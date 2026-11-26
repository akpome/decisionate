import json
import unittest
from unittest.mock import patch

from fastapi import HTTPException, Request
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.database import Base
from app.db.models import DataIngestionJob, Dataset, DataSourceConnection
from app.modules.auth_context import AuthContext
from app.modules.datasets import router


class DatasetDeletionDuringIngestionTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        self.addCleanup(engine.dispose)
        Base.metadata.create_all(engine)
        self.sessions = sessionmaker(bind=engine)
        self.enterContext(patch.object(router, "SessionLocal", self.sessions))
        self.remove_file = self.enterContext(patch.object(router, "remove_dataset_file"))
        self.request = Request({"type": "http", "headers": []})
        self.request.state._decisionate_auth_context = AuthContext("owner", "workspace", "owner")
        with self.sessions() as db:
            for identity, source, owner, workspace in [
                (1, "shopify", "owner", "workspace"),
                (2, "shopify", "owner", "workspace"),
                (3, "google_ads", "owner", "workspace"),
                (4, "shopify", "other", "other"),
                (5, "shopify", "owner", None),
            ]:
                db.add(DataSourceConnection(id=identity, source_type=source, user_id=owner,
                                            workspace_id=workspace, display_name=source))
            db.commit()

    def create_dataset(self, source, config=None, *, workspace="workspace"):
        with self.sessions() as db:
            dataset = Dataset(user_id="owner", workspace_id=workspace, source_type=source,
                              source_config=json.dumps(config or {}), file_name="saved.parquet",
                              file_path="saved.parquet", row_count=2, column_count=2)
            db.add(dataset)
            db.commit()
            return dataset.id

    def create_job(self, status, connection_id=None, *, job_type="connector_sync",
                   user="owner", workspace="workspace"):
        with self.sessions() as db:
            job = DataIngestionJob(user_id=user, workspace_id=workspace, connection_id=connection_id,
                                   status=status, job_type=job_type)
            db.add(job)
            db.commit()
            return job.id

    def assert_delete_succeeds(self, dataset_id):
        self.assertEqual(router.delete_dataset(self.request, dataset_id), {"message": "Dataset deleted"})
        with self.sessions() as db:
            self.assertIsNone(db.get(Dataset, dataset_id))

    def assert_delete_blocked(self, dataset_id):
        with self.assertRaises(HTTPException) as error:
            router.delete_dataset(self.request, dataset_id)
        self.assertEqual(error.exception.status_code, 409)
        self.assertIn("This dataset's connection", error.exception.detail)
        with self.sessions() as db:
            self.assertIsNotNone(db.get(Dataset, dataset_id))
        self.remove_file.assert_not_called()

    def test_uploads_and_connector_jobs_do_not_block_saved_file_deletion(self):
        upload = self.create_job("queued", job_type="file_upload")
        connector = self.create_job("running", 1)
        self.create_job("running", job_type="signed_url_import")
        for source in ("csv", "excel", "parquet", "json"):
            with self.subTest(source=source):
                self.assert_delete_succeeds(self.create_dataset(source))
        with self.sessions() as db:
            self.assertEqual(db.get(DataIngestionJob, upload).status, "queued")
            self.assertEqual(db.get(DataIngestionJob, connector).status, "running")

    def test_only_jobs_for_the_saved_connection_block_its_dataset(self):
        dataset_id = self.create_dataset("shopify", {"connection_id": 1})
        self.create_job("running", 2)
        self.create_job("queued", 3)
        self.create_job("running", 4, user="other", workspace="other")
        self.create_job("running", job_type="file_upload")
        self.create_job("succeeded", 1)
        self.assert_delete_succeeds(dataset_id)

    def test_queued_sync_and_running_analysis_protect_their_connector_dataset(self):
        dataset_id = self.create_dataset("shopify", {"connection_id": "1"})
        sync = self.create_job("queued", 1)
        self.assert_delete_blocked(dataset_id)
        with self.sessions() as db:
            db.get(DataIngestionJob, sync).status = "succeeded"
            db.commit()
        self.create_job("running", 1, job_type=router.CONNECTOR_ANALYSIS_JOB_TYPE)
        self.assert_delete_blocked(dataset_id)

    def test_old_connector_data_without_a_connection_id_is_still_protected(self):
        dataset_id = self.create_dataset("shopify", workspace=None)
        self.create_job("running", 5, workspace=None)
        self.assert_delete_blocked(dataset_id)

    def test_unknown_dataset_returns_not_found_even_if_an_import_is_active(self):
        self.create_job("running", 1)
        with self.assertRaises(HTTPException) as error:
            router.delete_dataset(self.request, 1234)
        self.assertEqual(error.exception.status_code, 404)
        self.remove_file.assert_not_called()
