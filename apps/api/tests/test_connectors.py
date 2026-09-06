import json
import os
import tempfile
import unittest
from datetime import UTC, date, datetime, timedelta
from types import SimpleNamespace
from urllib.parse import parse_qs, urlsplit
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

    def test_canonical_connector_dates_use_calendar_date_values(self):
        row = connectors.build_dynamic_connector_row(
            {
                "id": "record-1",
                "createdAt": "2026-08-30T22:43:09.318Z",
                "MetaData": {
                    "CreateTime": "2026-08-30T22:43:09.318Z",
                },
            },
            {
                "created_at": "2026-08-30T22:43:09.318Z",
                "updated_at": "2026-08-30T23:00:00Z",
            },
        )

        self.assertEqual(row["created_at"], "2026-08-30")
        self.assertEqual(row["updated_at"], "2026-08-30")
        self.assertEqual(row["createdAt"], "2026-08-30")
        self.assertEqual(row["MetaData__CreateTime"], "2026-08-30")

    def test_persisted_connector_date_columns_are_normalized_on_read(self):
        dataframe = pd.DataFrame(
            [{
                "createdAt": "2026-08-30T22:43:09.318Z",
                "MetaData__CreateTime": "2026-08-30T22:43:09.318Z",
                "created": 1767139200,
            }]
        )

        normalized = connectors.normalize_connector_dataframe_dates(dataframe)

        self.assertEqual(normalized.loc[0, "createdAt"], "2026-08-30")
        self.assertEqual(
            normalized.loc[0, "MetaData__CreateTime"],
            "2026-08-30",
        )
        self.assertEqual(normalized.loc[0, "created"], 1767139200)

    def test_freshbooks_resource_selections_load_documented_resources(self):
        identity_url = "https://api.freshbooks.com/auth/api/v1/users/me"

        def json_request(url, headers):
            self.assertEqual(
                headers["Authorization"],
                "Bearer freshbooks-token",
            )
            if url == identity_url:
                return {
                    "response": {
                        "id": 42,
                        "profile": {
                            "first_name": "Ada",
                            "last_name": "Lovelace",
                        },
                    },
                }
            if "/invoices/invoices?" in url:
                return {
                    "response": {
                        "result": {
                            "invoices": [{
                                "invoiceid": 101,
                                "create_date": "2026-01-02",
                                "amount": {"amount": "125.00", "code": "CAD"},
                            }],
                        },
                    },
                }
            if "/expenses/expenses?" in url:
                return {
                    "response": {
                        "result": {
                            "expenses": [{
                                "expenseid": 201,
                                "date": "2026-01-03",
                                "amount": {"amount": "25.00", "code": "CAD"},
                            }],
                        },
                    },
                }
            if "/payments/payments?" in url:
                return {
                    "response": {
                        "result": {
                            "payments": [{
                                "id": 301,
                                "date": "2026-01-04",
                                "amount": {"amount": "75.00", "code": "CAD"},
                            }],
                        },
                    },
                }
            if "/users/clients?" in url:
                return {
                    "response": {
                        "result": {
                            "clients": [{
                                "id": 401,
                                "signup_date": "2026-01-05 12:00:00",
                                "organization": "Example Ltd",
                            }],
                        },
                    },
                }
            if "/credit_notes/credit_notes?" in url:
                return {
                    "response": {
                        "result": {
                            "credit_notes": [{
                                "creditid": 501,
                                "create_date": "2026-01-06",
                                "amount": {"amount": "15.00", "code": "CAD"},
                            }],
                        },
                    },
                }
            if "/reports/chart_of_accounts?" in url:
                return {
                    "response": {
                        "result": {
                            "journal_entry_accounts": [{
                                "account_uuid": "account-uuid-1",
                                "account_name": "Cash",
                                "balance": "125.00",
                            }],
                        },
                    },
                }
            if "/projects/business/business-1/projects?" in url:
                return {
                    "meta": {"page": 0, "pages": 1, "total": 1},
                    "projects": [{
                        "id": 601,
                        "title": "Website refresh",
                        "created_at": "2026-01-07T00:00:00Z",
                    }],
                }
            raise AssertionError(f"Unhandled FreshBooks URL: {url}")

        with patch.dict(
            os.environ,
            {
                "FRESHBOOKS_API_BASE_URL_TEMPLATE": (
                    "https://api.freshbooks.com/accounting/account/{account_id}"
                ),
                "FRESHBOOKS_IDENTITY_API_URL": identity_url,
                "FRESHBOOKS_BUSINESS_API_BASE_URL_TEMPLATE": (
                    "https://api.freshbooks.com/accounting/businesses/{business_uuid}"
                ),
                "FRESHBOOKS_PROJECTS_API_BASE_URL_TEMPLATE": (
                    "https://api.freshbooks.com/projects/business/{business_id}"
                ),
            },
            clear=False,
        ), patch.object(
            connectors,
            "get_oauth_access_token",
            return_value="freshbooks-token",
        ), patch.object(
            connectors,
            "connector_json_request",
            side_effect=json_request,
        ):
            for resource_type, expected_column in [
                ("profile", "profile_id"),
                ("invoices", "invoice_id"),
                ("expenses", "expense_id"),
                ("payments", "payment_id"),
                ("clients", "client_id"),
                ("credit_notes", "credit_note_id"),
                ("chart_of_accounts", "account_uuid"),
                ("projects", "project_id"),
            ]:
                dataframe, report = connectors.load_freshbooks_dataframe(
                    None,
                    make_connection(
                        "freshbooks",
                        {
                            "account_id": "account-1",
                            "business_id": "business-1",
                            "business_uuid": "business-uuid-1",
                            "resource_type": resource_type,
                        },
                    ),
                    date(2026, 1, 1),
                    date(2026, 1, 31),
                )
                self.assertFalse(dataframe.empty, resource_type)
                self.assertIn(expected_column, dataframe.columns)
                self.assertEqual(report["resource"], resource_type)

    def test_freshbooks_resource_selection_accepts_multiple_objects(self):
        self.assertEqual(
            connectors.normalize_freshbooks_resource_types({
                "resource_types": "invoices, projects, invoices",
            }),
            ["invoices", "projects"],
        )

    def test_quickbooks_resource_selection_accepts_entity_aliases(self):
        self.assertEqual(
            connectors.normalize_quickbooks_resource_types({
                "resource_types": [
                    "Invoice",
                    "customers",
                    "SalesReceipt",
                    "invoice",
                ],
            }),
            ["invoices", "customers", "sales_receipts"],
        )

    def test_hubspot_resource_selection_accepts_multiple_objects(self):
        self.assertEqual(
            connectors.normalize_hubspot_resource_types({
                "resource_types": "contacts, deals, contacts, tickets",
            }),
            ["contacts", "deals", "tickets"],
        )
        self.assertEqual(
            connectors.normalize_hubspot_resource_types({
                "object_type": "companies",
            }),
            ["companies"],
        )
        self.assertEqual(
            connectors.normalize_hubspot_resource_types({}),
            ["deals"],
        )

    def test_quickbooks_resource_selections_load_supported_entities(self):
        def json_request(url, headers):
            query = parse_qs(urlsplit(url).query)["query"][0]
            entity = query.split(" FROM ", 1)[1].split(" ", 1)[0]
            return {
                "QueryResponse": {
                    entity: [{
                        "Id": f"{entity}-1",
                        "TxnDate": "2026-01-02",
                        "TotalAmt": "125.00",
                        "MetaData": {
                            "CreateTime": "2026-01-02T00:00:00-05:00",
                        },
                    }],
                },
            }

        with patch.dict(
            os.environ,
            {
                "QUICKBOOKS_API_BASE_URL": (
                    "https://quickbooks.api.intuit.com"
                ),
                "QUICKBOOKS_API_VERSION": "v3",
            },
            clear=False,
        ), patch.object(
            connectors,
            "get_oauth_access_token",
            return_value="quickbooks-token",
        ), patch.object(
            connectors,
            "connector_json_request",
            side_effect=json_request,
        ):
            for resource_type, entity in connectors.QUICKBOOKS_RESOURCE_TYPES.items():
                dataframe, report = connectors.load_quickbooks_dataframe(
                    None,
                    make_connection(
                        "quickbooks",
                        {
                            "company_id": "company-1",
                            "resource_types": [resource_type],
                        },
                    ),
                    date(2026, 1, 1),
                    date(2026, 1, 31),
                )
                self.assertFalse(dataframe.empty, resource_type)
                self.assertIn("record_id", dataframe.columns)
                self.assertEqual(report["resource"], resource_type)
                self.assertEqual(report["object_type"], entity)

    def test_quickbooks_nested_lists_are_flattened_for_analysis(self):
        row = connectors.build_dynamic_connector_row(
            {
                "Id": "invoice-1",
                "Line": [
                    {
                        "Amount": 125,
                        "SalesItemLineDetail": {
                            "Qty": 2,
                            "ItemRef": {"value": "item-1"},
                        },
                    },
                ],
            },
            {},
            flatten_lists=True,
        )

        self.assertEqual(row["Line__count"], 1)
        self.assertEqual(row["Line__0__Amount"], 125)
        self.assertEqual(
            row["Line__0__SalesItemLineDetail__ItemRef__value"],
            "item-1",
        )
        self.assertEqual(row["Line__0__SalesItemLineDetail__Qty"], 2)

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
                self.assertEqual(
                    headers["Authorization"],
                    "Bearer test-key",
                )
                self.assertNotIn("Stripe-Account", headers)
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
            patch.object(connectors, "decrypt_token", return_value="test-key"), \
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
                ("stripe", {"_stripe_api_key_encrypted": "encrypted-key"}),
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

    def test_stripe_sync_requires_customer_api_key(self):
        with patch.dict(
            os.environ,
            {
                "STRIPE_API_URL": "https://api.stripe.com/v1",
            },
            clear=False,
        ):
            with self.assertRaisesRegex(
                connectors.ConnectorUnavailable,
                "customer-provided Stripe restricted API key is required before syncing",
            ):
                connectors.load_stripe_dataframe(
                    make_connection("stripe", {"account_id": "acct_testaccount"}),
                    datetime(2026, 1, 1, tzinfo=UTC).date(),
                    datetime(2026, 1, 31, tzinfo=UTC).date(),
                )

    def test_salesforce_selected_object_preserves_dynamic_fields(self):
        def json_request(url, headers):
            self.assertEqual(
                headers["Authorization"],
                "Bearer test-access-token",
            )
            if url.endswith("/sobjects/Opportunity/describe"):
                return {
                    "fields": [
                        {"name": "Id"},
                        {"name": "Name"},
                        {"name": "Amount"},
                        {"name": "Custom_Score__c"},
                    ]
                }
            if "/query/" in url:
                return {
                    "records": [{
                        "attributes": {
                            "type": "Opportunity",
                        },
                        "Id": "006-test",
                        "Name": "Expansion",
                        "Amount": 12500,
                        "Custom_Score__c": 0.84,
                        "CreatedDate": "2026-01-02T00:00:00Z",
                        "LastModifiedDate": "2026-01-02T00:00:00Z",
                    }],
                    "done": True,
                }
            raise AssertionError(f"Unhandled Salesforce URL: {url}")

        with patch.object(
            connectors,
            "get_oauth_access_token",
            return_value="test-access-token",
        ), patch.object(
            connectors,
            "connector_json_request",
            side_effect=json_request,
        ), patch.dict(
            os.environ,
            {"SALESFORCE_API_VERSION": "65.0"},
            clear=False,
        ):
            dataframe, report = connectors.load_connector_dataframe(
                None,
                make_connection("salesforce", {
                    "object_type": "Opportunity",
                    "instance_url": "https://example.my.salesforce.com",
                }),
            )

        self.assertEqual(report["object_type"], "Opportunity")
        self.assertEqual(report["api_version"], "v65.0")
        self.assertEqual(dataframe.iloc[0]["Name"], "Expansion")
        self.assertEqual(dataframe.iloc[0]["Custom_Score__c"], 0.84)
        self.assertEqual(dataframe.iloc[0]["record_id"], "006-test")

    def test_salesforce_resource_selection_normalizes_multiple_objects(self):
        self.assertEqual(
            connectors.normalize_salesforce_resource_types({
                "resource_types": "accounts,Opportunity,leads,accounts",
            }),
            ["accounts", "opportunities", "leads"],
        )
        self.assertEqual(
            connectors.normalize_salesforce_resource_types({
                "object_type": "Opportunity",
            }),
            ["opportunities"],
        )

    def test_salesforce_resource_selection_defaults_to_opportunities(self):
        self.assertEqual(
            connectors.normalize_salesforce_resource_types({}),
            ["opportunities"],
        )

    def test_google_ads_campaign_report_loads_daily_metrics(self):
        response = [{
            "results": [{
                "campaign": {
                    "id": "1234567890",
                    "name": "Spring campaign",
                    "status": "ENABLED",
                    "advertisingChannelType": "SEARCH",
                },
                "segments": {"date": "2026-01-02"},
                "metrics": {
                    "impressions": "100",
                    "clicks": "5",
                    "costMicros": "1250000",
                    "conversions": "2.0",
                    "conversionsValue": "200.0",
                    "ctr": "0.05",
                    "averageCpc": "250000",
                },
            }],
        }]

        with patch.object(
            connectors,
            "get_oauth_access_token",
            return_value="google-ads-token",
        ), patch.object(
            connectors,
            "connector_json_post_request",
            return_value=response,
        ) as mocked_request, patch.dict(
            os.environ,
            {
                "GOOGLE_ADS_API_BASE_URL": (
                    "https://googleads.googleapis.com"
                ),
                "GOOGLE_ADS_API_VERSION": "v22",
                "GOOGLE_ADS_DEVELOPER_TOKEN": "developer-token",
            },
            clear=False,
        ):
            dataframe, report = connectors.load_google_ads_dataframe(
                None,
                make_connection("google_ads", {
                    "customer_id": "123-456-7890",
                }),
                date(2026, 1, 1),
                date(2026, 1, 31),
            )

        url, headers, body = mocked_request.call_args.args
        self.assertEqual(
            url,
            "https://googleads.googleapis.com/v22/customers/1234567890/"
            "googleAds:searchStream",
        )
        self.assertEqual(headers["Authorization"], "Bearer google-ads-token")
        self.assertEqual(headers["developer-token"], "developer-token")
        self.assertNotIn("login-customer-id", headers)
        self.assertIn("segments.date BETWEEN '2026-01-01'", body["query"])
        self.assertFalse(dataframe.empty)
        self.assertEqual(dataframe.iloc[0]["date"], "2026-01-02")
        self.assertEqual(dataframe.iloc[0]["impressions"], 100)
        self.assertEqual(dataframe.iloc[0]["cost_micros"], 1250000)
        self.assertEqual(dataframe.iloc[0]["cost"], 1.25)
        self.assertEqual(report["customer_id"], "1234567890")

    def test_google_ads_campaign_report_resolves_manager_automatically(self):
        response = [{
            "results": [{
                "campaign": {
                    "id": "1234567890",
                    "name": "Spring campaign",
                    "status": "ENABLED",
                    "advertisingChannelType": "SEARCH",
                },
                "segments": {"date": "2026-01-02"},
                "metrics": {
                    "impressions": "100",
                    "clicks": "5",
                    "costMicros": "1250000",
                    "conversions": "2.0",
                    "conversionsValue": "200.0",
                    "ctr": "0.05",
                    "averageCpc": "250000",
                },
            }],
        }]
        permission_error = connectors.ConnectorUnavailable(
            "Connector request failed with HTTP 403: Google Ads "
            "USER_PERMISSION_DENIED: User doesn't have permission to access customer"
        )
        post_calls = []

        def post_request(url, headers, payload):
            post_calls.append((url, headers, payload))
            if len(post_calls) == 1:
                raise permission_error
            if "FROM customer_client" in payload["query"]:
                self.assertEqual(
                    headers["login-customer-id"],
                    "9107036696",
                )
                return [{
                    "results": [{
                        "customerClient": {
                            "id": "1234567890",
                            "manager": False,
                        },
                    }],
                }]

            return response

        with patch.object(
            connectors,
            "get_oauth_access_token",
            return_value="google-ads-token",
        ), patch.object(
            connectors,
            "connector_json_request",
            return_value={
                "resourceNames": ["customers/9107036696"],
            },
        ), patch.object(
            connectors,
            "connector_json_post_request",
            side_effect=post_request,
        ), patch.dict(
            os.environ,
            {
                "GOOGLE_ADS_API_BASE_URL": (
                    "https://googleads.googleapis.com"
                ),
                "GOOGLE_ADS_API_VERSION": "v22",
                "GOOGLE_ADS_DEVELOPER_TOKEN": "developer-token",
            },
            clear=False,
        ):
            dataframe, report = connectors.load_google_ads_dataframe(
                None,
                make_connection("google_ads", {
                    "customer_id": "123-456-7890",
                }),
                date(2026, 1, 1),
                date(2026, 1, 31),
            )

        self.assertFalse(dataframe.empty)
        self.assertEqual(report["customer_id"], "1234567890")
        self.assertEqual(len(post_calls), 3)

    def test_google_ads_customer_id_requires_ten_digits(self):
        with self.assertRaisesRegex(
            connectors.ConnectorUnavailable,
            "Google Ads customer_id must be a 10-digit customer ID",
        ):
            connectors.normalize_google_ads_customer_id("12345")

    def test_google_ads_error_detail_exposes_authorization_code(self):
        detail = connectors.format_connector_error_detail(
            json.dumps([
                {
                    "error": {
                        "details": [
                            {
                                "@type": (
                                    "type.googleapis.com/google.ads."
                                    "googleads.v22.errors.GoogleAdsFailure"
                                ),
                                "errors": [
                                    {
                                        "errorCode": {
                                            "authorizationError": (
                                                "USER_PERMISSION_DENIED"
                                            )
                                        },
                                        "message": (
                                            "User does not have access"
                                        ),
                                    }
                                ],
                            }
                        ]
                    }
                }
            ])
        )

        self.assertEqual(
            detail,
            "Google Ads USER_PERMISSION_DENIED: User does not have access",
        )

    def test_quickbooks_authorization_error_is_customer_safe(self):
        detail = connectors.format_connector_error_detail(
            json.dumps({
                "fault": {
                    "error": [{
                        "message": (
                            "message=ApplicationAuthorizationFailed; "
                            "errorCode=003100; statusCode=403"
                        ),
                        "code": "3100",
                    }],
                },
            })
        )

        self.assertEqual(
            detail,
            "QuickBooks authorization is no longer valid. "
            "Reconnect QuickBooks and try again.",
        )
        self.assertTrue(
            connectors.connector_requires_reauthorization(
                "quickbooks",
                connectors.ConnectorUnavailable(detail),
            )
        )

    def test_meta_expired_oauth_error_is_customer_safe(self):
        detail = connectors.format_connector_error_detail(
            json.dumps({
                "error": {
                    "message": (
                        "Error validating access token: Session has expired"
                    ),
                    "type": "OAuthException",
                    "code": 190,
                },
            })
        )

        self.assertEqual(
            detail,
            "OAuth authorization is no longer valid. "
            "Reconnect the account and try again.",
        )
        self.assertTrue(
            connectors.connector_requires_reauthorization(
                "meta_ads",
                connectors.ConnectorUnavailable(detail),
            )
        )

    def test_scheduled_oauth_heartbeat_checks_refresh_credentials(self):
        credential = SimpleNamespace(
            refresh_token_encrypted="encrypted-refresh-token",
        )

        class Query:
            def filter(self, *_args):
                return self

            def first(self):
                return credential

        class FakeDb:
            def query(self, *_args):
                return Query()

        connection = make_connection(
            "quickbooks",
            {"schedule_enabled": True},
        )
        with patch.object(
            connectors,
            "get_oauth_access_token",
            return_value="access-token",
        ) as mocked_get_token:
            self.assertTrue(
                connectors.refresh_oauth_access_token_if_due(
                    FakeDb(),
                    connection,
                )
            )

        mocked_get_token.assert_called_once()
        self.assertEqual(
            mocked_get_token.call_args.args[1:],
            (connection, "quickbooks"),
        )

    def test_oauth_access_token_refreshes_with_ten_minute_leeway(self):
        credential = SimpleNamespace(
            access_token_encrypted="encrypted-access-token",
            refresh_token_encrypted="encrypted-refresh-token",
            expires_at=datetime.now(UTC).replace(tzinfo=None) + timedelta(
                minutes=5,
            ),
            token_type=None,
            scope=None,
        )

        class Query:
            def filter(self, *_args):
                return self

            def first(self):
                return credential

        class FakeDb:
            def query(self, *_args):
                return Query()

            def commit(self):
                return None

        connection = make_connection("quickbooks", {})
        with patch.object(
            connectors,
            "decrypt_token",
            side_effect=lambda value: {
                "encrypted-access-token": "old-access-token",
                "encrypted-refresh-token": "refresh-token",
            }.get(value),
        ), patch.object(
            connectors,
            "encrypt_token",
            side_effect=lambda value: f"encrypted-{value}",
        ), patch.object(
            connectors,
            "refresh_oauth_token",
            return_value={
                "access_token": "new-access-token",
                "expires_in": 3600,
            },
        ) as mocked_refresh:
            token = connectors.get_oauth_access_token(
                FakeDb(),
                connection,
                "quickbooks",
            )

        self.assertEqual(token, "new-access-token")
        mocked_refresh.assert_called_once()

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
