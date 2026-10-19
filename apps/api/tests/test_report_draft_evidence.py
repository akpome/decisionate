import json
import unittest
from unittest.mock import patch

from fastapi import HTTPException

from app.db.models import Dataset
from app.modules.decisions import router as decisions_router
from app.modules.decisions.activity_models import DecisionActivity
from app.modules.decisions.models import Decision, DecisionDuplicate
from app.modules.reports import router
from app.modules.reports.models import BusinessReport
from app.modules.reports.service import build_report
from tests.test_business_reports import definition, fixture
from tests import test_decision_metric_scope as scope_fixtures


class ReportDraftEvidenceTests(unittest.TestCase):
    def setUp(self):
        scope_fixtures.DecisionMetricOptionsRouteTests.setUp(self)
        self.client.app.include_router(router.router)

        def database():
            with self.Session() as db:
                yield db

        self.client.app.dependency_overrides[router.database] = database
        for target, name, value in (
            (router, "identity", lambda request: ("owner", "workspace")),
            (decisions_router, "require_decision_manager", lambda request: None),
        ):
            patcher = patch.object(target, name, value)
            patcher.start(); self.addCleanup(patcher.stop)
        snapshot = build_report(fixture(), definition())
        # A historical cache may contain more metrics than the saved selection.
        snapshot["metrics"].append({**snapshot["metrics"][0], "id": "1:clicks", "metric_key": "clicks"})
        with self.Session() as db:
            report = BusinessReport(workspace_id="workspace", user_id="owner", name="Selected report",
                                    definition=json.dumps(definition()), snapshot=json.dumps(snapshot))
            decision = Decision(clerk_user_id="owner", workspace_id="workspace", dataset_id=1,
                                title="Review joined dataset evidence", action="Review the joined metrics and agree on the next action.",
                                recommendation_context="Joined evidence from two datasets: every numeric column",
                                description="Original joined snapshot", notes="Keep my discussion", metric_column="clicks", status="planned")
            decision.evidence_dataset_ids = [1, 2]
            decision.evidence_metrics = scope_fixtures.evidence()
            db.add_all([report, decision]); db.commit()
            self.report_id, self.decision_id = report.id, decision.id

    def bind(self, identity=None, report_id=None):
        return self.client.post(f"/api/v2/business-reports/{report_id or self.report_id}/decision-drafts/{identity or self.decision_id}/evidence")

    def options(self):
        response = self.client.get(f"/decisions/{self.decision_id}/metric-options", headers={"X-User-Id": "owner", "X-Workspace-Id": "workspace"})
        self.assertEqual(response.status_code, 200, response.text)
        return [(item["dataset_id"], item["metric_column"]) for item in response.json()["metrics"]]

    def test_report_selection_is_persisted_on_the_same_draft_and_survives_reopening(self):
        self.assertEqual(self.options(), [(1, "spend"), (2, "orders")])
        self.load.reset_mock()
        response = self.bind()
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["decision_id"], self.decision_id)
        self.assertEqual(self.options(), [(1, "spend"), (2, "net_sales")])
        with self.Session() as db:
            for item in db.query(Dataset):
                item.source_config = '{"selected_metric_columns":[]}'
            db.commit()
        self.assertEqual(self.options(), [(1, "spend"), (2, "net_sales")])
        self.load.assert_not_called()
        with self.Session() as db:
            self.assertEqual(db.query(Decision).count(), 1)
            decision = db.get(Decision, self.decision_id)
            self.assertIsNone(decision.metric_column)
            self.assertIsNone(decision.outcome_dataset_id)
            self.assertEqual(decision.title, "Review joined dataset evidence")
            self.assertEqual(decision.description, "Original joined snapshot")
            self.assertEqual(decision.notes, "Keep my discussion")
            context = json.loads(decision.recommendation_context)
            self.assertEqual([item["metric_key"] for item in context["metrics"]], ["spend", "net_sales"])
            self.assertEqual(len(context["original_evidence"]["evidence_metrics"]), 6)
            self.assertEqual(context["original_evidence"]["metric_column"], "clicks")
            self.assertEqual(context["original_evidence"]["recommendation_context"], "Joined evidence from two datasets: every numeric column")
            self.assertEqual(db.query(DecisionActivity).count(), 1)

    def test_matching_outcome_is_preserved_and_repeat_open_is_idempotent(self):
        with self.Session() as db:
            item = db.get(Decision, self.decision_id)
            item.metric_column, item.outcome_dataset_id = "net_sales", 2
            db.commit()
        for _ in range(3):
            self.assertEqual(self.bind().status_code, 200)
        with self.Session() as db:
            item = db.get(Decision, self.decision_id)
            self.assertEqual((item.outcome_dataset_id, item.metric_column), (2, "net_sales"))
            self.assertEqual(db.query(DecisionActivity).count(), 1)
            self.assertEqual(db.query(Decision).count(), 1)

    def test_report_metrics_are_restored_when_the_legacy_draft_has_no_metric_cache(self):
        with self.Session() as db:
            item = db.get(Decision, self.decision_id)
            item.evidence_metrics = []
            item.metric_column = "spend"
            db.commit()
        self.assertEqual(self.options(), [(1, "spend")])
        self.assertEqual(self.bind().status_code, 200)
        self.assertEqual(self.options(), [(1, "spend"), (2, "net_sales")])

    def test_other_workspace_report_is_not_authorized_even_for_an_accessible_draft(self):
        with self.Session() as db:
            db.get(BusinessReport, self.report_id).workspace_id = "another-workspace"
            db.commit()
        self.assertEqual(self.bind().status_code, 404)

    def test_limited_report_cannot_replace_a_drafts_evidence(self):
        with self.Session() as db:
            report = db.get(BusinessReport, self.report_id)
            snapshot = json.loads(report.snapshot)
            snapshot["status"] = "limited_coverage"
            report.snapshot = json.dumps(snapshot)
            db.commit()
        self.assertEqual(self.bind().status_code, 400)

    def test_duplicate_alias_updates_only_the_canonical_draft(self):
        with self.Session() as db:
            duplicate = Decision(clerk_user_id="owner", workspace_id="workspace", dataset_id=1, title="Old alias")
            db.add(duplicate); db.flush()
            alias_id = duplicate.id
            db.add(DecisionDuplicate(duplicate_id=alias_id, canonical_id=self.decision_id)); db.commit()
        response = self.bind(identity=alias_id)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["decision_id"], self.decision_id)
        self.assertEqual(self.options(), [(1, "spend"), (2, "net_sales")])
        with self.Session() as db:
            self.assertIsNone(db.get(Decision, alias_id).recommendation_context)
            self.assertEqual(db.query(Decision).count(), 2)

    def test_recorded_work_and_archived_decisions_are_never_rewritten(self):
        for fields in ({"action": "Pause campaign B"}, {"status": "archived"}, {"status": "active"},
                       {"actual_outcome": "Improved"}, {"outcome_status": "success"}, {"lessons_learned": "Keep testing"},
                       {"outcome_baseline_value": 0}, {"outcome_measured_value": 0}, {"outcome_delta_percent": 0}):
            with self.subTest(fields=fields):
                with self.Session() as db:
                    item = db.get(Decision, self.decision_id)
                    original = {name: getattr(item, name) for name in fields}
                    for name, value in fields.items():
                        setattr(item, name, value)
                    db.commit()
                self.assertIn(self.bind().status_code, {400, 409})
                with self.Session() as db:
                    item = db.get(Decision, self.decision_id)
                    self.assertEqual(item.recommendation_context, "Joined evidence from two datasets: every numeric column")
                    for name, value in original.items():
                        setattr(item, name, value)
                    db.commit()

    def test_unrelated_sources_and_other_workspaces_are_rejected(self):
        with self.Session() as db:
            item = db.get(Decision, self.decision_id)
            item.evidence_dataset_ids = [1]
            db.commit()
        self.assertEqual(self.bind().status_code, 409)
        with self.Session() as db:
            item = db.get(Decision, self.decision_id)
            item.evidence_dataset_ids = [1, 2]
            item.workspace_id = "another-workspace"
            db.commit()
        self.assertEqual(self.bind().status_code, 404)

    def test_read_only_clients_cannot_bind_evidence(self):
        with patch.object(decisions_router, "require_decision_manager", side_effect=HTTPException(403, "Read only")):
            self.assertEqual(self.bind().status_code, 403)
        with self.Session() as db:
            self.assertEqual(db.query(DecisionActivity).count(), 0)

    def test_unavailable_saved_metric_fails_without_using_the_wide_cache(self):
        with self.Session() as db:
            report = db.get(BusinessReport, self.report_id)
            snapshot = json.loads(report.snapshot)
            snapshot["definition"]["metrics"][1]["metric_key"] = "missing"
            report.snapshot = json.dumps(snapshot)
            db.commit()
        self.assertEqual(self.bind().status_code, 400)
        with self.Session() as db:
            self.assertEqual(db.query(DecisionActivity).count(), 0)


if __name__ == "__main__":
    unittest.main()
