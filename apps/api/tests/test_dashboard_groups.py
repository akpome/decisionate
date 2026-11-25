import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.modules.datasets import router as datasets
from app.modules.datasets.services import dataset_loader
from app.modules.datasets.services.dashboard_groups import DashboardGroupRequest, dashboard_group_series, dashboard_group_series_for_dataset
from app.modules.datasets.services.join_cache import build_join_definition
from app.modules.datasets.services.joins import build_joined_dataset
from app.modules.organizations.router import clean_dashboard_preferences
from app.modules.public_dashboard import shared_view_settings


def dataset_fixture():
    return SimpleNamespace(
        id=17, file_name="sales.csv", source_type="csv",
        source_config='{"selected_metric_columns":["revenue"]}',
    )


def selection(**overrides):
    return DashboardGroupRequest.model_validate({
        "filter": {"column": "channel", "values": ["Online", "Store", None, ""]},
        "metric": "revenue", "date_column": "date", "start_date": "2026-01-01", "end_date": "2026-01-31",
        "aggregation": "weekly", "aggregation_type": "sum",
        **overrides,
    })


def joined_fixture():
    left = SimpleNamespace(id=17, file_name="sales.csv", source_type="csv", source_config="{}", user_id="owner", workspace_id="workspace")
    right = SimpleNamespace(id=18, file_name="ads.csv", source_type="csv", source_config="{}", user_id="owner", workspace_id="workspace")
    records = {
        17: (left, pd.DataFrame({
            "date": ["2026-01-02", "2026-01-06", "2026-01-12", "2026-01-20", "2026-02-02", "2026-03-02"],
            "channel": ["Online", "Online", "Store", "Store", "Online", "Store"],
            "country": ["US", "CA", "CA", "US", "CA", "CA"],
            "revenue": [999, 15, 30, 999, 50, 60],
        })),
        18: (right, pd.DataFrame({
            "date": ["2026-01-10", "2026-03-12"], "spend": [5, 10], "campaign": ["Spring", "Summer"],
        })),
    }
    selections = [
        {"dataset_id": 17, "date_column": "date", "metric_columns": ["revenue", "channel"],
         "dimension_filter": {"column": "country", "values": ["CA"]}},
        {"dataset_id": 18, "date_column": "date", "metric_columns": ["spend", "campaign"]},
    ]
    definition = build_join_definition(selections, None, "all", "monthly", "sum")
    frames = [(source, frame, {}) for source, frame in records.values()]
    result = build_joined_dataset(frames, selections)
    joined = SimpleNamespace(id=21, source_type="joined", file_name="Joined Sales and Ads",
                             user_id="owner", workspace_id="workspace", source_config=json.dumps({"join_definition": definition}))
    return joined, pd.DataFrame(result["rows"]), records, result["datasets"][0]["label"]


