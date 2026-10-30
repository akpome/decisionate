import json
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pandas as pd
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.modules.datasets import router as datasets
from app.modules.datasets.services.dimension_filters import (
    DimensionFilter, DimensionFilterError, apply_dimension_filter, dimension_columns, dimension_options,
)
from app.modules.datasets.services.metric_selection import filter_dataframe_to_selected_metrics
from app.modules.forecasting import router as forecasting
from app.modules.forecasting.services import generate_forecast
from app.modules.reports.schemas import ReportDefinition
from app.modules.reports.service import build_report, report_analysis_facts
from app.modules.alerts.router import build_weekly_cross_dataset_report
from app.modules.alerts.schemas import WeeklyReportPreferenceResponse
from tests.test_business_reports import FLAGS, definition, fixture
from tests import test_business_reports as report_fixtures


class DimensionFilterTests(unittest.TestCase):
    def setUp(self):
        self.dataset = SimpleNamespace(id=1, file_name="Sales.csv", source_type="csv", source_config=json.dumps({"selected_metric_columns": ["revenue"]}))
        self.frame = pd.DataFrame({"date": pd.date_range("2026-01-01", periods=8), "revenue": range(1, 9),
                                   "channel": ["East", "West", None, "null", "", "East", "West", None],
                                   "customer_id": [1, 2, 1, 2, 1, 2, 1, 2], "active": [True, False] * 4})

    def test_columns_include_dimensions_and_identifiers_not_metrics_or_dates(self):
        columns = {item["column"] for item in dimension_columns(self.dataset, self.frame)}
        self.assertTrue({"channel", "customer_id", "active"} <= columns)
        self.assertNotIn("revenue", columns)
        self.assertNotIn("date", columns)

    def test_filter_uses_or_values_and_keeps_missing_empty_and_literal_null_distinct(self):
        for values, expected in [(["East", "West"], [1, 2, 6, 7]), ([None], [3, 8]), (["null"], [4]), ([""], [5])]:
            with self.subTest(values=values):
                result = apply_dimension_filter(self.dataset, self.frame, {"column": "channel", "values": values})
                self.assertEqual(result.revenue.tolist(), expected)

    def test_numeric_identifier_and_boolean_values_match_the_catalog_tokens(self):
        for column, value in [("customer_id", "1"), ("active", "true")]:
            options = dimension_options(self.dataset, self.frame, column)
            self.assertIn(value, options["values"])
            result = apply_dimension_filter(self.dataset, self.frame, {"column": column, "values": [value]})
            self.assertEqual(result.revenue.tolist(), [1, 3, 5, 7])

    def test_source_and_analytical_attributes_are_preserved(self):
        before = self.frame.copy(deep=True)
        self.frame.attrs["test_policy"] = {"selected": ["revenue"]}
        result = apply_dimension_filter(self.dataset, self.frame, {"column": "channel", "values": ["East"]})
        pd.testing.assert_frame_equal(self.frame, before)
        self.assertEqual(result.attrs["test_policy"], {"selected": ["revenue"]})
        self.assertIs(apply_dimension_filter(self.dataset, self.frame, None), self.frame)
        self.assertTrue(apply_dimension_filter(self.dataset, self.frame, {"column": "channel", "values": ["Gone"]}).empty)

    def test_invalid_columns_and_empty_or_excessive_selections_are_rejected(self):
        for column in ("revenue", "date", "not_available"):
            with self.subTest(column=column), self.assertRaises(DimensionFilterError):
                apply_dimension_filter(self.dataset, self.frame, {"column": column, "values": ["East"]})
        for values in ([], list(map(str, range(51))), ["x" * 1001], [True]):
            with self.subTest(values=values), self.assertRaises(ValidationError):
                DimensionFilter(column="channel", values=values)
        self.assertEqual(DimensionFilter(column="channel", values=["East", "East"]).values, ["East"])

    def test_values_are_searchable_paginated_and_escaped_as_literal_text(self):
        frame = pd.DataFrame({"customer_id": [f"Customer {i:03}" for i in range(105)], "revenue": range(105)})
        first = dimension_options(self.dataset, frame, "customer_id")
        second = dimension_options(self.dataset, frame, "customer_id", offset=first["next_offset"])
        self.assertEqual(len(first["values"]), 100)
        self.assertEqual(len(second["values"]), 5)
        self.assertIsNone(second["next_offset"])
        self.assertEqual(dimension_options(self.dataset, frame, "customer_id", "104")["values"], ["Customer 104"])
        self.assertEqual(dimension_options(self.dataset, frame, "customer_id", ".*")["values"], [])

    def test_special_value_search_matches_display_labels_without_changing_literal_tokens(self):
        available = dimension_options(self.dataset, self.frame, "channel")["values"]
        self.assertIn(None, available)
        self.assertIn("", available)
        self.assertIn("null", available)
        self.assertEqual(dimension_options(self.dataset, self.frame, "channel", "missing")["values"], [None])
        self.assertEqual(dimension_options(self.dataset, self.frame, "channel", "EMPTY STRING")["values"], [""])
        self.assertEqual(dimension_options(self.dataset, self.frame, "channel", "null")["values"], ["null"])

    def test_line_dimension_cannot_silently_allocate_invoice_header_totals(self):
        dataset = SimpleNamespace(source_type="shopify", source_config='{"resource":"orders"}')
        frame = pd.DataFrame({"order_id": [1, 1], "total_price": [100, None], "line_total": [40, 60], "product_name": ["A", "B"]})
        selection = {"column": "product_name", "values": ["B"]}
        with self.assertRaisesRegex(DimensionFilterError, "splits transaction totals"):
            apply_dimension_filter(dataset, frame, selection, metrics=["total_price"])
        self.assertEqual(apply_dimension_filter(dataset, frame, selection, metrics=["line_total"]).line_total.sum(), 60)


