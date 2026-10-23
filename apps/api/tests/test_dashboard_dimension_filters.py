import json
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pandas as pd
from fastapi import HTTPException, Response
from app.modules.datasets import router as datasets
from app.modules.datasets.services.insights import generate_dataset_ai_analysis
from app.modules.datasets.services.joins import build_join_dataset_metadata, build_joined_dataset
from app.modules.datasets.services.join_cache import build_join_definition
from app.modules.organizations.router import clean_dashboard_preferences, clean_dashboard_views
from app.modules import public_dashboard
from tests import test_business_reports as fixtures


class DashboardDimensionRouteTests(unittest.TestCase):
    def setUp(self):
        fixtures.BusinessReportWorkflowTests.setUp(self)
        self.client.app.include_router(datasets.router, prefix="/datasets")
        for name, value in (("SessionLocal", self.Session), ("get_user_id", lambda _: "owner"),
                            ("get_workspace_id", lambda *_: "owner"),
                            ("load_dataframe_from_dataset", lambda dataset, **_: self.frames[dataset.id][1].copy()),
                            ("build_workspace_decision_learning_context", lambda *_args, **_kwargs: None)):
            item = patch.object(datasets, name, value); item.start(); self.addCleanup(item.stop)
        for identity, (dataset, frame) in list(self.frames.items()):
            metric = "spend" if identity == 1 else "net_sales"
            self.frames[identity] = dataset, pd.concat([frame.assign(region="East"), frame.assign(region="West", **{metric: 9999})], ignore_index=True)
        self.filter = {"column": "region", "values": ["East"]}

    def test_details_filters_before_chart_limit_and_preserves_metric_metadata(self):
        response = self.client.post("/datasets/1/details?include_all_rows=true&include_ai_analysis=false", json=self.filter)
        self.assertEqual(response.status_code, 200, response.text)
        value = response.json()
        self.assertEqual(value["dimension_filter"], self.filter)
        self.assertEqual(value["row_count"], 90)
        self.assertEqual(value["metrics"][0]["total"], sum(range(1, 91)))
        self.assertTrue(all(row["region"] == "East" for row in value["preview"]))
        self.assertTrue(all(row["region"] == "East" for row in value["chart"]["data"]))
        self.assertEqual(value["selected_metric_columns"], ["spend"])
        self.assertIsNone(value["ai_analysis"])
        self.assertEqual(len(self.frames[1][1]), 180)

    def test_empty_result_is_empty_not_an_unfiltered_fallback(self):
        response = self.client.post("/datasets/1/details?include_all_rows=true&include_ai_analysis=false", json={"column": "region", "values": ["Gone"]})
        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()
        self.assertEqual(result["row_count"], 0)
        self.assertEqual(result["preview"], [])
        self.assertFalse((result["chart"] or {}).get("data"))
        self.assertEqual(result["selected_metric_columns"], ["spend"])

    def test_unfiltered_get_is_backward_compatible(self):
        result = self.client.get("/datasets/1/details?include_ai_analysis=false").json()
        self.assertIsNone(result["dimension_filter"])
        self.assertEqual(result["metrics"][0]["total"], sum(range(1, 91)) + 90 * 9999)

    def test_details_exposes_date_choices_even_when_a_dimension_has_no_matching_rows(self):
        dataset, frame = self.frames[1]
        frame["paid_date"] = pd.to_datetime(frame["date"]) + pd.Timedelta(days=31)
        response = self.client.post("/datasets/1/details?include_ai_analysis=false", json={"column": "region", "values": ["Gone"]})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["date_columns"], ["date", "paid_date"])
        self.assertEqual(response.json()["preview"], [])

    def test_ai_analysis_uses_the_selected_date_for_the_window_and_keeps_dimension_scope(self):
        _dataset, frame = self.frames[1]
        frame["paid_date"] = pd.to_datetime(frame["date"]) + pd.Timedelta(days=31)
        with patch.object(datasets, "generate_dataset_ai_analysis", return_value={"summary": "Selected dates"}) as calculate:
            response = self.client.post("/datasets/1/ai-analysis?metric=spend&date_column=paid_date&start_date=2026-03-01&period_filter=1m&aggregation=daily", json=self.filter)
        self.assertEqual(response.status_code, 200, response.text)
        result = calculate.call_args.args[0]
        self.assertNotIn("date", result.columns)
        self.assertEqual(result.paid_date.min().strftime("%Y-%m-%d"), "2026-03-01")
        self.assertEqual(result.paid_date.max().strftime("%Y-%m-%d"), "2026-03-31")
        expected = frame.loc[(frame.region == "East") & (frame.paid_date >= "2026-03-01") & (frame.paid_date < "2026-04-01"), "spend"].sum()
        self.assertEqual(result.spend.sum(), expected)
        self.assertEqual(response.json()["date_column"], "paid_date")
        self.assertEqual(response.json()["dimension_filter"], self.filter)

    def test_invalid_selected_date_never_runs_automatic_analysis(self):
        with patch.object(datasets, "generate_dataset_ai_analysis") as calculate:
            for column in ("gone", "spend", "region", ""):
                with self.subTest(column=column):
                    response = self.client.get("/datasets/1/ai-analysis", params={"date_column": column})
                    self.assertEqual(response.status_code, 422, response.text)
            calculate.assert_not_called()

    def test_invalid_filters_are_rejected_by_every_dashboard_data_endpoint(self):
        for endpoint in ("details", "ai-analysis", "anomalies"):
            for selection in ({"column": "missing", "values": ["East"]}, {"column": "spend", "values": ["1"]},
                              {"column": "region", "values": []}, {"column": "region", "values": [True]}):
                with self.subTest(endpoint=endpoint, selection=selection):
                    response = self.client.post(f"/datasets/1/{endpoint}", json=selection)
                    self.assertEqual(response.status_code, 422, response.text)

    def test_analysis_and_anomaly_detection_receive_only_filtered_history(self):
        for endpoint, target, response_data in (("ai-analysis?metric=spend", "generate_dataset_ai_analysis", {"summary": "Selected segment"}),
                                               ("anomalies?metric=spend", "detect_dataset_anomalies", {"status": "ready", "metrics": []})):
            with self.subTest(endpoint=endpoint), patch.object(datasets, target, return_value=response_data) as calculate:
                response = self.client.post(f"/datasets/1/{endpoint}", json=self.filter)
                self.assertEqual(response.status_code, 200, response.text)
                frame = calculate.call_args.args[0]
                self.assertEqual(frame.region.unique().tolist(), ["East"])
                self.assertEqual(frame.spend.sum(), sum(range(1, 91)))
                self.assertEqual(response.json()["dimension_filter"], self.filter)

    def test_private_dataset_is_not_read_or_filtered(self):
        with patch.object(datasets, "load_dataframe_from_dataset") as read:
            for endpoint in ("details", "ai-analysis", "anomalies", "dimensions"):
                response = self.client.get(f"/datasets/3/{endpoint}")
                self.assertIn(response.status_code, (403, 404), response.text)
            read.assert_not_called()

    def test_filtered_details_cannot_reuse_persisted_whole_dataset_analysis(self):
        from app.db.models import Dataset
        with self.Session() as db:
            dataset = db.get(Dataset, 1)
            with patch.object(datasets, "generate_dataset_ai_analysis", return_value={"summary": "East only"}) as generate:
                result = datasets.build_dataset_details_response(dataset, self.frames[1][1], dimension_filter=self.filter,
                    persisted_analysis=SimpleNamespace(status="completed", completed_at=None, result=json.dumps({"ai_analysis": {"summary": "Whole dataset"}})))
        self.assertEqual(result["ai_analysis"], {"summary": "East only"})
        self.assertEqual(generate.call_args.args[0].region.unique().tolist(), ["East"])

    def test_missing_value_filter_cannot_include_unsplittable_historical_summaries(self):
        from app.modules.datasets.services.dimension_filters import apply_dimension_filter, DimensionFilterError
        dataset, frame = self.frames[1]
        frame = frame.iloc[:2].copy()
        frame["region"] = [None, "East"]
        frame["__decisionate_summary__"] = [True, False]
        with self.assertRaisesRegex(DimensionFilterError, "Historical summaries"):
            apply_dimension_filter(dataset, frame, {"column": "region", "values": [None]})
        self.assertEqual(len(apply_dimension_filter(dataset, frame, self.filter)), 1)


