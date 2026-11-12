import unittest
import warnings
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pandas as pd
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.modules.datasets import router as datasets
from app.modules.forecasting import router as forecasts
from app.modules.forecasting.services import forecast_date_columns, generate_forecast, prepare_forecast_dataframe


def sample():
    return pd.DataFrame({
        "date": pd.date_range("2026-01-01", periods=90).strftime("%Y-%m-%d"),
        "paid_date": pd.date_range("2025-10-01", periods=45).repeat(2).strftime("%Y-%m-%d"),
        "revenue": list(range(1, 91)),
        "region": ["East", "West"] * 45,
    })


class ForecastDateColumnTests(unittest.TestCase):
    def setUp(self):
        analysis = patch("app.modules.forecasting.services.generate_structured_analysis", return_value={})
        self.analysis = analysis.start()
        self.addCleanup(analysis.stop)

    def test_month_names_without_years_are_rejected_before_forecasting(self):
        for dates in (["Jan", "Feb", "Mar"], ["January", "February", "March"],
                      ["Jan 01", "Feb 01", "Mar 01"], ["01/01", "02/01", "03/01"],
                      ["Jan 31", "Feb 29", "Mar 31"]):
            for period in ("all", "1y"):
                with self.subTest(dates=dates, period=period):
                    frame = pd.DataFrame({"month": dates, "revenue": [100, 110, 120]})
                    original = frame.copy(deep=True)
                    result = generate_forecast(frame, date_column="month", period_filter=period,
                                               aggregation="monthly", aggregation_type="sum")
                    self.assertIn("date column needs a year", result["error"])
                    self.assertNotIn("forecast", result)
                    pd.testing.assert_frame_equal(frame, original)
        self.analysis.assert_not_called()

    def test_automatic_date_and_metric_selection_reject_yearless_months(self):
        frame = pd.DataFrame({"month": ["Jan", "Feb", "Mar"], "revenue": [100, 110, 120]})
        result = generate_forecast(frame, aggregation="monthly")
        self.assertIn("date column needs a year", result["error"])
        self.analysis.assert_not_called()

    def test_yearless_rows_are_not_silently_dropped_from_mixed_dates(self):
        for label in ("April", "Feb 29", "01/02", "15:30"):
            with self.subTest(label=label):
                frame = sample()
                frame.loc[89, "date"] = label
                result = generate_forecast(frame, date_column="date", start_date="2026-02-01", aggregation="daily")
                self.assertIn("date column needs a year", result["error"])
        self.analysis.assert_not_called()

    def test_months_with_explicit_years_still_forecast_without_a_selected_metric(self):
        for dates in (["2025-01", "2025-02", "2025-03"],
                      ["Jan 2025", "Feb 2025", "Mar 2025"],
                      pd.date_range("2025-01-01", periods=3, freq="MS")):
            with self.subTest(dates=list(dates)):
                frame = pd.DataFrame({"month": dates, "revenue": [100, 110, 120]})
                result = generate_forecast(frame, date_column="month", aggregation="monthly", aggregation_type="sum")
                self.assertNotIn("error", result)
                self.assertEqual(result["value_column"], "revenue")
                self.assertEqual(result["historical"][-1]["month"], "2025-03-01")
                self.assertEqual(result["forecast_periods"][0], "2025-04-01")

    def test_explicit_default_year_is_not_mistaken_for_a_missing_year(self):
        frame = pd.DataFrame({"month": ["Jan 2000", "Feb 2000", "Mar 2000"], "revenue": [100, 110, 120]})
        result = generate_forecast(frame, date_column="month", aggregation="monthly")
        self.assertNotIn("error", result)
        self.assertEqual(result["forecast_periods"][0], "2000-04-01")

    def test_already_parsed_year_one_dates_cannot_underflow_the_history_window(self):
        dates = pd.Series([pd.Timestamp("0001-01-01"), pd.Timestamp("0001-02-01")], dtype="datetime64[us]")
        for values in (dates, dates.dt.date):
            with self.subTest(dtype=values.dtype):
                frame = pd.DataFrame({"month": values, "revenue": [100, 110]})
                result = generate_forecast(frame, date_column="month", aggregation="monthly")
                self.assertIn("date column needs a year", result["error"])
        self.analysis.assert_not_called()

    def test_date_options_preserve_the_existing_default_and_exclude_non_dates(self):
        frame = sample()
        frame["customer_id"] = range(90)
        self.assertEqual(forecast_date_columns(frame), ["date", "paid_date"])
        self.assertEqual(forecast_date_columns(frame[["revenue", "region"]]), [])

    def test_selected_date_controls_grouping_history_and_projection_origin(self):
        frame = sample()
        original = frame.copy(deep=True)
        default = generate_forecast(frame, metric="revenue", aggregation="daily", aggregation_type="sum")
        selected = generate_forecast(frame, metric="revenue", date_column="paid_date", aggregation="daily", aggregation_type="sum")
        self.assertEqual(default["date_column"], "date")
        self.assertEqual(default["historical"][-1], {"date": "2026-03-31", "revenue": 90})
        self.assertEqual(selected["date_column"], "paid_date")
        self.assertEqual(selected["historical"][-1], {"paid_date": "2025-11-14", "revenue": 179})
        self.assertEqual(selected["forecast_periods"][0], "2025-11-15")
        pd.testing.assert_frame_equal(frame, original)

    def test_selected_date_controls_the_window_and_seasonal_model(self):
        result = generate_forecast(sample(), metric="revenue", date_column="paid_date", start_date="2025-10-10",
                                   period_filter="1m", aggregation="daily", aggregation_type="sum", seasonal_business=True)
        self.assertNotIn("error", result)
        self.assertEqual(result["date_column"], "paid_date")
        self.assertEqual(result["historical"][-1]["paid_date"], "2025-11-09")
        self.assertEqual(result["forecast_periods"][0], "2025-11-10")
        self.assertTrue(result["seasonality"]["requested"])

    def test_invalid_selected_dates_never_fall_back_to_the_default(self):
        for column in ("gone", "revenue", "region", ""):
            with self.subTest(column=column):
                result = generate_forecast(sample(), metric="revenue", date_column=column)
                self.assertIn("selected date column", result["error"])

    def test_an_explicit_date_works_even_when_no_default_name_is_recognized(self):
        frame = sample().rename(columns={"date": "booked", "paid_date": "settled"})
        result = generate_forecast(frame, metric="revenue", date_column="settled", aggregation="daily")
        self.assertEqual(result["date_column"], "settled")