class FilteredReportTests(unittest.TestCase):
    def setUp(self):
        item = patch.dict("os.environ", FLAGS)
        item.start(); self.addCleanup(item.stop)
        self.sources = {}
        self.expected = fixture()
        for identity, (dataset, frame) in fixture().items():
            key = "spend" if identity == 1 else "net_sales"
            self.sources[identity] = dataset, pd.concat([
                frame.assign(region="East"), frame.assign(region="West", **{key: 9999}),
            ], ignore_index=True)
            self.expected[identity] = dataset, self.expected[identity][1].assign(region="East")

    def selection(self):
        return [{"dataset_id": identity, "column": "region", "values": ["East"]} for identity in (1, 2)]

    def test_metrics_baselines_relationships_and_anomalies_use_the_identical_filtered_history(self):
        result = build_report(self.sources, definition(dimension_filters=self.selection()))
        expected = build_report(self.expected, definition())
        for key in ("metrics", "findings", "anomaly_analysis", "observations", "contrasts"):
            self.assertEqual(result[key], expected[key], key)
        self.assertEqual(result["definition"]["dimension_filters"], self.selection())
        self.assertEqual(report_analysis_facts(result)["dimension_filters"], self.selection())

    def test_single_report_filter_is_optional_and_never_falls_back_to_all_rows(self):
        reference = definition()["metrics"][:1]
        selected = [{"dataset_id": 1, "column": "region", "values": ["Gone"]}]
        result = build_report({1: self.sources[1]}, definition(scope="single", metrics=reference, dimension_filters=selected))
        self.assertIsNone(result["metrics"][0]["value"])
        self.assertEqual(result["status"], "limited_coverage")
        self.assertEqual(result["anomaly_analysis"]["metrics"][0]["anomaly_count"], 0)

    def test_each_dataset_has_its_own_filter_and_unknown_dataset_filters_are_rejected(self):
        for selections in ([self.selection()[0], self.selection()[0]], [{"dataset_id": 999, "column": "region", "values": ["East"]}]):
            with self.assertRaises(ValidationError):
                definition(dimension_filters=selections)
        self.assertEqual(ReportDefinition.model_validate(definition(dimension_filters=self.selection())).model_dump(mode="json")["dimension_filters"], self.selection())

    def test_weekly_templates_keep_the_dimension_filter_when_the_reporting_window_moves(self):
        preference = WeeklyReportPreferenceResponse(enabled=True, cadence="weekly", delivery_day="monday", recipient_emails=["owner@example.test"], include_recommendations=False, metric_focus=[])
        template = definition(dimension_filters=self.selection())
        with patch("app.modules.alerts.router.complete_week", return_value=template["date_range"]):
            result = build_weekly_cross_dataset_report(self.sources, preference, template)
            expected = build_weekly_cross_dataset_report(self.expected, preference, definition())
        self.assertEqual(result["metrics"], expected["metrics"])
        self.assertEqual(result["anomaly_analysis"], expected["anomaly_analysis"])
        self.assertEqual(result["definition"]["dimension_filters"], self.selection())

    def test_weekly_email_discloses_and_escapes_the_filter_scope(self):
        from app.modules.alerts.router import build_weekly_report_digest
        from app.modules.alerts.email_delivery import build_weekly_report_email_html, build_weekly_report_email_text
        preference = WeeklyReportPreferenceResponse(enabled=False, cadence="weekly", delivery_day="monday", recipient_emails=[], metric_focus=[], include_recommendations=False)
        selections = self.selection()
        selections[0]["values"] = ["East", "<script>unsafe</script>"]
        with patch("app.modules.alerts.router.complete_week", return_value=definition()["date_range"]), patch(
            "app.modules.alerts.router.load_dataframe_from_dataset", side_effect=lambda dataset: self.sources[dataset.id][1].copy()
        ):
            digest = build_weekly_report_digest(preference, [pair[0] for pair in self.sources.values()],
                report_definition=definition(dimension_filters=selections), include_ai_analysis=False)
        self.assertIn("Filter: Source 1.csv / region: East, <script>unsafe</script>", build_weekly_report_email_text(digest))
        html = build_weekly_report_email_html(digest)
        self.assertIn("region: East, &lt;script&gt;unsafe&lt;/script&gt;", html)
        self.assertNotIn("<script>", html)


