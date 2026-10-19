import json
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import pandas as pd
from pandas.testing import assert_frame_equal

from app.modules.reports.catalog import prepare_report_source, report_metric_catalog
from app.modules.reports.service import build_report
from app.modules.alerts.router import build_weekly_cross_dataset_report
from app.modules.alerts.schemas import WeeklyReportPreferenceResponse
from app.modules.datasets.services.connector_schema import normalize_connector_row_schema
from app.modules.datasets.services.metric_policy import METRIC_POLICIES, POLICY_SCHEMAS, SCHEMA_VERSION_KEY
from app.modules.datasets.services import connectors
from tests.test_business_reports import definition


def dataset(identity=1, source="csv", **config):
    return SimpleNamespace(id=identity, user_id="owner", file_name=f"Source {identity}", source_type=source, source_config=json.dumps(config))


def xero_frame():
    return pd.DataFrame({
        "date": pd.date_range("2026-01-01", periods=40).repeat(2),
        "record_id": [f"invoice-{i}" for i in range(40) for _ in range(2)],
        "line_item_id": [f"line-{i}" for i in range(80)],
        "quantity": [2., 1.] * 40, "unit_price": [10., 5.] * 40,
        "line_total": [20., 5.] * 40, "currency": ["CAD"] * 80,
        "total": [25., None] * 40,
    })


