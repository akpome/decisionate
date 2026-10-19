import ast
from datetime import datetime
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.database import Base
from app.db.models import Dataset
from app.modules.ai.schemas import AIAnalysis
from app.modules.decisions import router
from app.modules.decisions.activity_models import DecisionActivity
from app.modules.decisions.duplicates import canonical_decisions, reconcile_duplicate_decisions
from app.modules.decisions.models import Decision, DecisionCreationRequest, DecisionDuplicate
from app.modules.reports import router as reports
from app.modules.reports.models import BusinessReport


class DecisionDuplicateTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
        self.addCleanup(self.engine.dispose)
        with self.engine.connect() as connection:
            connection.execute(text("PRAGMA foreign_keys=ON"))
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine)
        for target, name, value in (
            (router, "SessionLocal", self.Session), (router, "get_active_user_id", lambda user: user),
            (router, "get_active_workspace_id", lambda user, workspace: workspace),
            (router, "require_decision_owner_or_workspace_owner", lambda *args: None),
            (router, "get_auth_context", lambda request: SimpleNamespace(workspace_role="owner")),
            (reports, "identity", lambda request: ("owner", "workspace")),
            (reports, "authorize_datasets", lambda *args: {}),
        ):
            stub = patch.object(target, name, value)
            stub.start(); self.addCleanup(stub.stop)
        app = FastAPI()
        app.include_router(router.router)
        app.include_router(reports.router)
        app.dependency_overrides[router.require_decision_manager] = lambda: None

        def database():
            with self.Session() as db:
                yield db

        app.dependency_overrides[reports.database] = database
        self.client = TestClient(app)
        self.addCleanup(self.client.close)
        self.headers = {"X-User-Id": "owner", "X-Workspace-Id": "workspace"}

    def record(self, db, **changes):
        item = Decision(**{
            "clerk_user_id": "owner", "workspace_id": "workspace", "dataset_id": 1,
            "title": "Shift campaign budget", "action": "Move 10% of budget to campaign B",
            "expected_outcome": "Increase orders without additional spend", "review_date": datetime(2026, 11, 1),
            "recommendation_context": '{"report_id":"report-1"}',
            "evidence_dataset_ids_json": "[1,2]", "status": "planned", **changes,
        })
        db.add(item); db.flush()
        db.add(DecisionActivity(decision_id=item.id, workspace_id=item.workspace_id,
            actor_user_id="owner", activity_type="created", decision_title=item.title, message="Decision created"))
        db.flush()
        return item

    def repair(self):
        with self.engine.begin() as connection:
            reconcile_duplicate_decisions(connection)

    def seed_pair(self):
        with self.Session() as db:
            first = self.record(db, creation_request_key="first", creation_payload_hash="payload")
            second = self.record(db, creation_request_key="second", creation_payload_hash="payload")
            snapshot = {"definition": {"metrics": [{"dataset_id": 1}, {"dataset_id": 2}]}}
            db.add(BusinessReport(id="report-1", workspace_id="workspace", user_id="owner", name="Campaign report",
                definition=json.dumps(snapshot["definition"]), snapshot=json.dumps(snapshot)))
            db.commit()
            return first.id, second.id

    def seed_legacy_pair(self):
        context = (
            "Joined evidence from 2 datasets on normalized month-year periods using sum aggregation. "
            "Shared periods: 12 of 12 available (100.0%). Columns: marketing-demo.csv / ad_spend, "
            "revenue-demo.csv / revenue. Latest shared period (2026-12-01): "
            "marketing-demo.csv / ad_spend: 5800.0; revenue-demo.csv / revenue: 30100.0."
        )
        evidence = [{"dataset_id": identity, "file_name": name, "metric_column": metric, "label": metric, "column_type": "numeric"}
                    for identity, name, metric in ((1, "marketing-demo.csv", "ad_spend"), (2, "revenue-demo.csv", "revenue"))]
        shared = {
            "action": "Review the joined metrics and agree on the next action.", "review_date": None,
            "recommendation_text": "Review the joined metrics and agree on the next action.",
            "recommendation_source": "rules", "recommendation_context": context,
            "description": "\n\n".join((context, "Latest shared period: 2026-12-01.",
                "Latest evidence: marketing-demo.csv / ad_spend: 5,800; revenue-demo.csv / revenue: 30,100.",
                "Select an outcome metric in Decision Details only if this decision needs numeric outcome measurement.")),
            "expected_outcome": "Agree on an action based on the joined evidence and measure the result by the review date.",
            "evidence_metrics_json": json.dumps(evidence),
        }
        with self.Session() as db:
            for identity, name in ((1, "marketing-demo.csv"), (2, "revenue-demo.csv")):
                db.add(Dataset(id=identity, user_id="owner", workspace_id="workspace", file_name=name,
                    source_type="csv", source_config="{}", file_path="unused.csv", row_count=12, column_count=5))
            old = self.record(db, id=3, title="Review joined evidence: marketing-demo.csv + revenue-demo.csv", **shared)
            selected = self.record(db, id=4, title="Review joined dataset evidence", metric_column="ad_spend", **shared)
            definition = {"metrics": [{"dataset_id": 1, "metric_key": "ad_spend"}, {"dataset_id": 2, "metric_key": "revenue"}]}
            db.add(BusinessReport(id="report-1", workspace_id="workspace", user_id="owner", name="Campaign report",
                definition=json.dumps(definition), snapshot=json.dumps({"definition": definition})))
            db.commit()
            return old.id, selected.id

    def test_screenshot_title_variants_keep_one_draft_and_preserve_its_ad_spend_selection(self):
        old, selected = self.seed_legacy_pair()
        self.repair(); self.repair()
        portfolio = self.client.get("/decisions/", headers=self.headers).json()
        self.assertEqual([item["id"] for item in portfolio], [selected])
        self.assertEqual(portfolio[0]["metric_column"], "ad_spend")
        report = self.client.get("/api/v2/business-reports/report-1", headers=self.headers).json()
        self.assertEqual(report["decisions"], [])
        self.assertEqual([item["id"] for item in report["decision_drafts"]], [selected])
        for identity in (old, selected):
            detail = self.client.get(f"/decisions/{identity}", headers=self.headers).json()
            self.assertEqual(detail["id"], selected)
            self.assertEqual(detail["metric_column"], "ad_spend")
        options = self.client.get(f"/decisions/{old}/metric-options", headers=self.headers)
        self.assertEqual(options.status_code, 200, options.text)
        self.assertEqual(options.json()["decision_id"], selected)
        self.assertEqual([item["metric_column"] for item in options.json()["metrics"]], ["ad_spend"])
        with self.Session() as db:
            self.assertEqual(db.query(Decision).count(), 2)
            self.assertEqual(db.get(DecisionDuplicate, old).canonical_id, selected)
            self.assertIsNone(db.get(Decision, old).metric_column)
            self.assertEqual(db.get(Decision, old).title, "Review joined evidence: marketing-demo.csv + revenue-demo.csv")
            self.assertEqual({item.decision_id for item in db.query(DecisionActivity)}, {selected})

    def test_legacy_repair_preserves_real_actions_manual_work_and_different_evidence(self):
        for changes in (
            {"action": "Move 10% of budget to campaign B"}, {"notes": "Check customer mix first"},
            {"actual_outcome": "Orders increased"}, {"outcome_baseline_value": 0}, {"review_date": datetime(2026, 11, 1)},
            {"lessons_learned": "This action worked"}, {"assigned_user_id": "colleague"},
            {"recommendation_context": "A different joined history"}, {"description": "My own reasoning"},
            {"evidence_dataset_ids_json": "[1,2,9]"}, {"evidence_metrics_json": "[]"},
            {"workspace_id": "another-workspace"}, {"clerk_user_id": "another-owner"},
            {"status": "in_progress"}, {"status": "archived"},
        ):
            with self.subTest(changes=changes):
                self.seed_legacy_pair()
                with self.Session() as db:
                    item = db.get(Decision, 4)
                    for name, value in changes.items():
                        setattr(item, name, value)
                    db.commit()
                self.repair()
                with self.Session() as db:
                    self.assertEqual(db.query(DecisionDuplicate).count(), 0)
                    db.query(DecisionActivity).delete()
                    db.query(Decision).delete()
                    db.query(Dataset).delete()
                    db.query(BusinessReport).delete()
                    db.commit()

    def test_conflicting_nonempty_legacy_outcome_choices_are_not_discarded(self):
        self.seed_legacy_pair()
        with self.Session() as db:
            db.get(Decision, 3).metric_column = "revenue"
            db.get(Decision, 3).outcome_dataset_id = 2
            db.commit()
        self.repair()
        with self.Session() as db:
            self.assertEqual(db.query(DecisionDuplicate).count(), 0)
            self.assertEqual(db.get(Decision, 3).metric_column, "revenue")
            self.assertEqual(db.get(Decision, 4).metric_column, "ad_spend")

    def test_existing_pair_is_one_record_in_both_report_and_portfolio_without_deleting_history(self):
        first, second = self.seed_pair()
        self.assertEqual(len(self.client.get("/decisions/", headers=self.headers).json()), 2)
        self.repair(); self.repair()
        portfolio = self.client.get("/decisions/", headers=self.headers)
        report = self.client.get("/api/v2/business-reports/report-1", headers=self.headers)
        self.assertEqual(portfolio.status_code, 200, portfolio.text)
        self.assertEqual(report.status_code, 200, report.text)
        self.assertEqual([item["id"] for item in portfolio.json()], [first])
        self.assertEqual([item["id"] for item in report.json()["decisions"]], [first])
        with self.Session() as db:
            self.assertEqual(db.query(Decision).count(), 2)
            self.assertEqual(db.query(DecisionDuplicate).count(), 1)
            self.assertEqual(db.get(DecisionDuplicate, second).canonical_id, first)
            self.assertEqual(db.query(DecisionActivity).count(), 2)
            self.assertEqual({item.decision_id for item in db.query(DecisionActivity)}, {first})
        self.assertEqual(len(self.client.get(f"/decisions/{second}/activities", headers=self.headers).json()), 2)

    def test_old_links_edit_the_original_and_archiving_does_not_reveal_the_duplicate(self):
        first, second = self.seed_pair()
        self.repair()
        response = self.client.patch(f"/decisions/{second}/details", headers=self.headers, json={"action": "Pause campaign B"})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["id"], first)
        self.assertEqual(self.client.get(f"/decisions/{second}", headers=self.headers).json()["action"], "Pause campaign B")
        response = self.client.patch(f"/decisions/{second}/archive", headers=self.headers)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.client.get("/decisions/?lifecycle=active", headers=self.headers).json(), [])
        archived = self.client.get("/decisions/?lifecycle=archived", headers=self.headers).json()
        self.assertEqual([item["id"] for item in archived], [first])
        self.repair()
        self.assertEqual(self.client.get("/decisions/?lifecycle=active", headers=self.headers).json(), [])

    def test_deleting_the_original_never_resurrects_its_old_duplicate(self):
        first, second = self.seed_pair()
        self.repair()
        with self.Session() as db:
            db.delete(db.get(Decision, first)); db.commit()
        self.repair()
        self.assertEqual(self.client.get("/decisions/", headers=self.headers).json(), [])
        self.assertEqual(self.client.get(f"/decisions/{second}", headers=self.headers).status_code, 410)
        with self.Session() as db:
            self.assertIsNone(db.get(DecisionDuplicate, second).canonical_id)

    def test_distinct_actions_evidence_owners_and_recorded_work_are_never_collapsed(self):
        with self.Session() as db:
            self.record(db)
            for changes in (
                {"title": "Different title"}, {"action": "Pause campaign B"}, {"notes": "A separate discussion"},
                {"actual_outcome": "Orders increased"}, {"lessons_learned": "Compare channel mix"},
                {"assigned_user_id": "colleague"}, {"clerk_user_id": "another-owner"}, {"workspace_id": "other"},
                {"recommendation_context": '{"report_id":"another-report"}'}, {"evidence_metrics_json": '[{"metric_column":"revenue"}]'},
                {"review_date": datetime(2026, 12, 1)}, {"status": "completed"}, {"status": "archived"},
            ):
                self.record(db, **changes)
            db.commit()
        self.repair()
        with self.Session() as db:
            self.assertEqual(db.query(DecisionDuplicate).count(), 0)

    def test_filtering_happens_before_pagination_and_counts_and_exports_use_the_same_records(self):
        first, _ = self.seed_pair()
        with self.Session() as db:
            other = self.record(db, action="Pause campaign B").id
            db.commit()
        self.repair()
        pages = [self.client.get(f"/decisions/?limit=1&offset={index}&sort=created_asc", headers=self.headers).json() for index in range(3)]
        self.assertEqual([[item["id"] for item in page] for page in pages], [[first], [other], []])
        exported = self.client.get("/decisions/export?format=json", headers=self.headers)
        self.assertEqual(exported.status_code, 200, exported.text)
        self.assertEqual({item["id"] for item in exported.json()}, {first, other})
        with patch.object(router, "generate_structured_analysis", return_value=AIAnalysis(
            source="rules", summary="Portfolio summary", recommendations=[], risks=[], confidence="low",
        ).model_dump()):
            summary = self.client.get("/decisions/summary", headers=self.headers)
        self.assertEqual(summary.status_code, 200, summary.text)
        self.assertEqual(summary.json()["total"], 2)
        self.assertEqual(summary.json()["active"], 2)
        self.assertEqual(summary.json()["by_status"], {"planned": 2})
        self.assertEqual(sum(summary.json()["by_created_month"].values()), 2)
        with self.Session() as db:
            self.assertEqual(router.get_decision_count_map(db, "owner", "workspace", Decision.status), {"planned": 2})
            self.assertEqual(sum(router.get_decision_month_count_map(db, "owner", "workspace").values()), 2)
            self.assertEqual(db.query(Decision).filter(canonical_decisions()).count(), 2)

    def test_request_aliases_and_further_reconciliation_follow_the_canonical_record(self):
        first, second = self.seed_pair()
        with self.Session() as db:
            db.add(DecisionCreationRequest(request_key="retry", payload_hash="payload", decision_id=second))
            db.commit()
        self.repair()
        with self.Session() as db:
            self.assertEqual(db.get(DecisionCreationRequest, "retry").decision_id, first)
            earlier = self.record(db, id=0, action="A different action")
            earlier.action = db.get(Decision, first).action
            db.commit()
        self.repair()
        with self.Session() as db:
            self.assertEqual(db.get(DecisionDuplicate, first).canonical_id, 0)
            self.assertEqual(db.get(DecisionDuplicate, second).canonical_id, 0)
            self.assertEqual({item.decision_id for item in db.query(DecisionActivity)}, {0})
            self.assertEqual(db.get(DecisionCreationRequest, "retry").decision_id, 0)

    def test_alias_resolution_rechecks_the_canonical_workspace(self):
        first, second = self.seed_pair()
        self.repair()
        with self.Session() as db:
            db.get(Decision, first).workspace_id = "other-workspace"
            db.commit()
        self.assertEqual(self.client.get(f"/decisions/{second}", headers=self.headers).status_code, 404)

    def test_a_failed_repair_rolls_back_aliases_and_history_changes_together(self):
        first, second = self.seed_pair()
        with self.assertRaises(RuntimeError):
            with self.engine.begin() as connection:
                reconcile_duplicate_decisions(connection)
                raise RuntimeError("Simulated migration failure")
        with self.Session() as db:
            self.assertEqual(db.query(DecisionDuplicate).count(), 0)
            self.assertEqual(db.query(Decision).count(), 2)
            self.assertEqual({item.decision_id for item in db.query(DecisionActivity)}, {first, second})

    def test_bootstrap_runs_the_shared_repair_inside_a_transaction(self):
        source = ast.parse((Path(__file__).parents[1] / "app/main.py").read_text())
        function = next(node for node in source.body if isinstance(node, ast.FunctionDef) and node.name == "ensure_canonical_decisions")
        namespace = {"engine": self.engine}
        exec(compile(ast.Module(body=[function], type_ignores=[]), "duplicate_bootstrap", "exec"), namespace)
        first, second = self.seed_pair()
        namespace[function.name]()
        namespace[function.name]()
        with self.Session() as db:
            self.assertEqual(db.get(DecisionDuplicate, second).canonical_id, first)