class FilteredReportWorkflowTests(unittest.TestCase):
    def setUp(self):
        report_fixtures.BusinessReportWorkflowTests.setUp(self)
        for identity, (dataset, frame) in list(self.frames.items()):
            metric = "spend" if identity == 1 else "net_sales"
            self.frames[identity] = dataset, pd.concat([
                frame.assign(region="East"), frame.assign(region="West", **{metric: 9999}),
            ], ignore_index=True)

    def test_worker_save_reopen_and_weekly_template_keep_the_exact_filter(self):
        from app.modules.reports.models import BusinessReport
        selection = [{"dataset_id": identity, "column": "region", "values": ["East"]} for identity in (1, 2)]
        response = self.client.post("/api/v2/business-reports", json=definition(dimension_filters=selection))
        self.assertEqual(response.status_code, 201, response.text)
        saved = response.json()
        self.assertEqual(saved["definition"]["dimension_filters"], selection)
        expected = build_report(fixture(), definition())
        self.assertEqual(saved["metrics"], expected["metrics"])
        self.frames[1][1]["spend"] = 1e9
        reopened = self.client.get(f"/api/v2/business-reports/{saved['report_id']}")
        self.assertEqual(reopened.status_code, 200, reopened.text)
        self.assertEqual(reopened.json()["metrics"], saved["metrics"])
        weekly = self.client.post(f"/api/v2/business-reports/{saved['report_id']}/weekly")
        self.assertEqual(weekly.status_code, 200, weekly.text)
        with self.Session() as db:
            self.assertEqual(json.loads(db.get(BusinessReport, saved["report_id"]).definition)["dimension_filters"], selection)

    def test_invalid_filter_fails_the_worker_without_using_all_rows(self):
        response = self.client.post("/api/v2/business-reports/preview", json=definition(
            dimension_filters=[{"dataset_id": 1, "column": "unknown", "values": ["East"]}],
        ))
        self.assertEqual(response.status_code, 422, response.text)
        self.assertIn("dimension column is unavailable", response.json()["detail"])


