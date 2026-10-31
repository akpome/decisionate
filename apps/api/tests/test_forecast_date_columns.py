import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pandas as pd
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.modules.datasets import router as datasets
from app.modules.forecasting import router as forecasts
from app.modules.forecasting.services import forecast_date_columns, generate_forecast


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
