import unittest
from types import SimpleNamespace

import pandas as pd

from app.modules.datasets.services.relationships import build_dataset_relationship


def frozen_relationship(left, right, *, method="pearson", lag=0):
    dates = pd.date_range("2026-01-01", periods=len(left), freq="D")
    frames = [
        (SimpleNamespace(id=1, file_name="Ads"), pd.DataFrame({"date": dates, "spend": left})),
        (SimpleNamespace(id=2, file_name="Sales"), pd.DataFrame({"date": dates, "revenue": right})),
    ]
    definition = {
        "left": {"dataset_id": 1, "date_column": "date", "metric_column": "spend"},
        "right": {"dataset_id": 2, "date_column": "date", "metric_column": "revenue"},
        "period": "daily", "aggregation": "sum", "method": method,
        "lag_mode": "manual", "lag_periods": lag,
        # Freeze the historical math independently of today's public minimum.
        "minimum_observations": 2,
    }
    return build_dataset_relationship(frames, definition), frames, definition


class CorrelationCharacterizationTests(unittest.TestCase):
    def test_frozen_pearson_and_negative(self):
        for right, coefficient in (([2, 4, 6, 8], 1), ([8, 6, 4, 2], -1)):
            result, *_ = frozen_relationship([1, 2, 3, 4], right)
            self.assertAlmostEqual(result["correlation"], coefficient, places=12)
            self.assertEqual(result["matched_period_count"], 4)
            self.assertEqual(result["lag_periods"], 0)

    def test_frozen_spearman_ties(self):
        result, *_ = frozen_relationship([1, 2, 2, 4], [1, 2, 3, 4], method="spearman")
        self.assertAlmostEqual(result["correlation"], 0.9486832980505138, places=12)

    def test_positive_lag_means_left_leads_right(self):
        result, *_ = frozen_relationship([2, 9, 1, 8, 4, 7, 3, 6], [99, 2, 9, 1, 8, 4, 7, 3], lag=1)
        self.assertAlmostEqual(result["correlation"], 1, places=12)
        self.assertEqual(result["matched_period_count"], 7)
        self.assertEqual(result["evidence"][0]["left_value"], 2)
        self.assertEqual(result["evidence"][0]["right_value"], 2)

    def test_constant_and_insufficient_are_null_not_zero(self):
        for left, right in (([1, 1, 1], [1, 2, 3]), ([1], [2])):
            result, *_ = frozen_relationship(left, right)
            self.assertIsNone(result["correlation"])
            self.assertEqual(result["status"], "insufficient_data")

    def test_legacy_sum_of_a_missing_observation_is_zero(self):
        result, *_ = frozen_relationship([1, None, 3, 4], [2, 0, 6, 8])
        self.assertEqual(result["matched_period_count"], 4)
        self.assertEqual(result["evidence"][1]["left_value"], 0)
        self.assertAlmostEqual(result["correlation"], 1)

    def test_legacy_validation_error_is_preserved(self):
        result, frames, definition = frozen_relationship([1, 2], [2, 4])
        definition["lag_periods"] = 13
        with self.assertRaisesRegex(ValueError, "between 0 and 12"):
            build_dataset_relationship(frames, definition)
