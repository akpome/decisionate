import json
import os
import unittest
from datetime import date
from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse
from unittest.mock import patch

from app.modules.datasets.services import connectors
from app.modules.oauth.service import (
    build_authorization_url,
    get_sage_token_url,
    normalize_sage_country,
)


class SageConnectorTests(unittest.TestCase):
    def test_sage_authorization_uses_read_only_consent(self):
        with patch.dict(
            os.environ,
            {
                "SAGE_CLIENT_ID": "client-id",
                "SAGE_CLIENT_SECRET": "client-secret",
                "SAGE_OAUTH_AUTHORIZATION_URL": (
                    "https://www.sageone.com/oauth2/auth/central?filter=api.v3.1"
                ),
                "SAGE_OAUTH_TOKEN_URL": "https://oauth.example/token",
                "SAGE_OAUTH_SCOPES": "readonly",
            },
            clear=False,
        ):
            url = build_authorization_url(
                "sage",
                "state-1",
                {"country": "CA"},
            )
            token_url = get_sage_token_url("US")

        self.assertIn("sageone.com/oauth2/auth/central", url)
        query = parse_qs(urlparse(url).query)
        self.assertEqual(query["filter"], ["apiv3.1"])
        self.assertEqual(query["country"], ["ca"])
        self.assertEqual(query["scope"], ["readonly"])
        self.assertEqual(token_url, "https://oauth.example/token")

    def test_sage_uses_central_token_endpoint_for_legacy_region_values(self):
        with patch.dict(
            os.environ,
            {
                "SAGE_OAUTH_TOKEN_URL": (
                    "https://oauth.accounting.sage.com/token"
                ),
            },
            clear=False,
        ):
            self.assertEqual(
                get_sage_token_url("CA"),
                "https://oauth.accounting.sage.com/token",
            )
            self.assertEqual(
                get_sage_token_url("US"),
                "https://oauth.accounting.sage.com/token",
            )
            self.assertEqual(
                get_sage_token_url("DE"),
                "https://oauth.accounting.sage.com/token",
            )
            self.assertEqual(
                get_sage_token_url("ES"),
                "https://oauth.accounting.sage.com/token",
            )
            self.assertEqual(
                get_sage_token_url("FR"),
                "https://oauth.accounting.sage.com/token",
            )
            self.assertEqual(
                get_sage_token_url("GB"),
                "https://oauth.accounting.sage.com/token",
            )
            self.assertEqual(
                get_sage_token_url("IE"),
                "https://oauth.accounting.sage.com/token",
            )

    def test_sage_normalizes_region_aliases(self):
        self.assertEqual(normalize_sage_country("Canada"), "CA")
        self.assertEqual(normalize_sage_country("United States"), "US")
        self.assertEqual(normalize_sage_country("Germany"), "DE")
        self.assertEqual(normalize_sage_country("Spain"), "ES")
        self.assertEqual(normalize_sage_country("France"), "FR")
        self.assertEqual(normalize_sage_country("UK"), "GB")
        self.assertEqual(normalize_sage_country("IE"), "IE")

    def test_sage_uses_central_endpoint_without_region(self):
        with patch.dict(
            os.environ,
            {
                "SAGE_OAUTH_TOKEN_URL": (
                    "https://oauth.accounting.sage.com/token"
                ),
            },
            clear=False,
        ):
            self.assertEqual(
                get_sage_token_url(),
                "https://oauth.accounting.sage.com/token",
            )

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
            self.assertNotIn("Ocp-Apim-Subscription-Key", headers)
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

    def test_sage_invoices_sync_by_updated_or_created_date(self):
        connection = SimpleNamespace(
            id=9,
            source_type="sage",
            connection_config=json.dumps({"business_id": "business-1"}),
        )

        def fake_request(url, headers):
            self.assertIn(
                "updated_or_created_since=2026-01-01T00%3A00%3A00%2B00%3A00",
                url,
            )
            self.assertNotIn("from_date=", url)
            self.assertNotIn("to_date=", url)
            return {
                "$items": [{
                    "id": "invoice-updated",
                    "date": "2020-01-02",
                    "updated_at": "2026-01-15T12:00:00Z",
                    "total_amount": 1400,
                }],
                "$next": None,
            }

        with patch.dict(
            os.environ,
            {
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
            dataframe, _ = connectors.load_sage_dataframe(
                None,
                connection,
                date(2026, 1, 1),
                date(2026, 1, 31),
            )

        self.assertEqual(len(dataframe), 1)
        self.assertEqual(dataframe.iloc[0]["record_id"], "invoice-updated")

    def test_sage_resource_selection_uses_documented_endpoint(self):
        connection = SimpleNamespace(
            id=8,
            source_type="sage",
            connection_config=json.dumps(
                {
                    "business_id": "business-1",
                    "resource_types": ["contacts", "ledger_accounts"],
                }
            ),
        )

        def fake_request(url, headers):
            self.assertIn("/contacts?", url)
            self.assertIn("items_per_page=100", url)
            self.assertIn("page=1", url)
            self.assertEqual(headers["X-Site"], "business-1")
            return {
                "$items": [{
                    "id": "contact-1",
                    "displayed_as": "Acme Ltd",
                    "email": "finance@example.com",
                }],
                "$next": None,
            }

        with patch.dict(
            os.environ,
            {
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
                resource_type_override="contacts",
            )

        self.assertEqual(len(dataframe), 1)
        self.assertEqual(dataframe.iloc[0]["contact_id"], "contact-1")
        self.assertEqual(dataframe.iloc[0]["contact_name"], "Acme Ltd")
        self.assertEqual(report["resource"], "contacts")

    def test_sage_requires_at_least_one_supported_resource(self):
        with self.assertRaises(connectors.ConnectorUnavailable):
            connectors.normalize_sage_resource_types({"resource_types": []})

        self.assertEqual(
            connectors.normalize_sage_resource_types({}),
            ["sales_invoices"],
        )


if __name__ == "__main__":
    unittest.main()