class FilteredForecastRouteTests(unittest.TestCase):
    def setUp(self):
        self.dataset = SimpleNamespace(id=1, file_name="Sales.csv", source_type="csv", source_config='{"selected_metric_columns":["revenue"]}')
        dates = pd.date_range("2026-01-01", periods=90)
        self.frame = pd.DataFrame({"date": list(dates) * 2, "revenue": list(range(1, 91)) + [9999] * 90,
                                   "region": ["East"] * 90 + ["West"] * 90})
        self.db = MagicMock()
        self.db.query.return_value.filter.return_value.first.return_value = self.dataset
        self.generate = MagicMock(side_effect=lambda frame, *_args: {
            "date_column": "date", "value_column": "revenue", "historical": [{"revenue": float(frame.revenue.sum())}],
        })
        for name, value in {
            "SessionLocal": MagicMock(return_value=self.db), "get_user_id": lambda _: "owner",
            "get_workspace_id": lambda *_: "workspace", "load_forecast_dataframe": lambda _, **kwargs: self.frame,
            "build_workspace_decision_learning_context": lambda *_args, **_kwargs: None,
            "generate_forecast": self.generate,
        }.items():
            item = patch.object(forecasting, name, value)
            item.start(); self.addCleanup(item.stop)
        app = FastAPI(); app.include_router(forecasting.router, prefix="/forecasting")
        self.client = TestClient(app)

    def test_filtered_post_applies_rows_before_every_forecast_option_and_echoes_scope(self):
        selection = {"column": "region", "values": ["East"]}
        response = self.client.post("/forecasting/1?metric=revenue&aggregation=daily&aggregation_type=sum&seasonal_business=true", json=selection)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.generate.call_args.args[0].region.unique().tolist(), ["East"])
        self.assertTrue(self.generate.call_args.args[-1])
        self.assertEqual(response.json()["historical"][0]["revenue"], 4095)
        self.assertEqual(response.json()["dimension_filter"], selection)

    def test_existing_get_keeps_the_unfiltered_contract(self):
        response = self.client.get("/forecasting/1?metric=revenue")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(len(self.generate.call_args.args[0]), 180)
        self.assertIsNone(response.json()["dimension_filter"])

    def test_filter_can_use_numeric_identifiers_not_retained_by_metric_selection(self):
        self.frame["customer_id"] = [1] * 90 + [2] * 90
        self.frame["internal_cost"] = list(range(180))
        selected = filter_dataframe_to_selected_metrics(self.dataset, self.frame)
        self.assertNotIn("customer_id", selected)
        self.assertNotIn("internal_cost", selected)
        original_config = self.dataset.source_config
        with patch.object(forecasting, "load_forecast_dataframe", side_effect=lambda dataset, **kwargs:
                          self.frame if kwargs.get("apply_metric_selection") is False else selected) as load:
            response = self.client.post("/forecasting/1?metric=revenue", json={"column": "customer_id", "values": ["1"]})
        self.assertEqual(response.status_code, 200, response.text)
        load.assert_called_once_with(self.dataset, apply_metric_selection=False)
        self.assertEqual(response.json()["historical"][0]["revenue"], 4095)
        self.assertNotIn("internal_cost", self.generate.call_args.args[0])
        self.assertEqual(self.dataset.source_config, original_config)

    def test_invalid_missing_and_nonmatching_filters_never_run_an_unfiltered_forecast(self):
        for selection, status in [({"column": "revenue", "values": ["1"]}, 422), ({"column": "Gone", "values": ["East"]}, 422),
                                  ({"column": "region", "values": []}, 422), ({"column": "region", "values": ["Gone"]}, 400)]:
            with self.subTest(selection=selection):
                response = self.client.post("/forecasting/1", json=selection)
                self.assertEqual(response.status_code, status, response.text)
        self.generate.assert_not_called()

    def test_dataset_authorization_happens_before_filtering(self):
        self.db.query.return_value.filter.return_value.first.return_value = None
        response = self.client.post("/forecasting/999", json={"column": "region", "values": ["East"]})
        self.assertEqual(response.status_code, 404)
        self.generate.assert_not_called()

    def test_real_forecast_history_contains_only_the_selected_dimension_rows(self):
        frame = apply_dimension_filter(self.dataset, self.frame, {"column": "region", "values": ["East"]})
        with patch("app.modules.forecasting.services.generate_structured_analysis", return_value={}) as analysis:
            result = generate_forecast(frame, metric="revenue", aggregation="daily", aggregation_type="sum")
        self.assertNotIn("error", result)
        self.assertEqual([item["revenue"] for item in result["historical"]], list(range(79, 91)))
        self.assertEqual(analysis.call_args.kwargs["facts"]["dimension_filter"], {"column": "region", "values": ["East"]})


class DimensionOptionsRouteTests(unittest.TestCase):
    def test_options_use_the_authorized_workspace_loader(self):
        dataset = SimpleNamespace(id=7, source_type="csv", source_config="{}")
        frame = pd.DataFrame({"region": ["East", "West"]})
        db = MagicMock()
        session = MagicMock(); session.return_value.__enter__.return_value = db
        app = FastAPI(); app.include_router(datasets.router, prefix="/datasets")
        with patch.object(datasets, "SessionLocal", session), patch.object(datasets, "get_user_id", return_value="owner"), patch.object(
            datasets, "get_workspace_id", return_value="workspace"
        ), patch.object(datasets, "_load_owned_dataset_dataframe", return_value=(dataset, frame)) as load:
            response = TestClient(app).get("/datasets/7/dimensions?column=region&search=East")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["values"], ["East"])
        load.assert_called_once_with(db, 7, "owner", "workspace", apply_metric_selection=False)

    def test_options_read_source_dimensions_even_when_manual_metric_selection_excludes_them(self):
        dataset = SimpleNamespace(id=7, source_type="csv", source_config='{"selected_metric_columns":["revenue"]}')
        frame = pd.DataFrame({"date": pd.date_range("2026-01-01", periods=10), "revenue": range(10), "customer_id": [1, 2] * 5})
        self.assertNotIn("customer_id", filter_dataframe_to_selected_metrics(dataset, frame))
        session = MagicMock()
        app = FastAPI(); app.include_router(datasets.router, prefix="/datasets")
        with patch.object(datasets, "SessionLocal", session), patch.object(datasets, "get_user_id", return_value="owner"), patch.object(
            datasets, "get_workspace_id", return_value="workspace"
        ), patch.object(datasets, "load_dataset", return_value=dataset), patch.object(datasets, "verify_dataset_owner") as authorize, patch(
            "app.modules.datasets.services.dataset_loader.load_dataset_dataframe", return_value=frame
        ):
            response = TestClient(app).get("/datasets/7/dimensions?column=customer_id")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["values"], ["1", "2"])
        authorize.assert_called_once_with(dataset, "owner", "workspace")
