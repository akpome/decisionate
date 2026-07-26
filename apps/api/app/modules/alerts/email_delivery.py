import os
import logging
import smtplib
from email.message import EmailMessage

from fastapi import HTTPException

from app.modules.alerts.schemas import (
    WeeklyReportDigestResponse,
    WeeklyReportAIAnalysis,
)


logger = logging.getLogger(__name__)


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


def is_email_delivery_configured(
    sender_email: str | None = None,
    smtp_host: str | None = None,
) -> bool:
    return bool(
        (
            str(smtp_host or "").strip()
            or clean_env_value("SMTP_HOST")
        )
        and (
            clean_env_value("SMTP_FROM_EMAIL")
            or str(sender_email or "").strip()
        )
    )


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
                "Set SMTP_HOST and either a workspace sender email or SMTP_FROM_EMAIL."
            ),
        )


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
    else:
        lines.append(
            "- No matching KPI metrics are available yet."
        )

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

    lines.extend([
        "",
        f"Generated by {digest.brand_name}.",
    ])

    return "\n".join(lines)


def get_weekly_report_analysis_source_label(
    analysis: WeeklyReportAIAnalysis,
) -> str:
    if analysis.source == "openai":
        return f"AI analysis ({analysis.model or 'configured provider'})"

    fallback_labels = {
        "provider_unavailable": "AI provider unavailable",
        "unsupported_provider": "unsupported AI provider",
        "not_configured": "AI provider not configured",
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
) -> EmailMessage:
    from_email = (
        digest.sender_email
        or clean_env_value(
            "SMTP_FROM_EMAIL",
        )
    )
    from_name = (
        digest.sender_name
        or clean_env_value(
            "SMTP_FROM_NAME",
            digest.brand_name,
        )
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
        host = clean_env_value(
            "SMTP_HOST",
        )
        port = clean_env_int(
            "SMTP_PORT",
            587,
        )
        username = clean_env_value(
            "SMTP_USERNAME",
        )
        password = clean_env_value(
            "SMTP_PASSWORD",
        )
        use_tls = clean_env_bool(
            "SMTP_USE_TLS",
            True,
        )
        use_ssl = clean_env_bool(
            "SMTP_USE_SSL",
            False,
        )
    timeout_seconds = clean_env_int(
        "SMTP_TIMEOUT_SECONDS",
        10,
    )

    if not digest.recipient_emails:
        raise HTTPException(
            status_code=400,
            detail="No weekly report recipients are configured",
        )

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
                smtp.send_message(
                    build_weekly_report_email_message(
                        digest,
                        recipient,
                    )
                )
    except Exception as error:
        logger.exception(
            "Weekly report email delivery failed"
        )
        raise HTTPException(
            status_code=502,
            detail=(
                "Weekly report email could not be sent. "
                "Check the delivery settings and try again."
            ),
        ) from error

    return {
        "delivered_count": len(
            digest.recipient_emails
        ),
        "recipients": [
            *digest.recipient_emails,
        ],
    }
