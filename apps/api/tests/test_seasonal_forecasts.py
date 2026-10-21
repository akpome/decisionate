import json
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
import numpy as np
import pandas as pd

from app.modules.forecasting import router
from app.modules.forecasting.services import generate_forecast, build_model_forecast
from app.modules.datasets.services.seasonal_baseline import _fit_predict
from app.modules.decisions.schemas import LOW_DECISION_CONFIDENCE


def sample(grain="daily", start="2022-01-01", end="2026-10-18", seasonal=True):
    dates = pd.date_range(start, end, freq={"daily": "D", "weekly": "W-MON", "monthly": "MS", "quarterly": "QS"}[grain])
    phase = (np.asarray(dates.dayofyear) - 1) / np.where(dates.is_leap_year, 366, 365)
    if grain in {"monthly", "quarterly"}:
        phase = (np.asarray(dates.month) - 1) / 12
    values = 1000. + np.arange(len(dates)) * .2
    if seasonal:
        values += 300 * np.sin(2 * np.pi * phase)
        if grain == "daily":
            values += 100 * np.cos(2 * np.pi * np.asarray(dates.dayofweek) / 7)
    return pd.DataFrame({"date": dates, "revenue": values})


class SeasonalForecastTests(unittest.TestCase):
    def setUp(self):
        self.ai = patch("app.modules.forecasting.services.generate_structured_analysis", return_value={
            "source": "rules", "confidence": LOW_DECISION_CONFIDENCE, "recommendations": [],
        }).start()
        self.addCleanup(patch.stopall)

    def forecast(self, frame=None, grain="daily", seasonal=True, **kwargs):
        return generate_forecast(sample(grain) if frame is None else frame, metric="revenue", aggregation=grain, seasonal_business=seasonal, **kwargs)

    def test_daily_forecast_uses_validated_weekly_and_annual_cycles(self):
        result = self.forecast()
        self.assertEqual(result["seasonality"]["status"], "applied")
        self.assertEqual(result["seasonality"]["seasonalities"], ["weekly", "annual"])
        truth = sample(end="2026-10-21").revenue.tail(3).to_numpy()
        np.testing.assert_allclose(result["forecast"], truth, atol=2)
        self.assertEqual(result["forecast_periods"], ["2026-10-19", "2026-10-20", "2026-10-21"])
        self.assertEqual(result["recommendation"]["title"], "Plan for seasonal variation")
        self.assertEqual(result["seasonality"]["validation_method"], "rolling_origin")
        self.assertEqual(result["model_quality"]["validation_periods"], 14)
        self.assertLess(result["model_quality"]["mae"], 1)
        json.dumps(result, allow_nan=False)

    def test_monthly_and_weekly_and_quarterly_forecasts_keep_calendar_seasons(self):
        for grain, end, dates in [
            ("monthly", "2026-09-01", ["2026-10-01", "2026-11-01", "2026-12-01"]),
            ("weekly", "2026-10-12", ["2026-10-19", "2026-10-26", "2026-11-02"]),
            ("quarterly", "2026-07-01", ["2026-10-01", "2027-01-01", "2027-04-01"]),
        ]:
            with self.subTest(grain=grain):
                result = self.forecast(sample(grain, end=end), grain)
                self.assertIn("annual", result["seasonality"]["seasonalities"])
                self.assertEqual(result["forecast_periods"], dates)
                truth = sample(grain, end=dates[-1]).revenue.tail(3).to_numpy()
                np.testing.assert_allclose(result["forecast"], truth, atol=2)
                if grain == "quarterly":
                    self.assertEqual(result["model_quality"]["reliability"], "limited")
                    self.assertTrue(any("shorter than" in warning for warning in result["seasonality"]["warnings"]))

    def test_default_and_explicit_opt_out_never_add_seasonal_terms(self):
        result = self.forecast(seasonal=False)
        self.assertEqual(result["seasonality"]["status"], "not_requested")
        self.assertEqual(result["seasonality"]["seasonalities"], [])
        default = generate_forecast(sample(), metric="revenue", aggregation="daily")
        self.assertEqual(default, result)

    def test_checkbox_does_not_force_seasonality_on_flat_or_trend_business(self):
        for constant in (False, True):
            frame = sample(seasonal=False)
            if constant:
                frame["revenue"] = 0.
            result = self.forecast(frame)
            self.assertEqual(result["seasonality"]["status"], "not_supported")
            self.assertEqual(result["seasonality"]["seasonalities"], [])
            json.dumps(result, allow_nan=False)

    def test_short_history_has_explicit_nonseasonal_fallback(self):
        result = self.forecast(sample("monthly", start="2026-01-01"), "monthly")
        self.assertEqual(result["seasonality"]["status"], "insufficient_history")
        self.assertEqual(result["model_quality"]["reliability"], "limited")
        self.assertTrue(any("Annual patterns need" in warning for warning in result["seasonality"]["warnings"]))

    def test_weekly_pattern_can_be_used_without_claiming_annual_support(self):
        frame = sample(start="2026-06-01", seasonal=False)
        frame["revenue"] += np.asarray(frame.date.dt.dayofweek) * 100
        result = self.forecast(frame)
        self.assertEqual(result["seasonality"]["seasonalities"], ["weekly"])
        self.assertTrue(any("Annual seasonality requires" in warning for warning in result["seasonality"]["warnings"]))

    def test_expired_history_cannot_influence_forecast_or_validation(self):
        frame = sample()
        original = self.forecast(frame)
        frame.loc[frame.date < "2023-10-18", "revenue"] = 1e15
        changed = self.forecast(frame)
        self.assertEqual(original, changed)
        self.assertGreaterEqual(original["seasonality"]["history_start"], "2023-10-18")

    def test_manual_range_prevents_future_observations_from_affecting_forecast(self):
        frame = sample()
        kwargs = {"start_date": "2025-01-01", "period_filter": "1y"}
        original = self.forecast(frame, **kwargs)
        frame.loc[frame.date >= "2026-01-01", "revenue"] = 1e12
        self.assertEqual(original, self.forecast(frame, **kwargs))
        self.assertEqual(original["seasonality"]["history_end"], "2025-12-31")

    def test_each_validation_fold_is_strictly_after_its_training_data(self):
        calls = []
        def predict(train, dates, *args):
            self.assertLess(train.index.max(), dates.min())
            calls.append((train.index.max(), dates.min()))
            return _fit_predict(train, dates, *args)
        with patch("app.modules.datasets.services.seasonal_baseline._fit_predict", side_effect=predict):
            self.forecast()
        self.assertGreater(len(calls), 4)

    def test_missing_measurements_are_not_zero_filled(self):
        frame = sample()
        frame.loc[frame.date == "2026-10-01", "revenue"] = np.nan
        result = self.forecast(frame)
        self.assertTrue(any("not filled with zeros" in warning for warning in result["seasonality"]["warnings"]))
        self.assertNotIn(0., [row["revenue"] for row in result["historical"]])
        self.assertEqual(result["seasonality"]["status"], "applied")

    def test_irregular_sparse_history_is_not_presented_as_reliable_seasonal_forecast(self):
        result = self.forecast(sample().iloc[::10])
        self.assertEqual(result["seasonality"]["status"], "insufficient_history")
        self.assertEqual(result["model_quality"]["reliability"], "limited")

    def test_weekday_business_forecast_does_not_invent_weekend_zeros(self):
        frame = sample(end="2026-10-16")
        frame = frame.loc[frame.date.dt.dayofweek < 5]
        result = self.forecast(frame)
        self.assertEqual(result["forecast_periods"], ["2026-10-19", "2026-10-20", "2026-10-21"])
        self.assertTrue(any("observed weekdays" in warning for warning in result["seasonality"]["warnings"]))
        self.assertIn("weekly", result["seasonality"]["seasonalities"])

    def test_model_failure_has_an_honest_fallback(self):
        with patch("app.modules.datasets.services.seasonal_baseline.RLM", side_effect=ValueError("Cannot fit")):
            result = self.forecast()
        self.assertEqual(result["seasonality"]["status"], "insufficient_history")
        self.assertEqual(result["model_quality"]["reliability"], "limited")
        json.dumps(result, allow_nan=False)

    def test_linear_fallback_uses_calendar_distance_not_row_distance(self):
        dates = pd.DatetimeIndex(["2026-01-01", "2026-01-02", "2026-01-10"])
        future = pd.date_range("2026-01-11", periods=3)
        values = build_model_forecast([10., 20., 100.], "linear_regression", 3, dates, future)
        self.assertEqual(values, [110., 120., 130.])

    def test_selected_metric_only_and_duplicate_transaction_dates_are_grouped(self):
        frame = sample()
        frame["irrelevant"] = 1e12
        result = self.forecast(pd.concat([frame, frame], ignore_index=True))
        self.assertEqual(result["value_column"], "revenue")
        self.assertEqual(result["seasonality"]["status"], "applied")
        self.assertEqual(result["seasonality"]["observations"], 1097)

    def test_partial_month_totals_are_not_compared_with_full_months(self):
        result = self.forecast(sample(start="2022-01-05", end="2026-10-18"), "monthly")
        self.assertEqual(result["seasonality"]["history_end"], "2026-09-01")
        self.assertEqual(result["forecast_periods"], ["2026-10-01", "2026-11-01", "2026-12-01"])
        self.assertTrue(any("Edge periods not fully spanned" in warning for warning in result["seasonality"]["warnings"]))

    def test_incomplete_week_is_excluded_but_completed_week_is_retained(self):
        partial = self.forecast(sample(end="2026-10-15"), "weekly")
        complete = self.forecast(sample(end="2026-10-18"), "weekly")
        self.assertEqual(partial["seasonality"]["history_end"], "2026-10-05")
        self.assertEqual(complete["seasonality"]["history_end"], "2026-10-12")

    def test_leap_day_cap_and_tiny_metric_precision(self):
        frame = sample(end="2024-02-29")
        frame["revenue"] *= 1e-7
        result = self.forecast(frame)
        self.assertGreaterEqual(result["seasonality"]["history_start"], "2021-02-28")
        self.assertTrue(all(value > 0 for value in result["forecast"]))
        self.assertEqual(result["forecast_periods"][0], "2024-03-01")


