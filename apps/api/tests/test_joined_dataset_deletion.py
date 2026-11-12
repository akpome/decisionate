import json
import unittest
from unittest.mock import patch

from fastapi import HTTPException, Request
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.database import Base
from app.db.models import DataIngestionJob, Dataset, DatasetAnalysis, DatasetJoinCache, UserPreference
from app.modules.auth_context import AuthContext
from app.modules.datasets import router


class JoinedDatasetDeletionTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine)
        self.request = Request({"type": "http", "headers": []})
        self.request.state._decisionate_auth_context = AuthContext("owner", "workspace", "owner")
        self.session_patch = patch.object(router, "SessionLocal", self.Session)
        self.session_patch.start()
        self.addCleanup(self.session_patch.stop)
        self.addCleanup(self.engine.dispose)
        self.removed = []

        def remove_file(reference):
            with self.Session() as db:
                self.assertIsNone(db.get(Dataset, 3), "Remove storage only after committing the dataset deletion")
            self.removed.append(reference)

        self.storage_patch = patch.object(router, "remove_dataset_file", side_effect=remove_file)
        self.storage_patch.start()
        self.addCleanup(self.storage_patch.stop)
        self.result = {"dataset_ids": [1, 2], "derived_dataset_id": 3}
        with self.Session() as db:
            for identity in range(1, 6):
                db.add(Dataset(id=identity, user_id="owner", workspace_id="other" if identity == 5 else "workspace",
                               source_type="csv" if identity < 3 else "joined", file_name=f"data-{identity}.parquet",
                               file_path=f"data-{identity}.parquet", row_count=2, column_count=2,
                               source_config=json.dumps({"derived_from_dataset_ids": [1, 2]}) if identity >= 3 else "{}"))
            db.add(DatasetAnalysis(dataset_id=3, user_id="owner", workspace_id="workspace", status="complete"))
            db.add(UserPreference(clerk_user_id="owner", workspace_id="workspace", selected_dataset_id=3,
                                  dashboard_dataset_ids=json.dumps({"business": 3, "sales": 1}),
                                  dashboard_preferences=json.dumps({"1": {"joinedDatasetResult": self.result}, "2": {"title": "Keep"}}),
                                  dashboard_views=json.dumps({"1": {"business": {"joinedDatasetResult": self.result}, "sales": {"title": "Keep"}}})))
            db.commit()

    def add_cache(self, user="owner", dashboard="business", derived_id=3, workspace="workspace"):
        with self.Session() as db:
            db.add(DatasetJoinCache(user_id=user, workspace_id=workspace, dashboard_key=dashboard,
                                    dataset_ids="[1,2]", definition="{}", source_fingerprint="test",
                                    result=json.dumps({**self.result, "derived_dataset_id": derived_id})))
            db.commit()

    def delete(self):
        return router.delete_dataset(self.request, 3)

    def reset_cache(self, dataset_id=1):
        return router.delete_dataset_join_cache(self.request, dataset_id=dataset_id, dashboard="general-business")

    def assert_removed(self):
        with self.Session() as db:
            self.assertIsNone(db.get(Dataset, 3))
            self.assertEqual([row.id for row in db.query(Dataset).order_by(Dataset.id)], [1, 2, 4, 5])
            self.assertEqual(db.query(DatasetAnalysis).count(), 0)
            preference = db.query(UserPreference).one()
            self.assertIsNone(preference.selected_dataset_id)
            self.assertEqual(json.loads(preference.dashboard_dataset_ids), {"sales": 1})
            self.assertEqual(json.loads(preference.dashboard_preferences), {"2": {"title": "Keep"}})
            self.assertEqual(json.loads(preference.dashboard_views), {"1": {"sales": {"title": "Keep"}}})
        self.assertEqual(self.removed, ["data-3.parquet"])

    def test_deletion_removes_joined_data_even_without_a_dashboard_cache(self):
        self.assertEqual(self.delete(), {"message": "Dataset deleted"})
        self.assert_removed()

    def test_shared_dashboard_and_user_caches_do_not_keep_a_reset_dataset_alive(self):
        self.add_cache()
        self.add_cache(dashboard="sales")
        self.add_cache(user="another-user")
        self.add_cache(user="unrelated-user", derived_id=4)
        self.add_cache(workspace="other", derived_id=5)
        self.delete()
        self.assert_removed()
        with self.Session() as db:
            self.assertEqual({json.loads(row.result)["derived_dataset_id"] for row in db.query(DatasetJoinCache)}, {4, 5})

    def test_read_only_and_cross_workspace_requests_cannot_delete_the_joined_dataset(self):
        for auth in (AuthContext("owner", "workspace", "read_only"), AuthContext("owner", "other", "owner")):
            with self.subTest(auth=auth):
                self.request.state._decisionate_auth_context = auth
                with self.assertRaises(HTTPException) as error:
                    self.delete()
                self.assertEqual(error.exception.status_code, 403)
                with self.Session() as db:
                    self.assertIsNotNone(db.get(Dataset, 3))
                self.assertEqual(self.removed, [])

    def test_an_active_import_preserves_the_joined_dataset_and_cache(self):
        self.add_cache()
        with self.Session() as db:
            db.add(DataIngestionJob(user_id="owner", workspace_id="workspace", job_type="file_upload", status="running", request_payload="{}"))
            db.commit()
        with self.assertRaises(HTTPException) as error:
            self.delete()
        self.assertEqual(error.exception.status_code, 409)
        with self.Session() as db:
            self.assertIsNotNone(db.get(Dataset, 3))
            self.assertEqual(db.query(DatasetJoinCache).count(), 1)
        self.assertEqual(self.removed, [])

    def test_cache_reset_deletes_the_join_and_all_shared_references(self):
        self.add_cache(dashboard="general-business")
        self.add_cache(dashboard="sales")
        self.add_cache(user="another-user")
        self.add_cache(user="unrelated-user", derived_id=4)
        self.assertEqual(self.reset_cache(), {"deleted": True, "deleted_dataset_id": 3})
        self.assert_removed()
        with self.Session() as db:
            self.assertEqual([json.loads(row.result)["derived_dataset_id"] for row in db.query(DatasetJoinCache)], [4])

    def test_cache_reset_for_a_different_source_does_not_delete_any_dataset(self):
        self.add_cache(dashboard="general-business")
        self.assertEqual(self.reset_cache(4), {"deleted": False, "deleted_dataset_id": None})
        with self.Session() as db:
            self.assertIsNotNone(db.get(Dataset, 3))
            self.assertEqual(db.query(DatasetJoinCache).count(), 1)
        self.assertEqual(self.removed, [])

    def test_read_only_cache_reset_is_denied(self):
        self.add_cache(dashboard="general-business")
        self.request.state._decisionate_auth_context = AuthContext("owner", "workspace", "read_only")
        with self.assertRaises(HTTPException) as error:
            self.reset_cache()
        self.assertEqual(error.exception.status_code, 403)
        self.assertEqual(self.removed, [])

    def test_busy_cache_reset_keeps_the_dataset_and_all_references(self):
        self.add_cache(dashboard="general-business")
        with self.Session() as db:
            db.add(DataIngestionJob(user_id="owner", workspace_id="workspace", job_type="file_upload", status="running", request_payload="{}"))
            db.commit()
        with self.assertRaises(HTTPException) as error:
            self.reset_cache()
        self.assertEqual(error.exception.status_code, 409)
        with self.Session() as db:
            self.assertIsNotNone(db.get(Dataset, 3))
            self.assertEqual(db.query(DatasetJoinCache).count(), 1)
        self.assertEqual(self.removed, [])


if __name__ == "__main__":
    unittest.main()
