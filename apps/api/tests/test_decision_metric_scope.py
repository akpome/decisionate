import ast
import asyncio
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import pandas as pd
from fastapi import HTTPException

from app.db.models import Dataset
from app.modules.decisions import router
from app.modules.decisions.models import Decision
from app.modules.decisions.schemas import DecisionCreate
from app.modules.decisions.metric_scope import decision_metric_options, selected_report_metrics
from app.modules.reports import router as reports_router
from app.modules.reports.models import BusinessReport
from app.modules.reports.schemas import ReportDecision
from app.modules.datasets.services.metric_selection import get_effective_dataset_metric_columns
from app.modules.datasets.services.metrics import generate_metrics
from tests import test_decision_creation as creation
from tests.test_business_reports import fixture, definition
from app.modules.reports.service import build_report


def evidence():
    return [{"dataset_id": identity, "file_name": f"Source {identity}.csv", "metric_column": column,
             "label": column, "column_type": "numeric"}
            for identity, columns in ((1, ("spend", "clicks", "impressions")), (2, ("orders", "sales", "discounts")))
            for column in columns]


def report_context(references=None):
    return json.dumps({"evidence_kind": "business_report", "definition": {"metrics": references if references is not None else [
        {"dataset_id": 1, "metric_key": "spend"}, {"dataset_id": 2, "metric_key": "orders"},
    ]}})