class DashboardDimensionPersistenceTests(unittest.TestCase):
    def setUp(self):
        self.filter = {"column": "region", "values": ["East", None, ""]}

    def test_saved_views_preserve_each_dashboard_filter_and_explicit_clear(self):
        views = {"1": {"general-business": {"dimensionFilter": self.filter}, "sales-performance": {"dimensionFilter": None}}}
        self.assertEqual(clean_dashboard_views(views), views)
        preferences = {"1": {"dimensionFilter": self.filter}}
        self.assertEqual(clean_dashboard_preferences(preferences), preferences)

    def test_saved_general_date_and_each_industry_date_survive_cleaning(self):
        for key in ("general-business", "sales-performance", "retail-performance"):
            view = {"metricMappings": {key: {"date": "paid_date"}}, "dimensionFilter": self.filter}
            self.assertEqual(clean_dashboard_views({"1": {key: view}}), {"1": {key: view}})
            self.assertEqual(clean_dashboard_preferences({"1": view}), {"1": view})
        cleaned = clean_dashboard_preferences({"1": {"metricMappings": {"general-business": {"date": "paid_date", "primary": "spend"}}}})
        self.assertEqual(cleaned["1"]["metricMappings"]["general-business"], {"date": "paid_date"})

    def test_invalid_saved_scope_fails_closed_instead_of_removing_the_filter(self):
        for value in ({"column": "region", "values": []}, {"column": "region", "values": ["x" * 1001]}, "region"):
            with self.subTest(value=value), self.assertRaises(HTTPException) as error:
                clean_dashboard_preferences({"1": {"dimensionFilter": value}})
            self.assertEqual(error.exception.status_code, 422)

    def test_join_filters_are_applied_before_aggregation_and_survive_cache_definition(self):
        frames, selections = [], []
        for identity in (1, 2):
            dataset = SimpleNamespace(id=identity, source_type="csv", file_name=f"Source {identity}.csv", row_count=4, source_config='{"selected_metric_columns":["revenue"]}')
            frame = pd.DataFrame({"date": ["2026-01-01", "2026-02-01"] * 2, "region": ["East"] * 2 + ["West"] * 2,
                                  "revenue": [10 * identity, 20 * identity, 9999, 9999]})
            frames.append((dataset, frame, build_join_dataset_metadata(dataset, frame)))
            selections.append({"dataset_id": identity, "date_column": "date", "metric_columns": ["revenue"], "dimension_filter": {"column": "region", "values": ["East"]}})
        result = build_joined_dataset(frames, selections)
        self.assertEqual(len(result["rows"]), 2)
        for detail in result["datasets"]:
            self.assertEqual([row[detail["label"]] for row in result["rows"]], [10 * detail["dataset_id"], 20 * detail["dataset_id"]])
        self.assertEqual(len(result["dimension_filters"]), 2)
        definition = build_join_definition(selections, None, "all", "monthly", "sum")
        repeated = build_joined_dataset(frames, definition["selections"])
        self.assertEqual(repeated["rows"], result["rows"])
        self.assertEqual(repeated["dimension_filters"], result["dimension_filters"])
        with self.assertRaises(ValueError):
            build_joined_dataset(frames, [{**selection, "dimension_filter": {"column": "unknown", "values": ["East"]}} for selection in selections])

    def test_ai_facts_disclose_the_selected_segment(self):
        frame = pd.DataFrame({"spend": [10, 20]})
        frame.attrs["dimension_filter"] = self.filter
        with patch("app.modules.datasets.services.insights.generate_structured_analysis", return_value={}) as ai:
            generate_dataset_ai_analysis(frame, "spend")
        self.assertEqual(ai.call_args.kwargs["facts"]["dimension_filter"], self.filter)


