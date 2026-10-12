"""Shared presentation for Decisionate-owned email, independent of delivery provider."""

import re
from html import escape
from urllib.parse import urlsplit, urlunsplit

from app.configuration import get_runtime_configuration


DECISIONATE_LOGO_PATH = "/icons/decisionate-logo.png"


def build_decisionate_logo_url() -> str | None:
    try:
        base = str(get_runtime_configuration().web_url or "").strip()
        if not base:
            return None
        if "://" not in base:
            base = "https://" + base
        parsed = urlsplit(base)
        if (parsed.scheme not in {"http", "https"} or not parsed.hostname
                or parsed.username or parsed.password or parsed.port == 0
                or any(char.isspace() for char in parsed.netloc)):
            return None
        return urlunsplit((parsed.scheme, parsed.netloc, parsed.path.rstrip("/") + DECISIONATE_LOGO_PATH, "", ""))
    except (RuntimeError, ValueError):
        return None


def render_decisionate_logo(width: int = 42) -> str:
    url = build_decisionate_logo_url()
    if not url:
        return ""
    return (f'<img src="{escape(url, quote=True)}" alt="Decisionate" width="{width}" height="{width}" '
            f'style="display:block;border:0;width:{width}px;height:{width}px;">')


def build_decisionate_email_header() -> str:
    logo = render_decisionate_logo()
    image_cell = f'<td width="42" style="padding:0 12px 0 0;vertical-align:middle;">{logo}</td>' if logo else ""
    return ('<table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" '
            f'style="margin:0 auto 24px;"><tr>{image_cell}'
            '<td style="vertical-align:middle;text-align:left;">'
            '<div style="font-size:20px;line-height:24px;font-weight:700;color:#111827;">Decisionate</div>'
            '<div style="font-size:12px;line-height:18px;color:#64748B;">Decisions from Data.</div>'
            '</td></tr></table>')


def clean_email_logo_url(value: str | None) -> str | None:
    value = str(value or "").strip()
    if not value:
        return None
    try:
        parsed = urlsplit(value)
        if parsed.scheme in {"http", "https"} and parsed.hostname:
            return value
    except ValueError:
        return None
    return value if value.lower().startswith("data:image/") else None


def build_client_email_header(brand_name: str | None, logo_url: str | None) -> str:
    name = escape(" ".join(str(brand_name or "Your agency").split()))
    logo_url = clean_email_logo_url(logo_url)
    logo = (f'<img src="{escape(logo_url, quote=True)}" alt="{name}" width="160" '
            'style="display:block;max-width:160px;height:auto;margin:0 auto 12px;border:0;">') if logo_url else ""
    return ('<table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" '
            f'style="margin:0 auto 24px;"><tr><td style="text-align:center;">{logo}'
            f'<div style="font-size:20px;line-height:1.4;font-weight:700;color:#111827;word-break:break-word;">{name}</div>'
            '</td></tr></table>')


def _linked_text(value: str) -> str:
    parts, cursor = [], 0
    for match in re.finditer(r"https?://[^\s<>\"']+", value):
        parts.append(escape(value[cursor:match.start()]))
        url = match.group()
        label = escape(url)
        try:
            valid = bool(urlsplit(url).hostname)
        except ValueError:
            valid = False
        parts.append(f'<a href="{escape(url, quote=True)}" style="color:#0047FF;word-break:break-all;">{label}</a>' if valid else label)
        cursor = match.end()
    parts.append(escape(value[cursor:]))
    return "".join(parts).replace("\n", "<br>")


def build_system_email_html(subject: str, body: str, *, branding: dict | None = None) -> str:
    branding = branding or {}
    header = (build_client_email_header(branding.get("brand_name"), branding.get("brand_logo_url"))
              if branding.get("is_managed_client") else build_decisionate_email_header())
    paragraphs = "".join(
        '<p style="margin:0 0 18px;font-size:14px;line-height:1.6;overflow-wrap:anywhere;word-break:break-word;">'
        f'{_linked_text(paragraph)}</p>' for paragraph in body.split("\n\n") if paragraph
    )
    return ('<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head>'
            '<body style="margin:0;background:#F8FAFC;font-family:Arial,Helvetica,sans-serif;color:#334155;">'
            '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">'
            '<tr><td align="center" style="padding:24px 16px;">'
            '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" '
            'style="max-width:600px;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:6px;">'
            '<tr><td height="4" style="background:#00C6E5;font-size:0;line-height:0;">&nbsp;</td></tr>'
            f'<tr><td style="padding:24px;">{header}'
            f'<h1 style="margin:0 0 24px;font-size:22px;line-height:1.3;color:#111827;word-break:break-word;">{escape(subject)}</h1>'
            f'{paragraphs}</td></tr></table></td></tr></table></body></html>')
