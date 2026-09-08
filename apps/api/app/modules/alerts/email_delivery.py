import os
import logging
import json
import re
import smtplib
from datetime import datetime
from datetime import timezone
from email.message import EmailMessage
from email.utils import parseaddr
from html import escape as escape_html
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
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
DEFAULT_RESEND_API_URL = "https://api.resend.com/emails"


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
    """Return persisted platform email settings with env fallback."""
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
    resend_api_url = clean_env_value(
        "RESEND_API_URL",
        DEFAULT_RESEND_API_URL,
    )
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
    """Return readiness for the platform mail provider only.

    The arguments remain for compatibility with older callers, but workspace
    sender and SMTP values are intentionally ignored.
    """
    platform_settings = get_platform_email_settings()

    if platform_settings["provider"] == "resend":
        return bool(platform_settings["configured"])
    return bool(
        platform_settings["smtp_host"]
        and platform_settings["smtp_from_email"]
    )


def get_platform_sender_details(
    settings: dict,
) -> tuple[str, str]:
    if settings["provider"] == "resend":
        return (
            settings["resend_from_email"],
            settings["resend_from_name"] or "Decisionate",
        )

    return (
        settings["smtp_from_email"],
        settings["smtp_from_name"] or "Decisionate",
    )


def get_email_delivery_source(
    sender_email: str | None = None,
    smtp_host: str | None = None,
) -> str:
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
                "A platform administrator must configure the Decisionate email provider."
            ),
        )


def _send_resend_message(
    message: EmailMessage,
    settings: dict,
) -> None:
    plain_part = message.get_body(
        preferencelist=("plain",)
    )
    html_part = message.get_body(
        preferencelist=("html",)
    )
    body = (
        plain_part.get_content()
        if plain_part is not None
        else message.get_content()
    )
    sender_name = settings["resend_from_name"] or "Decisionate"
    sender_email = settings["resend_from_email"]
    requested_sender_name, requested_sender_email = parseaddr(
        str(message.get("From") or "")
    )
    if (
        requested_sender_email
        and requested_sender_email.casefold()
        == sender_email.casefold()
    ):
        sender_name = requested_sender_name or sender_name
    payload = {
        "from": f"{sender_name} <{sender_email}>",
        "to": [message["To"]],
        "subject": str(message["Subject"] or "Decisionate message"),
        "text": body,
    }
    if html_part is not None:
        payload["html"] = html_part.get_content()
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
    """Send a Decisionate-owned system message through the platform provider."""
    clean_recipient = str(recipient or "").strip()
    if not clean_recipient:
        raise HTTPException(
            status_code=400,
            detail="System email recipient is required",
        )

    platform_settings = get_platform_email_settings()
    require_email_delivery_configured()
    message = EmailMessage()
    from_email, from_name = get_platform_sender_details(
        platform_settings
    )
    message["Subject"] = subject
    message["From"] = f"{from_name} <{from_email}>"
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


def clean_email_brand_color(
    value: str | None,
    default: str,
) -> str:
    clean_value = str(value or "").strip()
    if re.fullmatch(r"#[0-9a-fA-F]{6}", clean_value):
        return clean_value
    return default


def clean_email_logo_url(
    value: str | None,
) -> str | None:
    clean_value = str(value or "").strip()
    if not clean_value:
        return None

    parsed_url = urlparse(clean_value)
    if parsed_url.scheme in {"http", "https"}:
        return clean_value
    if clean_value.lower().startswith("data:image/"):
        return clean_value
    return None


