import types
import unittest
from unittest.mock import patch

from app.modules.datasets.router import record_scheduled_connector_failure
from app.modules.datasets.services.connectors import ConnectorUnavailable
from app.modules.oauth.service import OAuthProviderUnavailable


class FakeDb:
    def __init__(self):
        self.rollback_count = 0
        self.commit_count = 0

    def rollback(self):
        self.rollback_count += 1

    def commit(self):
        self.commit_count += 1


class ConnectorSchedulerApiTests(unittest.TestCase):
    def test_expired_oauth_for_any_connector_is_nonfatal(self):
        failures = (
            (
                "salesforce",
                OAuthProviderUnavailable("Salesforce refresh token expired"),
            ),
            (
                "quickbooks",
                ConnectorUnavailable("QuickBooks access token has expired"),
            ),
        )

        for source_type, error in failures:
            with self.subTest(source_type=source_type):
                db = FakeDb()
                connection = types.SimpleNamespace(
                    id=26,
                    source_type=source_type,
                    status="connected",
                    authorization_error=None,
                    authorization_error_at=None,
                )
                results = []

                with patch(
                    "app.modules.datasets.router.notify_workspace_owner_of_authorization_failure",
                    side_effect=RuntimeError("mail service unavailable"),
                ):
                    record_scheduled_connector_failure(
                        db,
                        connection,
                        error,
                        results,
                    )

                self.assertEqual(connection.status, "draft")
                self.assertIn("expired", connection.authorization_error)
                self.assertEqual(db.commit_count, 1)
                self.assertEqual(results[0]["connection_id"], 26)
                self.assertEqual(results[0]["status"], "failed")


if __name__ == "__main__":
    unittest.main()