class DecisionMetricScopeTests(unittest.TestCase):
    def setUp(self):
        self.datasets = {identity: SimpleNamespace(id=identity, file_name=f"Source {identity}.csv", source_type="csv",
                         source_config=json.dumps({"selected_metric_columns": [column]}))
                         for identity, column in ((1, "spend"), (2, "orders"))}
        self.frames = {1: pd.DataFrame({"date": ["2026-01-01", "2026-01-02"], "spend": [10, 20], "clicks": [1, 2], "impressions": [100, 200]}),
                       2: pd.DataFrame({"date": ["2026-01-01", "2026-01-02"], "orders": [2, 4], "sales": [50, 100], "discounts": [1, 2]})}
        self.load = Mock(side_effect=lambda dataset: self.frames[dataset.id])
        self.decision = SimpleNamespace(evidence_metrics=evidence(), recommendation_context="Joined evidence from two datasets",
                                        metric_column=None, outcome_dataset_id=None, dataset_id=1, evidence_dataset_ids=[1, 2])

    def options(self):
        return decision_metric_options(self.decision, self.datasets.__getitem__, self.load)

    def test_legacy_all_column_evidence_is_intersected_with_each_datasets_selection(self):
        before = json.dumps(self.decision.evidence_metrics)
        result = self.options()
        self.assertEqual([(item["dataset_id"], item["metric_column"]) for item in result], [(1, "spend"), (2, "orders")])
        self.assertEqual(json.dumps(self.decision.evidence_metrics), before)
        self.assertEqual(self.load.call_count, 2)

    def test_saved_report_selection_is_authoritative_without_loading_whole_datasets(self):
        self.decision.recommendation_context = report_context()
        self.datasets[1].source_config = '{"selected_metric_columns":["clicks","impressions"]}'
        result = self.options()
        self.assertEqual([item["metric_column"] for item in result], ["spend", "orders"])
        self.load.assert_not_called()

    def test_empty_report_selection_never_becomes_all_fields(self):
        self.decision.recommendation_context = report_context([])
        self.assertEqual(self.options(), [])
        self.load.assert_not_called()

    def test_missing_report_selection_fails_closed_instead_of_using_all_evidence(self):
        self.decision.recommendation_context = '{"evidence_kind":"business_report"}'
        self.assertEqual(self.options(), [])
        self.load.assert_not_called()

    def test_empty_dataset_selections_do_not_repopulate_defaults(self):
        for dataset in self.datasets.values():
            dataset.source_config = '{"selected_metric_columns":[]}'
        self.assertEqual(self.options(), [])
        self.load.assert_not_called()

    def test_missing_historical_selection_is_not_guessed_from_all_numeric_fields(self):
        for dataset in self.datasets.values():
            dataset.source_config = "{}"
        self.assertEqual(self.options(), [])
        self.decision.metric_column = "spend"
        self.assertEqual([item["metric_column"] for item in self.options()], ["spend"])
        self.load.assert_not_called()

    def test_manual_decision_keeps_its_selected_metric_without_a_dataset_wide_fallback(self):
        self.decision.evidence_metrics = []
        self.decision.metric_column = "orders"
        self.decision.outcome_dataset_id = 2
        self.assertEqual([(item["dataset_id"], item["metric_column"]) for item in self.options()], [(2, "orders")])
        self.load.assert_not_called()

    def test_no_metric_selected_is_not_all_metrics(self):
        self.decision.evidence_metrics = []
        self.assertEqual(self.options(), [])

    def test_repeated_and_dimension_fields_do_not_become_extra_outcome_options(self):
        self.decision.evidence_metrics += [evidence()[0], {**evidence()[0], "column_type": "categorical"}, None]
        self.assertEqual(len(self.options()), 2)

    def test_loading_failure_does_not_return_the_unfiltered_evidence(self):
        self.load.side_effect = HTTPException(503, "Dataset unavailable")
        with self.assertRaises(HTTPException):
            self.options()

    def test_identical_column_names_in_different_datasets_remain_distinct(self):
        self.decision.evidence_metrics = [{**item, "metric_column": "total"} for item in (evidence()[0], evidence()[3])]
        self.decision.recommendation_context = report_context([{"dataset_id": 2, "metric_key": "total"}])
        result = self.options()
        self.assertEqual([(item["dataset_id"], item["metric_column"]) for item in result], [(2, "total")])

    def test_other_dataset_metrics_are_not_added_even_if_cached_in_the_evidence(self):
        self.decision.evidence_dataset_ids = [1]
        self.assertEqual([item["metric_column"] for item in self.options()], ["spend"])

    def test_report_handoff_uses_definition_order_and_not_the_cached_full_metric_list(self):
        snapshot = {"definition": {"metrics": [{"dataset_id": 2, "metric_key": "orders"}, {"dataset_id": 1, "metric_key": "spend"}]},
                    "metrics": [{"dataset_id": item["dataset_id"], "metric_key": item["metric_column"]} for item in evidence()]}
        self.assertEqual([item["metric_key"] for item in selected_report_metrics(snapshot)], ["orders", "spend"])
        snapshot["definition"]["metrics"] = []
        self.assertEqual(selected_report_metrics(snapshot), [])
        snapshot["definition"]["metrics"] = [{"dataset_id": 1, "metric_key": "missing"}]
        with self.assertRaises(ValueError):
            selected_report_metrics(snapshot)

    def test_dataset_metrics_route_passes_selected_columns_even_if_the_frame_contains_extra_numbers(self):
        source = ast.parse((Path(__file__).parents[1] / "app/modules/datasets/router.py").read_text())
        function = next(node for node in source.body if isinstance(node, ast.FunctionDef) and node.name == "dataset_metrics")
        function.decorator_list = []
        namespace = {"Request": object, "SessionLocal": lambda: SimpleNamespace(close=lambda: None),
                     "get_user_id": lambda request: "owner", "get_workspace_id": lambda request, user: "workspace",
                     "_load_owned_dataset_dataframe": lambda *args: (self.datasets[1], self.frames[1]),
                     "connector_dataset_display_name": lambda dataset: dataset.file_name,
                     "generate_metrics": generate_metrics, "get_effective_dataset_metric_columns": get_effective_dataset_metric_columns}
        exec(compile(ast.Module(body=[function], type_ignores=[]), "dataset_metrics", "exec"), namespace)
        self.assertEqual([item["column"] for item in namespace[function.name](None, 1)["metrics"]], ["spend"])


