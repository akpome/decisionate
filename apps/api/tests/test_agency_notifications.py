import json
import unittest
from email.utils import parseaddr
from types import SimpleNamespace
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.db.models import AppUser, AuthIdentity, Organization, OrganizationMember
from app.modules.alerts import email_delivery
from app.modules.alerts.router import (
    build_weekly_report_digest,
    build_weekly_report_test_digest,
    get_weekly_report_branding,
)
from app.modules.alerts.schemas import WeeklyReportPreferenceResponse
from app.modules.billing.notifications import get_workspace_owner_email
from app.modules.datasets.services import authorization_notifications


class AgencyNotificationTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://")
        for model in (AppUser, AuthIdentity, Organization, OrganizationMember):
            model.__table__.create(self.engine)
        self.db = Session(self.engine)
        self.agency = Organization(
            name="North Star Agency",
            owner_user_id="agency-owner",
            report_display_name="Client Insights",
            logo_url="https://example.com/agency.png",
        )
        self.client = Organization(
            name="Smith Dental",
            owner_user_id="agency-owner:client:smith",
            report_display_name="Old Agency Name",
        )
        self.db.add_all([
            self.agency, self.client,
            AppUser(id="agency-owner", email="agency@example.com"),
            AppUser(id="client-owner", email="client@example.com"),
            AppUser(id="client-user", email="teammate@example.com"),
        ])
        self.db.flush()
        self.owner = OrganizationMember(
            organization_id=self.client.id,
            clerk_user_id="client-owner",
            role="client_owner",
        )
        self.db.add_all([
            self.owner,
            OrganizationMember(
                organization_id=self.client.id,
                clerk_user_id="client-user",
                role="client_user",
            ),
        ])
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def preference(self, prefix=""):
        return WeeklyReportPreferenceResponse(
            enabled=True, cadence="weekly", delivery_day="monday",
            recipient_emails=["client@example.com"], metric_focus=[],
            include_recommendations=True, subject_prefix=prefix,
        )

    def digest(self, prefix=""):
        branding = get_weekly_report_branding(self.db, self.client.owner_user_id)
        return build_weekly_report_digest(
            self.preference(prefix), [], branding["brand_name"],
            include_ai_analysis=False, branding=branding,
        )

    def email_settings(self, provider):
        return {
            "provider": provider, "configured": True,
            "smtp_host": "smtp.example.com", "smtp_port": 587,
            "smtp_username": "", "smtp_password": "",
            "smtp_use_tls": False, "smtp_use_ssl": False,
            "smtp_timeout_seconds": 10,
            "smtp_from_email": "alerts@decisionate.ca",
            "smtp_from_name": "Decisionate Alerts",
            "resend_from_email": "alerts@decisionate.ca",
            "resend_from_name": "Decisionate Alerts",
            "resend_api_url": "https://api.resend.com/emails",
            "resend_api_key": "test-key",
        }

    def test_actual_agency_name_is_kept_alongside_custom_report_brand(self):
        digest = self.digest("[Client KPI]")
        self.assertEqual(digest.brand_name, "Client Insights")
        self.assertEqual(digest.agency_name, "North Star Agency")
        self.assertEqual(digest.brand_logo_url, self.agency.logo_url)
        self.assertEqual(
            digest.subject,
            "[Client KPI] North Star Agency: Weekly Performance Alert \u2014 Smith Dental",
        )
        self.assertNotIn("Old Agency Name", digest.subject)

    def test_test_email_subject_and_bodies_include_agency_and_client(self):
        branding = get_weekly_report_branding(self.db, self.client.owner_user_id)
        digest = build_weekly_report_test_digest(None, branding["brand_name"], branding)
        self.assertIn("North Star Agency", digest.subject)
        self.assertIn("Smith Dental", digest.subject)
        for builder in (
            email_delivery.build_weekly_report_email_text,
            email_delivery.build_weekly_report_email_html,
        ):
            self.assertIn("Prepared for Smith Dental by North Star Agency", builder(digest))

    def test_sender_keeps_verified_platform_address_with_punctuation_and_unicode(self):
        self.agency.name = "Agence Nord, Inc. \u00c9quipe"
        self.db.commit()
        digest = self.digest()
        for provider in ("smtp", "resend"):
            message = email_delivery.build_weekly_report_email_message(
                digest, "client@example.com", self.email_settings(provider),
            )
            self.assertEqual(
                parseaddr(str(message["From"])),
                (f"{self.agency.name} via Decisionate", "alerts@decisionate.ca"),
            )

    def test_both_transports_preserve_agency_sender_subject_and_bodies(self):
        digest = self.digest()
        for provider in ("smtp", "resend"):
            with self.subTest(provider=provider), patch.object(
                email_delivery, "get_platform_email_settings",
                return_value=self.email_settings(provider),
            ), patch.object(email_delivery.smtplib, "SMTP") as smtp, patch.object(
                email_delivery, "urlopen",
            ) as urlopen:
                smtp.return_value.__enter__.return_value.send_message.return_value = {}
                urlopen.return_value.__enter__.return_value.status = 200
                result = email_delivery.send_weekly_report_email(digest)
            self.assertEqual(result["delivered_count"], 1)
            if provider == "smtp":
                message = smtp.return_value.__enter__.return_value.send_message.call_args.args[0]
                subject = str(message["Subject"])
                sender = str(message["From"])
                text = message.get_body(preferencelist=("plain",)).get_content()
                html = message.get_body(preferencelist=("html",)).get_content()
            else:
                payload = json.loads(urlopen.call_args.args[0].data)
                subject, sender = payload["subject"], payload["from"]
                text, html = payload["text"], payload["html"]
            self.assertIn("North Star Agency", subject)
            self.assertIn("North Star Agency via Decisionate", sender)
            self.assertEqual(parseaddr(sender)[1], "alerts@decisionate.ca")
            for body in (text, html):
                self.assertIn("Prepared for Smith Dental by North Star Agency", body)

    def test_agency_rename_applies_without_changing_client_settings(self):
        self.agency.name = "New Agency Name"
        self.db.commit()
        self.assertIn("New Agency Name", self.digest().subject)
        self.assertEqual(self.client.report_display_name, "Old Agency Name")

    def test_blank_report_brand_uses_agency_name(self):
        self.agency.report_display_name = "   "
        self.db.commit()
        digest = self.digest()
        self.assertEqual(digest.brand_name, "North Star Agency")
        self.assertEqual(digest.agency_name, "North Star Agency")

    def test_two_clients_keep_their_own_agency_identity_and_recipient(self):
        other_agency = Organization(name="Other Agency", owner_user_id="other-owner")
        other_client = Organization(name="Other Client", owner_user_id="other-owner:client:other")
        self.db.add_all([
            other_agency, other_client,
            AppUser(id="other-client-owner", email="other-client@example.com"),
        ])
        self.db.flush()
        self.db.add(OrganizationMember(
            organization_id=other_client.id,
            clerk_user_id="other-client-owner",
            role="client_owner",
        ))
        self.db.commit()
        for client, agency_name, recipient in (
            (self.client, "North Star Agency", "client@example.com"),
            (other_client, "Other Agency", "other-client@example.com"),
        ):
            branding = get_weekly_report_branding(self.db, client.owner_user_id)
            self.assertEqual(branding["agency_name"], agency_name)
            self.assertEqual(get_workspace_owner_email(self.db, client), recipient)

    def test_agency_text_is_escaped_in_html_and_header_newlines_are_normalized(self):
        self.agency.name = "North <Star> & Agency\r\nTeam"
        self.db.commit()
        digest = self.digest()
        self.assertNotIn("\n", digest.subject)
        html = email_delivery.build_weekly_report_email_html(digest)
        self.assertIn("North &lt;Star&gt; &amp; Agency Team", html)
        self.assertNotIn("North <Star>", html)

    def test_unrelated_and_missing_agencies_are_not_used(self):
        self.db.add(Organization(name="Other Agency", owner_user_id="other-owner"))
        self.client.owner_user_id = "missing-owner:client:smith"
        self.db.commit()
        branding = get_weekly_report_branding(self.db, self.client.owner_user_id)
        self.assertEqual(branding["agency_name"], "")
        self.assertEqual(branding["brand_name"], "Decisionate")

    def test_client_owner_email_resolves_member_and_legacy_owner_role(self):
        for role in ("client_owner", "client"):
            self.owner.role = role
            self.db.commit()
            self.assertEqual(get_workspace_owner_email(self.db, self.client), "client@example.com")

    def test_client_owner_email_can_use_linked_identity(self):
        self.db.get(AppUser, "client-owner").email = None
        self.db.add(AuthIdentity(
            user_id="client-owner", provider="clerk", subject="external-client",
            email="identity@example.com",
        ))
        self.db.commit()
        self.assertEqual(get_workspace_owner_email(self.db, self.client), "identity@example.com")

    def test_missing_client_owner_does_not_notify_agency_or_teammate(self):
        self.db.delete(self.owner)
        self.db.commit()
        self.assertIsNone(get_workspace_owner_email(self.db, self.client))

    def test_reauthorization_notice_uses_agency_name_and_client_owner(self):
        connection = SimpleNamespace(
            id=17, workspace_id=self.client.owner_user_id, user_id="agency-owner",
            source_type="quickbooks", display_name="Client QuickBooks",
            authorization_error="Authorization expired",
            authorization_notification_error=None,
            authorization_notification_sent_at=None,
        )
        with patch.object(
            authorization_notifications, "send_platform_system_email",
        ) as send:
            self.assertTrue(authorization_notifications.notify_workspace_owner_of_authorization_failure(self.db, connection))
            self.assertFalse(authorization_notifications.notify_workspace_owner_of_authorization_failure(self.db, connection))
        send.assert_called_once()
        recipient, subject, body = send.call_args.args
        self.assertEqual(recipient, "client@example.com")
        self.assertIn("North Star Agency", subject)
        self.assertIn("Smith Dental is managed by North Star Agency", body)
        self.assertEqual(send.call_args.kwargs["sender_name"], "North Star Agency via Decisionate")

    def test_system_sender_override_preserves_platform_address_and_default_sender(self):
        with patch.object(
            email_delivery, "get_platform_email_settings",
            return_value=self.email_settings("resend"),
        ), patch.object(email_delivery, "_send_platform_message") as send:
            email_delivery.send_platform_system_email("client@example.com", "Notice", "Body", sender_name="North Star Agency via Decisionate")
            email_delivery.send_platform_system_email("client@example.com", "Notice", "Body")
        self.assertEqual(parseaddr(str(send.call_args_list[0].args[0]["From"])), ("North Star Agency via Decisionate", "alerts@decisionate.ca"))
        self.assertEqual(parseaddr(str(send.call_args_list[1].args[0]["From"])), ("Decisionate Alerts", "alerts@decisionate.ca"))


if __name__ == "__main__":
    unittest.main()
