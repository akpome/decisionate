import unittest

import pandas as pd

from app.modules.datasets.services.anomalies import (
    detect_dataset_anomalies,
)


class DatasetAnomalyTests(unittest.TestCase):
    def test_detects_high_outlier_from_real_time_series(self):
        dataframe = pd.DataFrame({
            "date": pd.date_range(
                "2025-01-01",
                periods=10,
                freq="D",
            ),
            "revenue": [
                10,
                11,
                9,
                10,
                11,
                10,
                10,
                10,
                10,
                100,
            ],
        })

        result = detect_dataset_anomalies(
            dataframe,
            metric="revenue",
            date_column="date",
            aggregation="daily",
            sensitivity="medium",
        )

        self.assertEqual(result["status"], "ready")
        self.assertEqual(result["total_anomaly_count"], 1)
        self.assertEqual(
            result["metrics"][0]["anomalies"][0]["direction"],
            "high",
        )
        self.assertEqual(
            result["metrics"][0]["anomalies"][0]["value"],
            100.0,
        )

    def test_summary_statistics_are_used_for_historical_rows(self):
        dataframe = pd.DataFrame({
            "period": pd.date_range(
                "2020-01-01",
                periods=6,
                freq="MS",
            ),
            "__decisionate_summary__": [
                True,
                True,
                True,
                True,
                True,
                True,
            ],
            "revenue__sum": [
                100,
                100,
                100,
                100,
                110,
                1000,
            ],
            "revenue__count": [1, 1, 1, 1, 1, 1],
            "revenue__mean": [
                100,
                100,
                100,
                100,
                110,
                1000,
            ],
            "revenue__min": [
                100,
                100,
                100,
                100,
                110,
                1000,
            ],
            "revenue__max": [
                100,
                100,
                100,
                100,
                110,
                1000,
            ],
        })

        result = detect_dataset_anomalies(
            dataframe,
            metric="revenue",
            date_column="period",
            aggregation="monthly",
            aggregation_type="sum",
        )

        self.assertEqual(result["status"], "ready")
        self.assertEqual(result["available_metrics"], ["revenue"])
        self.assertEqual(result["total_anomaly_count"], 1)
        self.assertTrue(result["data_notes"])

    def test_connector_count_fields_are_not_treated_as_summary_metrics(self):
        dataframe = pd.DataFrame({
            "txn_date": pd.date_range(
                "2025-01-01",
                periods=10,
                freq="D",
            ),
            "Line__count": [
                1,
                1,
                2,
                1,
                1,
                1,
                2,
                1,
                1,
                8,
            ],
        })

        result = detect_dataset_anomalies(
            dataframe,
            aggregation="daily",
            sensitivity="medium",
        )

        self.assertEqual(
            result["available_metrics"],
            ["Line__count"],
        )
        self.assertEqual(
            result["metrics"][0]["metric"],
            "Line__count",
        )

    def test_does_not_report_anomaly_with_too_few_periods(self):
        dataframe = pd.DataFrame({
            "date": pd.date_range(
                "2025-01-01",
                periods=4,
                freq="D",
            ),
            "revenue": [10, 10, 10, 100],
        })

        result = detect_dataset_anomalies(
            dataframe,
            metric="revenue",
            date_column="date",
            aggregation="daily",
        )

        self.assertEqual(
            result["status"],
            "insufficient_data",
        )
        self.assertEqual(
            result["total_anomaly_count"],
            0,
        )

    def test_requires_a_date_column(self):
        dataframe = pd.DataFrame({
            "revenue": [10, 11, 12, 13, 14],
        })

        with self.assertRaisesRegex(
            ValueError,
            "date or time column",
        ):
            detect_dataset_anomalies(dataframe)


if __name__ == "__main__":
    unittest.main()
