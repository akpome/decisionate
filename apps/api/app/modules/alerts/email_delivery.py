import os
import logging
import json
import smtplib
from datetime import datetime
from datetime import timezone
from email.message import EmailMessage
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from fastapi import HTTPException

from app.db.database import SessionLocal
from app.db.models import PlatformEmailSettings
from app.modules.alerts.schemas import (
    WeeklyReportDigestResponse,
    WeeklyReportAIAnalysis,
)
from app.security.secrets import decrypt_secret


logger = logging.getLogger(__name__)


class WeeklyReportEmailDeliveryError(HTTPException):
    """Preserve partial SMTP delivery details for the delivery history log."""

    def __init__(
        self,
        detail: str,
        recipients: list[str],
        delivered_recipients: list[str],
    ):
        self.delivery_recipients = recipients
        self.delivered_recipients = delivered_recipients
        super().__init__(
            status_code=502,
            detail=detail,
        )


def clean_env_value(
    name: str,
    default: str = "",
) -> str:
    return str(
        os.getenv(
            name,
            default,
        )
        or ""
    ).strip()


def clean_env_bool(
    name: str,
    default: bool,
) -> bool:
    value = clean_env_value(
        name,
    ).lower()

    if not value:
        return default

    return value in {
        "1",
        "true",
        "yes",
        "on",
    }


def clean_env_int(
    name: str,
    default: int,
) -> int:
    value = clean_env_value(
        name,
    )

    if not value:
        return default

    try:
        return int(value)
    except ValueError:
        return default


def get_platform_email_settings() -> dict:
    """Return persisted Decisionate SMTP settings with env fallback."""
    saved_settings = None
    db = SessionLocal()
    try:
        saved_settings = (
            db.query(PlatformEmailSettings)
            .filter(PlatformEmailSettings.id == 1)
            .first()
        )
    except Exception as error:
        logger.warning(
            "Platform email settings could not be loaded: %s",
            error,
        )
    finally:
        db.close()

    def saved_or_env(attribute: str, environment_name: str) -> str:
        saved_value = getattr(saved_settings, attribute, None)
        if attribute in {"resend_api_key", "smtp_password"}:
            saved_value = decrypt_secret(saved_value)
        return str(
            saved_value
            or clean_env_value(environment_name)
            or ""
        ).strip()

    has_saved_settings = bool(
        saved_settings
        and (
            saved_settings.provider
            or saved_settings.resend_api_key
            or saved_settings.resend_from_email
            or saved_settings.smtp_host
            or saved_settings.smtp_from_email
            or saved_settings.smtp_username
            or saved_settings.smtp_password
        )
    )
    use_tls = (
        bool(saved_settings.smtp_use_tls)
        if saved_settings and saved_settings.smtp_use_tls is not None
        else clean_env_bool("SMTP_USE_TLS", True)
    )
    use_ssl = (
        bool(saved_settings.smtp_use_ssl)
        if saved_settings and saved_settings.smtp_use_ssl is not None
        else clean_env_bool("SMTP_USE_SSL", False)
    )
    password = saved_or_env(
        "smtp_password",
        "SMTP_PASSWORD",
    )
    resend_api_key = saved_or_env(
        "resend_api_key",
        "RESEND_API_KEY",
    )
    resend_from_email = saved_or_env(
        "resend_from_email",
        "RESEND_FROM_EMAIL",
    )
    resend_from_name = saved_or_env(
        "resend_from_name",
        "RESEND_FROM_NAME",
    ) or "Decisionate"
    configured_provider = str(
        getattr(saved_settings, "provider", None) or ""
    ).strip().lower()
    provider = configured_provider or clean_env_value("EMAIL_PROVIDER").lower()
    resend_from_email = (
        resend_from_email
        or clean_env_value("RESEND_FROM_EMAIL")
        or saved_or_env("smtp_from_email", "SMTP_FROM_EMAIL")
    )
    resend_from_name = (
        resend_from_name
        or clean_env_value("RESEND_FROM_NAME")
        or "Decisionate"
    )
    resend_api_url = clean_env_value("RESEND_API_URL")
    if provider not in {"smtp", "resend"}:
        provider = ""
    provider_configured = bool(
        provider == "resend"
        and resend_api_key
        and resend_api_url
        and resend_from_email
    ) or bool(
        provider == "smtp"
        and saved_or_env("smtp_host", "SMTP_HOST")
        and saved_or_env("smtp_from_email", "SMTP_FROM_EMAIL")
    )
    return {
        "provider": provider,
        "smtp_host": saved_or_env("smtp_host", "SMTP_HOST"),
        "smtp_port": (
            int(saved_settings.smtp_port)
            if saved_settings and saved_settings.smtp_port
            else clean_env_int("SMTP_PORT", 587)
        ),
        "smtp_username": saved_or_env(
            "smtp_username",
            "SMTP_USERNAME",
        ),
        "smtp_password": password,
        "smtp_from_email": saved_or_env(
            "smtp_from_email",
            "SMTP_FROM_EMAIL",
        ),
        "smtp_from_name": (
            saved_or_env("smtp_from_name", "SMTP_FROM_NAME")
        ),
        "smtp_use_tls": use_tls,
        "smtp_use_ssl": use_ssl,
        "smtp_timeout_seconds": clean_env_int(
            "SMTP_TIMEOUT_SECONDS",
            10,
        ),
        "resend_api_key": resend_api_key,
        "resend_api_url": resend_api_url,
        "resend_from_email": resend_from_email,
        "resend_from_name": resend_from_name,
        "source": (
            "database"
            if has_saved_settings
            else (
                "environment"
                if provider_configured
                else "unconfigured"
            )
        ),
        "configured": provider_configured,
    }