class ReportMetricDefaultsTests(unittest.TestCase):
    def setUp(self):
        env = patch.dict("os.environ", {"CURATED_METRIC_DEFAULTS_BACKEND": "false", "CORRELATION_REPORTING_TIMEZONE": "UTC"})
        env.start()
        self.addCleanup(env.stop)

    def test_csv_default_choices_do_not_require_a_prior_save_or_include_unknown_numbers(self):
        frame = pd.DataFrame({"month": pd.date_range("2025-01-01", periods=12, freq="MS"), "ad_spend": range(10, 22),
                              "website_visits": range(100, 112), "leads": range(20, 32), "customers": range(5, 17),
                              "account_id": range(12), "unreviewed_number": range(12)})
        item = dataset()
        before = item.source_config
        result = report_metric_catalog(item, frame)
        self.assertEqual({metric["metric_key"] for metric in result["metrics"]}, {"ad_spend", "website_visits", "leads", "customers"})
        self.assertNotIn("selection_not_saved", str(result["metric_issues"]))
        self.assertEqual(item.source_config, before)

    def test_explicit_empty_and_manual_csv_choices_are_preserved(self):
        frame = pd.DataFrame({"date": pd.date_range("2026-01-01", periods=4), "spend": [1, 2, 3, 4], "revenue": [10, 20, 30, 40]})
        for saved in ([], ["revenue"]):
            item = dataset(selected_metric_columns=saved)
            before = item.source_config
            self.assertEqual([metric["metric_key"] for metric in report_metric_catalog(item, frame)["metrics"]], saved)
            self.assertEqual(item.source_config, before)

    def test_legacy_xero_exposes_reviewed_line_metrics_without_rollout_flags(self):
        item, frame = dataset(source="xero", resource="invoices"), xero_frame()
        before = frame.copy(deep=True)
        result = report_metric_catalog(item, frame)
        metrics = {metric["metric_key"]: metric for metric in result["metrics"]}
        self.assertEqual(set(metrics), {"quantity", "unit_price", "line_total"})
        self.assertEqual(metrics["line_total"]["aggregation"], "policy")
        self.assertEqual(metrics["line_total"]["currency"], "CAD")
        self.assertEqual(json.loads(item.source_config), {"resource": "invoices"})
        assert_frame_equal(frame, before)

    def test_manual_connector_selection_and_explicit_empty_are_not_replaced_by_defaults(self):
        frame = xero_frame()
        for selection in ([], ["unit_price"]):
            item = dataset(source="xero", resource="invoices", selected_metric_columns=selection, metric_selection_provenance={"source": "user"})
            result = report_metric_catalog(item, frame)
            self.assertEqual([metric["metric_key"] for metric in result["metrics"]], selection)

    def test_line_connector_defaults_use_only_fields_certified_by_the_emitted_schema(self):
        for (source, resource, schema_version), policy in METRIC_POLICIES.items():
            if policy.grain not in {"document_line", "order_line", "sale_line"}:
                continue
            with self.subTest(source=source, resource=resource):
                schema = POLICY_SCHEMAS[f"{source}/{resource}/{schema_version}"]
                config = {"resource": resource}
                if schema["api_versions"]:
                    config["api_version"] = schema["api_versions"][0]
                frame = xero_frame()
                frame["state"] = "COMPLETED"
                result = report_metric_catalog(dataset(source=source, **config), frame)
                keys = {metric["metric_key"] for metric in result["metrics"]}
                if "quantity" in schema["columns"]:
                    self.assertIn("quantity", keys)
                else:
                    self.assertNotIn("quantity", keys)
                self.assertTrue(keys <= set(schema["columns"]))

    def test_legacy_horizontal_manual_choices_follow_reviewed_normalized_aliases(self):
        raw = pd.DataFrame({"record_id": ["one", "two"], "date": ["2026-01-01", "2026-01-02"], "currency": ["CAD", "CAD"],
                            "LineItems__0__Quantity": [2, 3], "LineItems__0__UnitAmount": [10, 20], "LineItems__0__LineAmount": [20, 60]})
        frame = normalize_connector_row_schema(raw, "xero", "invoices")
        item = dataset(source="xero", resource="invoices", selected_metric_columns=["LineItems__0__LineAmount"], metric_selection_provenance={"source": "user"})
        self.assertEqual([metric["metric_key"] for metric in report_metric_catalog(item, frame)["metrics"]], ["line_total"])
        self.assertEqual(json.loads(item.source_config)["selected_metric_columns"], ["LineItems__0__LineAmount"])

    def test_actual_xero_emitter_output_is_reportable_without_reconnecting_or_saving(self):
        payload = {"Invoices": [{"InvoiceID": f"invoice-{index}", "DateString": f"2026-01-0{index + 1}", "CurrencyCode": "CAD", "Total": 25,
                                 "LineItems": [{"LineItemID": f"{index}-a", "Quantity": 2, "UnitAmount": 10, "LineAmount": 20},
                                               {"LineItemID": f"{index}-b", "Quantity": 1, "UnitAmount": 5, "LineAmount": 5}]} for index in range(2)]}
        connection = SimpleNamespace(source_type="xero", last_synced_at=None,
                                     connection_config=json.dumps({"tenant_id": "123e4567-e89b-12d3-a456-426614174000"}))
        with patch.object(connectors, "get_oauth_access_token", return_value="test-token"), \
             patch.object(connectors, "require_provider_url", return_value="https://api.xero.com/api.xro/2.0"), \
             patch.object(connectors, "connector_json_request", return_value=payload):
            frame, metadata = connectors.load_xero_dataframe(None, connection, resource_type_override="invoices")
        item = dataset(source="xero", **metadata)
        self.assertEqual({metric["metric_key"] for metric in report_metric_catalog(item, frame)["metrics"]}, {"quantity", "unit_price", "line_total"})

    def test_report_preview_and_weekly_values_use_the_same_xero_policy(self):
        invoice, raw = dataset(source="xero", resource="invoices"), xero_frame()
        sales = dataset(identity=2)
        sales_frame = pd.DataFrame({"date": pd.date_range("2026-01-01", periods=40), "net_sales": [100.] * 40})
        frames = {1: (invoice, raw), 2: (sales, sales_frame)}
        payload = definition()
        payload["metrics"][0].update(metric_key="line_total", aggregation="policy")
        payload["date_range"] = {"start": "2026-01-26", "end": "2026-02-01"}
        report = build_report(frames, payload)
        self.assertEqual(report["metrics"][0]["value"], 175.)
        self.assertEqual(report["metrics"][1]["value"], 700.)
        preference = WeeklyReportPreferenceResponse(enabled=False, cadence="weekly", delivery_day="monday", recipient_emails=[],
                                                   metric_focus=["1:line_total", "2:net_sales"], include_recommendations=False)
        with patch("app.modules.alerts.router.complete_week", return_value=payload["date_range"]):
            weekly = build_weekly_cross_dataset_report(frames, preference)
        self.assertEqual({metric["metric_key"]: metric["value"] for metric in weekly["metrics"]}, {"line_total": 175., "net_sales": 700.})

    def test_xero_unit_prices_are_averaged_not_summed_and_preparation_is_idempotent(self):
        item = dataset(source="xero", resource="invoices", selected_metric_columns=["unit_price"], metric_selection_provenance={"source": "user"})
        view, frame = prepare_report_source(item, xero_frame())
        view2, frame2 = prepare_report_source(view, frame)
        assert_frame_equal(frame, frame2)
        self.assertEqual(view.source_config, view2.source_config)
        payload = definition(); payload["metrics"][0].update(metric_key="unit_price", aggregation="policy")
        payload["date_range"] = {"start": "2026-01-26", "end": "2026-02-01"}
        other = pd.DataFrame({"date": pd.date_range("2026-01-01", periods=40), "net_sales": [100.] * 40})
        self.assertEqual(build_report({1: (item, xero_frame()), 2: (dataset(identity=2), other)}, payload)["metrics"][0]["value"], 7.5)

    def test_unknown_schema_api_and_pinned_policy_versions_do_not_get_replaced(self):
        for config in (
            {SCHEMA_VERSION_KEY: "unreviewed-schema"},
            {"curated_metric_selection": True, "metric_selection_provenance": {"source": "user", "policy_version": "missing-version"}},
        ):
            item = dataset(source="xero", resource="invoices", selected_metric_columns=["line_total"], **config)
            before = item.source_config
            self.assertEqual(report_metric_catalog(item, xero_frame())["metrics"], [])
            self.assertEqual(item.source_config, before)
        ads = dataset(source="google_ads", resource="campaign_performance", api_version="v999")
        self.assertEqual(report_metric_catalog(ads, pd.DataFrame({"date": ["2026-01-01", "2026-01-02"], "clicks": [1, 2]}))["metrics"], [])

    def test_unsafe_currency_and_unknown_saved_fields_are_not_approved_by_generic_fallback(self):
        frame = xero_frame(); frame["currency"] = ["CAD", "USD"] * 40
        frame["unknown_numeric"] = range(80)
        item = dataset(source="xero", resource="invoices", selected_metric_columns=["line_total", "unknown_numeric"], metric_selection_provenance={"source": "user"})
        self.assertEqual(report_metric_catalog(item, frame)["metrics"], [])

    def test_saved_dimensions_do_not_remove_the_date_needed_by_valid_measures(self):
        item = dataset(source="xero", resource="invoices", selected_metric_columns=["date", "quantity"], metric_selection_provenance={"source": "user"})
        result = report_metric_catalog(item, xero_frame())
        self.assertEqual(result["date_columns"], ["date"])
        self.assertEqual([metric["metric_key"] for metric in result["metrics"]], ["quantity"])

    def test_reviewed_header_totals_with_duplicate_document_values_are_withheld(self):
        frame = xero_frame().rename(columns={"total": "total_amount"})
        frame["total_amount"] = [25.] * 80
        item = dataset(source="sage", resource="sales_invoices", selected_metric_columns=["total_amount", "quantity"], metric_selection_provenance={"source": "user"})
        result = report_metric_catalog(item, frame)
        self.assertEqual([metric["metric_key"] for metric in result["metrics"]], ["quantity"])

    def test_empty_or_unknown_csv_defaults_remain_honest(self):
        frame = pd.DataFrame({"date": ["2026-01-01", "2026-01-02"], "unknown_number": [1, 2]})
        result = report_metric_catalog(dataset(), frame)
        self.assertEqual(result["metrics"], [])
        self.assertIn({"code": "no_eligible_defaults"}, result["metric_issues"])


if __name__ == "__main__":
    unittest.main()
