import ast
from pathlib import Path
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.database import Base
from app.db.models import Dataset
from app.modules.decisions import router
from app.modules.decisions.activity_models import DecisionActivity
from app.modules.decisions.models import Decision


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

    def test_independent_submissions_can_share_the_same_datasets_and_title(self):
        first, second = self.create(), self.create(key="another-submission")
        self.assertNotEqual(first.json()["id"], second.json()["id"])
        with self.Session() as db:
            self.assertEqual(db.query(Decision).count(), 2)

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

        with patch.object(router, "get_replayed_decision", side_effect=race):
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


if __name__ == "__main__":
    unittest.main()
