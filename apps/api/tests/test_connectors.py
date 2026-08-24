import json
import os
import tempfile
import unittest
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import patch

import pandas as pd
from sqlalchemy import create_engine, text

from app.modules.datasets.services import connectors
from app.modules.datasets.services.sources import (
    IMPLEMENTED_CONNECTOR_TYPES,
    get_dataset_source,
)


def make_connection(source_type, config):
    return SimpleNamespace(
        id=1,
        source_type=source_type,
        connection_config=json.dumps(config),
    )


class ConnectorSmokeTests(unittest.TestCase):
    def test_dynamic_connector_rows_preserve_unmapped_provider_fields(self):
        row = connectors.build_dynamic_connector_row(
            {
                "id": "record-1",
                "custom_metric": 42,
                "customer": {
                    "segment": "enterprise",
                },
            },
            {
                "record_id": "record-1",
                "missing_alias": None,
            },
        )

        self.assertEqual(row["custom_metric"], 42)
        self.assertEqual(row["customer__segment"], "enterprise")
        self.assertEqual(row["record_id"], "record-1")
        self.assertNotIn("missing_alias", row)

    def test_implemented_connectors_are_registered(self):
        for source_type in IMPLEMENTED_CONNECTOR_TYPES:
            source = get_dataset_source(source_type)
            self.assertIsNotNone(source, source_type)
            self.assertEqual(source["type"], source_type)

    def test_api_connectors_transform_representative_payloads(self):
        tenant_id = "11111111-1111-4111-8111-111111111111"
        token = "test-access-token"

        def json_request(url, headers):
            if "hubapi.com" in url:
                return {
                    "results": [{
                        "id": "deal-1",
                        "createdAt": "2026-01-02T00:00:00Z",
                        "properties": {"amount": "1250"},
                    }],
                }
            if "stripe.com" in url:
                return {
                    "data": [{
                        "id": "ch_1",
                        "created": 1767312000,
                        "amount": 1250,
                        "currency": "usd",
                    }],
                    "has_more": False,
                }
            if "facebook.com" in url:
                return {
                    "data": [{
                        "date_start": "2026-01-02",
                        "date_stop": "2026-01-02",
                        "campaign_id": "campaign-1",
                        "campaign_name": "Launch",
                        "impressions": "100",
                        "actions": [{"action_type": "lead", "value": "4"}],
                    }],
                }
            if "quickbooks" in url:
                return {
                    "QueryResponse": {
                        "Invoice": [{
                            "Id": "invoice-1",
                            "TxnDate": "2026-01-02",
                            "TotalAmt": 500,
                            "CustomerRef": {"value": "customer-1"},
                        }],
                    },
                }
            if "freshbooks" in url:
                return {
                    "response": {
                        "result": {
                            "invoices": [{
                                "invoiceid": "invoice-1",
                                "create_date": "2026-01-02",
                                "amount": {"amount": "500", "code": "USD"},
                            }],
                        },
                    },
                }
            if "api.xero.com" in url:
                self.assertEqual(headers["Xero-tenant-id"], tenant_id)
                return {
                    "Invoices": [{
                        "InvoiceID": "invoice-1",
                        "DateString": "2026-01-02",
                        "Total": 500,
                        "CurrencyCode": "USD",
                        "Contact": {"ContactID": "customer-1"},
                        "LineItems": [{}],
                    }],
                }
            if "drive.google.com" in url or "googleapis.com/drive" in url:
                return {
                    "name": "marketing.csv",
                    "mimeType": "text/csv",
                }
            if "graph.microsoft.com" in url:
                return {
                    "name": "sales.csv",
                    "@microsoft.graph.downloadUrl": "https://files.example/sales.csv",
                }
            raise AssertionError(f"Unhandled connector URL: {url}")

        with patch.object(connectors, "get_oauth_access_token", return_value=token), \
            patch.object(connectors, "connector_json_request", side_effect=json_request), \
            patch.object(
                connectors,
                "connector_json_request_with_headers",
                return_value=(
                    {
                        "orders": [{
                            "id": "order-1",
                            "created_at": "2026-01-02T00:00:00Z",
                            "total_price": "500",
                        }]
                    },
                    {},
                ),
            ), \
            patch.dict(
                os.environ,
                {
                    "STRIPE_API_KEY": "test-key",
                    "STRIPE_API_URL": "https://api.stripe.com/v1",
                    "HUBSPOT_API_BASE_URL": "https://api.hubapi.com",
                    "HUBSPOT_CRM_API_VERSION": "v3",
                    "SHOPIFY_API_VERSION": "2026-07",
                    "SHOPIFY_API_BASE_URL_TEMPLATE": (
                        "https://{shop_domain}/admin/api/{api_version}"
                    ),
                    "META_ADS_API_BASE_URL": "https://graph.facebook.com",
                    "META_ADS_GRAPH_VERSION": "v23.0",
                    "META_ADS_TIME_INCREMENT": "1",
                    "QUICKBOOKS_API_BASE_URL": (
                        "https://quickbooks.api.intuit.com"
                    ),
                    "QUICKBOOKS_API_VERSION": "v3",
                    "FRESHBOOKS_API_BASE_URL_TEMPLATE": (
                        "https://api.freshbooks.com/account/{account_id}/invoices/invoices"
                    ),
                    "XERO_API_BASE_URL": "https://api.xero.com/api.xro/2.0",
                },
                clear=False,
            ):
            cases = [
                ("hubspot", {"object_type": "deals"}),
                ("stripe", {}),
                ("shopify", {"shop_domain": "shop.example.com"}),
                ("meta_ads", {"ad_account_id": "act_123"}),
                ("quickbooks", {"company_id": "company-1"}),
                ("freshbooks", {"account_id": "account-1"}),
                ("xero", {"tenant_id": tenant_id}),
            ]

            for source_type, config in cases:
                dataframe, report = connectors.load_connector_dataframe(
                    None,
                    make_connection(source_type, config),
                    datetime(2026, 1, 1, tzinfo=UTC).date(),
                    datetime(2026, 1, 31, tzinfo=UTC).date(),
                )
                self.assertFalse(dataframe.empty, source_type)
                self.assertEqual(report["connector"], source_type)

    def test_database_connectors_load_read_only_rows(self):
        with tempfile.NamedTemporaryFile(suffix=".sqlite") as database_file:
            engine = create_engine(f"sqlite:///{database_file.name}")
            with engine.begin() as connection:
                connection.execute(
                    text(
                        "CREATE TABLE source_rows "
                        "(created_at TEXT, revenue INTEGER)"
                    )
                )
                connection.execute(
                    text(
                        "INSERT INTO source_rows VALUES "
                        "('2026-01-02', 500)"
                    )
                )

            with patch.dict(
                os.environ,
                {
                    "POSTGRESQL_SOURCE_URL": f"sqlite:///{database_file.name}",
                    "MYSQL_SOURCE_URL": f"sqlite:///{database_file.name}",
                    "SQL_SERVER_SOURCE_URL": f"sqlite:///{database_file.name}",
                },
                clear=False,
            ), patch.object(
                connectors,
                "bound_database_query",
                return_value="SELECT created_at, revenue FROM source_rows",
            ):
                for source_type in ("postgresql", "mysql", "sql_server"):
                    dataframe, report = connectors.load_connector_dataframe(
                        None,
                        make_connection(source_type, {
                            "query": "SELECT created_at, revenue FROM source_rows",
                        }),
                    )
                    self.assertEqual(len(dataframe), 1, source_type)
                    self.assertEqual(report["connector"], source_type)

    def test_database_queries_reject_mutations_and_multiple_statements(self):
        with self.assertRaises(connectors.ConnectorUnavailable):
            connectors.validate_read_query(
                "UPDATE source_rows SET revenue = 0"
            )

        with self.assertRaises(connectors.ConnectorUnavailable):
            connectors.validate_read_query(
                "SELECT * FROM source_rows; DELETE FROM source_rows"
            )

    def test_database_connector_query_has_no_implicit_row_cap(self):
        query = "SELECT created_at, revenue FROM source_rows"
        self.assertEqual(
            connectors.bound_database_query("postgresql", query),
            query,
        )


if __name__ == "__main__":
    unittest.main()
