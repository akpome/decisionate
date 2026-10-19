import json
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import pandas as pd

from app.modules.correlation.catalog import metric_catalog
from app.modules.datasets.services.metric_policy import FRAME_POLICY_KEY
from app.modules.datasets.services.summary_query import SUMMARY_MARKER_COLUMN


class ReportCatalogDiagnosticsTests(unittest.TestCase):
    def setUp(self):
        env = patch.dict("os.environ", {"CURATED_METRIC_DEFAULTS_BACKEND": "false", "CORRELATION_REPORTING_TIMEZONE": "UTC"})
        env.start()
        self.addCleanup(env.stop)
        self.frame = pd.DataFrame({"date": pd.date_range("2026-01-01", periods=4), "spend": [10., 20., 30., 40.]})

    def catalog(self, config=None, frame=None, source="csv"):
        dataset = SimpleNamespace(id=1, source_type=source, file_name="Source.csv", source_config=json.dumps(config or {}))
        return metric_catalog(dataset, self.frame if frame is None else frame)

    def test_missing_selection_is_not_misrepresented_as_missing_numeric_data(self):
        value = self.catalog()
        self.assertEqual(value["metrics"], [])
        self.assertEqual(value["metric_issues"], [{"code": "selection_not_saved"}])
        self.assertEqual(value["date_columns"], ["date"])
        self.assertEqual(value["availability"]["date"]["start"], "2026-01-01")

    def test_explicit_empty_selection_stays_empty(self):
        value = self.catalog({"selected_metric_columns": []})
        self.assertEqual(value["metrics"], [])
        self.assertEqual(value["metric_issues"], [{"code": "no_metrics_selected"}])

    def test_selected_supported_metrics_are_unchanged_and_not_auto_expanded(self):
        self.frame["orders"] = [1, 2, 3, 4]
        value = self.catalog({"selected_metric_columns": ["spend"]})
        self.assertEqual([metric["metric_key"] for metric in value["metrics"]], ["spend"])
        self.assertEqual(value["metric_issues"], [])
        self.assertEqual(value["metrics"][0]["aggregation"], "sum")

    def test_missing_identifier_unknown_and_insufficient_fields_have_distinct_reasons(self):
        self.frame["account_id"] = [1, 2, 3, 4]
        self.frame["unrecognized_measure"] = [1, 2, 3, 4]
        self.frame["revenue"] = [None, 10., None, None]
        value = self.catalog({"selected_metric_columns": ["removed", "account_id", "unrecognized_measure", "revenue", "spend"]})
        self.assertEqual({issue["metric_key"]: issue["code"] for issue in value["metric_issues"]}, {
            "removed": "column_unavailable", "account_id": "identifier_field",
            "unrecognized_measure": "aggregation_unconfirmed", "revenue": "insufficient_values",
        })
        self.assertEqual([metric["metric_key"] for metric in value["metrics"]], ["spend"])

    def test_legacy_connector_totals_remain_blocked_without_transaction_policy(self):
        value = self.catalog({"selected_metric_columns": ["spend"]}, source="xero")
        self.assertEqual(value["metrics"], [])
        self.assertIn({"code": "transaction_policy_required"}, value["metric_issues"])

    def test_curated_policy_still_exposes_only_saved_metrics(self):
        self.frame.attrs[FRAME_POLICY_KEY] = {"selected": ["spend"], "descriptors": {
            "spend": {"unit": "currency", "currency": "CAD", "aggregation": "SUM", "components": []},
        }}
        value = self.catalog({"selected_metric_columns": ["spend"]}, source="xero")
        self.assertEqual(value["metric_issues"], [])
        self.assertEqual(value["metrics"][0]["aggregation"], "policy")

    def test_mixed_currency_is_not_silently_combined(self):
        self.frame["currency"] = ["CAD", "USD", "CAD", "CAD"]
        value = self.catalog({"selected_metric_columns": ["spend"]})
        self.assertEqual(value["metrics"], [])
        self.assertEqual(value["metric_issues"], [{"metric_key": "spend", "code": "currency_unresolved"}])

    def test_summary_and_ratio_fields_remain_excluded_without_safe_policy(self):
        summary = self.frame.copy()
        summary[SUMMARY_MARKER_COLUMN] = True
        value = self.catalog({"selected_metric_columns": ["spend"]}, summary)
        self.assertEqual(value["metrics"], [])
        self.assertIn({"metric_key": "spend", "code": "summary_policy_required"}, value["metric_issues"])
        self.frame["conversion_rate"] = [.1, .2, .3, .4]
        value = self.catalog({"selected_metric_columns": ["conversion_rate"]})
        self.assertEqual(value["metrics"], [])
        self.assertIn({"metric_key": "conversion_rate", "code": "formula_required"}, value["metric_issues"])

    def test_no_date_field_and_unusable_date_values_are_distinct(self):
        value = self.catalog({"selected_metric_columns": ["spend"]}, self.frame.drop(columns="date"))
        self.assertIn({"code": "date_field_missing"}, value["metric_issues"])
        self.frame["date"] = [None] * 4
        value = self.catalog({"selected_metric_columns": ["spend"]})
        self.assertIn({"code": "date_values_unavailable"}, value["metric_issues"])

    def test_diagnostics_expose_field_names_not_source_values(self):
        self.frame["currency"] = ["private-value"] * 4
        value = self.catalog({"selected_metric_columns": ["spend"]})
        self.assertNotIn("private-value", json.dumps(value))


if __name__ == "__main__":
    unittest.main()