class SeasonalForecastRouteTests(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(router.router, prefix="/forecasting")
        self.client = TestClient(app)
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = SimpleNamespace(id=1)
        for name, value in {
            "SessionLocal": MagicMock(return_value=db), "get_user_id": lambda _: "owner",
            "get_workspace_id": lambda *_: "owner", "load_forecast_dataframe": lambda _: sample(),
            "build_workspace_decision_learning_context": lambda *_args, **_kwargs: None,
            "build_forecast_dataset_metadata": lambda _: {"dataset_id": 1, "file_name": "sales.csv"},
        }.items():
            patch.object(router, name, value).start()
        patch("app.modules.forecasting.services.generate_structured_analysis", return_value={"source": "rules", "confidence": LOW_DECISION_CONFIDENCE}).start()
        self.addCleanup(patch.stopall)

    def test_route_passes_setting_and_defaults_to_nonseasonal(self):
        for flag, expected in [(None, "not_requested"), ("false", "not_requested"), ("true", "applied")]:
            params = {"metric": "revenue", "aggregation": "daily"}
            if flag is not None:
                params["seasonal_business"] = flag
            response = self.client.get("/forecasting/1", params=params)
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()["forecast"]["seasonality"]["status"], expected)

    def test_invalid_boolean_is_rejected(self):
        self.assertEqual(self.client.get("/forecasting/1?seasonal_business=maybe").status_code, 422)