def is_email_delivery_configured(
    sender_email: str | None = None,
    smtp_host: str | None = None,
) -> bool:
    platform_settings = get_platform_email_settings()
    if platform_settings["provider"] == "resend":
        return bool(platform_settings["configured"])
    return bool(
        (
            str(smtp_host or "").strip()
            or platform_settings["smtp_host"]
        )
        and (
            platform_settings["smtp_from_email"]
            or str(sender_email or "").strip()
        )
    )


def get_email_delivery_source(
    sender_email: str | None = None,
    smtp_host: str | None = None,
) -> str:
    workspace_host = str(
        smtp_host or ""
    ).strip()
    workspace_sender = str(
        sender_email or ""
    ).strip()

    if workspace_host and (
        workspace_sender or
        get_platform_email_settings()["smtp_from_email"]
    ):
        return "workspace"

    if is_email_delivery_configured():
        return "decisionate"

    return "unconfigured"


def require_email_delivery_configured(
    sender_email: str | None = None,
    smtp_host: str | None = None,
):
    if not is_email_delivery_configured(
        sender_email,
        smtp_host,
    ):
        raise HTTPException(
            status_code=503,
            detail=(
                "Email delivery is not configured. "
                "Configure Decisionate email delivery or a workspace SMTP sender."
            ),
        )


def _send_resend_message(
    message: EmailMessage,
    settings: dict,
) -> None:
    body = message.get_content()
    sender_name = settings["resend_from_name"] or "Decisionate"
    sender_email = settings["resend_from_email"]
    payload = {
        "from": f"{sender_name} <{sender_email}>",
        "to": [message["To"]],
        "subject": str(message["Subject"] or "Decisionate message"),
        "text": body,
    }
    if message.get("Reply-To"):
        payload["reply_to"] = [message["Reply-To"]]

    request = Request(
        settings["resend_api_url"],
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {settings['resend_api_key']}",
            "Content-Type": "application/json",
            "User-Agent": "Decisionate email delivery",
        },
        method="POST",
    )
    try:
        with urlopen(
            request,
            timeout=settings["smtp_timeout_seconds"],
        ) as response:
            if response.status >= 300:
                raise RuntimeError(
                    f"Resend returned HTTP {response.status}"
                )
    except (HTTPError, URLError, TimeoutError, OSError) as error:
        raise RuntimeError("Resend email delivery failed") from error