class DecisionMetricOptionsRouteTests(unittest.TestCase):
    def create(self, **changes):
        return asyncio.run(router.create_decision(DecisionCreate(**creation.payload(**changes)), "owner", "workspace"))

    def options(self, identity, workspace="workspace"):
        return asyncio.run(router.get_decision_metric_options(identity, "owner", workspace))

    def setUp(self):
        creation.DecisionCreationTests.setUp(self)
        with self.Session() as db:
            db.get(Dataset, 1).source_config = '{"selected_metric_columns":["spend"]}'
            db.add(Dataset(id=2, user_id="owner", workspace_id="workspace", file_name="sales.csv", file_path="unused.csv",
                           source_type="csv", source_config='{"selected_metric_columns":["orders"]}', row_count=2, column_count=3))
            db.commit()
        frames = {1: pd.DataFrame({"spend": [10, 20], "clicks": [1, 2], "impressions": [100, 200]}),
                  2: pd.DataFrame({"orders": [1, 2], "sales": [25, 50], "discounts": [0, 1]})}
        patcher = patch.object(router, "load_dataframe_from_dataset", side_effect=lambda dataset: frames[dataset.id])
        self.load = patcher.start(); self.addCleanup(patcher.stop)

    def test_options_are_scoped_and_the_original_evidence_is_not_rewritten(self):
        identity = self.create(evidence_dataset_ids=[1, 2], evidence_metrics=evidence()).id
        result = self.options(identity)
        self.assertEqual([item["metric_column"] for item in result["metrics"]], ["spend", "orders"])
        with self.Session() as db:
            self.assertEqual(len(db.get(Decision, identity).evidence_metrics), 6)

    def test_report_options_are_pinned_to_the_selected_report_metrics(self):
        identity = self.create(evidence_dataset_ids=[1, 2], evidence_metrics=evidence(), recommendation_context=report_context()).id
        self.assertEqual(len(self.options(identity)["metrics"]), 2)
        self.load.assert_not_called()

    def test_another_workspace_cannot_read_the_decisions_metric_scope(self):
        identity = self.create().id
        with self.assertRaises(HTTPException) as error:
            self.options(identity, "other-workspace")
        self.assertEqual(error.exception.status_code, 404)
        self.load.assert_not_called()

    def test_metric_options_route_keeps_decision_and_workspace_identity_in_the_contract(self):
        operation = self.client.app.openapi()["paths"]["/decisions/{decision_id}/metric-options"]["get"]
        self.assertEqual({item["name"] for item in operation["parameters"]}, {"decision_id", "X-User-Id", "X-Workspace-Id"})


    def test_report_evidence_contains_only_the_definition_metrics_and_their_findings(self):
        snapshot = build_report(fixture(), definition())
        snapshot["metrics"].append({**snapshot["metrics"][0], "id": "1:clicks", "metric_key": "clicks", "label": "Clicks"})
        extra_finding = {**snapshot["findings"][0], "id": "extra-finding", "metric_a": snapshot["metrics"][-1]}
        snapshot["findings"].append(extra_finding)
        snapshot["included_findings"].append(extra_finding["id"])
        with self.Session() as db:
            report = BusinessReport(workspace_id="workspace", user_id="owner", name="Selected report", definition=json.dumps(definition()), snapshot=json.dumps(snapshot))
            db.add(report); db.commit(); report_id = report.id
            fields = {"title": "Shift campaign budget", "action": "Move 10% of budget to a controlled test", "reasoning": "Compare advertising and sales",
                      "expected_outcome": "Increase orders without additional spend", "outcome_metric": "2:net_sales", "review_date": "2026-05-01"}
            with patch.object(reports_router, "identity", return_value=("owner", "workspace")):
                payload = reports_router.decision_evidence(report_id, None, ReportDecision(**fields), db)["decision_payload"]
                self.assertEqual([item["metric_column"] for item in payload["evidence_metrics"]], ["spend", "net_sales"])
                context = json.loads(payload["recommendation_context"])
                self.assertEqual([item["metric_key"] for item in context["metrics"]], ["spend", "net_sales"])
                self.assertNotIn("extra-finding", [item["id"] for item in context["findings"]])
                fields["outcome_metric"] = "1:clicks"
                with self.assertRaises(HTTPException) as error:
                    reports_router.decision_evidence(report_id, None, ReportDecision(**fields), db)
                self.assertEqual(error.exception.status_code, 400)
            self.assertEqual(db.query(Decision).count(), 0)
            self.assertEqual(len(json.loads(db.get(BusinessReport, report_id).snapshot)["metrics"]), 3)


if __name__ == "__main__":
    unittest.main()
