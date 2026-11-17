import unittest
from unittest.mock import patch

import pandas as pd

from app.modules.datasets.services.anomalies import detect_dataset_anomalies


class DashboardAnomalyEndDateTests(unittest.TestCase):
    def test_calendar_window_matches_chart_including_last_day_and_excluding_future(self):
        frame = pd.DataFrame({"date": pd.date_range("2026-09-01", "2026-12-01", freq="D"), "revenue": range(92)})
        with patch("app.modules.datasets.services.anomalies._metric_result", return_value={"status": "ready", "anomaly_count": 0}) as scan:
            result = detect_dataset_anomalies(frame, date_column="date", end_date="2026-11-16", period_filter="1m", aggregation="daily")
        selected = scan.call_args.args[0]
        self.assertEqual(str(selected.date.min().date()), "2026-10-17")
        self.assertEqual(str(selected.date.max().date()), "2026-11-16")
        self.assertEqual(len(selected), 31)
        self.assertEqual(result["end_date"], "2026-11-16")

    def test_month_end_is_clamped_and_invalid_end_dates_are_rejected(self):
        frame = pd.DataFrame({"date": pd.date_range("2024-01-01", "2024-03-31"), "revenue": range(91)})
        with patch("app.modules.datasets.services.anomalies._metric_result", return_value={"status": "ready", "anomaly_count": 0}) as scan:
            detect_dataset_anomalies(frame, date_column="date", end_date="2024-03-31", period_filter="1m", aggregation="daily")
        self.assertEqual(str(scan.call_args.args[0].date.min().date()), "2024-03-01")
        with self.assertRaisesRegex(ValueError, "End date"):
            detect_dataset_anomalies(frame, date_column="date", end_date="not-a-date")
