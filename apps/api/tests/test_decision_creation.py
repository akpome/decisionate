import ast
from pathlib import Path
import unittest
from unittest.mock import Mock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.database import Base
from app.db.models import Dataset
from app.modules.decisions import router
from app.modules.decisions.activity_models import DecisionActivity
from app.modules.decisions.models import Decision, DecisionCreationRequest
from app.modules.decisions.creation import lock_decision_creation


def payload(**changes):
    return {
        "dataset_id": 1, "title": "Shift the campaign budget",
        "action": "Move 10% of campaign A's budget to campaign B for two weeks",
        "expected_outcome": "Increase orders without increasing the total budget",
        **changes,
    }


class DecisionCreationTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
        with self.engine.connect() as connection:
            connection.execute(text("PRAGMA foreign_keys=ON"))
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine)
        self.addCleanup(self.engine.dispose)
        with self.Session() as db:
            db.add(Dataset(id=1, user_id="owner", workspace_id="workspace", file_name="sales.csv",
                           file_path="unused.csv", source_type="csv", row_count=0, column_count=0))
            db.commit()
        for name, replacement in (
            ("SessionLocal", self.Session), ("get_active_user_id", lambda user: user),
            ("get_active_workspace_id", lambda user, workspace: workspace),
            ("get_accessible_dataset", lambda db, identity, user, workspace: db.get(Dataset, identity)),
        ):
            patcher = patch.object(router, name, replacement)
            patcher.start(); self.addCleanup(patcher.stop)
        app = FastAPI()
        app.include_router(router.router)
        app.dependency_overrides[router.require_decision_manager] = lambda: None
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def create(self, key="submission-1", body=None, **headers):
        return self.client.post("/decisions/", json=body or payload(), headers={
            "X-User-Id": "owner", "X-Workspace-Id": "workspace",
            **({"Idempotency-Key": key} if key is not None else {}), **headers,
        })

    def test_retries_create_one_record_and_one_activity_without_changing_the_title(self):
        first, retry = self.create(), self.create()
        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(retry.status_code, 200, retry.text)
        self.assertEqual(first.json()["id"], retry.json()["id"])
        self.assertEqual(first.json()["title"], payload()["title"])
        self.assertNotIn("creation_request_key", first.json())
        with self.Session() as db:
            self.assertEqual(db.query(Decision).count(), 1)
            self.assertEqual(db.query(DecisionActivity).count(), 1)

    def test_a_key_cannot_be_reused_for_a_different_action(self):
        self.create()
        response = self.create(body=payload(action="Pause campaign B"))
        self.assertEqual(response.status_code, 409, response.text)
        with self.Session() as db:
            self.assertEqual(db.query(Decision).count(), 1)
            self.assertEqual(db.query(Decision).one().action, payload()["action"])

    def test_reopened_form_with_a_new_key_reuses_the_identical_active_decision(self):
        first, second = self.create(), self.create(key="another-submission")
        self.assertEqual(first.json()["id"], second.json()["id"])
        with self.Session() as db:
            self.assertEqual(db.query(Decision).count(), 1)
            self.assertEqual(db.query(DecisionActivity).count(), 1)

    def test_different_actions_can_share_the_same_datasets_and_title(self):
        first = self.create()
        second = self.create(key="another-submission", body=payload(action="Pause campaign B for one week"))
        self.assertNotEqual(first.json()["id"], second.json()["id"])
        with self.Session() as db:
            self.assertEqual(db.query(Decision).count(), 2)

    def test_older_clients_without_a_request_key_do_not_create_duplicate_actions(self):
        first = self.create(key=None)
        second = self.create(key=None)
        third = self.create()
        self.assertEqual(first.json()["id"], second.json()["id"])
        self.assertEqual(first.json()["id"], third.json()["id"])
        with self.Session() as db:
            self.assertEqual(db.query(Decision).count(), 1)
            self.assertEqual(db.query(DecisionActivity).count(), 1)

    def test_preexisting_records_without_submission_metadata_are_reused_without_overwriting_notes(self):
        identity = self.create(key=None).json()["id"]
        with self.Session() as db:
            decision = db.get(Decision, identity)
            decision.notes = "Keep the original discussion"
            db.commit()
        response = self.create(key="new-browser-key")
        self.assertEqual(response.json()["id"], identity)
        with self.Session() as db:
            self.assertEqual(db.query(Decision).count(), 1)
            self.assertEqual(db.get(Decision, identity).notes, "Keep the original discussion")

    def test_a_new_request_key_is_remembered_even_when_it_reuses_an_existing_decision(self):
        identity = self.create().json()["id"]
        self.assertEqual(self.create(key="reopened-form").json()["id"], identity)
        with self.Session() as db:
            decision = db.get(Decision, identity)
            decision.title, decision.status = "An updated decision", "archived"
            db.commit()
        response = self.create(key="reopened-form")
        self.assertEqual(response.json()["id"], identity)
        self.assertEqual(response.json()["title"], "An updated decision")
        self.assertEqual(response.json()["status"], "archived")
        self.assertEqual(self.create(key="reopened-form", body=payload(action="A different action")).status_code, 409)
        with self.Session() as db:
            self.assertEqual(db.query(Decision).count(), 1)
            self.assertEqual(db.query(DecisionActivity).count(), 1)
            self.assertEqual(db.query(DecisionCreationRequest).count(), 1)

    def test_a_retried_alias_does_not_resurrect_a_deleted_decision(self):
        identity = self.create().json()["id"]
        self.create(key="reopened-form")
        with self.Session() as db:
            db.delete(db.get(Decision, identity))
            db.commit()
            self.assertIsNone(db.query(DecisionCreationRequest).one().decision_id)
        self.assertEqual(self.create(key="reopened-form").status_code, 410)
        with self.Session() as db:
            self.assertEqual(db.query(Decision).count(), 0)

    def test_changed_outcome_evidence_review_or_reasoning_remains_a_distinct_decision(self):
        identity = self.create().json()["id"]
        for index, changes in enumerate((
            {"expected_outcome": "Reduce acquisition costs"}, {"review_date": "2026-12-01T00:00:00"},
            {"metric_column": "orders"}, {"description": "Different reasoning"},
            {"recommendation_context": '{"report_id":"another-report"}'},
        )):
            response = self.create(key=f"different-{index}", body=payload(**changes))
            self.assertEqual(response.status_code, 200, response.text)
            self.assertNotEqual(response.json()["id"], identity)

    def test_equivalent_context_formatting_defaults_and_metric_order_do_not_create_copies(self):
        metrics = [{"dataset_id": 1, "file_name": "sales.csv", "metric_column": name, "label": name}
                   for name in ("orders", "revenue")]
        first = self.create(body=payload(evidence_metrics=metrics, recommendation_context='{"report_id":"r1","metrics":["orders","revenue"]}'))
        second = self.create(key="reopened-form", body=payload(
            evidence_metrics=list(reversed(metrics)), priority="medium", category="general",
            recommendation_context='{"metrics": ["orders", "revenue"], "report_id": "r1"}',
        ))
        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(second.status_code, 200, second.text)
        self.assertEqual(first.json()["id"], second.json()["id"])
        different = self.create(key="different-evidence", body=payload(
            evidence_metrics=metrics[:1], recommendation_context='{"report_id":"r1","metrics":["orders","revenue"]}',
        ))
        self.assertNotEqual(first.json()["id"], different.json()["id"])

    def test_completed_cancelled_and_archived_decisions_allow_a_deliberate_new_submission(self):
        for status in ("completed", "cancelled", "archived"):
            with self.Session() as db:
                db.query(Decision).delete()
                db.query(DecisionActivity).delete()
                db.commit()
            original = self.create().json()["id"]
            with self.Session() as db:
                db.get(Decision, original).status = status
                db.commit()
            fresh = self.create(key="new-action")
            self.assertNotEqual(fresh.json()["id"], original)
            self.assertEqual(self.create().json()["id"], original)

    def test_postgres_uses_a_stable_workspace_transaction_lock(self):
        db = Mock()
        db.get_bind.return_value.dialect.name = "postgresql"
        lock_decision_creation(db, "workspace")
        statement, parameters = db.execute.call_args.args
        self.assertEqual(str(statement), "SELECT pg_advisory_xact_lock(:key)")
        lock_decision_creation(db, "workspace")
        self.assertEqual(db.execute.call_args.args[1], parameters)
        lock_decision_creation(db, "another-workspace")
        self.assertNotEqual(db.execute.call_args.args[1], parameters)

    def test_submission_keys_are_scoped_to_the_user_and_workspace(self):
        self.create()
        for headers in ({"X-User-Id": "another-owner"}, {"X-Workspace-Id": "another-workspace"}):
            response = self.create(**headers)
            self.assertEqual(response.status_code, 200, response.text)
        with self.Session() as db:
            self.assertEqual(db.query(Decision).count(), 3)

    def test_replay_does_not_bypass_current_dataset_authorization(self):
        self.create()
        with patch.object(router, "get_accessible_dataset", return_value=None):
            self.assertEqual(self.create().status_code, 404)

    def test_a_lost_response_followed_by_an_update_or_archive_never_creates_a_copy(self):
        identity = self.create().json()["id"]
        with self.Session() as db:
            decision = db.get(Decision, identity)
            decision.title, decision.status = "Pause the campaign instead", "archived"
            db.commit()
        retry = self.create()
        self.assertEqual(retry.json()["id"], identity)
        self.assertEqual(retry.json()["status"], "archived")
        self.assertEqual(retry.json()["title"], "Pause the campaign instead")
        with self.Session() as db:
            self.assertEqual(db.query(Decision).count(), 1)

    def test_concurrent_unique_key_collision_returns_the_already_created_record(self):
        first = self.create().json()
        original = router.get_replayed_decision
        calls = []

        def race(db, submission):
            calls.append(submission)
            return None if len(calls) == 1 else original(db, submission)

        with patch.object(router, "get_replayed_decision", side_effect=race), \
             patch.object(router, "repeated_active_decision", return_value=None):
            retry = self.create()
        self.assertEqual(retry.status_code, 200, retry.text)
        self.assertEqual(retry.json()["id"], first["id"])
        self.assertEqual(len(calls), 2)
        with self.Session() as db:
            self.assertEqual(db.query(Decision).count(), 1)
            self.assertEqual(db.query(DecisionActivity).count(), 1)

    def test_optional_header_preserves_older_action_based_clients(self):
        self.assertEqual(self.create(key=None).status_code, 200)
        self.assertEqual(self.create(key="").status_code, 422)
        self.assertEqual(self.create(key="x" * 121).status_code, 422)

    def test_old_evidence_placeholders_cannot_be_created_as_real_decisions(self):
        for title in ("Review joined dataset evidence", "Review joined evidence: sales.csv + ads.csv", "Review generated insight"):
            for action in (None, title, "Review the joined metrics and agree on the next action."):
                response = self.create(body=payload(title=title, action=action))
                self.assertEqual(response.status_code, 400, response.text)
        with self.Session() as db:
            self.assertEqual(db.query(Decision).count(), 0)

    def test_deliberately_named_review_actions_are_preserved(self):
        response = self.create(body=payload(title="Review supplier contracts", action="Compare supplier renewal terms before signing"))
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["title"], "Review supplier contracts")


