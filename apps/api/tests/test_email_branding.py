import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app.infrastructure import email_branding
from app.modules.alerts import email_delivery
from app.modules.alerts.schemas import WeeklyReportDigestResponse


class EmailBrandingTests(unittest.TestCase):
    def setUp(self):
        runtime = patch.object(email_branding, "get_runtime_configuration",
                               return_value=SimpleNamespace(web_url="https://www.decisionate.ca"))
        runtime.start()
        self.addCleanup(runtime.stop)

    def email_settings(self, provider):
        return {
            "provider": provider, "configured": True,
            "smtp_host": "smtp.example.test", "smtp_port": 587,
            "smtp_username": "", "smtp_password": "", "smtp_use_tls": False, "smtp_use_ssl": False,
            "smtp_timeout_seconds": 10, "smtp_from_email": "no-reply@decisionate.ca", "smtp_from_name": "Decisionate",
            "resend_from_email": "no-reply@decisionate.ca", "resend_from_name": "Decisionate",
            "resend_api_url": "https://api.resend.com/emails", "resend_api_key": "test-only-key",
        }

    def delivered_content(self, provider, smtp, http):
        if provider == "resend":
            payload = json.loads(http.call_args.args[0].data)
            return payload["text"], payload["html"], payload
        message = smtp.return_value.__enter__.return_value.send_message.call_args.args[0]
        return (message.get_body(preferencelist=("plain",)).get_content(),
                message.get_body(preferencelist=("html",)).get_content(), message)

    def test_logo_uses_absolute_png_url_without_query_or_fragment(self):
        for base, expected in [
            ("https://www.decisionate.ca", "https://www.decisionate.ca/icons/decisionate-logo.png"),
            ("https://web.example.test/app/?token=ignored#anchor", "https://web.example.test/app/icons/decisionate-logo.png"),
            ("web.example.test", "https://web.example.test/icons/decisionate-logo.png"),
            ("http://localhost:3000", "http://localhost:3000/icons/decisionate-logo.png"),
        ]:
            with self.subTest(base=base), patch.object(email_branding, "get_runtime_configuration",
                    return_value=SimpleNamespace(web_url=base)):
                self.assertEqual(email_branding.build_decisionate_logo_url(), expected)

    def test_invalid_logo_host_leaves_readable_brand_name_without_broken_image(self):
        for base in ("", "file:///logo", "https://", "https://web.example.test:bad", "https://user:secret@web.example.test"):
            with self.subTest(base=base), patch.object(email_branding, "get_runtime_configuration",
                    return_value=SimpleNamespace(web_url=base)):
                self.assertIsNone(email_branding.build_decisionate_logo_url())
                header = email_branding.build_decisionate_email_header()
                self.assertIn("Decisionate", header)
                self.assertNotIn("<img", header)

    def test_system_html_escapes_subject_body_and_preserves_safe_clickable_urls(self):
        subject = "Trial <ended> & billing"
        body = 'Hello <script>alert(1)</script>,\n\nOpen billing: https://www.decisionate.ca/dashboard/billing?workspace_id=owner&tab=plan\njavascript:alert(1)'
        html = email_branding.build_system_email_html(subject, body)
        self.assertIn("Trial &lt;ended&gt; &amp; billing", html)
        self.assertNotIn("<script>", html)
        self.assertIn("&lt;script&gt;", html)
        self.assertIn('href="https://www.decisionate.ca/dashboard/billing?workspace_id=owner&amp;tab=plan"', html)
        self.assertNotIn('href="javascript:', html)
        self.assertIn('alt="Decisionate" width="42" height="42"', html)
        self.assertIn('name="viewport"', html)
        self.assertIn('role="presentation"', html)

    def test_system_emails_have_logo_and_plain_text_on_both_transports(self):
        body = "Hello,\n\nYour trial has ended.\nOpen billing: https://www.decisionate.ca/dashboard/billing\n\nDecisionate"
        for provider in ("smtp", "resend"):
            with self.subTest(provider=provider), patch.object(email_delivery, "get_platform_email_settings",
                    return_value=self.email_settings(provider)), patch.object(email_delivery.smtplib, "SMTP") as smtp, patch.object(
                        email_delivery, "urlopen") as http:
                smtp.return_value.__enter__.return_value.send_message.return_value = {}
                http.return_value.__enter__.return_value.status = 200
                email_delivery.send_platform_system_email("owner@example.test", "Your trial has ended", body,
                    reply_to="support@decisionate.ca", sender_name="Agency via Decisionate")
                text, html, message = self.delivered_content(provider, smtp, http)
            self.assertEqual(text.rstrip("\n"), body)
            self.assertIn("https://www.decisionate.ca/icons/decisionate-logo.png", html)
            self.assertIn("Your trial has ended", html)
            self.assertNotIn("Unsubscribe", html)
            if provider == "resend":
                self.assertEqual(message["from"], "Agency via Decisionate <no-reply@decisionate.ca>")
                self.assertEqual(message["reply_to"], ["support@decisionate.ca"])
            else:
                self.assertEqual(str(message["From"]), "Agency via Decisionate <no-reply@decisionate.ca>")
                self.assertEqual(str(message["Reply-To"]), "support@decisionate.ca")

    def test_support_emails_have_logo_without_changing_recipient_or_reply_to(self):
        for provider in ("smtp", "resend"):
            with self.subTest(provider=provider), patch.object(email_delivery, "get_platform_email_settings",
                    return_value=self.email_settings(provider)), patch.object(email_delivery, "clean_env_value",
                    return_value="support@example.test"), patch.object(email_delivery.smtplib, "SMTP") as smtp, patch.object(
                        email_delivery, "urlopen") as http:
                smtp.return_value.__enter__.return_value.send_message.return_value = {}
                http.return_value.__enter__.return_value.status = 200
                email_delivery.send_support_request_email("help", "owner@example.test", "Need <help>",
                    "Message <script>bad()</script>", "https://www.decisionate.ca/dashboard", "owner", "owner")
                text, html, message = self.delivered_content(provider, smtp, http)
            self.assertIn("Message <script>bad()</script>", text)
            self.assertIn("Need &lt;help&gt;", html)
            self.assertNotIn("<script>", html)
            self.assertIn("/icons/decisionate-logo.png", html)
            if provider == "resend":
                self.assertEqual(message["to"], ["support@example.test"])
                self.assertEqual(message["reply_to"], ["owner@example.test"])
            else:
                self.assertEqual(str(message["To"]), "support@example.test")
                self.assertEqual(str(message["Reply-To"]), "owner@example.test")

    def test_business_report_includes_decisionate_logo_without_brand_configuration(self):
        digest = WeeklyReportDigestResponse(enabled=True, cadence="weekly", delivery_day="monday",
            recipient_emails=["owner@example.test"], metric_focus=[], subject="Weekly report", preview_text="Report",
            dataset_count=0, metrics=[], recommendations=[], unavailable_datasets=[])
        html = email_delivery.build_weekly_report_email_html(digest)
        self.assertIn("https://www.decisionate.ca/icons/decisionate-logo.png", html)
        self.assertNotIn(".svg", html)
        self.assertEqual(html.count('alt="Decisionate"'), 1)
        self.assertNotIn("<img", email_delivery.build_weekly_report_email_text(digest))

    def test_agency_report_without_custom_logo_uses_text_not_decisionate_logo(self):
        for logo in (None, "javascript:alert(1)"):
            with self.subTest(logo=logo):
                digest = WeeklyReportDigestResponse(enabled=True, cadence="weekly", delivery_day="monday",
                    recipient_emails=["owner@example.test"], metric_focus=[], subject="Client report", preview_text="Report",
                    dataset_count=0, metrics=[], recommendations=[], unavailable_datasets=[], brand_name="Agency <Name>",
                    is_managed_client=True, agency_name="Agency <Name>", workspace_name="Client", brand_logo_url=logo)
                html = email_delivery.build_weekly_report_email_html(digest)
                self.assertIn("Agency &lt;Name&gt;", html)
                self.assertNotIn("/icons/decisionate-logo.png", html)
                self.assertNotIn("<img", html)
                self.assertNotIn('src="javascript:', html)

    def test_client_system_email_uses_only_agency_logo_on_both_transports(self):
        branding = {"is_managed_client": True, "brand_name": "North <Star> Agency",
                    "brand_logo_url": "https://agency.example.test/logo.png"}
        body = "Hello,\n\nPlease reconnect your business data.\n\nPowered by Decisionate"
        for provider in ("smtp", "resend"):
            with self.subTest(provider=provider), patch.object(email_delivery, "get_platform_email_settings",
                    return_value=self.email_settings(provider)), patch.object(email_delivery.smtplib, "SMTP") as smtp, patch.object(
                        email_delivery, "urlopen") as http:
                smtp.return_value.__enter__.return_value.send_message.return_value = {}
                http.return_value.__enter__.return_value.status = 200
                email_delivery.send_platform_system_email("client@example.test", "Reconnect your data", body,
                    sender_name="North Star Agency via Decisionate", branding=branding)
                text, html, _ = self.delivered_content(provider, smtp, http)
            self.assertEqual(text.rstrip("\n"), body)
            self.assertIn(branding["brand_logo_url"], html)
            self.assertIn("North &lt;Star&gt; Agency", html)
            self.assertNotIn("/icons/decisionate-logo.png", html)
            self.assertNotIn('alt="Decisionate"', html)

    def test_client_system_email_never_substitutes_decisionate_for_missing_logo(self):
        for logo in (None, "", "javascript:alert(1)", "https://"):
            with self.subTest(logo=logo):
                html = email_branding.build_system_email_html("Notice", "Body", branding={
                    "is_managed_client": True, "brand_name": "North Star Agency", "brand_logo_url": logo})
                self.assertIn("North Star Agency", html)
                self.assertNotIn("<img", html)
                self.assertNotIn("/icons/decisionate-logo.png", html)

    def test_owner_system_email_retains_decisionate_even_with_custom_workspace_brand(self):
        html = email_branding.build_system_email_html("Notice", "Body", branding={
            "is_managed_client": False, "brand_name": "Agency owner", "brand_logo_url": "https://agency.example.test/logo.png"})
        self.assertIn("/icons/decisionate-logo.png", html)
        self.assertNotIn("https://agency.example.test/logo.png", html)
