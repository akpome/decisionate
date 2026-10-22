"""Real process/locking tests; use an isolated DECISIONATE_TEST_POSTGRES_URL."""

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest
from uuid import uuid4

import pandas as pd
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.db.database import Base
from app.db.models import Dataset, IngestionWorkerHeartbeat, utc_now
from app.modules.reports.jobs import WORKER_NAME, enqueue_report, save_completed_job
from app.modules.reports.models import BusinessReport, ReportAnalysisJob
from app.modules.reports.schemas import ReportDefinition


TEST_URL = os.getenv("DECISIONATE_TEST_POSTGRES_URL", "")
API_ROOT = Path(__file__).resolve().parents[1]


@unittest.skipUnless(TEST_URL, "An isolated PostgreSQL test database is required")
class AnalysisWorkerPostgresTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(TEST_URL)
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine)
        self.workspace = "usr_test_analysis_" + uuid4().hex
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        path = Path(self.directory.name) / "sales.csv"
        pd.DataFrame({"date": pd.date_range("2026-01-01", periods=120), "revenue": [100 + i % 14 for i in range(120)]}).to_csv(path, index=False)
        with self.sessions() as db:
            heartbeat = db.get(IngestionWorkerHeartbeat, WORKER_NAME)
            if heartbeat is None:
                heartbeat = IngestionWorkerHeartbeat(name=WORKER_NAME)
                db.add(heartbeat)
            heartbeat.last_seen_at = utc_now()
            dataset = Dataset(user_id=self.workspace, workspace_id=self.workspace, file_name="sales.csv", file_path=str(path),
                source_type="csv", source_config=json.dumps({"selected_metric_columns": ["revenue"]}), row_count=120, column_count=2)
            db.add(dataset); db.commit()
            self.dataset_id = dataset.id
        self.definition = ReportDefinition(scope="single", name="Worker process test", business_question="What changed in selected sales?",
            metrics=[{"dataset_id": self.dataset_id, "metric_key": "revenue", "date_column": "date", "aggregation": "sum"}],
            date_range={"start": "2026-04-20", "end": "2026-04-26"}, seasonal_business=True)
        self.environment = {**os.environ, "DATABASE_URL": TEST_URL, "APP_ENV": "development", "OBJECT_STORAGE_PROVIDER": "local",
            "PYTHONDONTWRITEBYTECODE": "1", "BILLING_ENFORCEMENT_ENABLED": "false", "MARKETING_ENABLED": "false", "MARKETING_SEND_ENABLED": "false"}

    def tearDown(self):
        with self.sessions() as db:
            for model in (ReportAnalysisJob, BusinessReport, Dataset):
                db.query(model).filter_by(workspace_id=self.workspace).delete(synchronize_session=False)
            db.commit()
        self.engine.dispose()

    def run_worker(self):
        result = subprocess.run([sys.executable, "-B", "scripts/run_analysis_worker.py", "--once"], cwd=API_ROOT,
            env=self.environment, capture_output=True, text=True, timeout=60)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_separate_supervised_process_completes_and_saves_without_api_computation(self):
        with self.sessions() as db:
            identity = enqueue_report(db, self.definition, self.workspace, self.workspace).id
        self.run_worker()
        with self.sessions() as db:
            job = db.get(ReportAnalysisJob, identity)
            self.assertEqual(job.status, "succeeded", job.error)
            self.assertEqual(job.attempts, 1)
            result = json.loads(job.result)
            self.assertEqual([item["metric_key"] for item in result["metrics"]], ["revenue"])
            self.assertTrue(result["anomaly_analysis"]["seasonal_business"])
            saved = save_completed_job(db, identity, self.workspace, self.workspace)
            again = save_completed_job(db, identity, self.workspace, self.workspace)
            self.assertEqual(saved["report_id"], again["report_id"])

    def test_duplicate_workers_cannot_consume_queue_or_steal_ingestion_lock(self):
        with self.engine.connect() as connection:
            connection.execute(text("SELECT pg_advisory_lock(59831, 4)")); connection.commit()
            try:
                result = subprocess.run([sys.executable, "-B", "scripts/run_analysis_worker.py", "--once"], cwd=API_ROOT,
                    env=self.environment, capture_output=True, text=True, timeout=45)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("Another analysis worker", result.stderr)
                self.assertTrue(connection.execute(text("SELECT pg_try_advisory_lock(59831, 1)")).scalar())
                connection.execute(text("SELECT pg_advisory_unlock(59831, 1)")); connection.commit()
            finally:
                connection.execute(text("SELECT pg_advisory_unlock(59831, 4)")); connection.commit()

    def test_concurrent_requests_and_saves_are_idempotent(self):
        barrier = threading.Barrier(2)
        identities, errors = [], []
        def enqueue():
            try:
                with self.sessions() as db:
                    barrier.wait(timeout=5)
                    identities.append(enqueue_report(db, self.definition, self.workspace, self.workspace, "same-request").id)
            except Exception as error:
                errors.append(error)
        threads = [threading.Thread(target=enqueue) for _ in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=10)
            self.assertFalse(thread.is_alive())
        self.assertFalse(errors, errors)
        self.assertEqual(len(set(identities)), 1)
        self.run_worker()
        barrier = threading.Barrier(2)
        saved = []
        def save():
            try:
                with self.sessions() as db:
                    barrier.wait(timeout=5)
                    saved.append(save_completed_job(db, identities[0], self.workspace, self.workspace)["report_id"])
            except Exception as error:
                errors.append(error)
        threads = [threading.Thread(target=save) for _ in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=10)
            self.assertFalse(thread.is_alive())
        self.assertFalse(errors, errors)
        self.assertEqual(len(set(saved)), 1)


if __name__ == "__main__":
    unittest.main()
