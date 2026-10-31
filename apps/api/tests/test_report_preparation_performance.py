import unittest
from types import SimpleNamespace
from unittest.mock import patch

import pandas as pd

from app.modules.datasets.services import relationships
from app.modules.datasets.services.metric_policy import FRAME_POLICY_KEY
from app.modules.reports import service


class ReportPreparationPerformanceTests(unittest.TestCase):
    def fixture(self):
        frame = pd.DataFrame({"date": ["2026-01-03T02:00:00Z", "2026-01-02T02:00:00Z",
                                       "2026-01-02T01:00:00Z", "2026-01-04T01:00:00Z", "invalid"],
                              "other_date": ["2026-01-01"] * 5})
        references = []
        for aggregation in ("sum", "avg", "min", "max", "count", "last"):
            frame[aggregation] = ["$50", "30", "(10)", None, "999"]
            references.append({"dataset_id": 1, "metric_key": aggregation, "aggregation": aggregation, "date_column": "date"})
        definition = {"grain": "daily", "reporting_timezone": "America/Halifax",
                      "date_range": {"start": "2026-01-01", "end": "2026-01-03"}}
        frames = {1: (SimpleNamespace(id=1, file_name="data.csv"), frame)}
        return frames, references, definition

    def test_metrics_share_date_preparation_without_changing_values_or_missingness(self):
        frames, refs, definition = self.fixture()
        original = frames[1][1].copy(deep=True)
        for grain in ("daily", "weekly", "monthly", "quarterly"):
            definition["grain"] = grain
            expected = {key: values for ref in refs for key, values in service.prepare_report_series(frames, [ref], definition).items()}
            with patch.object(service, "report_dates", wraps=service.report_dates) as parse:
                result = service.prepare_report_series(frames, refs, definition)
            self.assertEqual(parse.call_count, 1)
            for key in expected:
                pd.testing.assert_frame_equal(result[key], expected[key])
        definition["grain"] = "daily"
        result = service.prepare_report_series(frames, refs, definition)
        for metric, expected in (("sum", 20), ("avg", 10), ("min", -10), ("max", 30), ("count", 2), ("last", 30)):
            self.assertEqual(result[f"1:{metric}"].value.iloc[0], expected)
            self.assertTrue(pd.isna(result[f"1:{metric}"].value.iloc[-1]))
        pd.testing.assert_frame_equal(frames[1][1], original)

    def test_preparation_is_scoped_to_source_date_column_and_call(self):
        frames, refs, definition = self.fixture()
        frames[2] = (SimpleNamespace(id=2, file_name="other.csv"), frames[1][1].copy())
        refs = [refs[0], {**refs[1], "date_column": "other_date"}, {**refs[0], "dataset_id": 2}]
        with patch.object(service, "report_dates", wraps=service.report_dates) as parse:
            result = service.prepare_report_series(frames, refs, definition)
        self.assertEqual(parse.call_count, 3)
        self.assertNotEqual(result["1:sum"].value.iloc[0], result["1:avg"].value.iloc[0])
        frames[2][1]["sum"] = 100
        updated = service.prepare_report_series(frames, refs, definition)
        self.assertEqual(updated["2:sum"].value.iloc[0], 200)
        pd.testing.assert_frame_equal(updated["1:sum"], result["1:sum"])

    def test_relationship_metric_validation_does_not_scan_unrelated_columns(self):
        frames, _, _ = self.fixture()
        frame = frames[1][1]
        with patch.object(relationships, "get_numeric_columns", wraps=relationships.get_numeric_columns) as numeric:
            self.assertEqual(relationships._select_numeric_column(frame, "sum", "Metric"), "sum")
        self.assertEqual(list(numeric.call_args.args[0].columns), ["sum"])
        frame.attrs[FRAME_POLICY_KEY] = {"selected": ["avg"], "descriptors": {"avg": {}}}
        with self.assertRaisesRegex(ValueError, "numeric metric"):
            relationships._select_numeric_column(frame, "sum", "Metric")


if __name__ == "__main__":
    unittest.main()