def _send_platform_message(message: EmailMessage) -> None:
    settings = get_platform_email_settings()
    require_email_delivery_configured()
    if settings["provider"] == "resend":
        _send_resend_message(message, settings)
        return

    smtp_class = smtplib.SMTP_SSL if settings["smtp_use_ssl"] else smtplib.SMTP
    with smtp_class(
        settings["smtp_host"],
        settings["smtp_port"],
        timeout=settings["smtp_timeout_seconds"],
    ) as smtp:
        if settings["smtp_use_tls"] and not settings["smtp_use_ssl"]:
            smtp.starttls()
        if settings["smtp_username"]:
            smtp.login(settings["smtp_username"], settings["smtp_password"])
        refused_recipients = smtp.send_message(message) or {}
        if refused_recipients:
            raise RuntimeError(f"Email recipient refused: {refused_recipients}")


def send_platform_system_email(
    recipient: str,
    subject: str,
    body: str,
    reply_to: str | None = None,
) -> None:
    """Send a Decisionate-owned system message through platform SMTP."""
    clean_recipient = str(recipient or "").strip()
    if not clean_recipient:
        raise HTTPException(
            status_code=400,
            detail="System email recipient is required",
        )

    platform_settings = get_platform_email_settings()
    require_email_delivery_configured()
    message = EmailMessage()
    from_name = platform_settings["smtp_from_name"] or "Decisionate"
    message["Subject"] = subject
    message["From"] = f"{from_name} <{platform_settings['smtp_from_email']}>"
    message["To"] = clean_recipient
    if reply_to:
        message["Reply-To"] = reply_to
    message.set_content(body)

    try:
        _send_platform_message(message)
    except HTTPException:
        raise
    except Exception as error:
        logger.error(
            "System email delivery failed: %s",
            error,
        )
        raise HTTPException(
            status_code=502,
            detail="System email could not be delivered",
        ) from error