class ForecastCalendarTimezoneTests(unittest.TestCase):
    def prepare(self, frame, **options):
        original = frame.copy(deep=True)
        with warnings.catch_warnings(record=True) as captured:
            warnings.simplefilter("always", UserWarning)
            result = prepare_forecast_dataframe(frame, "date", **options)
        self.assertFalse([str(warning.message) for warning in captured if "drop timezone information" in str(warning.message)])
        pd.testing.assert_frame_equal(frame, original)
        return result

    def test_calendar_grouping_does_not_warn_for_date_only_or_timezone_aware_inputs(self):
        dates = pd.date_range("2026-01-01", periods=4)
        for values in (dates, dates.tz_localize("UTC"), dates.tz_localize("America/Halifax"), dates.strftime("%Y-%m-%d")):
            for grain, label in (("weekly", "2025-12-29"), ("monthly", "2026-01-01"), ("quarterly", "2026-01-01")):
                with self.subTest(dtype=str(values.dtype), grain=grain):
                    result = self.prepare(pd.DataFrame({"date": values, "revenue": [10, 20, 30, 40]}), aggregation=grain)
                    self.assertEqual(result["date"].tolist(), [pd.Timestamp(label)])
                    self.assertEqual(result["revenue"].tolist(), [100])
                    self.assertIsNone(result["date"].dt.tz)

    def test_offset_timestamps_still_use_utc_week_month_and_quarter_boundaries(self):
        for grain, dates, labels in (
            ("weekly", ["2026-02-01T23:30:00-04:00", "2026-02-02T00:30:00+02:00"], ["2026-01-26", "2026-02-02"]),
            ("monthly", ["2026-01-31T23:30:00-04:00", "2026-02-01T00:30:00+02:00"], ["2026-01-01", "2026-02-01"]),
            ("quarterly", ["2026-03-31T23:30:00-04:00", "2026-04-01T00:30:00+02:00"], ["2026-01-01", "2026-04-01"]),
        ):
            with self.subTest(grain=grain):
                result = self.prepare(pd.DataFrame({"date": dates, "revenue": [10, 20]}), aggregation=grain)
                self.assertEqual(result["date"].dt.strftime("%Y-%m-%d").tolist(), labels)
                self.assertEqual(result["revenue"].tolist(), [20, 10])

    def test_date_windows_are_applied_before_removing_the_utc_timezone(self):
        frame = pd.DataFrame({"date": ["2026-01-31T23:30:00-04:00", "2026-02-01T00:30:00+02:00", "2026-03-01T00:00:00+00:00"],
                              "revenue": [10, 20, 1000]})
        result = self.prepare(frame, aggregation="monthly", start_date="2026-02-01T00:00:00Z", period_filter="1m")
        self.assertEqual(result["date"].tolist(), [pd.Timestamp("2026-02-01")])
        self.assertEqual(result["revenue"].tolist(), [10])

    def test_daily_grouping_and_ungrouped_dates_retain_their_utc_timezone(self):
        frame = pd.DataFrame({"date": ["2026-01-31T23:30:00-04:00", "2026-02-01T00:30:00+02:00"], "revenue": [10, 20]})
        daily = self.prepare(frame, aggregation="daily")
        self.assertEqual(daily["date"].tolist(), [pd.Timestamp("2026-01-31", tz="UTC"), pd.Timestamp("2026-02-01", tz="UTC")])
        self.assertEqual(daily["revenue"].tolist(), [20, 10])
        ungrouped = self.prepare(frame)
        self.assertEqual(ungrouped["date"].tolist(), pd.to_datetime(frame["date"], utc=True).tolist())

    def test_historical_summary_rows_and_raw_rows_keep_correct_totals_and_weighted_averages(self):
        frame = pd.DataFrame({"date": pd.date_range("2026-01-01", periods=2, tz="UTC"),
                              "__decisionate_summary__": [True, False], "revenue": [None, 30],
                              "revenue__sum": [100, None], "revenue__count": [2, None],
                              "revenue__min": [40, None], "revenue__max": [60, None]})
        for grain, label in (("weekly", "2025-12-29"), ("monthly", "2026-01-01"), ("quarterly", "2026-01-01")):
            for operation, expected in (("sum", 130), ("avg", 130 / 3), ("count", 3), ("min", 30), ("max", 60)):
                with self.subTest(grain=grain, operation=operation):
                    result = self.prepare(frame, aggregation=grain, aggregation_type=operation)
                    self.assertEqual(result["date"].tolist(), [pd.Timestamp(label)])
                    self.assertAlmostEqual(result["revenue"].iloc[0], expected)