class DecisionCreationMigrationTests(unittest.TestCase):
    def test_existing_decisions_are_preserved_and_bootstrap_is_repeatable(self):
        engine = create_engine("sqlite://")
        self.addCleanup(engine.dispose)
        with engine.begin() as connection:
            connection.execute(text("CREATE TABLE decisions (id INTEGER PRIMARY KEY, title VARCHAR)"))
            connection.execute(text("INSERT INTO decisions VALUES (1, 'Keep the chosen action')"))
        Decision.__table__.create(engine, checkfirst=True)
        DecisionCreationRequest.__table__.create(engine, checkfirst=True)
        DecisionCreationRequest.__table__.create(engine, checkfirst=True)
        source = ast.parse((Path(__file__).parents[1] / "app/main.py").read_text())
        function = next(node for node in source.body if isinstance(node, ast.FunctionDef) and node.name == "ensure_decision_optional_columns")
        namespace = {"engine": engine, "text": text,
                     "get_table_columns": lambda connection, table: {item["name"] for item in inspect(connection).get_columns(table)}}
        exec(compile(ast.Module(body=[function], type_ignores=[]), "decision_migration", "exec"), namespace)
        namespace[function.name]()
        namespace[function.name]()
        with engine.connect() as connection:
            row = connection.execute(text("SELECT title, action, creation_request_key FROM decisions")).one()
            self.assertEqual(tuple(row), ("Keep the chosen action", "Keep the chosen action", None))
        self.assertTrue(any(index["name"] == "uq_decisions_creation_request_key" and index["unique"] for index in inspect(engine).get_indexes("decisions")))
        foreign_key = inspect(engine).get_foreign_keys("decision_creation_requests")[0]
        self.assertEqual(foreign_key["referred_table"], "decisions")
        self.assertEqual(foreign_key["options"]["ondelete"], "SET NULL")


if __name__ == "__main__":
    unittest.main()
