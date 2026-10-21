import json
from datetime import datetime, timezone
import unittest
from unittest.mock import patch

import numpy as np
import pandas as pd

from app.modules.reports.anomalies import detect_report_metric, historical_start
from app.modules.reports.service import build_report
from app.modules.alerts.router import build_weekly_cross_dataset_report, build_weekly_report_digest
from app.modules.alerts.schemas import WeeklyReportPreferenceResponse
from app.modules.alerts.email_delivery import build_weekly_report_email_html, build_weekly_report_email_text
from tests.test_business_reports import FLAGS, definition, fixture


METRIC = {"id": "1:spend", "dataset_id": 1, "dataset_label": "Advertising", "metric_key": "spend", "label": "Spend", "unit": "currency", "currency": "CAD"}
WINDOW = {"start": "2026-08-03", "end": "2026-08-09"}


def series(seasonal=False, start="2022-01-01", end="2026-08-09"):
    dates = pd.date_range(start, end)
    phase = (np.asarray(dates.dayofyear) - 1) / np.where(dates.is_leap_year, 366, 365)
    values = 1000 + np.arange(len(dates)) * .2 + np.random.default_rng(12).normal(0, 3, len(dates))
    if seasonal:
        values += 300 * np.sin(2 * np.pi * phase) + 100 * np.cos(2 * np.pi * np.asarray(dates.dayofweek) / 7)
    return pd.DataFrame({"period": dates, "value": values})


