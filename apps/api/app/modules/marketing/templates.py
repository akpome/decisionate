from html import escape
from urllib.parse import urlencode

from app.configuration import get_runtime_configuration
from app.modules.marketing.config import absolute_url, settings
from app.modules.marketing.service import unsubscribe_token, workspace_facts


def render_message(db, contact, message):
    config, runtime = settings(), get_runtime_configuration()
    base = absolute_url(runtime.web_url)
    query = urlencode({"workspace_id": message.workspace_id, "utm_source": "decisionate",
                       "utm_medium": "email", "utm_campaign": message.message_type,
                       "utm_content": f"lifecycle-{message.id}"})
    unsubscribe = absolute_url(runtime.api_url) + "/marketing/unsubscribe?" + urlencode({"token": unsubscribe_token(contact)})
    name = str(contact.first_name or "there").strip() or "there"
    subject, text, label, path = {
        "welcome": ("Your first step in Decisionate", "Bring one source of business data into your workspace. Connect an accounting, sales or marketing tool, or upload a spreadsheet to start reviewing your numbers.", "Add your data", "/dashboard/datasets"),
        "incomplete_setup": ("Ready to add your first data source?", "Your workspace is ready for data. Choose a business tool to connect, or upload a spreadsheet. Once the import finishes, you can review trends and record your next decision.", "Add your data", "/dashboard/datasets"),
        "trial_ending": ("Your Decisionate trial is ending", "", "Review plans", "/dashboard/billing"),
    }[message.message_type]
    facts = workspace_facts(db, message.workspace_id)
    if facts and facts["account_type"] == "agency" and message.message_type in {"welcome", "incomplete_setup"}:
        subject = "Create your first client workspace" if message.message_type == "welcome" else "Ready to invite your first client?"
        text = "Create a client workspace and invite its owner. Each client connects and manages their own business data. When they grant your agency access, you can review performance, record decisions and coordinate actions together."
        label, path = "Manage client workspaces", "/dashboard/settings"
    if message.message_type == "trial_ending":
        deadline = (message.trial_deadline or facts["trial_ends_at"]).strftime("%d %B %Y at %H:%M UTC")
        text = f"Your trial ends on {deadline}. When the trial ends, workspace access requires a paid plan. Review the available plans and keep your data, decisions and follow-up work together."
    link = base + path + "?" + query
    footer = f"{config['identity']}\n{config['address']}\n{config['reply_to']}"
    plain = f"Hi {name},\n\n{text}\n\n{label}: {link}\n\n{footer}\n\nUnsubscribe from marketing: {unsubscribe}\nAccount notices and your configured reports have separate preferences."
    html = f"""<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;background:#f8f9fa;font-family:Arial,sans-serif;color:#1a1a1a">
<main style="max-width:560px;margin:0 auto;padding:28px 20px;background:white">
<p style="color:#0047ff;font-weight:bold;font-size:20px">Decisionate</p>
<h1 style="font-size:24px;line-height:1.3">{escape(subject)}</h1>
<p style="line-height:1.6">Hi {escape(name)},</p><p style="line-height:1.6">{escape(text)}</p>
<p style="margin:28px 0"><a href="{escape(link, quote=True)}" style="display:inline-block;padding:12px 18px;background:#0047ff;color:white;text-decoration:none;border-radius:6px">{escape(label)}</a></p>
<footer style="border-top:1px solid #ddd;padding-top:20px;font-size:12px;line-height:1.7;color:#555">
{escape(footer).replace(chr(10), '<br>')}<br><a href="{escape(unsubscribe, quote=True)}">Unsubscribe from marketing</a>
<p>Account notices and your configured reports have separate preferences.</p></footer></main></body></html>"""
    return {"subject": subject, "html": html, "text": plain, "headers": {
        "List-Unsubscribe": f"<{unsubscribe}>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"},
        "tags": [{"name": "decisionate_marketing_id", "value": str(message.id)},
                 {"name": "sequence", "value": message.message_type}]}
