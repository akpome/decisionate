import types
import unittest
from unittest.mock import patch

from app.modules.datasets.services.authorization_notifications import (
    notify_workspace_owner_of_authorization_failure,
)
from app.modules.datasets.services.connectors import (
    ConnectorUnavailable,
    connector_requires_reauthorization,
)


class FakeQuery:
    def __init__(self, result):
        self.result = result

    def filter(self, *_args, **_kwargs):
        return self

    def first(self):
        return self.result


class FakeDb:
    def __init__(self, organization):
        self.organization = organization
        self.commit_count = 0

    def query(self, _model):
        return FakeQuery(self.organization)

    def commit(self):
        self.commit_count += 1


class AuthorizationNotificationTests(unittest.TestCase):
    def build_connection(self, notification_error=None):
        return types.SimpleNamespace(
            id=17,
            user_id="owner-1",
            workspace_id="workspace-1",
            source_type="quickbooks",
            display_name="QuickBooks invoices",
            authorization_error=(
                "QuickBooks authorization is no longer valid. "
                "Reconnect the account and try again."
            ),
            authorization_notification_error=notification_error,
            authorization_notification_sent_at=None,
        )

    def test_sends_owner_email_once_for_a_new_authorization_failure(self):
        organization = types.SimpleNamespace(
            name="Acme Inc.",
            owner_user_id="workspace-1",
        )
        db = FakeDb(organization)
        connection = self.build_connection()

        with patch(
            "app.modules.datasets.services.authorization_notifications.get_workspace_owner_email",
            return_value="owner@example.com",
        ), patch(
            "app.modules.datasets.services.authorization_notifications.get_runtime_configuration",
            return_value=types.SimpleNamespace(
                web_url="https://app.example.com/",
            ),
        ), patch(
            "app.modules.datasets.services.authorization_notifications.send_platform_system_email",
        ) as send_email:
            sent = notify_workspace_owner_of_authorization_failure(
                db,
                connection,
            )

        self.assertTrue(sent)
        self.assertEqual(db.commit_count, 1)
        self.assertEqual(
            connection.authorization_notification_error,
            connection.authorization_error,
        )
        self.assertIsNotNone(connection.authorization_notification_sent_at)
        recipient, subject, body = send_email.call_args.args
        self.assertEqual(recipient, "owner@example.com")
        self.assertIn("QuickBooks", subject)
        self.assertIn("https://app.example.com/dashboard/connections", body)
        self.assertIn("Reauthorize", body.title())

    def test_does_not_resend_the_same_failure(self):
        connection = self.build_connection(
            notification_error=(
                "QuickBooks authorization is no longer valid. "
                "Reconnect the account and try again."
            )
        )
        db = FakeDb(types.SimpleNamespace(name="Acme Inc."))

        with patch(
            "app.modules.datasets.services.authorization_notifications.send_platform_system_email",
        ) as send_email:
            sent = notify_workspace_owner_of_authorization_failure(
                db,
                connection,
            )

        self.assertFalse(sent)
        send_email.assert_not_called()
        self.assertEqual(db.commit_count, 0)

    def test_delivery_failure_does_not_mark_notification_as_sent(self):
        organization = types.SimpleNamespace(
            name="Acme Inc.",
            owner_user_id="workspace-1",
        )
        db = FakeDb(organization)
        connection = self.build_connection()

        with patch(
            "app.modules.datasets.services.authorization_notifications.get_workspace_owner_email",
            return_value="owner@example.com",
        ), patch(
            "app.modules.datasets.services.authorization_notifications.send_platform_system_email",
            side_effect=RuntimeError("SMTP unavailable"),
        ):
            sent = notify_workspace_owner_of_authorization_failure(
                db,
                connection,
            )

        self.assertFalse(sent)
        self.assertIsNone(connection.authorization_notification_error)
        self.assertIsNone(connection.authorization_notification_sent_at)
        self.assertEqual(db.commit_count, 0)

    def test_recognizes_common_token_failure_messages(self):
        source_types = (
            "google_analytics",
            "google_ads",
            "hubspot",
            "meta_ads",
            "quickbooks",
            "freshbooks",
            "sage",
            "xero",
            "zoho_books",
            "salesforce",
            "shopify",
        )
        messages = (
            "access token has expired",
            "refresh token is invalid",
            "authorization revoked",
            "OAuth token exchange rejected",
        )

        for source_type in source_types:
            for message in messages:
                with self.subTest(source_type=source_type, message=message):
                    self.assertTrue(
                        connector_requires_reauthorization(
                            source_type,
                            ConnectorUnavailable(message),
                        )
                    )

    def test_recognizes_provider_specific_oauth_api_failures(self):
        failures = {
            "meta_ads": "Connector request failed with HTTP 400: OAuthException code 190",
            "google_analytics": "Google Analytics report request failed: 403 Permission denied",
            "shopify": "Connector request failed with HTTP 401: access token is invalid",
        }

        for source_type, message in failures.items():
            with self.subTest(source_type=source_type):
                self.assertTrue(
                    connector_requires_reauthorization(
                        source_type,
                        ConnectorUnavailable(message),
                    )
                )


if __name__ == "__main__":
    unittest.main()