def build_weekly_report_email_text(
    digest: WeeklyReportDigestResponse,
) -> str:
    lines = [
        digest.subject,
        "",
        digest.preview_text,
        "",
        "KPI metrics",
    ]

    if digest.ai_analysis:
        lines[4:4] = [
            "Analysis",
            digest.ai_analysis.summary,
            f"Analysis confidence: {digest.ai_analysis.confidence}",
            "Analysis source: "
            + get_weekly_report_analysis_source_label(
                digest.ai_analysis,
            ),
            "",
        ]

        learning_context = digest.ai_analysis.learning_context
        evidence_parts = []
        if learning_context:
            evidence_parts = []
            learning_scope_labels = {
                "workspace": "workspace decisions",
                "dataset": "this dataset's decisions",
                "metric": "this metric's decisions",
                "decision": "this decision's history",
            }
            learning_scope = learning_scope_labels.get(
                learning_context.learning_scope,
                "workspace decisions",
            )
            if learning_context.recorded_outcome_count > 0:
                evidence_parts.append(
                    f"{learning_context.recorded_outcome_count} recorded "
                    "decision outcome"
                    + (
                        "s"
                        if learning_context.recorded_outcome_count != 1
                        else ""
                    )
                )
                outcome_breakdown = []
                if learning_context.successful_outcome_count > 0:
                    outcome_breakdown.append(
                        f"{learning_context.successful_outcome_count} successful"
                    )
                if learning_context.partially_successful_outcome_count > 0:
                    outcome_breakdown.append(
                        f"{learning_context.partially_successful_outcome_count} partially successful"
                    )
                if learning_context.unsuccessful_outcome_count > 0:
                    outcome_breakdown.append(
                        f"{learning_context.unsuccessful_outcome_count} unsuccessful"
                    )
                if outcome_breakdown:
                    evidence_parts.append(
                        "Outcome pattern: "
                        + ", ".join(outcome_breakdown)
                    )
                if learning_context.historical_success_rate is not None:
                    evidence_parts.append(
                        "Weighted historical success signal: "
                        f"{learning_context.historical_success_rate:.0%}"
                    )
            if learning_context.recorded_recommendation_count > 0:
                evidence_parts.append(
                    f"{learning_context.recorded_recommendation_count} prior recommendation"
                    + (
                        "s"
                        if learning_context.recorded_recommendation_count != 1
                        else ""
                    )
                    + " with recorded results"
                )
            if learning_context.recorded_lesson_count > 0:
                evidence_parts.append(
                    f"{learning_context.recorded_lesson_count} recorded "
                    "decision lesson"
                    + (
                        "s"
                        if learning_context.recorded_lesson_count != 1
                        else ""
                    )
                )

        if learning_context and evidence_parts:
            lines[4:4] = [
                "Learning context: informed by "
                + " and ".join(evidence_parts)
                + f" from {learning_scope}.",
                "",
            ]

    if digest.metrics:
        for metric in digest.metrics:
            lines.extend([
                "",
                f"- {metric.column} ({metric.dataset_name})",
                f"  Total: {format_digest_number(metric.total)}",
                f"  Average: {format_digest_number(metric.average)}",
                f"  Minimum: {format_digest_number(metric.minimum)}",
                f"  Maximum: {format_digest_number(metric.maximum)}",
            ])
            if metric.target is not None:
                lines.append(
                    "  KPI target: "
                    + format_digest_number(metric.target)
                )
    else:
        lines.append(
            "- No matching KPI metrics are available yet."
        )

    if digest.relationships:
        lines.extend([
            "",
            "Cross-source evidence",
        ])
        for relationship in digest.relationships:
            correlation = (
                f"{relationship.correlation:.2f}"
                if relationship.correlation is not None
                else relationship.relationship_strength
            )
            lines.extend([
                "",
                f"- {relationship.name}",
                f"  {relationship.left_dataset_name} · "
                f"{relationship.left_metric} -> "
                f"{relationship.right_dataset_name} · "
                f"{relationship.right_metric}",
                f"  Relationship: {relationship.direction} "
                f"({correlation}) across "
                f"{relationship.matched_period_count} shared "
                f"{relationship.period} periods",
                f"  Evidence: {relationship.decision_context}",
            ])

    if digest.ai_analysis and digest.ai_analysis.risks:
        lines.extend([
            "",
            "Risks to review",
        ])

        for risk in digest.ai_analysis.risks:
            lines.append(
                f"- {risk}"
            )

    if digest.recommendations:
        lines.extend([
            "",
            "Recommendations",
        ])

        for recommendation in digest.recommendations:
            lines.append(
                f"- {recommendation}"
            )

    if digest.unavailable_datasets:
        lines.extend([
            "",
            "Unavailable datasets",
            ", ".join(
                digest.unavailable_datasets
            ),
        ])

    if digest.decision_template_url:
        lines.extend([
            "",
            "Start a decision from a template",
            digest.decision_template_url,
        ])

    lines.extend([
        "",
        f"Generated by {digest.brand_name}.",
    ])

    return "\n".join(lines)


def get_weekly_report_analysis_source_label(
    analysis: WeeklyReportAIAnalysis,
) -> str:
    if analysis.source != "rules":
        return f"AI analysis ({analysis.model or 'configured provider'})"

    fallback_labels = {
        "provider_unavailable": "AI provider unavailable",
        "unsupported_provider": "unsupported AI provider",
        "not_configured": "AI provider not configured",
        "credits_exhausted": "AI credits exhausted",
    }
    fallback_label = fallback_labels.get(
        analysis.fallback_reason or "not_configured",
        "AI provider unavailable",
    )
    return f"deterministic rules fallback ({fallback_label})"


def format_digest_number(
    value: float | None,
) -> str:
    if value is None:
        return "—"

    return f"{value:,.2f}"


