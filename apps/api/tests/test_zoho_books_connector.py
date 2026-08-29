import json
import os
import unittest
from datetime import date
from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse
from unittest.mock import MagicMock, patch

from app.modules.datasets.services import connectors
from app.modules.oauth.service import (
    build_authorization_url,
    exchange_code,
    normalize_zoho_books_accounts_server,
)


class ZohoBooksConnectorTests(unittest.TestCase):
    def test_accounts_server_normalizes_known_oauth_paths(self):
        self.assertEqual(
            normalize_zoho_books_accounts_server(
                "https://accounts.zoho.com/oauth/v2/auth"
            ),
            "https://accounts.zoho.com",
        )
        self.assertEqual(
            normalize_zoho_books_accounts_server(
                "https://accounts.zoho.eu/oauth/v2/token/"
            ),
            "https://accounts.zoho.eu",
        )

    def test_token_exchange_uses_query_parameters(self):
        with patch.dict(
            os.environ,
            {
                "ZOHO_BOOKS_CLIENT_ID": "client-id",
                "ZOHO_BOOKS_CLIENT_SECRET": "client-secret",
                "ZOHO_BOOKS_OAUTH_AUTHORIZATION_URL": (
                    "https://accounts.zoho.com/oauth/v2/auth"
                ),
                "ZOHO_BOOKS_OAUTH_TOKEN_URL": (
                    "https://accounts.zoho.com/oauth/v2/token"
                ),
                "ZOHO_BOOKS_OAUTH_SCOPES": (
                    "ZohoBooks.settings.READ ZohoBooks.invoices.READ "
                    "ZohoBooks.contacts.READ ZohoBooks.expenses.READ "
                    "ZohoBooks.customerpayments.READ ZohoBooks.creditnotes.READ "
                    "ZohoBooks.estimates.READ ZohoBooks.salesorders.READ "
                    "ZohoBooks.projects.READ"
                ),
                "OAUTH_CALLBACK_URL": "http://localhost:8000/oauth/callback",
            },
            clear=False,
        ), patch("app.modules.oauth.service.urlopen") as mocked_urlopen:
            response = MagicMock()
            response.read.return_value = (
                b'{"access_token":"access","refresh_token":"refresh"}'
            )
            response.__enter__.return_value = response
            mocked_urlopen.return_value = response

            payload = exchange_code("zoho_books", "auth-code")

        request = mocked_urlopen.call_args.args[0]
        query = parse_qs(urlparse(request.full_url).query)
        self.assertEqual(payload["access_token"], "access")
        self.assertEqual(query["code"], ["auth-code"])
        self.assertEqual(query["client_id"], ["client-id"])
        self.assertEqual(query["client_secret"], ["client-secret"])
        self.assertIsNone(request.data)

    def test_oauth_uses_offline_read_scopes(self):
        with patch.dict(
            os.environ,
            {
                "ZOHO_BOOKS_CLIENT_ID": "client-id",
                "ZOHO_BOOKS_CLIENT_SECRET": "client-secret",
                "ZOHO_BOOKS_OAUTH_AUTHORIZATION_URL": (
                    "https://accounts.zoho.com/oauth/v2/auth"
                ),
                "ZOHO_BOOKS_OAUTH_TOKEN_URL": (
                    "https://accounts.zoho.com/oauth/v2/token"
                ),
                "ZOHO_BOOKS_OAUTH_SCOPES": (
                    "ZohoBooks.settings.READ,"
                    "ZohoBooks.invoices.READ,"
                    "ZohoBooks.contacts.READ,"
                    "ZohoBooks.expenses.READ,"
                    "ZohoBooks.customerpayments.READ,"
                    "ZohoBooks.creditnotes.READ,"
                    "ZohoBooks.estimates.READ,"
                    "ZohoBooks.salesorders.READ,"
                    "ZohoBooks.projects.READ"
                ),
                "OAUTH_CALLBACK_URL": "http://localhost:8000/oauth/callback",
            },
            clear=False,
        ):
            url = build_authorization_url("zoho_books", "state-1")

        query = parse_qs(urlparse(url).query)
        self.assertEqual(
            query["scope"],
            [
                "ZohoBooks.settings.READ,ZohoBooks.invoices.READ,"
                "ZohoBooks.contacts.READ,ZohoBooks.expenses.READ,"
                "ZohoBooks.customerpayments.READ,ZohoBooks.creditnotes.READ,"
                "ZohoBooks.estimates.READ,ZohoBooks.salesorders.READ,"
                "ZohoBooks.projects.READ"
            ],
        )
        self.assertEqual(query["access_type"], ["offline"])
        self.assertEqual(query["prompt"], ["consent"])

    def test_resource_selection_is_normalized_and_deduplicated(self):
        self.assertEqual(
            connectors.normalize_zoho_books_resource_types(
                {
                    "resource_types": [
                        "Invoices",
                        "customer payments",
                        "customer_payments",
                        "sales-orders",
                    ]
                }
            ),
            ["invoices", "customer_payments", "sales_orders"],
        )

    def test_invoice_sync_preserves_provider_fields(self):
        connection = SimpleNamespace(
            id=7,
            source_type="zoho_books",
            connection_config=json.dumps(
                {
                    "organization_id": "123456789",
                    "api_domain": "https://www.zohoapis.com",
                    "resource_types": ["invoices"],
                }
            ),
        )

        def fake_request(url, headers):
            self.assertIn("/books/v3/invoices?", url)
            self.assertIn("organization_id=123456789", url)
            self.assertIn("date_start=2026-01-01", url)
            self.assertIn("date_end=2026-01-31", url)
            self.assertEqual(
                headers["Authorization"],
                "Zoho-oauthtoken zoho-access-token",
            )
            return {
                "invoices": [
                    {
                        "invoice_id": "invoice-1",
                        "invoice_number": "INV-1001",
                        "date": "2026-01-02",
                        "total": 125.50,
                        "customer_name": "Acme Ltd",
                        "custom_fields": [
                            {"label": "Segment", "value": "SMB"}
                        ],
                    }
                ],
                "page_context": {"has_more_page": False},
            }

        with patch.dict(
            os.environ,
            {
                "ZOHO_BOOKS_API_BASE_URL": "https://www.zohoapis.com/books/v3",
            },
            clear=False,
        ), patch.object(
            connectors,
            "get_oauth_access_token",
            return_value="zoho-access-token",
        ), patch.object(
            connectors,
            "connector_json_request",
            side_effect=fake_request,
        ):
            dataframe, report = connectors.load_connector_dataframe(
                None,
                connection,
                date(2026, 1, 1),
                date(2026, 1, 31),
                zoho_books_resource_type="invoices",
            )

        self.assertEqual(len(dataframe), 1)
        self.assertEqual(dataframe.iloc[0]["record_id"], "invoice-1")
        self.assertEqual(dataframe.iloc[0]["total_amount"], 125.50)
        self.assertEqual(dataframe.iloc[0]["custom_fields__0__value"], "SMB")
        self.assertEqual(report["connector"], "zoho_books")
        self.assertEqual(report["organization_id"], "123456789")

    def test_customer_payment_sync_does_not_send_unsupported_range_filters(self):
        connection = SimpleNamespace(
            id=8,
            source_type="zoho_books",
            connection_config=json.dumps(
                {
                    "organization_id": "123456789",
                    "api_domain": "https://www.zohoapis.com",
                    "resource_types": ["customer_payments"],
                }
            ),
        )

        def fake_request(url, headers):
            self.assertIn("/books/v3/customerpayments?", url)
            self.assertNotIn("date_start", url)
            self.assertNotIn("date_end", url)
            return {
                "customer_payments": [
                    {
                        "payment_id": "payment-1",
                        "date": "2026-01-02",
                        "amount": 80,
                    }
                ],
                "page_context": None,
            }

        with patch.dict(
            os.environ,
            {},
            clear=False,
        ), patch.object(
            connectors,
            "get_oauth_access_token",
            return_value="zoho-access-token",
        ), patch.object(
            connectors,
            "connector_json_request",
            side_effect=fake_request,
        ):
            dataframe, _report = connectors.load_connector_dataframe(
                None,
                connection,
                date(2026, 1, 1),
                date(2026, 1, 31),
                zoho_books_resource_type="customer_payments",
            )

        self.assertEqual(len(dataframe), 1)
        self.assertEqual(dataframe.iloc[0]["payment_id"], "payment-1")


if __name__ == "__main__":
    unittest.main()
