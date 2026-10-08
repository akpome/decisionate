"""Queue integration tests. Set DECISIONATE_TEST_POSTGRES_URL to an empty test DB."""

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
from uuid import uuid4

from fastapi import BackgroundTasks, HTTPException
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.db.database import Base
from app.db.models import DataIngestionJob, Dataset, DataSourceConnection
from app.modules.datasets import router as routes
from app.modules.datasets.schemas import DataSourceConnectionSync


TEST_URL = os.getenv("DECISIONATE_TEST_POSTGRES_URL", "")
API_ROOT = Path(__file__).resolve().parents[1]


@unittest.skipUnless(TEST_URL, "An isolated PostgreSQL test database is required")
class DurableWorkerIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(TEST_URL)
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine)
        self.workspace = f"test-worker-{uuid4().hex}"
        self.environment = {
            **os.environ, "DATABASE_URL": TEST_URL, "APP_ENV": "development",
            "INGESTION_EXECUTION_MODE": "worker", "PYTHONDONTWRITEBYTECODE": "1",
            "OBJECT_STORAGE_PROVIDER": "local", "BILLING_ENFORCEMENT_ENABLED": "false",
        }

    def tearDown(self):
        with self.sessions() as db:
            for model in (DataIngestionJob, Dataset, DataSourceConnection):
                db.query(model).filter(model.workspace_id == self.workspace).delete(synchronize_session=False)
            db.commit()
        self.engine.dispose()

    def run_worker(self):
        result = subprocess.run(
            [sys.executable, "-B", "scripts/run_ingestion_worker.py", "--once"],
            cwd=API_ROOT, env=self.environment, capture_output=True, text=True, timeout=45,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_separate_worker_resumes_a_queued_file_import(self):
        with tempfile.TemporaryDirectory() as directory:
            file_path = Path(directory) / "data.csv"
            file_path.write_text("date,revenue\n2026-10-01,100\n2026-10-02,120\n")
            with self.sessions() as db:
                job = DataIngestionJob(
                    user_id=self.workspace, workspace_id=self.workspace, job_type="file_upload", status="queued",
                    request_payload=json.dumps({"file_path": str(file_path), "upload_filename": "data.csv", "source_config": {}}),
                )
                db.add(job)
                db.commit()
                job_id = job.id
            self.run_worker()
            with self.sessions() as db:
                job = db.get(DataIngestionJob, job_id)
                self.assertEqual(job.status, "succeeded", job.error_message)
                dataset = db.query(Dataset).filter(Dataset.workspace_id == self.workspace).one()
                self.assertEqual(dataset.row_count, 2)

    def test_restart_fails_interrupted_job_instead_of_leaving_it_running(self):
        with self.sessions() as db:
            job = DataIngestionJob(user_id=self.workspace, workspace_id=self.workspace, status="running")
            db.add(job)
            db.commit()
            job_id = job.id
        self.run_worker()
        with self.sessions() as db:
            self.assertEqual(db.get(DataIngestionJob, job_id).status, "failed")

    def test_second_worker_cannot_consume_the_same_queue(self):
        with self.engine.connect() as connection:
            self.assertTrue(connection.execute(text("SELECT pg_try_advisory_lock(59831, 1)")).scalar())
            connection.commit()
            try:
                result = subprocess.run(
                    [sys.executable, "-B", "scripts/run_ingestion_worker.py", "--once"],
                    cwd=API_ROOT, env=self.environment, capture_output=True, text=True, timeout=30,
                )
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("Another ingestion worker", result.stderr)
            finally:
                connection.execute(text("SELECT pg_advisory_unlock(59831, 1)"))
                connection.commit()

    def test_concurrent_sync_requests_create_only_one_active_job(self):
        with self.sessions() as db:
            connection = DataSourceConnection(
                user_id=self.workspace, workspace_id=self.workspace, source_type="hubspot", display_name="Test",
            )
            db.add(connection)
            db.commit()
            connection_id = connection.id
        barrier = threading.Barrier(2)
        outcomes = []

        def enqueue():
            with self.sessions() as db:
                connection = db.get(DataSourceConnection, connection_id)
                barrier.wait(timeout=5)
                try:
                    routes.enqueue_connector_ingestion_job(db, connection, DataSourceConnectionSync(), BackgroundTasks(), launch=False)
                    outcomes.append("queued")
                except HTTPException as error:
                    outcomes.append(error.status_code)

        threads = [threading.Thread(target=enqueue) for _ in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=10)
            self.assertFalse(thread.is_alive())
        self.assertCountEqual(outcomes, ["queued", 409])
