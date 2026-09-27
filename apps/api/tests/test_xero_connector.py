import json
import unittest
from datetime import date
from types import SimpleNamespace
from unittest.mock import patch

import pandas as pd

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

    def test_invoice_lines_are_one_row_per_item(self):
        def json_request(url, headers):
            self.assertEqual(headers["Xero-tenant-id"], TENANT_ID)
            return {
                "Invoices": [{
                    "InvoiceID": "invoice-1",
                    "DateString": "2026-01-02",
                    "UpdatedDateUTCString": "2026-01-03T00:00:00Z",
                    "Total": 125,
                    "LineItems": [
                        {
                            "LineItemID": "line-1",
                            "ItemCode": "CONSULTING",
                            "Description": "Consulting",
                            "Quantity": 1,
                            "UnitAmount": 100,
                            "LineAmount": 100,
                        },
                        {
                            "LineItemID": "line-2",
                            "ItemCode": "SUPPORT",
                            "Description": "Support",
                            "Quantity": 1,
                            "UnitAmount": 25,
                            "LineAmount": 25,
                        },
                    ],
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
                "invoices",
            )

        self.assertEqual(report["resource"], "invoices")
        self.assertEqual(dataframe["line_item_id"].tolist(), ["line-1", "line-2"])
        self.assertEqual(dataframe["item_description"].tolist(), ["Consulting", "Support"])
        self.assertEqual(dataframe.loc[0, "total"], 125)
        self.assertTrue(pd.isna(dataframe.loc[1, "total"]))
        self.assertFalse(any("LineItems__" in column for column in dataframe.columns))

    def test_master_data_is_not_removed_by_transaction_date_window(self):
        def json_request(url, headers):
            return {
                "Contacts": [{
                    "ContactID": "contact-1",
                    "Name": "Northstar Retail",
                    "UpdatedDateUTCString": "2020-01-03T00:00:00Z",
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
            dataframe, _report = connectors.load_xero_dataframe(
                None,
                make_connection(),
                date(2026, 1, 1),
                date(2026, 1, 31),
                "contacts",
            )

        self.assertEqual(len(dataframe), 1)
        self.assertEqual(dataframe.iloc[0]["contact_name"], "Northstar Retail")

    def test_transaction_sync_uses_updated_date_when_business_date_is_old(self):
        def json_request(url, headers):
            return {
                "Invoices": [{
                    "InvoiceID": "invoice-1",
                    "DateString": "2020-01-02",
                    "UpdatedDateUTCString": "2026-01-03T00:00:00Z",
                    "Total": 125.5,
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
            dataframe, _report = connectors.load_xero_dataframe(
                None,
                make_connection(),
                date(2026, 1, 1),
                date(2026, 1, 31),
                "invoices",
            )

        self.assertEqual(len(dataframe), 1)

    def test_transaction_sync_falls_back_to_created_date_when_updated_is_missing(self):
        def json_request(url, headers):
            return {
                "Invoices": [{
                    "InvoiceID": "invoice-1",
                    "DateString": "2020-01-02",
                    "Total": 125.5,
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
            dataframe, _report = connectors.load_xero_dataframe(
                None,
                make_connection(),
                date(2026, 1, 1),
                date(2026, 1, 31),
                "invoices",
            )

        self.assertTrue(dataframe.empty)

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