class FilteredPublicDashboardTests(unittest.TestCase):
    def setUp(self):
        self.dataset = SimpleNamespace(id=1, user_id="owner", workspace_id="owner", file_name="Sales.csv", source_type="csv",
            source_label=None, source_config='{"selected_metric_columns":["revenue"]}', share_token="token", row_count=4)
        self.frame = pd.DataFrame({"date": ["2026-01-01", "2026-02-01"] * 2, "revenue": [10, 20, 9999, 9999], "region": ["East"] * 2 + ["West"] * 2})
        self.preference = SimpleNamespace(metric_targets=None, selected_metric="revenue", dashboard_preferences=None,
            dashboard_views=json.dumps({"1": {"general-business": {"dimensionFilter": {"column": "region", "values": ["East"]}}}}))
        for name, value in (("SessionLocal", lambda: MagicMock()), ("load_dataset", lambda *_: self.dataset),
                            ("load_dataframe_from_dataset", lambda *_: self.frame.copy()), ("get_dashboard_preference", lambda *_: self.preference),
                            ("get_public_join_cache_result", lambda *_: None), ("get_public_dashboard_brand", lambda *_: {})):
            item = patch.object(public_dashboard, name, value); item.start(); self.addCleanup(item.stop)

    def test_public_response_contains_only_the_saved_segment_and_no_private_view_cache(self):
        views = json.loads(self.preference.dashboard_views)
        views["1"]["sales-performance"] = {"joinedDatasetResult": {"rows": [{"private": 9999}]}}
        self.preference.dashboard_views = json.dumps(views)
        response = Response()
        result = public_dashboard.get_public_shared_dashboard(1, response, "token")
        self.assertEqual(result["dataset"]["metrics"][0]["total"], 30)
        self.assertEqual(result["dataset"]["row_count"], 2)
        self.assertEqual(result["dataset"]["dimension_filter"], {"column": "region", "values": ["East"]})
        self.assertNotIn("West", json.dumps(result))
        self.assertNotIn("private", json.dumps(result))
        self.assertEqual(response.headers["Cache-Control"], "no-store")

    def test_invalid_or_removed_public_dimension_never_reverts_to_all_rows(self):
        self.preference.dashboard_views = json.dumps({"1": {"general-business": {"dimensionFilter": {"column": "gone", "values": ["East"]}}}})
        with self.assertRaises(HTTPException) as error:
            public_dashboard.get_public_shared_dashboard(1, Response(), "token")
        self.assertEqual(error.exception.status_code, 422)

    def test_unauthorized_public_token_does_not_read_source_rows(self):
        with patch.object(public_dashboard, "load_dataframe_from_dataset") as read, self.assertRaises(HTTPException):
            public_dashboard.get_public_shared_dashboard(1, Response(), "wrong")
        read.assert_not_called()

    def test_filtered_joined_public_view_contains_only_the_joined_filtered_rows(self):
        self.preference.dashboard_views = None
        joined = {"dimension_filters": [{"dataset_id": 1, "column": "region", "values": ["East"]}],
            "rows": [{"period": "2026-01-01", "Sales revenue": 10}, {"period": "2026-02-01", "Sales revenue": 20}]}
        with patch.object(public_dashboard, "get_public_join_cache_result", return_value=joined):
            result = public_dashboard.get_public_shared_dashboard(1, Response(), "token")
        self.assertEqual(result["dataset"]["dimension_filters"], joined["dimension_filters"])
        self.assertEqual(result["dataset"]["metrics"][0]["total"], 30)
        self.assertNotIn("9999", json.dumps(result))
