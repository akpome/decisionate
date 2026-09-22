import json
import unittest
from datetime import date, datetime
from types import SimpleNamespace
from urllib.parse import parse_qs, urlsplit
from unittest.mock import patch

import pandas as pd

from app.modules.datasets.services import connectors
from app.modules.datasets.services import sources
from app.modules.datasets.services.sources import get_dataset_source
from app.modules.datasets import router as datasets_router


def make_connection(source_type, config):
    return SimpleNamespace(
        id=1,
        source_type=source_type,
        connection_config=json.dumps(config),
    )


class NewConnectorTests(unittest.TestCase):
    def test_search_console_initial_sync_uses_standard_history(self):
        connection = SimpleNamespace(
            source_type="google_search_console",
            last_synced_at=None,
        )

        start_date, end_date = datasets_router.get_incremental_sync_window(
            connection,
            SimpleNamespace(start_date=None, end_date=None),
        )

        self.assertEqual(
            (end_date - start_date).days + 1,
            datasets_router.INITIAL_CONNECTOR_SYNC_DAYS,
        )
        self.assertEqual(end_date, date.today())

    def test_search_console_incremental_sync_rechecks_delayed_data(self):
        connection = SimpleNamespace(
            source_type="google_search_console",
            last_synced_at=datetime.combine(
                date.today(),
                datetime.min.time(),
            ),
            connection_config=json.dumps({
                datasets_router.INITIAL_CONNECTOR_SYNC_COMPLETED_KEY: True,
            }),
        )

        start_date, end_date = datasets_router.get_incremental_sync_window(
            connection,
            SimpleNamespace(start_date=None, end_date=None),
        )

        self.assertEqual(
            (date.today() - start_date).days,
            7,
        )
        self.assertEqual(end_date, date.today())

    def test_search_console_existing_connection_without_backfill_marker_repeats_initial_window(self):
        connection = SimpleNamespace(
            source_type="google_search_console",
            last_synced_at=datetime.combine(
                date.today(),
                datetime.min.time(),
            ),
            connection_config=json.dumps({"site_url": "decisionate.ca"}),
        )

        start_date, end_date = datasets_router.get_incremental_sync_window(
            connection,
            SimpleNamespace(start_date=None, end_date=None),
        )

        self.assertEqual(
            (end_date - start_date).days + 1,
            datasets_router.INITIAL_CONNECTOR_SYNC_DAYS,
        )

    def test_google_business_profile_stays_planned_pending_google_approval(self):
        with patch.object(
            sources,
            "is_oauth_provider_configured",
            return_value=True,
        ), patch.object(
            sources,
            "get_missing_provider_settings",
            return_value=[],
        ):
            source = sources.get_dataset_source(
                "google_business_profile"
            )

        self.assertEqual(source["status"], "planned")
        self.assertIn(
            "pending Google Business Profile API approval",
            source["availability_note"],
        )

    def test_search_console_property_formats_are_normalized(self):
        self.assertEqual(
            connectors.normalize_google_search_console_site_url(
                "decisionate.ca"
            ),
            "sc-domain:decisionate.ca",
        )
        self.assertEqual(
            connectors.normalize_google_search_console_site_url(
                "sc-domain:decisionate.ca"
            ),
            "sc-domain:decisionate.ca",
        )
        self.assertEqual(
            connectors.normalize_google_search_console_site_url(
                "https://decisionate.ca/"
            ),
            "https://decisionate.ca/",
        )

    def test_search_console_confirms_accessible_domain_property(self):
        request_payloads = []

        def json_request(url, headers, payload):
            request_payloads.append((url, payload))
            return {
                "rows": [{
                    "keys": ["2026-09-18"],
                    "clicks": 0,
                    "impressions": 1,
                    "ctr": 0,
                    "position": 6,
                }],
            }

        with patch.object(
            connectors,
            "get_oauth_access_token",
            return_value="search-token",
        ), patch.object(
            connectors,
            "connector_json_request",
            return_value={
                "siteEntry": [{
                    "siteUrl": "sc-domain:decisionate.ca",
                }],
            },
        ), patch.object(
            connectors,
            "connector_json_post_request",
            side_effect=json_request,
        ), patch.dict(
            "os.environ",
            {"GOOGLE_SEARCH_CONSOLE_API_BASE_URL": "https://www.googleapis.com/webmasters/v3"},
            clear=False,
        ):
            dataframe, report = connectors.load_google_search_console_dataframe(
                None,
                make_connection(
                    "google_search_console",
                    {"site_url": "decisionate.ca"},
                ),
                date(2026, 9, 1),
                date(2026, 9, 22),
            )

        self.assertEqual(report["site_url"], "sc-domain:decisionate.ca")
        self.assertEqual(dataframe.loc[0, "impressions"], 1)
        self.assertEqual(len(request_payloads), 2)

    def test_search_console_does_not_persist_zero_only_rows(self):
        with patch.object(
            connectors,
            "get_oauth_access_token",
            return_value="search-token",
        ), patch.object(
            connectors,
            "connector_json_request",
            return_value={
                "siteEntry": [{
                    "siteUrl": "sc-domain:decisionate.ca",
                }],
            },
        ), patch.object(
            connectors,
            "connector_json_post_request",
            return_value={
                "rows": [{
                    "keys": ["2026-09-18"],
                    "clicks": 0,
                    "impressions": 0,
                    "ctr": 0,
                    "position": 0,
                }],
            },
        ), patch.dict(
            "os.environ",
            {"GOOGLE_SEARCH_CONSOLE_API_BASE_URL": "https://www.googleapis.com/webmasters/v3"},
            clear=False,
        ):
            with self.assertRaises(connectors.ConnectorNoData):
                connectors.load_google_search_console_dataframe(
                    None,
                    make_connection(
                        "google_search_console",
                        {"site_url": "decisionate.ca"},
                    ),
                    date(2026, 9, 1),
                    date(2026, 9, 22),
                )

    def test_search_console_retries_domain_property_for_zero_url_prefix(self):
        def json_request(url, headers, payload):
            if "sc-domain%3Adecisionate.ca" in url:
                return {
                    "rows": [{
                        "keys": ["2026-09-18"],
                        "clicks": 0,
                        "impressions": 1,
                        "ctr": 0,
                        "position": 6,
                    }],
                }
            return {
                "rows": [{
                    "keys": ["2026-09-18"],
                    "clicks": 0,
                    "impressions": 0,
                    "ctr": 0,
                    "position": 0,
                }],
            }

        with patch.object(
            connectors,
            "get_oauth_access_token",
            return_value="search-token",
        ), patch.object(
            connectors,
            "connector_json_request",
            return_value={
                "siteEntry": [{
                    "siteUrl": "sc-domain:decisionate.ca",
                }],
            },
        ), patch.object(
            connectors,
            "connector_json_post_request",
            side_effect=json_request,
        ), patch.dict(
            "os.environ",
            {"GOOGLE_SEARCH_CONSOLE_API_BASE_URL": "https://www.googleapis.com/webmasters/v3"},
            clear=False,
        ):
            dataframe, report = connectors.load_google_search_console_dataframe(
                None,
                make_connection(
                    "google_search_console",
                    {"site_url": "https://decisionate.ca"},
                ),
                date(2026, 9, 1),
                date(2026, 9, 22),
            )

        self.assertEqual(report["site_url"], "sc-domain:decisionate.ca")
        self.assertEqual(dataframe.loc[0, "impressions"], 1)

    def test_new_sources_are_registered_with_expected_connection_types(self):
        expected = {
            "google_search_console": "oauth",
            "google_business_profile": "oauth",
            "square": "oauth",
            "woocommerce": "oauth",
            "lightspeed": "oauth",
            "lightspeed_x": "oauth",
            "lightspeed_k": "oauth",
            "lightspeed_o": "oauth",
        }
        for source_type, connection_type in expected.items():
            source = get_dataset_source(source_type)
            self.assertIsNotNone(source)
            self.assertEqual(source["connection_type"], connection_type)

    def test_search_console_rows_are_normalized(self):
        request_payloads = []

        def json_request(url, headers, payload):
            request_payloads.append(payload)
            return {
                "rows": [{
                    "keys": ["2026-09-01"],
                    "clicks": 12,
                    "impressions": 100,
                    "ctr": 0.12,
                    "position": 3.5,
                }],
            }

        with patch.object(
            connectors,
            "get_oauth_access_token",
            return_value="search-token",
        ), patch.object(
            connectors,
            "connector_json_post_request",
            side_effect=json_request,
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
        self.assertEqual(dataframe.loc[0, "date"], "2026-09-01")
        self.assertEqual(dataframe.loc[0, "clicks"], 12)
        self.assertEqual(request_payloads[0]["dimensions"], ["date"])
        self.assertNotIn("dataState", request_payloads[0])

    def test_search_console_falls_back_to_daily_rows(self):
        request_payloads = []

        def json_request(url, headers, payload):
            request_payloads.append(payload)
            if "dataState" not in payload:
                return {"rows": []}
            return {
                "rows": [{
                    "keys": ["2026-09-01"],
                    "clicks": 12,
                    "impressions": 100,
                    "ctr": 0.12,
                    "position": 3.5,
                }],
            }

        with patch.object(
            connectors,
            "get_oauth_access_token",
            return_value="search-token",
        ), patch.object(
            connectors,
            "connector_json_post_request",
            side_effect=json_request,
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

        self.assertEqual(report["dimensions"], ["date"])
        self.assertEqual(dataframe.loc[0, "date"], "2026-09-01")
        self.assertEqual(dataframe.loc[0, "clicks"], 12)
        self.assertEqual(request_payloads[1]["aggregationType"], "byProperty")
        self.assertEqual(request_payloads[1]["dataState"], "final")
        self.assertNotIn(
            "all",
            [payload.get("dataState") for payload in request_payloads],
        )

    def test_search_console_prefers_nonzero_daily_result(self):
        def json_request(url, headers, payload):
            if "dataState" not in payload:
                return {"rows": [{
                    "keys": ["2026-09-18"],
                    "clicks": 0,
                    "impressions": 1,
                    "ctr": 0,
                    "position": 10,
                }]}
            return {"rows": [{
                "keys": ["2026-09-18"],
                "clicks": 0,
                "impressions": 0,
                "ctr": 0,
                "position": 0,
            }]}

        with patch.object(
            connectors,
            "get_oauth_access_token",
            return_value="search-token",
        ), patch.object(
            connectors,
            "connector_json_post_request",
            side_effect=json_request,
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
                date(2026, 9, 30),
            )

        september_18 = dataframe.loc[dataframe["date"] == "2026-09-18"].iloc[0]
        self.assertEqual(september_18["impressions"], 1)
        self.assertEqual(report["dimensions"], ["date"])

    def test_search_console_uses_final_daily_metrics_when_fresh_data_is_zero(self):
        def json_request(url, headers, payload):
            if "dataState" not in payload:
                return {
                    "rows": [
                        {
                            "keys": ["2026-09-18"],
                            "clicks": 0,
                            "impressions": 0,
                            "ctr": 0,
                            "position": 0,
                        },
                        {
                            "keys": ["2026-09-20"],
                            "clicks": 0,
                            "impressions": 0,
                            "ctr": 0,
                            "position": 0,
                        },
                    ],
                }
            if payload["dataState"] == "all":
                return {
                    "rows": [
                        {
                            "keys": ["2026-09-18"],
                            "clicks": 0,
                            "impressions": 0,
                            "ctr": 0,
                            "position": 0,
                        },
                        {
                            "keys": ["2026-09-20"],
                            "clicks": 0,
                            "impressions": 0,
                            "ctr": 0,
                            "position": 0,
                        },
                    ],
                }
            return {
                "rows": [
                    {
                        "keys": ["2026-09-18"],
                        "clicks": 0,
                        "impressions": 1,
                        "ctr": 0,
                        "position": 6,
                    },
                    {
                        "keys": ["2026-09-20"],
                        "clicks": 0,
                        "impressions": 1,
                        "ctr": 0,
                        "position": 6,
                    },
                ],
            }

        with patch.object(
            connectors,
            "get_oauth_access_token",
            return_value="search-token",
        ), patch.object(
            connectors,
            "connector_json_post_request",
            side_effect=json_request,
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
                date(2026, 9, 22),
            )

        self.assertEqual(
            dataframe.set_index("date").loc[
                ["2026-09-18", "2026-09-20"],
                "impressions",
            ].tolist(),
            [1, 1],
        )
        self.assertEqual(report["dimensions"], ["date"])

    def test_search_console_retries_a_lagged_finalized_window(self):
        def json_request(url, headers, payload):
            if "dataState" not in payload:
                return {"rows": []}
            if payload["endDate"] == "2026-09-22":
                return {
                    "rows": [{
                        "keys": ["2026-09-18"],
                        "clicks": 0,
                        "impressions": 0,
                        "ctr": 0,
                        "position": 0,
                    }],
                }
            return {
                "rows": [
                    {
                        "keys": ["2026-09-18"],
                        "clicks": 0,
                        "impressions": 1,
                        "ctr": 0,
                        "position": 6,
                    },
                    {
                        "keys": ["2026-09-20"],
                        "clicks": 0,
                        "impressions": 1,
                        "ctr": 0,
                        "position": 6,
                    },
                ],
            }

        with patch.object(
            connectors,
            "get_oauth_access_token",
            return_value="search-token",
        ), patch.object(
            connectors,
            "connector_json_post_request",
            side_effect=json_request,
        ), patch.object(
            connectors,
            "date",
            SimpleNamespace(
                today=lambda: date(2026, 9, 22),
            ),
        ), patch.dict(
            "os.environ",
            {"GOOGLE_SEARCH_CONSOLE_API_BASE_URL": "https://www.googleapis.com/webmasters/v3"},
            clear=False,
        ):
            dataframe, _report = connectors.load_google_search_console_dataframe(
                None,
                make_connection(
                    "google_search_console",
                    {"site_url": "https://example.com/"},
                ),
                date(2026, 9, 1),
                date(2026, 9, 22),
            )

        self.assertEqual(
            dataframe.set_index("date").loc[
                ["2026-09-18", "2026-09-20"],
                "impressions",
            ].tolist(),
            [1, 1],
        )

    def test_search_console_ignores_fresh_only_dates_when_final_data_exists(self):
        def json_request(url, headers, payload):
            if "dataState" not in payload:
                return {
                    "rows": [
                        {
                            "keys": ["2026-09-18"],
                            "clicks": 0,
                            "impressions": 0,
                            "ctr": 0,
                            "position": 0,
                        },
                        {
                            "keys": ["2026-09-20"],
                            "clicks": 0,
                            "impressions": 0,
                            "ctr": 0,
                            "position": 0,
                        },
                    ],
                }
            if payload["dataState"] == "all":
                return {
                    "rows": [
                        {
                            "keys": ["2026-09-18"],
                            "clicks": 0,
                            "impressions": 1,
                            "ctr": 0,
                            "position": 10,
                        },
                        {
                            "keys": ["2026-09-20"],
                            "clicks": 0,
                            "impressions": 1,
                            "ctr": 0,
                            "position": 2,
                        },
                        {
                            "keys": ["2026-09-21"],
                            "clicks": 1,
                            "impressions": 1,
                            "ctr": 1,
                            "position": 1,
                        },
                    ],
                }
            return {
                "rows": [
                    {
                        "keys": ["2026-09-18"],
                        "clicks": 0,
                        "impressions": 1,
                        "ctr": 0,
                        "position": 10,
                    },
                    {
                        "keys": ["2026-09-20"],
                        "clicks": 0,
                        "impressions": 1,
                        "ctr": 0,
                        "position": 2,
                    },
                ],
            }

        with patch.object(
            connectors,
            "get_oauth_access_token",
            return_value="search-token",
        ), patch.object(
            connectors,
            "connector_json_post_request",
            side_effect=json_request,
        ), patch.dict(
            "os.environ",
            {"GOOGLE_SEARCH_CONSOLE_API_BASE_URL": "https://www.googleapis.com/webmasters/v3"},
            clear=False,
        ):
            dataframe, _report = connectors.load_google_search_console_dataframe(
                None,
                make_connection(
                    "google_search_console",
                    {"site_url": "https://example.com/"},
                ),
                date(2026, 9, 1),
                date(2026, 9, 22),
            )

        self.assertEqual(
            set(dataframe["date"]),
            {"2026-09-18", "2026-09-20"},
        )

    def test_search_console_daily_aggregate_replaces_stale_detailed_zero(self):
        existing = pd.DataFrame([
            {
                "date": "2026-09-18",
                "query": "decisionate",
                "page": "https://decisionate.ca/",
                "clicks": 0,
                "impressions": 0,
                "ctr": 0,
                "position": 0,
            },
        ])
        incoming = pd.DataFrame([
            {
                "date": "2026-09-18",
                "clicks": 0,
                "impressions": 1,
                "ctr": 0,
                "position": 6,
            },
        ])

        merged = datasets_router.merge_connector_dataframes(
            existing,
            incoming,
            "google_search_console",
            {"dimensions": ["date"]},
        )

        self.assertEqual(len(merged), 1)
        self.assertEqual(merged.loc[0, "impressions"], 1)
        self.assertTrue(pd.isna(merged.loc[0, "query"]))
        self.assertTrue(pd.isna(merged.loc[0, "page"]))

    def test_search_console_daily_rows_are_deduplicated_by_date(self):
        existing = pd.DataFrame([
            {
                "keys": '["2026-09-18"]',
                "date": "2026-09-18",
                "clicks": 0,
                "impressions": 0,
                "ctr": 0,
                "position": 0,
                "revision": "old",
            },
        ])
        incoming = pd.DataFrame([
            {
                "keys": '["2026-09-18"]',
                "date": "2026-09-18",
                "clicks": 0,
                "impressions": 1,
                "ctr": 0,
                "position": 10,
                "revision": "new",
            },
        ])

        merged = datasets_router.merge_connector_dataframes(
            existing,
            incoming,
            "google_search_console",
            {"dimensions": ["date"]},
        )

        self.assertEqual(len(merged), 1)
        self.assertEqual(merged.loc[0, "impressions"], 1)
        self.assertEqual(merged.loc[0, "revision"], "new")

    def test_search_console_resync_replaces_daily_rows_in_window(self):
        existing = pd.DataFrame([
            {
                "date": "2026-09-18",
                "clicks": 0,
                "impressions": 1,
                "ctr": 0,
                "position": 10,
            },
            {
                "date": "2026-09-21",
                "clicks": 1,
                "impressions": 1,
                "ctr": 1,
                "position": 1,
            },
        ])
        incoming = pd.DataFrame([
            {
                "date": "2026-09-18",
                "clicks": 0,
                "impressions": 1,
                "ctr": 0,
                "position": 10,
            },
            {
                "date": "2026-09-20",
                "clicks": 0,
                "impressions": 1,
                "ctr": 0,
                "position": 2,
            },
        ])

        merged = datasets_router.merge_connector_dataframes(
            existing,
            incoming,
            "google_search_console",
            {
                "start_date": "2026-09-15",
                "end_date": "2026-09-22",
            },
        )

        self.assertEqual(
            set(merged["date"]),
            {"2026-09-18", "2026-09-20"},
        )

    def test_empty_connector_fetch_does_not_duplicate_existing_rows(self):
        existing = pd.DataFrame([
            {"created_at": "2026-09-18", "revenue": 125},
        ])

        merged = datasets_router.merge_connector_dataframes(
            existing,
            pd.DataFrame(),
            "postgresql",
            {},
        )

        self.assertEqual(len(merged), 1)
        self.assertEqual(merged.loc[0, "revenue"], 125)

    def test_initial_connector_fetch_deduplicates_provider_rows(self):
        incoming = pd.DataFrame([
            {"record_id": "contact-1", "name": "Old name"},
            {"record_id": "contact-1", "name": "Current name"},
        ])

        merged = datasets_router.merge_connector_dataframes(
            None,
            incoming,
            "hubspot",
            {},
        )

        self.assertEqual(len(merged), 1)
        self.assertEqual(merged.loc[0, "name"], "Current name")

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

    def test_google_business_profile_does_not_create_location_rows_without_metrics(self):
        def json_request(url, headers):
            if "mybusinessbusinessinformation.googleapis.com" in url:
                return {
                    "locations": [{
                        "name": "locations/123",
                        "title": "Decisionate Halifax",
                    }],
                }
            return {"multiDailyMetricTimeSeries": []}

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
            dataframe, _report = connectors.load_google_business_profile_dataframe(
                None,
                make_connection("google_business_profile", {}),
                date(2026, 9, 1),
                date(2026, 9, 2),
            )

        self.assertTrue(dataframe.empty)

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
        ) as square_request, patch.dict(
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
        request_payload = square_request.call_args.kwargs["payload"]
        self.assertEqual(
            request_payload["query"]["filter"]["state_filter"]["states"],
            ["COMPLETED", "CANCELED"],
        )

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
                "date_created": "2020-09-01T12:00:00",
                "date_modified": "2026-09-01T12:00:00",
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
        request_params = parse_qs(urlsplit(request.call_args.args[0]).query)
        self.assertEqual(request_params["modified_after"], ["2026-09-01T00:00:00Z"])
        self.assertEqual(request_params["modified_before"], ["2026-09-02T23:59:59Z"])
        self.assertEqual(request_params["dates_are_gmt"], ["true"])

    def test_shopify_orders_sync_by_update_time(self):
        params = connectors.shopify_order_params(
            date(2026, 9, 1),
            date(2026, 9, 30),
        )

        self.assertEqual(
            params["updated_at_min"],
            "2026-09-01T00:00:00Z",
        )
        self.assertEqual(
            params["updated_at_max"],
            "2026-09-30T23:59:59Z",
        )
        self.assertNotIn("created_at_min", params)
        self.assertNotIn("created_at_max", params)

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
        ) as request, patch.dict(
            "os.environ",
            {
                "LIGHTSPEED_API_BASE_URL_TEMPLATE": (
                    "https://api.lightspeedapp.com/API/V3/Account/{account_id}"
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
        request_url = request.call_args.args[0]
        self.assertIn(
            "/API/V3/Account/account-1/Sale.json",
            request_url,
        )

    def test_lightspeed_x_resources_are_normalized(self):
        with patch.object(
            connectors,
            "get_oauth_access_token",
            return_value="lightspeed-x-token",
        ), patch.object(
            connectors,
            "connector_json_request",
            return_value={
                "data": [{
                    "id": "sale-1",
                    "created_at": "2026-09-01T12:00:00Z",
                    "customer_id": "customer-1",
                    "total_price": "125.00",
                    "line_items": [{"product_id": "product-1"}],
                }],
            },
        ) as request, patch.dict(
            "os.environ",
            {
                "LIGHTSPEED_X_API_BASE_URL_TEMPLATE": (
                    "https://{domain_prefix}.retail.lightspeed.app/api/{version}"
                ),
                "LIGHTSPEED_X_API_VERSION": "2026-07",
            },
            clear=False,
        ):
            dataframe, report = connectors.load_lightspeed_x_dataframe(
                None,
                make_connection(
                    "lightspeed_x",
                    {
                        "domain_prefix": "client-store",
                        "resource_types": "sales,customers,products",
                    },
                ),
                date(2026, 9, 1),
                date(2026, 9, 2),
                "sales",
            )

        self.assertEqual(report["resource"], "sales")
        self.assertEqual(dataframe.loc[0, "sale_id"], "sale-1")
        self.assertEqual(dataframe.loc[0, "customer_id"], "customer-1")
        self.assertEqual(dataframe.loc[0, "total"], "125.00")
        self.assertIn(
            "https://client-store.retail.lightspeed.app/api/2026-07/sales",
            request.call_args.args[0],
        )

    def test_lightspeed_k_sales_are_normalized(self):
        with patch.object(
            connectors,
            "get_oauth_access_token",
            return_value="lightspeed-k-token",
        ), patch.object(
            connectors,
            "connector_json_request",
            return_value={
                "sales": [{
                    "accountFiscId": "A65315.17",
                    "timeOpening": "2026-09-01T12:00:00Z",
                    "timeClosed": "2026-09-01T12:30:00Z",
                    "type": "SALE",
                    "payments": [{
                        "netAmountWithTax": "125.00",
                        "consumer": {
                            "customerId": 42,
                            "email": "buyer@example.com",
                        },
                    }],
                }],
            },
        ) as request, patch.dict(
            "os.environ",
            {"LIGHTSPEED_K_API_BASE_URL": "https://api.lsk.lightspeed.app"},
            clear=False,
        ):
            dataframe, report = connectors.load_lightspeed_k_dataframe(
                None,
                make_connection(
                    "lightspeed_k",
                    {
                        "business_location_id": "45454565682155",
                        "resource_types": "sales,products",
                    },
                ),
                date(2026, 9, 1),
                date(2026, 9, 2),
                "sales",
            )

        self.assertEqual(report["resource"], "sales")
        self.assertEqual(dataframe.loc[0, "sale_id"], "A65315.17")
        self.assertEqual(dataframe.loc[0, "customer_id"], 42)
        self.assertEqual(dataframe.loc[0, "total"], 125.0)
        self.assertIn(
            "/f/v2/business-location/45454565682155/sales",
            request.call_args.args[0],
        )

    def test_lightspeed_o_orders_are_normalized(self):
        with patch.object(
            connectors,
            "get_oauth_access_token",
            return_value="lightspeed-o-token",
        ), patch.object(
            connectors,
            "connector_json_request_with_headers",
            return_value=([
                {
                    "id": 77,
                    "created_at": "2026-09-01T12:00:00Z",
                    "status": "COMPLETE",
                    "value": "125.00",
                    "customer_id": 42,
                },
            ], {}),
        ) as request, patch.dict(
            "os.environ",
            {"LIGHTSPEED_O_API_BASE_URL": "https://api.kounta.com"},
            clear=False,
        ):
            dataframe, report = connectors.load_lightspeed_o_dataframe(
                None,
                make_connection(
                    "lightspeed_o",
                    {
                        "company_id": "5678",
                        "site_id": "827",
                        "resource_types": "sales,customers,products",
                    },
                ),
                date(2026, 9, 1),
                date(2026, 9, 2),
                "sales",
            )

        self.assertEqual(report["resource"], "sales")
        self.assertEqual(dataframe.loc[0, "sale_id"], 77)
        self.assertEqual(dataframe.loc[0, "customer_id"], 42)
        self.assertEqual(dataframe.loc[0, "total"], "125.00")
        self.assertIn(
            "/v1/companies/5678/sites/827/orders/complete.json",
            request.call_args.args[0],
        )


if __name__ == "__main__":
    unittest.main()
