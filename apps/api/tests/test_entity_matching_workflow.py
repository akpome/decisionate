import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import pandas as pd
from fastapi import HTTPException
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from app.db.models import Dataset, CanonicalEntity, EntityIdentity
from app.modules.datasets import router
from app.modules.datasets.schemas import EntityMatchingRequest, EntityMatchingPreviewResponse
from tests import test_entity_history as fixtures


class EntityMatchingWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        for model in (Dataset, CanonicalEntity, EntityIdentity):
            model.__table__.create(self.engine)
        self.Session = sessionmaker(bind=self.engine)
        self.addCleanup(self.engine.dispose)
        self.frames = {item.id: frame for item, frame in fixtures.EntityHistoryTests().frames()}
        with self.Session() as db:
            db.add_all([Dataset(id=i, user_id="owner", workspace_id="owner", source_type="csv", source_config="{}",
                                file_name=f"source-{i}.csv", file_path=f"original-{i}", row_count=len(frame), column_count=len(frame.columns))
                        for i, frame in self.frames.items()])
            db.add(Dataset(id=3, user_id="owner", workspace_id="owner", source_type="entity_matching",
                           source_config=json.dumps({"entity_type": "customer", "derived_from_dataset_ids": [1, 2]}),
                           file_name="unified-customers.parquet", file_path="legacy", row_count=1, column_count=2))
            db.commit()
        self.outputs = []

        def persist(frame, workspace, kind):
            self.outputs.append(frame.copy())
            return f"linked-{len(self.outputs)}", "local", f"linked-{len(self.outputs)}"

        for target, replacement in (("SessionLocal", self.Session), ("get_user_id", lambda request: "owner"),
                                    ("get_workspace_id", lambda request, user: "owner"),
                                    ("require_workspace_data_manager", lambda request: None),
                                    ("load_dataframe_from_dataset", lambda dataset, **kwargs: self.frames[dataset.id]),
                                    ("persist_entity_matching_dataframe", persist), ("remove_dataset_file", lambda path: None)):
            patcher = patch.object(router, target, replacement)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.payload = EntityMatchingRequest(dataset_ids=[1, 2], entity_type="customer",
                                            key_columns={"1": ["email"], "2": ["email"]},
                                            metric_columns={"1": ["revenue"], "2": ["revenue"]}, date_columns={"1": "date", "2": "date"})

    def save(self, **changes):
        return router.run_entity_matching(SimpleNamespace(), self.payload.model_copy(update=changes))

    def test_metadata_defaults_dates_and_preview_does_not_write(self):
        metadata = router.get_entity_matching_metadata(SimpleNamespace(), [1, 2], "customer")
        self.assertEqual(metadata["datasets"][0]["default_date_column"], "date")
        preview = router.preview_entity_matching(SimpleNamespace(), self.payload)
        self.assertEqual(EntityMatchingPreviewResponse(**preview).matched_row_count, 4)
        with self.Session() as db:
            self.assertEqual(db.query(Dataset).count(), 3)
            self.assertEqual(db.query(CanonicalEntity).count(), 0)

    def test_save_and_rebuild_preserve_sources_legacy_and_reuse_current_output(self):
        first = self.save(include_summary=True)
        second = self.save()
        self.assertEqual(first["unified_dataset_id"], second["unified_dataset_id"])
        self.assertEqual(first["unified_dataset_row_count"], 5)
        self.assertEqual(len(first["summary"]), 1)
        self.assertEqual(second["summary"], [])
        with self.Session() as db:
            self.assertEqual(db.query(Dataset).count(), 4)
            self.assertEqual(db.get(Dataset, 3).file_path, "legacy")
            self.assertEqual(db.get(Dataset, 1).file_path, "original-1")
            self.assertEqual(db.get(Dataset, 1).source_config, "{}")
            self.assertEqual(db.query(EntityIdentity).count(), 4)
            self.assertEqual(db.query(CanonicalEntity).count(), 1)
            config = json.loads(db.get(Dataset, first["unified_dataset_id"]).source_config)
            self.assertEqual(config["entity_history"]["version"], 1)

    def test_save_as_new_does_not_hit_identity_unique_constraint(self):
        first = self.save()
        second = self.save(replace_existing=False)
        self.assertNotEqual(first["unified_dataset_id"], second["unified_dataset_id"])

    def test_canonical_entities_are_flushed_in_batches(self):
        for identity in self.frames:
            self.frames[identity] = pd.DataFrame({"email": [f"customer-{i}@example.test" for i in range(25)],
                                                "date": ["2025-01-01"] * 25, "revenue": range(25)})
        flushes = []
        def before_flush(session, context, instances):
            flushes.append(len(session.new))
        event.listen(self.Session, "before_flush", before_flush)
        self.addCleanup(event.remove, self.Session, "before_flush", before_flush)
        result = self.save()
        self.assertEqual(result["canonical_entity_count"], 25)
        self.assertEqual(len(flushes), 2)
        self.assertEqual(flushes, [25, 51])
        with self.Session() as db:
            self.assertEqual(db.query(EntityIdentity).count(), 50)
            self.assertEqual(db.query(CanonicalEntity).count(), 25)

    def test_large_matching_jobs_bound_pending_database_writes(self):
        for identity in self.frames:
            self.frames[identity] = pd.DataFrame({"email": [f"customer-{i}@example.test" for i in range(501)],
                                                "date": ["2025-01-01"] * 501, "revenue": range(501)})
        flushes = []
        def before_flush(session, context, instances):
            flushes.append(len(session.new))
        event.listen(self.Session, "before_flush", before_flush)
        self.addCleanup(event.remove, self.Session, "before_flush", before_flush)
        result = self.save()
        self.assertEqual(result["canonical_entity_count"], 501)
        self.assertEqual(flushes, [500, 1, 1000, 3])
        with self.Session() as db:
            self.assertEqual(db.query(EntityIdentity).count(), 1002)

    def test_deleting_legacy_summary_keeps_identities_used_by_linked_history(self):
        self.save()
        with self.Session() as db:
            legacy = db.get(Dataset, 3)
            router.cleanup_deleted_entity_matching_records(db, legacy)
            db.delete(legacy)
            db.commit()
            self.assertEqual(db.query(EntityIdentity).count(), 4)
            self.assertEqual(db.query(CanonicalEntity).count(), 1)

    def test_failed_storage_rolls_back_entities_and_keeps_prior_output(self):
        first = self.save()
        with patch.object(router, "persist_entity_matching_dataframe", side_effect=ValueError("Storage failed")):
            with self.assertRaises(HTTPException):
                self.save()
        with self.Session() as db:
            self.assertEqual(db.get(Dataset, first["unified_dataset_id"]).file_path, "linked-1")
            self.assertEqual(db.query(EntityIdentity).count(), 4)

    def test_access_check_precedes_reading_source_data(self):
        with self.Session() as db:
            db.get(Dataset, 2).workspace_id = "another-workspace"
            db.commit()
        with patch.object(router, "load_dataframe_from_dataset", side_effect=lambda dataset, **kwargs: self.frames[1] if dataset.id == 1 else self.fail("Unauthorized file read")):
            with self.assertRaises(HTTPException):
                self.save()

    def test_read_only_workspace_cannot_save(self):
        with patch.object(router, "require_workspace_data_manager", side_effect=HTTPException(403, "Read only")):
            with self.assertRaises(HTTPException) as error:
                self.save()
            self.assertEqual(error.exception.status_code, 403)


if __name__ == "__main__":
    unittest.main()