class ReportAnomalyTests(unittest.TestCase):
    def detect(self, points, seasonal=False, window=None, grain="daily", anchor=None):
        return detect_report_metric(points, METRIC, window or WINDOW, grain, seasonal, anchor)

    def test_seasonal_peaks_and_trend_are_not_anomalies(self):
        result = self.detect(series(True), True)
        self.assertEqual(result["status"], "ready")
        self.assertEqual(result["evaluated_observations"], 7)
        self.assertEqual(result["anomaly_count"], 0)
        self.assertEqual(result["seasonalities"], ["annual", "weekly"])
        self.assertFalse(any("Annual seasonality could not" in value for value in result["warnings"]))

    def test_seasonal_spikes_and_drops_are_detected(self):
        points = series(True)
        points.loc[points.period == "2026-08-04", "value"] += 400
        points.loc[points.period == "2026-08-06", "value"] -= 400
        result = self.detect(points, True)
        self.assertEqual([(item["period"], item["direction"]) for item in result["anomalies"]], [("2026-08-04", "high"), ("2026-08-06", "low")])
        for point in result["anomalies"]:
            self.assertGreater(abs(point["score"]), 3.5)
            self.assertAlmostEqual(abs(point["deviation"]), 400, delta=15)

    def test_nonseasonal_business_uses_trend_without_seasonal_terms(self):
        result = self.detect(series(), False)
        self.assertEqual(result["status"], "ready")
        self.assertEqual(result["anomaly_count"], 0)
        self.assertEqual(result["seasonalities"], [])
        self.assertFalse(result["warnings"])

    def test_seasonal_checkbox_does_not_force_seasonality_on_flat_business(self):
        points = series()
        points["value"] = 50.
        result = self.detect(points, True)
        self.assertEqual(result["anomaly_count"], 0)
        self.assertEqual(result["seasonalities"], [])

    def test_zero_noise_and_zero_expected_do_not_divide_by_zero(self):
        points = series()
        points["value"] = 0.
        points.loc[points.period == "2026-08-04", "value"] = 10.
        result = self.detect(points)
        self.assertEqual(result["anomaly_count"], 1)
        self.assertIsNone(result["anomalies"][0]["score"])
        self.assertIsNone(result["anomalies"][0]["deviation_percent"])
        json.dumps(result, allow_nan=False)

    def test_current_week_cannot_influence_its_own_baseline(self):
        points = series(True)
        original = self.detect(points, True)
        points.loc[points.period >= WINDOW["start"], "value"] += 1000
        modified = self.detect(points, True)
        self.assertEqual(original["baselines"], modified["baselines"])
        self.assertEqual(modified["anomaly_count"], 7)
        self.assertLess(modified["baselines"][0]["history_end"], WINDOW["start"])

    def test_future_and_expired_data_do_not_change_the_baseline(self):
        points = series()
        original = self.detect(points)
        points.loc[points.period < historical_start(WINDOW["start"]), "value"] = 1e12
        future = pd.DataFrame({"period": pd.date_range("2026-08-10", periods=30), "value": 1e12})
        changed = self.detect(pd.concat([points, future], ignore_index=True))
        self.assertEqual(original, changed)
        self.assertGreaterEqual(original["baselines"][0]["history_start"], "2023-08-03")

    def test_missing_values_are_not_zero_or_anomalies(self):
        points = series()
        points.loc[points.period == "2026-08-05", "value"] = np.nan
        result = self.detect(points)
        self.assertEqual(result["observations"], 6)
        self.assertEqual(result["missing_observations"], 1)
        self.assertEqual(result["evaluated_observations"], 6)
        self.assertEqual(result["anomaly_count"], 0)

    def test_weekday_only_business_has_a_usable_seasonal_baseline_without_inventing_weekend_zeros(self):
        points = series(True)
        points.loc[points.period.dt.dayofweek >= 5, "value"] = np.nan
        result = self.detect(points, True)
        self.assertEqual(result["status"], "ready")
        self.assertEqual(result["observations"], 5)
        self.assertEqual(result["missing_observations"], 2)
        self.assertEqual(result["evaluated_observations"], 5)
        self.assertEqual(result["anomaly_count"], 0)
        self.assertIn("annual", result["seasonalities"])
        self.assertIn("weekly", result["seasonalities"])

    def test_insufficient_history_is_not_reported_as_no_anomalies(self):
        result = self.detect(series(start="2026-07-25"), True)
        self.assertEqual(result["status"], "insufficient_history")
        self.assertEqual(result["evaluated_observations"], 0)
        self.assertTrue(result["warnings"])

    def test_one_year_does_not_claim_validated_annual_seasonality(self):
        result = self.detect(series(True, start="2025-08-01"), True)
        self.assertNotIn("annual", result["seasonalities"])
        self.assertTrue(any("Annual seasonality could not" in value for value in result["warnings"]))

    def test_stale_history_is_not_scored_as_a_reliable_current_baseline(self):
        points = series()
        points.loc[points.period.between("2026-07-01", "2026-08-02"), "value"] = np.nan
        result = self.detect(points)
        self.assertEqual(result["status"], "insufficient_history")
        self.assertFalse(result["baselines"])

    def test_window_recomputes_and_handles_leap_day(self):
        self.assertEqual(historical_start("2024-02-29"), "2021-02-28")
        points = series(end="2027-08-09")
        result = self.detect(points, window={"start": "2027-08-03", "end": "2027-08-09"})
        self.assertEqual(result["history_window"]["start"], "2024-08-03")
        self.assertTrue(all(item["history_start"] >= "2024-08-03" for item in result["baselines"]))

    def test_monthly_series_has_only_monthly_observations(self):
        dates = pd.date_range("2023-01-01", "2026-08-01", freq="MS")
        values = 1000 + np.arange(len(dates)) * 2 + 100 * np.sin(2 * np.pi * (np.asarray(dates.month) - 1) / 12)
        result = self.detect(pd.DataFrame({"period": dates, "value": values}), True, {"start": "2026-08-01", "end": "2026-08-31"}, "monthly")
        self.assertEqual(result["observations"], 1)
        self.assertLessEqual(result["baselines"][0]["observations"], 36)

    def test_partial_month_is_not_compared_with_complete_months(self):
        dates = pd.date_range("2023-01-01", "2026-08-01", freq="MS")
        points = pd.DataFrame({"period": dates, "value": 1000.})
        points.loc[points.period == "2026-08-01", "value"] = 20.
        result = self.detect(points, True, {"start": "2026-07-01", "end": "2026-08-09"}, "monthly")
        self.assertEqual(result["observations"], 1)
        self.assertEqual(result["anomaly_count"], 0)
        self.assertTrue(any("Partial calendar" in value for value in result["warnings"]))

    def test_quarterly_seasonal_pattern_and_genuine_spike(self):
        dates = pd.date_range("2022-01-01", "2026-07-01", freq="QS")
        values = 1000 + np.arange(len(dates)) * 2 + np.asarray(dates.quarter) * 100
        points = pd.DataFrame({"period": dates, "value": values.astype(float)})
        window = {"start": "2026-07-01", "end": "2026-09-30"}
        result = self.detect(points, True, window, "quarterly")
        self.assertEqual(result["status"], "ready")
        self.assertEqual(result["seasonalities"], ["annual"])
        self.assertEqual(result["anomaly_count"], 0)
        points.loc[points.period == "2026-07-01", "value"] += 500
        self.assertEqual(self.detect(points, True, window, "quarterly")["anomaly_count"], 1)

    def test_long_manual_report_refits_without_future_leakage_and_keeps_all_periods(self):
        points = series(True)
        window = {"start": "2025-08-10", "end": "2026-08-09"}
        result = self.detect(points, True, window)
        self.assertEqual(result["evaluated_observations"], 365)
        self.assertEqual(result["anomaly_count"], 0)
        self.assertTrue(all(item["history_end"] < item["start"] for item in result["baselines"]))
        points.loc[points.period > "2025-09-06", "value"] *= 5
        changed = self.detect(points, True, window)
        self.assertEqual(result["baselines"][0], changed["baselines"][0])

    def test_failed_model_fitting_returns_a_limitation_not_a_false_success(self):
        with patch("app.modules.reports.anomalies.RLM", side_effect=ValueError("Cannot fit")):
            result = self.detect(series())
        self.assertEqual(result["status"], "insufficient_history")
        self.assertEqual(result["evaluated_observations"], 0)

    @patch.dict("os.environ", FLAGS)
    def test_report_only_evaluates_selected_metrics_and_does_not_change_selections(self):
        frames = fixture()
        for _, frame in frames.values():
            frame["private_metric"] = 1e9
        result = build_report(frames, definition(seasonal_business=True))
        self.assertEqual([item["metric_id"] for item in result["anomaly_analysis"]["metrics"]], ["1:spend", "2:net_sales"])
        self.assertTrue(result["anomaly_analysis"]["seasonal_business"])
        self.assertEqual(result["definition"]["metrics"], definition()["metrics"])

    @patch.dict("os.environ", FLAGS)
    def test_unavailable_selected_dataset_has_an_explicit_anomaly_result(self):
        report = build_report({1: fixture()[1]}, definition(), unavailable=["Sales unavailable"])
        self.assertEqual(len(report["anomaly_analysis"]["metrics"]), 2)
        self.assertEqual(report["anomaly_analysis"]["metrics"][1]["status"], "unavailable")

    @patch.dict("os.environ", FLAGS)
    def test_weekly_template_keeps_an_explicit_result_for_an_unavailable_selected_metric(self):
        preference = WeeklyReportPreferenceResponse(enabled=False, cadence="weekly", delivery_day="monday", recipient_emails=[], metric_focus=[], include_recommendations=True)
        with patch("app.modules.alerts.router.complete_week", return_value=definition()["date_range"]):
            report = build_weekly_cross_dataset_report({1: fixture()[1]}, preference, definition())
        results = {item["metric_id"]: item for item in report["anomaly_analysis"]["metrics"]}
        self.assertEqual(set(results), {"1:spend", "2:net_sales"})
        self.assertEqual(results["2:net_sales"]["status"], "unavailable")

    @patch.dict("os.environ", FLAGS)
    def test_weekly_anomalies_use_current_three_year_history_not_template_dates_and_reach_both_email_parts(self):
        class Clock(datetime):
            @classmethod
            def now(cls, tz=None):
                return datetime(2026, 8, 12, tzinfo=timezone.utc)

        frames = fixture()
        points = series(True)
        points.loc[points.period == "2026-08-04", "value"] += 400
        for identity, (dataset, _) in list(frames.items()):
            column = "spend" if identity == 1 else "net_sales"
            frames[identity] = dataset, points.rename(columns={"period": "date", "value": column}).assign(currency="CAD")
        frames[1][0].file_name = "Advertising <script>unsafe</script>"
        preference = WeeklyReportPreferenceResponse(enabled=False, cadence="weekly", delivery_day="monday", recipient_emails=[], metric_focus=[], include_recommendations=True)
        template = definition(seasonal_business=True, date_range={"start": "2000-01-01", "end": "2000-01-31"})
        with patch("app.modules.alerts.router.complete_week", return_value=WINDOW), \
             patch("app.modules.alerts.router.datetime", Clock), \
             patch("app.modules.alerts.router.load_dataframe_from_dataset", side_effect=lambda dataset: frames[dataset.id][1].copy()):
            digest = build_weekly_report_digest(preference, [item[0] for item in frames.values()], report_definition=template, include_ai_analysis=False)
        report = digest.cross_dataset_report
        self.assertEqual(report["window"], WINDOW)
        self.assertEqual(report["history_window"]["start"], "2023-08-12")
        analysis = report["anomaly_analysis"]
        self.assertTrue(analysis["seasonal_business"])
        self.assertEqual(analysis["anchor_date"], "2026-08-12")
        self.assertEqual(analysis["anomaly_count"], 2)
        self.assertTrue(all(item["history_start"] >= "2023-08-12" and item["history_end"] < WINDOW["start"] for metric in analysis["metrics"] for item in metric["baselines"]))
        text, markup = build_weekly_report_email_text(digest), build_weekly_report_email_html(digest)
        for value in (text, markup):
            self.assertIn("Unusual changes (anomaly detection)", value)
            self.assertIn("2026-08-04", value)
            self.assertIn("expected range:", value)
            self.assertIn("residual mad", value)
        self.assertIn("&lt;script&gt;unsafe", markup)
        self.assertNotIn("<script>", markup)


if __name__ == "__main__":
    unittest.main()
