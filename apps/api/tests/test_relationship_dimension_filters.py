import ast
import json
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pandas as pd
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.database import Base, get_table_columns
from app.db.models import Dataset, DatasetRelationship
from app.modules.datasets import router as routes
from app.modules.datasets.services.metric_selection import filter_dataframe_to_selected_metrics
from app.modules.datasets.services.relationships import relationship_definition_from_record
from app.modules.alerts import router as alerts


class RelationshipDimensionFilterTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine)
        self.addCleanup(self.engine.dispose)
        self.frames = {}
        with self.sessions() as db:
            for identity, metric in ((1, "spend"), (2, "revenue")):
                dataset = Dataset(id=identity, user_id="owner", workspace_id="workspace", file_name=f"Source {identity}.csv",
                                  file_path="unused.csv", source_type="csv", row_count=24, column_count=5,
                                  source_config=json.dumps({"selected_metric_columns": [metric]}))
                db.add(dataset)
                self.frames[identity] = pd.DataFrame({
                    "date": list(pd.date_range("2026-10-01", periods=12)) * 2,
                    metric: (list(range(1, 13)) + list(range(100, 112))) if identity == 1 else (list(range(2, 25, 2)) + list(range(500, 488, -1))),
                    "region": ["East"] * 12 + ["West"] * 12, "customer_id": [1] * 12 + [2] * 12, "internal_cost": list(range(24)),
                })
            db.commit()
        self.load = MagicMock(side_effect=lambda dataset, apply_metric_selection=True:
                              filter_dataframe_to_selected_metrics(dataset, self.frames[dataset.id]) if apply_metric_selection else self.frames[dataset.id].copy())
        for item in (patch.object(routes, "SessionLocal", self.sessions), patch.object(routes, "get_user_id", return_value="owner"),
                     patch.object(routes, "get_workspace_id", return_value="workspace"), patch.object(routes, "load_dataframe_from_dataset", self.load)):
            item.start(); self.addCleanup(item.stop)
        app = FastAPI(); app.include_router(routes.router, prefix="/datasets")
        self.client = TestClient(app)

    def payload(self, left="East", right="West"):
        return {"name": "Filtered campaign and revenue", "period": "daily", "aggregation": "sum", "method": "pearson",
                "lag_mode": "manual", "lag_periods": 0,
                "left": {"dataset_id": 1, "date_column": "date", "metric_column": "spend", "dimension_filter": {"column": "region", "values": [left]}},
                "right": {"dataset_id": 2, "date_column": "date", "metric_column": "revenue", "dimension_filter": {"column": "region", "values": [right]}}}

    def save(self, payload=None):
        payload = payload or self.payload()
        filtered = any(payload[side].get("dimension_filter") is not None for side in ("left", "right"))
        response = self.client.post("/datasets/relationships/filtered" if filtered else "/datasets/relationships", json=payload)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_preview_filters_each_source_before_grouping_and_keeps_source_unchanged(self):
        before = {identity: frame.copy(deep=True) for identity, frame in self.frames.items()}
        response = self.client.post("/datasets/relationships/preview/filtered", json=self.payload())
        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()
        self.assertEqual(result["matched_period_count"], 12)
        self.assertAlmostEqual(result["correlation"], -1)
        self.assertEqual(result["evidence"][0], {"period": "2026-10-01", "left_value": 1, "right_value": 500})
        for side in ("left", "right"):
            self.assertEqual(result[side]["dimension_filter"], self.payload()[side]["dimension_filter"])
        self.assertIn("region: East", result["decision_context"])
        self.assertIn("region: West", result["decision_context"])
        for identity in before:
            pd.testing.assert_frame_equal(self.frames[identity], before[identity])

    def test_saved_relationship_recalculates_with_identical_filters(self):
        saved = self.save()
        with self.sessions() as db:
            record = db.get(DatasetRelationship, saved["id"])
            self.assertEqual(json.loads(record.left_dimension_filter), self.payload()["left"]["dimension_filter"])
            self.assertEqual(json.loads(record.right_dimension_filter), self.payload()["right"]["dimension_filter"])
        response = self.client.get("/datasets/relationships")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()[0]["evidence"], saved["evidence"])
        self.assertEqual(response.json()[0]["left"], saved["left"])

    def test_numeric_id_filter_does_not_enable_unselected_measures(self):
        payload = self.payload()
        payload["left"]["dimension_filter"] = {"column": "customer_id", "values": ["1"]}
        response = self.client.post("/datasets/relationships/preview", json=payload)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["evidence"][0]["left_value"], 1)
        payload["left"]["metric_column"] = "internal_cost"
        response = self.client.post("/datasets/relationships/preview", json=payload)
        self.assertEqual(response.status_code, 400, response.text)

    def test_empty_unknown_or_nonmatching_filters_never_use_all_rows(self):
        for selection, status in [({"column": "region", "values": []}, 422), ({"column": "unknown", "values": ["East"]}, 400),
                                  ({"column": "spend", "values": ["1"]}, 400)]:
            with self.subTest(selection=selection):
                payload = self.payload(); payload["left"]["dimension_filter"] = selection
                response = self.client.post("/datasets/relationships/preview", json=payload)
                self.assertEqual(response.status_code, status, response.text)
        response = self.client.post("/datasets/relationships/preview", json=self.payload(left="No match"))
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["matched_period_count"], 0)
        self.assertIsNone(response.json()["correlation"])

    def test_authorization_precedes_reading_a_filtered_source(self):
        with self.sessions() as db:
            db.get(Dataset, 1).workspace_id = "other-workspace"; db.commit()
        response = self.client.post("/datasets/relationships/preview", json=self.payload())
        self.assertIn(response.status_code, (403, 404), response.text)
        self.load.assert_not_called()

    def test_invalid_saved_json_is_unavailable_not_an_unfiltered_calculation(self):
        saved = self.save()
        with self.sessions() as db:
            db.get(DatasetRelationship, saved["id"]).left_dimension_filter = "broken-json"; db.commit()
        self.load.reset_mock()
        response = self.client.get("/datasets/relationships")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()[0]["status"], "unavailable")
        self.assertEqual(response.json()[0]["evidence"], [])
        self.load.assert_not_called()

    def test_legacy_relationships_without_filters_still_use_all_rows(self):
        payload = self.payload()
        for side in ("left", "right"):
            payload[side].pop("dimension_filter")
        saved = self.save(payload)
        self.assertEqual(saved["evidence"][0]["left_value"], 101)
        self.assertEqual(saved["evidence"][0]["right_value"], 502)
        self.assertIsNone(saved["left"]["dimension_filter"])

    def test_scheduled_relationships_preserve_saved_filters(self):
        saved = self.save()
        with self.sessions() as db:
            datasets = db.query(Dataset).all()
            with patch.object(alerts, "complete_week", return_value={"start": "2026-10-12", "end": "2026-10-18"}), patch.object(
                alerts, "load_dataframe_from_dataset", self.load
            ):
                results = alerts.build_weekly_report_relationships(db, SimpleNamespace(relationship_focus=[saved["id"]]), datasets, "workspace")
        self.assertEqual(len(results), 1)
        self.assertAlmostEqual(results[0]["correlation"], saved["correlation"])
        self.assertIn("region: East", results[0]["decision_context"])
        self.assertIn("region: West", results[0]["decision_context"])

    def test_record_definition_preserves_missing_and_empty_tokens(self):
        payload = self.payload(); payload["left"]["dimension_filter"]["values"] = [None, "", "null"]
        saved = self.save(payload)
        with self.sessions() as db:
            result = relationship_definition_from_record(db.get(DatasetRelationship, saved["id"]))
        self.assertEqual(result["left"]["dimension_filter"]["values"], [None, "", "null"])

    def test_filtered_and_unfiltered_scheduled_monitors_do_not_share_a_filtered_cache(self):
        saved = self.save()
        legacy = self.payload()
        for side in ("left", "right"):
            legacy[side].pop("dimension_filter")
        other = self.save(legacy)
        with self.sessions() as db:
            with patch.object(alerts, "complete_week", return_value={"start": "2026-10-12", "end": "2026-10-18"}), patch.object(
                alerts, "load_dataframe_from_dataset", self.load
            ):
                results = alerts.build_weekly_report_relationships(db, SimpleNamespace(relationship_focus=[saved["id"], other["id"]]), db.query(Dataset).all(), "workspace")
        self.assertEqual(len(results), 2)
        self.assertAlmostEqual(results[0]["correlation"], -1)
        self.assertAlmostEqual(results[1]["correlation"], 1)


class RelationshipFilterMigrationTests(unittest.TestCase):
    def test_bootstrap_adds_nullable_filters_and_preserves_existing_rows_idempotently(self):
        engine = create_engine("sqlite://")
        self.addCleanup(engine.dispose)
        with engine.begin() as connection:
            connection.execute(text("CREATE TABLE dataset_relationships (id INTEGER PRIMARY KEY, name TEXT)"))
            connection.execute(text("INSERT INTO dataset_relationships (id, name) VALUES (1, 'Existing monitor')"))
        source = ast.parse(Path("app/main.py").read_text())
        declaration = next(node for node in source.body if isinstance(node, ast.FunctionDef) and node.name == "ensure_dataset_relationship_columns")
        scope = {"engine": engine, "get_table_columns": get_table_columns, "text": text}
        exec(compile(ast.Module(body=[declaration], type_ignores=[]), "relationship_migration", "exec"), scope)
        scope["ensure_dataset_relationship_columns"](); scope["ensure_dataset_relationship_columns"]()
        with engine.connect() as connection:
            row = connection.execute(text("SELECT name, lag_mode, left_dimension_filter, right_dimension_filter FROM dataset_relationships")).one()
        self.assertEqual(tuple(row), ("Existing monitor", "manual", None, None))
