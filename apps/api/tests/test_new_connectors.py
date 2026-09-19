import json
import unittest
from datetime import date
from types import SimpleNamespace
from unittest.mock import patch

from app.modules.datasets.services import connectors
from app.modules.datasets.services.sources import get_dataset_source


def make_connection(source_type, config):
    return SimpleNamespace(
        id=1,
        source_type=source_type,
        connection_config=json.dumps(config),
    )


class NewConnectorTests(unittest.TestCase):
    def test_new_sources_are_registered_with_expected_connection_types(self):
        expected = {
            "google_search_console": "oauth",
            "google_business_profile": "oauth",
            "square": "oauth",
            "woocommerce": "api_key",
            "lightspeed": "oauth",
        }
        for source_type, connection_type in expected.items():
            source = get_dataset_source(source_type)
            self.assertIsNotNone(source)
            self.assertEqual(source["connection_type"], connection_type)

    def test_search_console_rows_are_normalized(self):
        with patch.object(
            connectors,
            "get_oauth_access_token",
            return_value="search-token",
        ), patch.object(
            connectors,
            "connector_json_post_request",
            return_value={
                "rows": [{
                    "keys": ["2026-09-01", "decisionate", "https://example.com"],
                    "clicks": 12,
                    "impressions": 100,
                    "ctr": 0.12,
                    "position": 3.5,
                }],
            },
        ), patch.dict(
            "os.environ",
            {"GOOGLE_SEARCH_CONSOLE_API_BASE_URL": "https://www.googleapis.com/webmasters/v3"},
            clear=False,
        ):
            dataframe, report = connectors.load_google_search_console_dataframe(
                None,
                make_connection(
                    "google_search_console",
                    {"site_url": "https://example.com/"},
                ),
                date(2026, 9, 1),
                date(2026, 9, 2),
            )

        self.assertEqual(report["resource"], "search_analytics")
        self.assertEqual(dataframe.loc[0, "query"], "decisionate")
        self.assertEqual(dataframe.loc[0, "clicks"], 12)

    def test_google_business_profile_locations_and_metrics_are_normalized(self):
        def json_request(url, headers):
            self.assertEqual(headers["Authorization"], "Bearer business-token")
            if "mybusinessbusinessinformation.googleapis.com" in url:
                self.assertIn("accounts/-/locations", url)
                self.assertIn("readMask=", url)
                return {
                    "locations": [{
                        "name": "locations/123",
                        "title": "Decisionate Halifax",
                        "storeCode": "HALIFAX",
                        "websiteUri": "https://decisionate.example",
                        "metadata": {"placeId": "ChIJ123"},
                        "phoneNumbers": {"primaryPhone": "+19025550123"},
                        "openInfo": {"status": "OPEN"},
                    }],
                }
            self.assertIn(
                "locations/123:fetchMultiDailyMetricsTimeSeries",
                url,
            )
            self.assertIn("dailyMetrics=", url)
            self.assertIn("dailyRange.start_date.year=2026", url)
            return {
                "multiDailyMetricTimeSeries": [{
                    "dailyMetricTimeSeries": [{
                        "dailyMetric": "WEBSITE_CLICKS",
                        "timeSeries": {
                            "datedValues": [{
                                "date": {"year": 2026, "month": 9, "day": 1},
                                "value": "7",
                            }],
                        },
                    }],
                }],
            }

        with patch.object(
            connectors,
            "get_oauth_access_token",
            return_value="business-token",
        ), patch.object(
            connectors,
            "connector_json_request",
            side_effect=json_request,
        ), patch.dict(
            "os.environ",
            {
                "GOOGLE_BUSINESS_PROFILE_API_BASE_URL": (
                    "https://mybusinessbusinessinformation.googleapis.com/v1"
                ),
                "GOOGLE_BUSINESS_PROFILE_PERFORMANCE_API_BASE_URL": (
                    "https://businessprofileperformance.googleapis.com/v1"
                ),
            },
            clear=False,
        ):
            dataframe, report = connectors.load_google_business_profile_dataframe(
                None,
                make_connection("google_business_profile", {}),
                date(2026, 9, 1),
                date(2026, 9, 2),
            )

        self.assertEqual(report["resource"], "location_performance")
        self.assertEqual(report["location_count"], 1)
        self.assertEqual(dataframe.loc[0, "location_id"], "123")
        self.assertEqual(dataframe.loc[0, "location_title"], "Decisionate Halifax")
        self.assertEqual(dataframe.loc[0, "daily_metric"], "WEBSITE_CLICKS")
        self.assertEqual(dataframe.loc[0, "metric_value"], 7)
        self.assertEqual(dataframe.loc[0, "date"], "2026-09-01")

    def test_square_orders_are_normalized(self):
        with patch.object(
            connectors,
            "get_oauth_access_token",
            return_value="square-token",
        ), patch.object(
            connectors,
            "connector_json_post_request",
            return_value={
                "orders": [{
                    "id": "order-1",
                    "location_id": "location-1",
                    "created_at": "2026-09-01T12:00:00Z",
                    "total_money": {"amount": 1250, "currency": "CAD"},
                    "line_items": [{"uid": "line-1"}],
                }],
            },
        ), patch.dict(
            "os.environ",
            {
                "SQUARE_API_BASE_URL": "https://connect.squareup.com",
                "SQUARE_API_VERSION": "2026-09-16",
            },
            clear=False,
        ):
            dataframe, report = connectors.load_square_dataframe(
                None,
                make_connection("square", {"location_id": "location-1"}),
                date(2026, 9, 1),
                date(2026, 9, 2),
            )

        self.assertEqual(report["resource"], "orders")
        self.assertEqual(dataframe.loc[0, "order_id"], "order-1")
        self.assertEqual(dataframe.loc[0, "total_amount"], 12.5)

    def test_woocommerce_orders_use_basic_auth_and_normalized_aliases(self):
        with patch.object(
            connectors,
            "get_woocommerce_secret",
            side_effect=["ck_test", "cs_test"],
        ), patch.object(
            connectors,
            "connector_json_request_with_headers",
            return_value=([{
                "id": 42,
                "number": "10042",
                "date_created": "2026-09-01T12:00:00",
                "total": "125.00",
                "billing": {"country": "CA"},
            }], {}),
        ) as request:
            dataframe, report = connectors.load_woocommerce_dataframe(
                make_connection(
                    "woocommerce",
                    {"store_url": "https://shop.example.com"},
                ),
                date(2026, 9, 1),
                date(2026, 9, 2),
            )

        self.assertEqual(report["resource"], "orders")
        self.assertEqual(dataframe.loc[0, "order_id"], 42)
        self.assertEqual(dataframe.loc[0, "billing_country"], "CA")
        self.assertTrue(request.call_args.kwargs["headers"]["Authorization"].startswith("Basic "))

    def test_lightspeed_sales_are_normalized(self):
        with patch.object(
            connectors,
            "get_oauth_access_token",
            return_value="lightspeed-token",
        ), patch.object(
            connectors,
            "connector_json_request",
            return_value={
                "Sale": [{
                    "saleID": "sale-1",
                    "createTime": "2026-09-01T12:00:00Z",
                    "total": "125.00",
                }],
            },
        ), patch.dict(
            "os.environ",
            {
                "LIGHTSPEED_API_BASE_URL_TEMPLATE": (
                    "https://api.lightspeedapp.com/API/Account/{account_id}"
                ),
            },
            clear=False,
        ):
            dataframe, report = connectors.load_lightspeed_dataframe(
                None,
                make_connection("lightspeed", {"account_id": "account-1"}),
                date(2026, 9, 1),
                date(2026, 9, 2),
            )

        self.assertEqual(report["resource"], "sales")
        self.assertEqual(dataframe.loc[0, "sale_id"], "sale-1")


if __name__ == "__main__":
    unittest.main()
