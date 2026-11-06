"""Exercise file acceptance, queue ownership, parsing and persistence together."""

import asyncio
from contextlib import ExitStack
from io import BytesIO
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import pandas as pd
from fastapi import BackgroundTasks, HTTPException, UploadFile
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.database import Base
from app.db.models import DataIngestionJob, Dataset
from app.infrastructure.object_storage import ObjectStorage, ObjectStorageConfig
from app.infrastructure import ingestion_jobs, ingestion_worker
from app.modules.datasets import router as routes
from app.modules.datasets.services import file_loader


class FileUploadPathTests(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.directory = Path(self.stack.enter_context(tempfile.TemporaryDirectory()))
        self.engine = create_engine(f"sqlite:///{self.directory / 'test.db'}")
        self.addCleanup(self.engine.dispose)
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine)
        self.uploads = self.directory / "uploads"
        self.uploads.mkdir()
        self.storage = ObjectStorage(ObjectStorageConfig(
            provider="local", local_root=str(self.uploads), bucket="", endpoint_url="", access_key="", secret_key="", region="",
        ))
        for name, value in (
            ("get_user_id", "owner"), ("get_workspace_id", "workspace"),
            ("get_dataset_upload_dir", str(self.uploads)), ("durable_ingestion_enabled", True),
            ("ingestion_worker_ready", True), ("get_object_storage", self.storage),
        ):
            self.stack.enter_context(patch.object(routes, name, return_value=value))
        for name in ("require_workspace_data_manager", "require_workspace_connection_viewer"):
            self.stack.enter_context(patch.object(routes, name))
        self.stack.enter_context(patch.object(routes, "SessionLocal", self.sessions))
        self.stack.enter_context(patch.object(file_loader, "get_object_storage", return_value=self.storage))
        self.stack.enter_context(patch.object(ingestion_jobs, "get_object_storage", return_value=self.storage))
        self.stack.enter_context(patch.object(ingestion_worker, "SessionLocal", self.sessions))

    def use_remote_storage(self):
        objects = {}
        storage = ObjectStorage(ObjectStorageConfig(
            provider="s3", local_root=str(self.uploads), bucket="uploads", endpoint_url="", access_key="", secret_key="", region="",
        ))
        client = Mock()
        client.upload_file.side_effect = lambda path, bucket, key: objects.__setitem__((bucket, key), Path(path).read_bytes())
        client.download_file.side_effect = lambda bucket, key, path: Path(path).write_bytes(objects[(bucket, key)])
        client.delete_object.side_effect = lambda *, Bucket, Key: objects.pop((Bucket, Key), None)
        self.stack.enter_context(patch.object(storage, "_s3_client", return_value=client))
        for module in (routes, file_loader, ingestion_jobs):
            self.stack.enter_context(patch.object(module, "get_object_storage", return_value=storage))
        return storage, objects

    def upload(self, contents=b"date,revenue\n2026-11-04,10\n2026-11-05,20\n", filename="sales.csv"):
        return routes.upload_dataset(SimpleNamespace(), BackgroundTasks(), UploadFile(file=BytesIO(contents), filename=filename, size=len(contents)))

    def jobs(self):
        with self.sessions() as db:
            return db.query(DataIngestionJob).count()

    def test_acceptance_only_stages_the_file_and_worker_persists_it_later(self):
        with patch.object(routes, "load_dataset_file", wraps=routes.load_dataset_file) as load:
            queued = self.upload()
            load.assert_not_called()
        with self.sessions() as db:
            job = db.get(DataIngestionJob, queued["job_id"])
            self.assertEqual(job.status, "queued")
            staged = Path(json.loads(job.request_payload)["file_path"])
            self.assertTrue(staged.exists())
            self.assertEqual(db.query(Dataset).count(), 0)
        routes.run_file_ingestion_job(queued["job_id"])
        status = asyncio.run(routes.get_ingestion_job(SimpleNamespace(), queued["job_id"]))
        self.assertEqual(status["status"], "succeeded")
        self.assertEqual(status["result"]["row_count"], 2)
        self.assertFalse(staged.exists())
        with self.sessions() as db:
            saved = db.get(Dataset, status["result"]["id"])
            self.assertEqual(saved.workspace_id, "workspace")
            frame = pd.read_parquet(saved.file_path)
            self.assertEqual(frame.revenue.tolist(), [10, 20])

    def test_repeated_filenames_do_not_overwrite_existing_files(self):
        first, second = self.upload(), self.upload(b"date,revenue\n2026-11-05,90\n")
        for item in (first, second):
            routes.run_file_ingestion_job(item["job_id"])
        with self.sessions() as db:
            datasets = db.query(Dataset).order_by(Dataset.id).all()
            self.assertEqual(len(datasets), 2)
            self.assertNotEqual(datasets[0].file_path, datasets[1].file_path)
            self.assertEqual([pd.read_parquet(item.file_path).revenue.sum() for item in datasets], [30, 90])

    def test_missing_worker_rejects_import_without_leaving_a_file_or_queued_job(self):
        with patch.object(routes, "ingestion_worker_ready", return_value=False):
            with self.assertRaises(HTTPException) as error:
                self.upload()
        self.assertEqual(error.exception.status_code, 503)
        self.assertEqual(self.jobs(), 0)
        self.assertEqual(list(self.uploads.iterdir()), [])

    def test_database_session_failure_removes_the_staged_local_upload(self):
        with patch.object(routes, "SessionLocal", side_effect=RuntimeError("Database is unavailable")):
            with self.assertRaisesRegex(RuntimeError, "Database is unavailable"):
                self.upload()
        self.assertEqual(list(self.uploads.iterdir()), [])

    def test_remote_staging_failure_does_not_enqueue_a_broken_import(self):
        storage = SimpleNamespace(is_remote=True, put_file=Mock(side_effect=RuntimeError("Storage is unavailable")), delete=self.storage.delete)
        with patch.object(routes, "get_object_storage", return_value=storage):
            with self.assertRaisesRegex(RuntimeError, "Storage is unavailable"):
                self.upload()
        self.assertEqual(self.jobs(), 0)
        self.assertEqual(list(self.uploads.iterdir()), [])

    def test_remote_staging_is_removed_without_deleting_the_saved_dataset(self):
        storage, objects = self.use_remote_storage()
        queued = self.upload()
        self.assertEqual(list(self.uploads.iterdir()), [])
        self.assertEqual(len(objects), 1)
        routes.run_file_ingestion_job(queued["job_id"])
        ingestion_worker.cleanup_terminal_file_jobs()
        status = asyncio.run(routes.get_ingestion_job(SimpleNamespace(), queued["job_id"]))
        self.assertEqual(status["status"], "succeeded")
        self.assertEqual(list(self.uploads.iterdir()), [])
        self.assertEqual(len(objects), 1)
        with self.sessions() as db:
            dataset = db.get(Dataset, status["result"]["id"])
            self.assertEqual(dataset.storage_provider, "s3")
            reference = storage.reference_for_stored_value(dataset.file_path, dataset.storage_provider)
            with storage.materialize(reference) as path:
                self.assertEqual(pd.read_parquet(path).revenue.tolist(), [10, 20])

    def test_post_commit_confirmation_failure_does_not_delete_committed_data(self):
        for filename in ("sales.csv", "sales.parquet"):
            with self.subTest(filename=filename):
                contents = b"date,revenue\n2026-11-05,20\n"
                if filename.endswith("parquet"):
                    buffer = BytesIO()
                    pd.DataFrame({"date": ["2026-11-05"], "revenue": [20]}).to_parquet(buffer, index=False)
                    contents = buffer.getvalue()
                queued = self.upload(contents, filename)
                def failing_confirmation_session():
                    db = self.sessions()
                    refresh = db.refresh
                    def refresh_record(record, *args, **kwargs):
                        if isinstance(record, Dataset):
                            raise RuntimeError("Confirmation connection lost")
                        return refresh(record, *args, **kwargs)
                    db.refresh = refresh_record
                    return db
                with patch.object(routes, "SessionLocal", side_effect=failing_confirmation_session):
                    routes.run_file_ingestion_job(queued["job_id"])
                ingestion_worker.cleanup_terminal_file_jobs()
        with self.sessions() as db:
            datasets = db.query(Dataset).all()
            self.assertEqual(len(datasets), 2)
            for dataset in datasets:
                self.assertEqual(pd.read_parquet(dataset.file_path).revenue.tolist(), [20])

    def test_full_workspace_queue_rejects_cleanly_but_other_workspaces_are_isolated(self):
        with self.sessions() as db:
            db.add_all([DataIngestionJob(user_id="owner", workspace_id="workspace", job_type="file_upload", status="queued") for _ in range(5)])
            db.commit()
        with self.assertRaises(HTTPException) as error:
            self.upload()
        self.assertEqual(error.exception.status_code, 429)
        self.assertEqual(self.jobs(), 5)
        self.assertEqual(list(self.uploads.iterdir()), [])
        with patch.object(routes, "get_workspace_id", return_value="other-workspace"):
            self.assertEqual(self.upload()["status"], "queued")

    def test_unsupported_empty_and_malformed_files_never_create_usable_datasets(self):
        with self.assertRaises(HTTPException) as unsupported:
            self.upload(b"ZIP", "datasets.zip")
        self.assertEqual(unsupported.exception.status_code, 400)
        for contents in (b"", b'col\n"unterminated'):
            queued = self.upload(contents)
            routes.run_file_ingestion_job(queued["job_id"])
            status = asyncio.run(routes.get_ingestion_job(SimpleNamespace(), queued["job_id"]))
            self.assertEqual(status["status"], "failed")
            self.assertTrue(status["error_message"])
        with self.sessions() as db:
            self.assertEqual(db.query(Dataset).count(), 0)
        self.assertEqual(list(self.uploads.iterdir()), [])

    def test_oversized_and_interrupted_uploads_remove_partial_files(self):
        with patch.object(routes, "UPLOAD_MAX_BYTES", 3):
            with self.assertRaises(HTTPException) as error:
                self.upload()
        self.assertEqual(error.exception.status_code, 413)
        class Interrupted(BytesIO):
            def read(self, size=-1):
                if self.tell():
                    raise OSError("Transfer interrupted")
                return super().read(3)
        with self.assertRaisesRegex(OSError, "Transfer interrupted"):
            routes.upload_dataset(SimpleNamespace(), BackgroundTasks(), UploadFile(file=Interrupted(b"a\n1\n"), filename="sales.csv"))
        self.assertEqual(list(self.uploads.iterdir()), [])
        self.assertEqual(self.jobs(), 0)

    def test_supported_structured_formats_complete_the_same_background_path(self):
        frame = pd.DataFrame({"date": ["2026-11-04", "2026-11-05"], "revenue": [10, 20]})
        parquet = BytesIO()
        frame.to_parquet(parquet, index=False)
        for filename, contents in (
            ("sales.json", frame.to_json(orient="records").encode()),
            ("sales.jsonl", frame.to_json(orient="records", lines=True).encode()),
            ("sales.parquet", parquet.getvalue()),
        ):
            with self.subTest(filename=filename):
                queued = self.upload(contents, filename)
                routes.run_file_ingestion_job(queued["job_id"])
                ingestion_worker.cleanup_terminal_file_jobs()
                status = asyncio.run(routes.get_ingestion_job(SimpleNamespace(), queued["job_id"]))
                self.assertEqual(status["status"], "succeeded", status.get("error_message"))
                self.assertEqual(status["result"]["row_count"], 2)
                self.assertEqual(pd.read_parquet(status["result"]["file_path"]).revenue.tolist(), [10, 20])

    def test_job_status_cannot_be_read_from_a_different_workspace(self):
        queued = self.upload()
        with patch.object(routes, "get_workspace_id", return_value="other-workspace"):
            with self.assertRaises(HTTPException) as error:
                asyncio.run(routes.get_ingestion_job(SimpleNamespace(), queued["job_id"]))
        self.assertEqual(error.exception.status_code, 404)


if __name__ == "__main__":
    unittest.main()