def build_weekly_report_email_html(
    digest: WeeklyReportDigestResponse,
) -> str:
    primary_color = clean_email_brand_color(
        digest.brand_primary_color,
        "#0F766E",
    )
    accent_color = clean_email_brand_color(
        digest.brand_accent_color,
        "#1D4ED8",
    )
    raw_brand_name = str(digest.brand_name or "Decisionate")
    raw_workspace_name = str(
        digest.workspace_name or digest.brand_name
    )
    brand_name = escape_html(raw_brand_name)
    workspace_name = escape_html(raw_workspace_name)
    logo_url = clean_email_logo_url(digest.brand_logo_url)
    logo = (
        f'<img src="{escape_html(logo_url, quote=True)}" '
        f'alt="{brand_name}" width="160" '
        'style="display:block;max-width:160px;height:auto;margin:0 auto 24px;">'
        if logo_url
        else (
            f'<div style="color:{primary_color};font-size:20px;'
            f'font-weight:700;margin:0 auto 24px;text-align:center;">'
            f"{brand_name}</div>"
        )
    )
    title = (
        "Weekly Performance Alert"
        if digest.is_managed_client
        else "KPI Performance Digest"
    )
    escaped_title = escape_html(title)
    escaped_subject = escape_html(digest.subject)

    metric_rows = []
    for metric in digest.metrics:
        metric_name = escape_html(metric.column)
        dataset_name = escape_html(metric.dataset_name)
        metric_value = format_digest_number(
            metric.total
            if metric.total is not None
            else metric.average
        )
        target_markup = ""
        if metric.target is not None:
            target_markup = (
                '<div style="color:#64748B;font-size:12px;margin-top:4px;">'
                "Target: "
                f"{escape_html(format_digest_number(metric.target))}"
                "</div>"
            )
        metric_rows.append(
            "<tr>"
            '<td style="border-bottom:1px solid #E2E8F0;padding:14px 0;">'
            f'<div style="color:#0F172A;font-size:15px;font-weight:700;">{metric_name}</div>'
            f'<div style="color:#64748B;font-size:12px;margin-top:3px;">{dataset_name}</div>'
            f"{target_markup}"
            "</td>"
            '<td align="right" style="border-bottom:1px solid #E2E8F0;'
            'padding:14px 0;color:#0F172A;font-size:17px;font-weight:700;'
            f'white-space:nowrap;">{escape_html(metric_value)}</td>'
            "</tr>"
        )
    metrics_markup = "".join(metric_rows)
    if not metrics_markup:
        metrics_markup = (
            '<tr><td colspan="2" style="color:#64748B;padding:14px 0;">'
            "No matching KPI metrics are available yet."
            "</td></tr>"
        )

    recommendation_items = "".join(
        f'<li style="margin:0 0 10px;">{escape_html(recommendation)}</li>'
        for recommendation in digest.recommendations
    )
    if not recommendation_items:
        recommendation_items = (
            '<li style="margin:0;">No recommendation is available yet.</li>'
        )
    recommendation_heading = (
        "Recommendation"
        if len(digest.recommendations) == 1
        else "Recommendations"
    )
    analysis_markup = ""
    if digest.ai_analysis:
        analysis_markup = (
            '<p style="color:#475569;font-size:14px;line-height:1.6;'
            f'margin:0 0 20px;">{escape_html(digest.ai_analysis.summary)}</p>'
        )
    review_url = digest.review_url or digest.decision_template_url
    review_markup = ""
    if review_url:
        review_markup = (
            '<table role="presentation" cellpadding="0" cellspacing="0" '
            'border="0" style="margin:28px auto 0;">'
            "<tr><td>"
            f'<a href="{escape_html(review_url, quote=True)}" '
            f'style="background:{accent_color};border-radius:5px;color:#FFFFFF;'
            'display:inline-block;font-size:14px;font-weight:700;padding:12px 20px;'
            'text-decoration:none;">Review in Dashboard</a>'
            "</td></tr></table>"
        )

    if digest.workspace_name:
        prepared_for = (
            f"Prepared for {raw_workspace_name} by {raw_brand_name}"
        )
    else:
        prepared_for = f"Prepared by {raw_brand_name}"
    escaped_prepared_for = escape_html(prepared_for)

    return (
        "<!doctype html>"
        '<html lang="en"><body style="margin:0;background:#F8FAFC;'
        'font-family:Arial,Helvetica,sans-serif;color:#0F172A;">'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        'border="0" style="background:#F8FAFC;"><tr><td align="center" '
        'style="padding:32px 16px;">'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        'border="0" style="max-width:600px;background:#FFFFFF;border:1px solid '
        '#E2E8F0;border-radius:8px;overflow:hidden;">'
        f'<tr><td style="height:6px;background:{primary_color};font-size:0;">&nbsp;</td></tr>'
        '<tr><td style="padding:34px 40px 28px;">'
        f"{logo}"
        f'<p style="color:#64748B;font-size:12px;letter-spacing:.04em;'
        f'margin:0 0 8px;text-align:center;text-transform:uppercase;">{brand_name}</p>'
        f'<h1 style="color:#0F172A;font-size:26px;line-height:1.2;margin:0;'
        f'text-align:center;">{escaped_title}</h1>'
        f'<p style="color:#334155;font-size:18px;margin:8px 0 6px;text-align:center;">'
        f"{workspace_name}</p>"
        f'<p style="color:#64748B;font-size:12px;margin:0;text-align:center;">'
        f"{escaped_subject}</p>"
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        'border="0" style="margin-top:30px;">'
        f"{metrics_markup}"
        "</table>"
        f'<div style="border-left:4px solid {primary_color};margin-top:30px;'
        'padding:2px 0 2px 16px;">'
        f'<h2 style="color:#0F172A;font-size:14px;letter-spacing:.04em;'
        f'margin:0 0 12px;text-transform:uppercase;">{recommendation_heading}</h2>'
        f"{analysis_markup}"
        f'<ul style="color:#334155;font-size:14px;line-height:1.5;margin:0;padding-left:20px;">'
        f"{recommendation_items}</ul></div>"
        f"{review_markup}"
        '<div style="border-top:1px solid #E2E8F0;margin-top:34px;padding-top:20px;'
        'text-align:center;">'
        f'<p style="color:#475569;font-size:13px;margin:0 0 8px;">{escaped_prepared_for}</p>'
        '<p style="color:#94A3B8;font-size:12px;margin:0;">Powered by Decisionate</p>'
        '</div></td></tr></table></td></tr></table>'
        "</body></html>"
    )


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
    from_email, from_name = get_platform_sender_details(
        platform_settings
    )
    if digest.is_managed_client:
        from_name = f"{digest.brand_name} via Decisionate"
    sender = (
        f"{from_name} <{from_email}>"
        if from_name
        else from_email
    )

    message = EmailMessage()
    message["Subject"] = digest.subject
    message["From"] = sender
    message["To"] = recipient
    message.set_content(
        build_weekly_report_email_text(
            digest
        )
    )
    message.add_alternative(
        build_weekly_report_email_html(
            digest
        ),
        subtype="html",
    )

    return message


def send_weekly_report_email(
    digest: WeeklyReportDigestResponse,
    smtp_settings: dict | None = None,
) -> dict:
    """Send a report through the platform-configured provider only."""
    platform_settings = get_platform_email_settings()
    require_email_delivery_configured()

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

    if platform_settings["provider"] == "resend":
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
    from_email, from_name = get_platform_sender_details(
        platform_settings
    )
    from_name = from_name or "Decisionate Support"
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
