import json
import os
import unittest
from datetime import date
from types import SimpleNamespace
from unittest.mock import patch

from app.modules.datasets.services import connectors
from app.modules.oauth.service import build_authorization_url, get_sage_token_url


class SageConnectorTests(unittest.TestCase):
    def test_sage_authorization_uses_read_only_consent(self):
        with patch.dict(
            os.environ,
            {
                "SAGE_CLIENT_ID": "client-id",
                "SAGE_CLIENT_SECRET": "client-secret",
                "SAGE_OAUTH_AUTHORIZATION_URL": (
                    "https://www.sageone.com/oauth2/auth/central"
                ),
                "SAGE_OAUTH_TOKEN_URL": "https://oauth.example/token",
                "SAGE_OAUTH_SCOPES": "readonly",
            },
            clear=False,
        ):
            url = build_authorization_url("sage", "state-1")
            token_url = get_sage_token_url("US")

        self.assertIn("sageone.com/oauth2/auth/central", url)
        self.assertIn("scope=readonly", url)
        self.assertEqual(token_url, "https://oauth.example/token")

    def test_sage_invoices_are_normalized_for_analytics(self):
        connection = SimpleNamespace(
            id=7,
            source_type="sage",
            connection_config=json.dumps({"business_id": "business-1"}),
        )

        def fake_request(url, headers):
            self.assertIn("sales_invoices", url)
            self.assertEqual(headers["Authorization"], "Bearer sage-token")
            self.assertEqual(headers["X-Site"], "business-1")
            self.assertEqual(
                headers["Ocp-Apim-Subscription-Key"],
                "subscription-key",
            )
            return {
                "$items": [{
                    "id": "invoice-1",
                    "displayed_as": "SI-1001",
                    "date": "2026-01-02",
                    "due_date": "2026-02-01",
                    "status": "PROGRESS",
                    "total_amount": 1200,
                    "contact": {
                        "id": "contact-1",
                        "displayed_as": "Acme Ltd",
                    },
                    "currency": {"id": "GBP"},
                }],
            }

        with patch.dict(
            os.environ,
            {
                "SAGE_API_SUBSCRIPTION_KEY": "subscription-key",
                "SAGE_API_BASE_URL": "https://api.example/sage",
                "SAGE_BUSINESS_HEADER": "X-Site",
            },
            clear=False,
        ), patch.object(
            connectors,
            "get_oauth_access_token",
            return_value="sage-token",
        ), patch.object(
            connectors,
            "connector_json_request",
            side_effect=fake_request,
        ):
            dataframe, report = connectors.load_sage_dataframe(
                None,
                connection,
                date(2026, 1, 1),
                date(2026, 1, 31),
            )

        self.assertEqual(len(dataframe), 1)
        self.assertEqual(dataframe.iloc[0]["invoice_id"], "invoice-1")
        self.assertEqual(dataframe.iloc[0]["total_amount"], 1200)
        self.assertEqual(report["connector"], "sage")


if __name__ == "__main__":
    unittest.main()