def build_weekly_report_email_message(
    digest: WeeklyReportDigestResponse,
    recipient: str,
    platform_settings: dict | None = None,
) -> EmailMessage:
    platform_settings = (
        platform_settings
        or get_platform_email_settings()
    )
    from_email = (
        digest.sender_email
        or platform_settings["smtp_from_email"]
    )
    from_name = (
        digest.sender_name
        or platform_settings["smtp_from_name"]
        or digest.brand_name
    )
    sender = (
        f"{from_name} <{from_email}>"
        if from_name
        else from_email
    )

    message = EmailMessage()
    message["Subject"] = digest.subject
    message["From"] = sender
    message["To"] = recipient
    if digest.reply_to_email:
        message["Reply-To"] = digest.reply_to_email
    message.set_content(
        build_weekly_report_email_text(
            digest
        )
    )

    return message


def send_weekly_report_email(
    digest: WeeklyReportDigestResponse,
    smtp_settings: dict | None = None,
) -> dict:
    platform_settings = get_platform_email_settings()
    workspace_smtp_host = str(
        (smtp_settings or {}).get(
            "smtp_host",
            "",
        )
        or ""
    ).strip()
    require_email_delivery_configured(
        digest.sender_email,
        workspace_smtp_host,
    )

    if workspace_smtp_host:
        host = workspace_smtp_host
        port = int(
            (smtp_settings or {}).get(
                "smtp_port",
            )
            or 587
        )
        username = str(
            (smtp_settings or {}).get(
                "smtp_username",
                "",
            )
            or ""
        ).strip()
        password = str(
            (smtp_settings or {}).get(
                "smtp_password",
                "",
            )
            or ""
        )
        use_tls = bool(
            (smtp_settings or {}).get(
                "smtp_use_tls",
                True,
            )
        )
        use_ssl = bool(
            (smtp_settings or {}).get(
                "smtp_use_ssl",
                False,
            )
        )
    else:
        host = platform_settings["smtp_host"]
        port = platform_settings["smtp_port"]
        username = platform_settings["smtp_username"]
        password = platform_settings["smtp_password"]
        use_tls = platform_settings["smtp_use_tls"]
        use_ssl = platform_settings["smtp_use_ssl"]
    timeout_seconds = platform_settings["smtp_timeout_seconds"]

    if not digest.recipient_emails:
        raise HTTPException(
            status_code=400,
            detail="No weekly report recipients are configured",
        )

    if not workspace_smtp_host and platform_settings["provider"] == "resend":
        delivered_recipients: list[str] = []
        try:
            for recipient in digest.recipient_emails:
                message = build_weekly_report_email_message(
                    digest,
                    recipient,
                    platform_settings,
                )
                _send_resend_message(message, platform_settings)
                delivered_recipients.append(recipient)
        except Exception as error:
            failed_recipients = [
                recipient
                for recipient in digest.recipient_emails
                if recipient not in delivered_recipients
            ]
            raise WeeklyReportEmailDeliveryError(
                detail=(
                    "Weekly report email could not be sent to "
                    f"{len(failed_recipients)} recipient"
                    f"{'s' if len(failed_recipients) != 1 else ''}. "
                    f"{len(delivered_recipients)} recipient"
                    f"{'s were' if len(delivered_recipients) != 1 else ' was'} delivered."
                ),
                recipients=[*digest.recipient_emails],
                delivered_recipients=delivered_recipients,
            ) from error
        return {
            "delivered_count": len(delivered_recipients),
            "recipients": delivered_recipients,
        }

    delivered_recipients: list[str] = []
    failed_recipients: list[str] = []
    delivery_error: Exception | None = None

    try:
        smtp_class = (
            smtplib.SMTP_SSL
            if use_ssl
            else smtplib.SMTP
        )

        with smtp_class(
            host,
            port,
            timeout=timeout_seconds,
        ) as smtp:
            if use_tls and not use_ssl:
                smtp.starttls()

            if username:
                smtp.login(
                    username,
                    password,
                )

            for recipient in digest.recipient_emails:
                try:
                    refused_recipients = smtp.send_message(
                        build_weekly_report_email_message(
                            digest,
                            recipient,
                            platform_settings,
                        )
                    ) or {}
                    if refused_recipients:
                        failed_recipients.append(recipient)
                    else:
                        delivered_recipients.append(recipient)
                except Exception as error:
                    failed_recipients.append(recipient)
                    delivery_error = error
    except Exception as error:
        delivery_error = error
        failed_recipients.extend(
            recipient
            for recipient in digest.recipient_emails
            if recipient not in delivered_recipients
            and recipient not in failed_recipients
        )

    if failed_recipients or delivery_error:
        logger.error(
            "Weekly report email delivery failed: %s",
            delivery_error or f"refused recipients: {failed_recipients}",
        )
        raise WeeklyReportEmailDeliveryError(
            detail=(
                "Weekly report email could not be sent to "
                f"{len(failed_recipients)} recipient"
                f"{'s' if len(failed_recipients) != 1 else ''}. "
                f"{len(delivered_recipients)} recipient"
                f"{'s were' if len(delivered_recipients) != 1 else ' was'} delivered."
            ),
            recipients=[*digest.recipient_emails],
            delivered_recipients=delivered_recipients,
        )

    return {
        "delivered_count": len(
            delivered_recipients
        ),
        "recipients": [
            *delivered_recipients,
        ],
    }


