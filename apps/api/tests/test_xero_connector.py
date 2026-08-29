import json
import unittest
from datetime import date
from types import SimpleNamespace
from unittest.mock import patch

from app.modules.datasets.services import connectors
from app.modules.oauth.service import OAUTH_PROVIDERS, get_provider_scopes


TENANT_ID = "123e4567-e89b-12d3-a456-426614174000"


def make_connection(config=None):
    return SimpleNamespace(
        id=1,
        source_type="xero",
        connection_config=json.dumps(config or {"tenant_id": TENANT_ID}),
        last_synced_at=None,
    )


class XeroConnectorTests(unittest.TestCase):
    def test_resource_normalization_defaults_legacy_connections_to_invoices(self):
        self.assertEqual(
            connectors.normalize_xero_resource_types(
                {"tenant_id": TENANT_ID}
            ),
            ["invoices"],
        )
        self.assertEqual(
            connectors.normalize_xero_resource_types({
                "resource_types": "contacts, payments, contacts",
            }),
            ["contacts", "payments"],
        )

    def test_all_supported_resources_use_the_documented_collection(self):
        expected = {
            "invoices": "Invoices",
            "contacts": "Contacts",
            "payments": "Payments",
            "credit_notes": "CreditNotes",
            "quotes": "Quotes",
            "purchase_orders": "PurchaseOrders",
            "accounts": "Accounts",
            "items": "Items",
        }

        for resource_type, endpoint in expected.items():
            with self.subTest(resource_type=resource_type):
                requested_urls = []

                def json_request(url, headers):
                    requested_urls.append(url)
                    self.assertEqual(headers["Xero-tenant-id"], TENANT_ID)
                    return {
                        endpoint: [{
                            "DateString": "2026-01-02",
                            "UpdatedDateUTCString": "2026-01-03T00:00:00Z",
                            "InvoiceID": "invoice-1",
                            "ContactID": "contact-1",
                            "PaymentID": "payment-1",
                            "CreditNoteID": "credit-note-1",
                            "QuoteID": "quote-1",
                            "PurchaseOrderID": "purchase-order-1",
                            "AccountID": "account-1",
                            "ItemID": "item-1",
                            "Name": "Northstar Retail",
                            "Total": 125.5,
                            "provider_specific_field": "retained",
                            "Contact": {"ContactID": "contact-1"},
                            "LineItems": [{"Description": "Service"}],
                        }],
                    }

                with patch.object(
                    connectors,
                    "get_oauth_access_token",
                    return_value="xero-access-token",
                ), patch.object(
                    connectors,
                    "require_provider_url",
                    return_value="https://api.xero.com/api.xro/2.0",
                ), patch.object(
                    connectors,
                    "connector_json_request",
                    side_effect=json_request,
                ):
                    dataframe, report = connectors.load_xero_dataframe(
                        None,
                        make_connection(),
                        date(2026, 1, 1),
                        date(2026, 1, 31),
                        resource_type,
                    )

                self.assertEqual(report["resource"], resource_type)
                self.assertEqual(report["object_type"], endpoint)
                self.assertEqual(len(dataframe), 1)
                self.assertEqual(
                    dataframe.iloc[0]["provider_specific_field"],
                    "retained",
                )
                self.assertIn(f"/{endpoint}?", requested_urls[0])

    def test_unsupported_resource_is_rejected(self):
        with self.assertRaisesRegex(
            connectors.ConnectorUnavailable,
            "unsupported resource",
        ):
            connectors.normalize_xero_resource_type("bank_transactions")

    def test_xero_accepts_current_granular_read_scopes(self):
        provider = OAUTH_PROVIDERS["xero"]
        with patch.dict(
            "os.environ",
            {
                "XERO_OAUTH_SCOPES": (
                    "openid profile email offline_access "
                    "accounting.invoices.read accounting.payments.read "
                    "accounting.contacts.read accounting.settings.read"
                ),
            },
            clear=False,
        ):
            scopes = get_provider_scopes(provider, {
                "resource_types": "invoices, payments, contacts, accounts",
            })

        self.assertIn("accounting.invoices.read", scopes)
        self.assertIn("accounting.payments.read", scopes)


if __name__ == "__main__":
    unittest.main()