class DashboardGroupTests(unittest.TestCase):
    def setUp(self):
        self.frame = pd.DataFrame({
            "date": ["2026-01-05", "2026-01-06", "2026-01-12", "2026-01-12", "2026-01-19", "2026-01-19",
                     "2026-01-31T23:00:00Z", "2026-02-01", "not a date"],
            "channel": ["Online", "Online", "Store", "Online", None, "", "Online", "Store", "Online"],
            "revenue": [10, 4, 18, None, 5, 0, 20, 99, 999],
            "cost": [1] * 9,
        })

    def test_compares_one_metric_over_shared_periods_and_preserves_missing_and_zero(self):
        result = dashboard_group_series(dataset_fixture(), self.frame, selection())
        self.assertEqual(result["series"], [
            {"value": "Online", "points": [{"period": "2026-01-05", "amount": 14}, {"period": "2026-01-26", "amount": 20}]},
            {"value": "Store", "points": [{"period": "2026-01-12", "amount": 18}]},
            {"value": None, "points": [{"period": "2026-01-19", "amount": 5}]},
            {"value": "", "points": [{"period": "2026-01-19", "amount": 0}]},
        ])
        self.assertEqual(dashboard_group_series(dataset_fixture(), self.frame, selection(aggregation_type="avg"))
                         ["series"][0]["points"][0]["amount"], 7)

    def test_missing_group_never_falls_back_to_a_total(self):
        result = dashboard_group_series(dataset_fixture(), self.frame, selection(filter={"column": "channel", "values": ["Absent"]}))
        self.assertEqual(result["series"], [{"value": "Absent", "points": []}])
        with self.assertRaisesRegex(ValueError, "available on this dashboard"):
            dashboard_group_series(dataset_fixture(), self.frame, selection(metric="cost"))
        with self.assertRaises(ValidationError):
            selection(filter={"column": "channel", "values": list("123456789")})

    def test_group_preferences_store_separate_targets_without_touching_the_metric_filter(self):
        preference = {
            "dimensionFilter": {"column": "channel", "values": ["Store"]},
            "groupComparison": {
                "filter": {"column": "channel", "values": ["Online", "Store", None]}, "metric": "revenue",
                "targets": [200, None, 500], "active": False,
            },
        }
        self.assertEqual(clean_dashboard_preferences({"17": preference}), {"17": preference})
        preference["groupComparison"]["targets"] = [500]
        with self.assertRaises(HTTPException) as error:
            clean_dashboard_preferences({"17": preference})
        self.assertEqual(error.exception.status_code, 422)

    def test_shared_dashboard_settings_strip_private_group_values_and_extract_the_target_separately(self):
        stored = SimpleNamespace(
            dashboard_preferences='{"17":{"groupComparison":{"filter":{"column":"channel","values":["Private"]},"metric":"revenue","targets":[200]}}}',
            dashboard_views='{"17":{"general-business":{"targetMetric":"revenue","groupComparison":{"filter":{"column":"channel","values":["Private"]},"metric":"revenue","targets":[200]}}}}',
        )
        self.assertEqual(shared_view_settings(stored, 17, "general-business"), ({}, {}, "revenue"))

    def test_older_monthly_summaries_are_not_shown_as_daily_or_partial_month_results(self):
        frame = self.frame.assign(**{"__decisionate_summary__": [True, *([False] * 8)], "revenue__sum": [200, *([None] * 8)]})
        query = selection(filter={"column": "channel", "values": ["Online"]}, aggregation="daily")
        result = dashboard_group_series(dataset_fixture(), frame, query)
        self.assertTrue(result["has_summarized_data"])
        self.assertNotIn("2026-01-05", {point["period"] for point in result["series"][0]["points"]})
        result = dashboard_group_series(dataset_fixture(), frame, query.model_copy(update={"aggregation": "monthly"}))
        self.assertEqual(result["series"][0]["points"], [{"period": "2026-01-01", "amount": 224}])

    def test_endpoint_uses_workspace_scoped_dataset_lookup(self):
        app = FastAPI()
        app.include_router(datasets.router, prefix="/datasets")
        with patch.object(datasets, "get_user_id", return_value="actor"), patch.object(
            datasets, "get_workspace_id", return_value="workspace",
        ), patch.object(datasets, "_load_owned_dataset_dataframe", return_value=(dataset_fixture(), self.frame)) as load:
            response = TestClient(app).post("/datasets/17/dashboard-groups", json=selection().model_dump(mode="json"))
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(load.call_args.args[1:], (17, "actor", "workspace"))
        self.assertEqual(response.json()["series"][0]["value"], "Online")

    def test_joined_endpoint_splits_the_original_metric_only_for_matched_months(self):
        joined, frame, sources, metric = joined_fixture()
        app = FastAPI()
        app.include_router(datasets.router, prefix="/datasets")
        query = selection(metric=metric, date_column="period", aggregation="monthly", end_date="2026-03-31",
                          filter={"column": "channel", "values": ["Online", "Store"]}).model_dump(mode="json")
        with patch.object(datasets, "get_user_id", return_value="owner"), patch.object(
            datasets, "get_workspace_id", return_value="workspace",
        ), patch.object(datasets, "_load_owned_dataset_dataframe", return_value=(joined, frame)), patch.object(
            dataset_loader, "load_dataset", side_effect=lambda db, identity: sources[identity][0],
        ), patch.object(dataset_loader, "load_dataframe_from_dataset", side_effect=lambda source, **_: sources[source.id][1]):
            client = TestClient(app)
            response = client.post("/datasets/21/dashboard-groups", json=query)
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()["series"], [
                {"value": "Online", "points": [{"period": "2026-01-01", "amount": 15}]},
                {"value": "Store", "points": [{"period": "2026-01-01", "amount": 30}, {"period": "2026-03-01", "amount": 60}]},
            ])
            self.assertEqual(response.json()["metric_aggregation"], "Sum")
            weekly = client.post("/datasets/21/dashboard-groups", json={**query, "aggregation": "weekly"})
            self.assertEqual(weekly.status_code, 422)
            wrong_source = client.post("/datasets/21/dashboard-groups", json={**query, "filter": {"column": "campaign", "values": ["Spring"]}})
            self.assertEqual(wrong_source.status_code, 422)
            sources[17][1].loc[1, "revenue"] = 20
            stale = client.post("/datasets/21/dashboard-groups", json=query)
            self.assertEqual(stale.status_code, 422)
            self.assertIn("Rebuild the join", stale.json()["detail"])

    def test_joined_comparison_never_loads_another_workspaces_source(self):
        joined, frame, sources, metric = joined_fixture()
        sources[17][0].workspace_id = "elsewhere"
        query = selection(metric=metric, date_column="period", aggregation="monthly")
        with patch.object(dataset_loader, "load_dataset", return_value=sources[17][0]), patch.object(
            dataset_loader, "load_dataframe_from_dataset",
        ) as load:
            with self.assertRaisesRegex(ValueError, "A source for this join is unavailable"):
                dashboard_group_series_for_dataset(None, joined, frame, query)
            load.assert_not_called()

    def test_joined_group_dimension_catalog_includes_all_sources_and_keeps_legacy_keys(self):
        joined, frame, sources, metric = joined_fixture()
        sources[18][1]["channel"] = ["Search", "Social"]
        app = FastAPI()
        app.include_router(datasets.router, prefix="/datasets")
        joined_columns = {"sales.csv · channel", "ads.csv · campaign"}
        with patch.object(datasets, "get_user_id", return_value="owner"), patch.object(
            datasets, "get_workspace_id", return_value="workspace",
        ), patch.object(datasets, "_load_owned_dataset_dataframe", return_value=(joined, frame)), patch.object(
            dataset_loader, "load_dataset", side_effect=lambda db, identity: sources[identity][0],
        ), patch.object(dataset_loader, "load_dataframe_from_dataset", side_effect=lambda source, **_: sources[source.id][1]) as load:
            client = TestClient(app)
            path = "/datasets/21/dimensions"
            ordinary = client.get(path)
            self.assertEqual({item["column"] for item in ordinary.json()["columns"]}, joined_columns)
            load.assert_not_called()
            base = client.get(path, params={"group_metric": ""})
            self.assertEqual(base.status_code, 200, base.text)
            columns = {item["label"]: item["column"] for item in base.json()["columns"]}
            self.assertEqual(set(columns), {"sales.csv / country", "sales.csv / channel", "ads.csv / campaign", "ads.csv / channel"}
                             | {f"{column} (joined months)" for column in joined_columns})
            self.assertTrue(all("(joined months)" not in label for label in list(columns)[:4]))
            self.assertNotEqual(columns["sales.csv / channel"], columns["ads.csv / channel"])
            channel = columns["sales.csv / channel"]
            values = client.get(path, params={"group_metric": "", "column": channel})
            self.assertEqual(values.status_code, 200, values.text)
            self.assertEqual(values.json()["values"], ["Online", "Store"])
            grouped = client.post("/datasets/21/dashboard-groups", json=selection(
                metric=metric, date_column="period", aggregation="monthly", end_date="2026-03-31",
                filter={"column": channel, "values": values.json()["values"]},
            ).model_dump(mode="json"))
            self.assertEqual(grouped.status_code, 200, grouped.text)
            self.assertEqual(grouped.json()["dimension_label"], "sales.csv / channel")
            self.assertEqual([group["points"][0] for group in grouped.json()["series"]], [
                {"period": "2026-01-01", "amount": 15},
                {"period": "2026-01-01", "amount": 30},
            ])
            for selected_metric in (metric, "ads.csv · spend", "stale metric"):
                response = client.get(path, params={"group_metric": selected_metric})
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.json()["columns"], base.json()["columns"])
            for selected_metric, value in [(metric, "Store"), ("ads.csv · spend", "Social")]:
                legacy = client.get(path, params={"group_metric": selected_metric, "column": "channel"})
                self.assertEqual(legacy.status_code, 200, legacy.text)
                self.assertIn(value, legacy.json()["values"])
                self.assertIn("channel", {item["column"] for item in legacy.json()["columns"]})
            response = client.get(path, params={"group_metric": metric, "column": "ads.csv · campaign", "search": "spring"})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()["values"], ["Spring"])

    def test_joined_cross_source_groups_use_monthly_totals_once_and_skip_ambiguous_or_missing_months(self):
        joined, _, sources, metric = joined_fixture()
        sales, history = sources[17]
        ads, _ = sources[18]
        sources[17] = sales, pd.concat([history, pd.DataFrame({
            "date": ["2026-04-01"], "channel": ["Store"], "country": ["CA"], "revenue": [90],
        })], ignore_index=True)
        sources[18] = ads, pd.DataFrame({
            "date": ["2026-01-10", "2026-01-11", "2026-02-12", "2026-03-11", "2026-03-12", "2026-04-01", "2026-05-01"],
            "spend": [5, 7, 10, 15, 20, 21, 25], "campaign": ["Spring", "Spring", "Spring", "Spring", "Summer", None, "Autumn"],
        })
        config = json.loads(joined.source_config)
        config["join_definition"]["selections"][1]["metric_columns"] = ["spend"]
        joined.source_config = json.dumps(config)
        frame = pd.DataFrame(build_joined_dataset([(source, rows, {}) for source, rows in sources.values()],
                                                 config["join_definition"]["selections"])["rows"])
        self.assertNotIn("ads.csv · campaign", frame)
        app = FastAPI()
        app.include_router(datasets.router, prefix="/datasets")
        with patch.object(datasets, "get_user_id", return_value="owner"), patch.object(
            datasets, "get_workspace_id", return_value="workspace",
        ), patch.object(datasets, "_load_owned_dataset_dataframe", return_value=(joined, frame)), patch.object(
            dataset_loader, "load_dataset", side_effect=lambda db, identity: sources[identity][0],
        ), patch.object(dataset_loader, "load_dataframe_from_dataset", side_effect=lambda source, **_: sources[source.id][1]):
            client = TestClient(app)
            path = "/datasets/21/dimensions"
            catalog = client.get(path, params={"group_metric": ""})
            self.assertEqual(catalog.status_code, 200, catalog.text)
            column = next(item["column"] for item in catalog.json()["columns"] if item["label"] == "ads.csv / campaign")
            options = client.get(path, params={"group_metric": "", "column": column, "search": "spring"})
            self.assertEqual(options.status_code, 200, options.text)
            self.assertEqual(options.json()["values"], ["Spring"])
            query = selection(metric=metric, date_column="period", aggregation="monthly", end_date="2026-05-31",
                              filter={"column": column, "values": ["Spring", "Summer", None, "Autumn"]}).model_dump(mode="json")
            result = client.post("/datasets/21/dashboard-groups", json=query)
            self.assertEqual(result.status_code, 200, result.text)
            self.assertEqual(result.json()["dimension_label"], "ads.csv / campaign")
            self.assertEqual(result.json()["cross_source_months_omitted"], 2)
            self.assertEqual(result.json()["series"], [
                {"value": "Spring", "points": [{"period": "2026-01-01", "amount": 45}, {"period": "2026-02-01", "amount": 50}]},
                {"value": "Summer", "points": []},
                {"value": None, "points": []},
                {"value": "Autumn", "points": []},
            ])
            sales_channel = next(item["column"] for item in catalog.json()["columns"] if item["label"] == "sales.csv / channel")
            same_source = client.post("/datasets/21/dashboard-groups", json={
                **query, "filter": {"column": sales_channel, "values": ["Online"]},
            })
            self.assertEqual(same_source.status_code, 200, same_source.text)
            self.assertEqual(same_source.json()["series"], [
                {"value": "Online", "points": [{"period": "2026-01-01", "amount": 15}, {"period": "2026-02-01", "amount": 50}]},
            ])
            self.assertEqual(client.post("/datasets/21/dashboard-groups", json={
                **query, "filter": {"column": column.replace("_18_", "_19_"), "values": ["Spring"]},
            }).status_code, 422)

    def test_saved_joined_dimensions_group_monthly_values_without_reaggregating(self):
        joined, frame, _, metric = joined_fixture()
        config = json.loads(joined.source_config)
        config["join_definition"]["aggregation_type"] = "count"
        joined.source_config = json.dumps(config)
        frame[metric] = [2, 3]
        query = selection(
            metric=metric, date_column="period", aggregation="monthly", aggregation_type="count",
            end_date="2026-03-31", filter={"column": "ads.csv · campaign", "values": ["Spring", "Summer"]},
        )
        with patch.object(dataset_loader, "load_dataset") as load:
            result = dashboard_group_series_for_dataset(None, joined, frame, query)
            load.assert_not_called()
        self.assertEqual(result["series"], [
            {"value": "Spring", "points": [{"period": "2026-01-01", "amount": 2}]},
            {"value": "Summer", "points": [{"period": "2026-03-01", "amount": 3}]},
        ])
        self.assertEqual(result["metric_aggregation"], "Count")