def send_support_request_email(
    request_type: str,
    requester_email: str,
    subject: str,
    message: str,
    page_url: str,
    user_id: str,
    workspace_id: str,
    authenticated_email: str = "",
    workspace_name: str = "",
    workspace_role: str = "",
    user_agent: str = "",
    referer: str = "",
):
    require_email_delivery_configured()

    platform_settings = get_platform_email_settings()
    host = platform_settings["smtp_host"]
    port = platform_settings["smtp_port"]
    username = platform_settings["smtp_username"]
    password = platform_settings["smtp_password"]
    use_tls = platform_settings["smtp_use_tls"]
    use_ssl = platform_settings["smtp_use_ssl"]
    timeout_seconds = platform_settings["smtp_timeout_seconds"]
    from_email = platform_settings["smtp_from_email"]
    from_name = platform_settings["smtp_from_name"] or "Decisionate Support"
    recipient = clean_env_value(
        "SUPPORT_EMAIL",
        "support@decisionate.ca",
    )

    email = EmailMessage()
    email["Subject"] = f"[Decisionate {request_type}] {subject}"
    email["From"] = f"{from_name} <{from_email}>"
    email["To"] = recipient
    email["Reply-To"] = requester_email
    email.set_content(
        "\n".join([
            f"Request type: {request_type}",
            f"Requester: {requester_email}",
            f"Authenticated account: {authenticated_email or 'Unavailable'}",
            f"User ID: {user_id}",
            f"Workspace: {workspace_name or 'Unavailable'}",
            f"Workspace ID: {workspace_id}",
            f"Workspace role: {workspace_role or 'Unavailable'}",
            f"Received UTC: {datetime.now(timezone.utc).isoformat()}",
            f"Page: {page_url or 'Not provided'}",
            f"Referrer: {referer or 'Not provided'}",
            f"User agent: {user_agent or 'Not provided'}",
            "",
            subject,
            "",
            message,
        ])
    )

    try:
        if platform_settings["provider"] == "resend":
            _send_resend_message(email, platform_settings)
        else:
            smtp_class = smtplib.SMTP_SSL if use_ssl else smtplib.SMTP
            with smtp_class(
                host,
                port,
                timeout=timeout_seconds,
            ) as smtp:
                if use_tls and not use_ssl:
                    smtp.starttls()
                if username:
                    smtp.login(username, password)
                refused_recipients = smtp.send_message(email) or {}
                if refused_recipients:
                    raise RuntimeError(
                        f"Support recipient refused: {refused_recipients}"
                    )
    except HTTPException:
        raise
    except Exception as error:
        logger.error(
            "Support request email delivery failed: %s",
            error,
        )
        raise HTTPException(
            status_code=502,
            detail="Support message could not be delivered",
        ) from error
