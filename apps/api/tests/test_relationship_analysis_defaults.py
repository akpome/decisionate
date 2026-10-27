import unittest
import math
from types import SimpleNamespace
from unittest.mock import patch

import pandas as pd

from app.db.models import DatasetRelationship
from app.modules.datasets.schemas import DatasetRelationshipRequest, DatasetRelationshipResponse
from app.modules.datasets.services import relationships
from app.modules.reports.schemas import ReportDefinition


def sources(count=80, frequency="D"):
    dates = pd.date_range("2000-01-01", periods=count, freq=frequency)
    return [(SimpleNamespace(id=identity, file_name=f"Source {identity}.csv"), pd.DataFrame({"date": dates, "value": range(count)}))
            for identity in (1, 2)]


def definition(**settings):
    return {"left": {"dataset_id": 1, "date_column": "date", "metric_column": "value"},
            "right": {"dataset_id": 2, "date_column": "date", "metric_column": "value"}, **settings}


class RelationshipAnalysisDefaultTests(unittest.TestCase):
    def test_report_monitor_and_new_record_defaults_agree(self):
        monitor = DatasetRelationshipRequest(**definition())
        report = ReportDefinition(name="Shared defaults", business_question="How do these sources change together?",
                                  metrics=[{"dataset_id": identity, "date_column": "date", "metric_key": "value"} for identity in (1, 2)],
                                  date_range={"start": "2000-01-01", "end": "2000-02-01"})
        self.assertEqual((monitor.method, monitor.period, monitor.aggregation, monitor.minimum_observations, monitor.maximum_lag, monitor.lag_periods),
                         ("spearman", "daily", "sum", 52, 12, 0))
        self.assertEqual((monitor.method, monitor.period, monitor.minimum_observations, monitor.maximum_lag),
                         (report.method, report.grain, report.filters.minimum_observations, report.lag.maximum))
        self.assertEqual(DatasetRelationshipResponse.model_fields["lag_mode"].default, monitor.lag_mode)
        for name in ("method", "period", "minimum_observations", "maximum_lag", "lag_direction"):
            self.assertEqual(getattr(DatasetRelationship, name).property.columns[0].default.arg, getattr(monitor, name))

    def test_minimum_history_is_enforced_in_manual_and_automatic_modes(self):
        for mode in ("manual", "automatic"):
            with self.subTest(mode=mode):
                result = relationships.build_dataset_relationship(sources(51), definition(lag_mode=mode))
                self.assertIsNone(result["correlation"])
                self.assertEqual(result["status"], "insufficient_data")
                self.assertTrue(all(candidate["correlation"] is None and not candidate["credible"] for candidate in result["lag_candidates"]))
                self.assertIn("At least 52 matched observations", result["association_summary"])
        enough = relationships.build_dataset_relationship(sources(52), definition())
        self.assertAlmostEqual(enough["correlation"], 1)
        self.assertEqual(enough["status"], "ready")
        self.assertNotIn("Insufficient", enough["association_summary"])
        self.assertNotIn("strongest", enough["association_summary"])
        constant = sources(80)
        constant[0][1]["value"] = 1
        unavailable = relationships.build_dataset_relationship(constant, definition())
        self.assertIsNone(unavailable["correlation"])
        self.assertIn("variation", unavailable["association_summary"])
        self.assertNotIn("not enough matched history", unavailable["association_summary"])

    def test_maximum_lag_is_12_for_every_grouping_and_custom_limits_are_obeyed(self):
        for period, frequency in (("daily", "D"), ("weekly", "W-MON"), ("monthly", "MS"), ("quarterly", "QS")):
            for maximum in (0, 3, 12):
                with self.subTest(period=period, maximum=maximum), patch.object(relationships, "_calculate_lag_result", wraps=relationships._calculate_lag_result) as calculate:
                    result = relationships.build_dataset_relationship(sources(frequency=frequency), definition(period=period, lag_mode="automatic", maximum_lag=maximum))
                    self.assertEqual(calculate.call_count, maximum + 1)
                    self.assertEqual([item["lag_periods"] for item in result["lag_candidates"]], list(range(maximum + 1)))
                    self.assertEqual(result["maximum_lag"], maximum)

    def test_custom_higher_minimum_and_explicit_method_and_period_are_preserved(self):
        result = relationships.build_dataset_relationship(sources(40, frequency="MS"), definition(period="monthly", method="pearson", minimum_observations=41))
        self.assertEqual((result["method"], result["period"], result["minimum_observations"]), ("pearson", "monthly", 41))
        self.assertIsNone(result["correlation"])

    def test_saved_24_observation_setting_remains_valid_and_fixed_timing_is_not_rewritten(self):
        settings = DatasetRelationshipRequest(**definition(minimum_observations=24, period="daily", lag_mode="manual", lag_periods=2))
        result = relationships.build_dataset_relationship(sources(26, "D"), settings.model_dump())
        self.assertEqual((result["minimum_observations"], result["period"], result["lag_mode"], result["lag_periods"]), (24, "daily", "manual", 2))
        self.assertEqual(result["status"], "ready")

    def test_reverse_direction_search_preserves_metric_identity_and_evidence_values(self):
        frames = sources()
        leader = [math.sin(index / 3) for index in range(80)]
        frames[0][1]["value"] = [0] * 3 + leader[:-3]
        frames[1][1]["value"] = leader
        result = relationships.build_dataset_relationship(frames, definition(lag_mode="automatic", lag_direction="b_leads_a", maximum_lag=3))
        self.assertEqual((result["lag_direction"], result["lag_periods"], result["matched_period_count"]), ("b_leads_a", 3, 77))
        self.assertAlmostEqual(result["correlation"], 1)
        self.assertEqual((result["left"]["dataset_id"], result["right"]["dataset_id"]), (1, 2))
        self.assertAlmostEqual(result["evidence"][-1]["left_value"], leader[76])
        self.assertAlmostEqual(result["evidence"][-1]["right_value"], leader[76])
        self.assertTrue(result["association_summary"].index("Source 2") < result["association_summary"].index("Source 1"))


if __name__ == "__main__":
    unittest.main()
