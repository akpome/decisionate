import unittest
from types import SimpleNamespace
from unittest.mock import patch

import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.modules.datasets import router as datasets
from app.modules.datasets.services.dashboard_groups import DashboardGroupRequest, dashboard_group_series
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

    def test_existing_shared_dashboard_never_exposes_private_comparison_values_or_targets(self):
        stored = SimpleNamespace(
            dashboard_preferences='{"17":{"groupComparison":{"filter":{"column":"channel","values":["Private"]},"metric":"revenue","targets":[200]}}}',
            dashboard_views='{"17":{"general-business":{"groupComparison":{"filter":{"column":"channel","values":["Private"]},"metric":"revenue","targets":[200]}}}}',
        )
        self.assertEqual(shared_view_settings(stored, 17, "general-business"), ({}, {}))

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