class ForecastDateColumnRouteTests(unittest.TestCase):
    def setUp(self):
        self.frame = sample()
        self.dataset = SimpleNamespace(id=1, file_name="Sales.csv", source_type="csv",
                                       source_config='{"selected_metric_columns":["revenue"]}')
        self.db = MagicMock()
        self.db.query.return_value.filter.return_value.first.return_value = self.dataset
        self.load = MagicMock(return_value=self.frame)
        for name, value in {
            "SessionLocal": MagicMock(return_value=self.db), "get_user_id": lambda _: "owner",
            "get_workspace_id": lambda *_: "workspace", "load_forecast_dataframe": self.load,
            "build_workspace_decision_learning_context": lambda *_args, **_kwargs: None,
        }.items():
            mocked = patch.object(forecasts, name, value)
            mocked.start()
            self.addCleanup(mocked.stop)
        analysis = patch("app.modules.forecasting.services.generate_structured_analysis", return_value={})
        analysis.start()
        self.addCleanup(analysis.stop)
        app = FastAPI()
        app.include_router(forecasts.router, prefix="/forecasting")
        app.include_router(datasets.router, prefix="/datasets")
        self.client = TestClient(app)

    def test_yearless_dates_return_actionable_400_for_get_and_filtered_post(self):
        self.load.return_value = pd.DataFrame({
            "month": ["Jan", "Feb", "Mar"], "revenue": [100, 110, 120], "region": ["East"] * 3,
        })
        url = "/forecasting/1?date_column=month&period_filter=all&aggregation=monthly&aggregation_type=sum&seasonal_business=false"
        for response in (self.client.get(url), self.client.post(url, json={"column": "region", "values": ["East"]})):
            self.assertEqual(response.status_code, 400, response.text)
            self.assertIn("date column needs a year", response.json()["detail"])
            self.assertIn("2025-01", response.json()["detail"])
        self.db.close.assert_called()

        self.load.return_value["month"] = pd.date_range("2025-01-01", periods=3, freq="MS")
        recovered = self.client.get(url)
        self.assertEqual(recovered.status_code, 200, recovered.text)
        self.assertEqual(recovered.json()["forecast"]["value_column"], "revenue")

    def test_get_and_filtered_post_use_the_selected_date_column(self):
        response = self.client.get("/forecasting/1?metric=revenue&date_column=paid_date&aggregation=daily")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["forecast"]["date_column"], "paid_date")
        self.assertEqual(response.json()["historical"][-1]["revenue"], 179)
        selection = {"column": "region", "values": ["East"]}
        response = self.client.post("/forecasting/1?metric=revenue&date_column=paid_date&aggregation=daily&seasonal_business=true", json=selection)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["forecast"]["date_column"], "paid_date")
        self.assertEqual(response.json()["historical"][-1]["revenue"], 89)
        self.assertTrue(response.json()["forecast"]["seasonality"]["requested"])
        self.assertEqual(response.json()["dimension_filter"], selection)

    def test_invalid_dates_are_rejected_and_do_not_return_an_automatic_forecast(self):
        for column, status in (("gone", 400), ("revenue", 400), ("", 422), ("x" * 201, 422)):
            with self.subTest(column=column):
                response = self.client.get("/forecasting/1", params={"metric": "revenue", "date_column": column})
                self.assertEqual(response.status_code, status, response.text)

    def test_authorization_precedes_loading_a_date_selected_forecast(self):
        self.db.query.return_value.filter.return_value.first.return_value = None
        response = self.client.get("/forecasting/1?date_column=paid_date")
        self.assertEqual(response.status_code, 404)
        self.load.assert_not_called()

    def test_metrics_can_include_dates_without_loading_a_second_frame_or_extra_metrics(self):
        owned = MagicMock(return_value=(self.dataset, self.frame))
        with patch.object(datasets, "SessionLocal", return_value=self.db), patch.object(datasets, "get_user_id", return_value="owner"), patch.object(
            datasets, "get_workspace_id", return_value="workspace"
        ), patch.object(datasets, "_load_owned_dataset_dataframe", owned):
            response = self.client.get("/datasets/1/metrics?include_dates=true")
            self.assertEqual(response.status_code, 200, response.text)
            result = response.json()
            self.assertEqual(result["date_columns"], ["date", "paid_date"])
            self.assertEqual(result["default_date_column"], "date")
            self.assertEqual([metric["column"] for metric in result["metrics"]], ["revenue"])
            owned.assert_called_once_with(self.db, 1, "owner", "workspace")
            with patch.object(datasets, "forecast_date_columns") as inspect_dates:
                legacy = self.client.get("/datasets/1/metrics")
            self.assertEqual(legacy.status_code, 200, legacy.text)
            self.assertNotIn("date_columns", legacy.json())
            self.assertEqual(legacy.json()["metrics"], result["metrics"])
            inspect_dates.assert_not_called()
