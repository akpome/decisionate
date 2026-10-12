"""Marketing queue SQL checks on an isolated PostgreSQL test database."""

import os
import unittest
from datetime import timedelta
from unittest.mock import Mock, patch
from uuid import uuid4

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.schema import CreateSchema, DropSchema

from app.db.database import Base
from app.db.models import utc_now
from app.modules.marketing import worker
from app.modules.marketing.models import MarketingContact, MarketingEmail, MarketingJob


TEST_URL = os.getenv("DECISIONATE_TEST_POSTGRES_URL", "")


@unittest.skipUnless(TEST_URL, "An isolated PostgreSQL test database is required")
class MarketingQueuePostgresTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(TEST_URL)
        self.schema = f"test_marketing_{uuid4().hex}"
        self.addCleanup(self.engine.dispose)
        with self.engine.begin() as connection:
            connection.execute(CreateSchema(self.schema))
        self.addCleanup(self.drop_schema)
        self.isolated_engine = self.engine.execution_options(schema_translate_map={None: self.schema})
        Base.metadata.create_all(self.isolated_engine, tables=[
            MarketingContact.__table__, MarketingEmail.__table__, MarketingJob.__table__])
        self.sessions = sessionmaker(bind=self.isolated_engine, autoflush=False)
        for stub in (patch.object(worker, "SessionLocal", self.sessions),
                     patch.object(worker, "settings", return_value={"enabled": True}),
                     patch.object(worker, "ResendMarketing", return_value=Mock())):
            stub.start()
            self.addCleanup(stub.stop)

    def drop_schema(self):
        with self.engine.begin() as connection:
            connection.execute(DropSchema(self.schema, cascade=True))

    def test_priorities_skip_locked_jobs_and_preserve_future_retry_deadlines(self):
        now = utc_now()
        with self.sessions() as db:
            db.add_all([MarketingJob(dedupe_key=f"priority-{index}", job_type=kind, entity_id=str(index), next_attempt_at=due)
                for index, (kind, due) in enumerate([
                    ("workspace", now), ("contact", now), ("webhook", now),
                    ("contact", now), ("webhook", now + timedelta(hours=1))])])
            db.commit()
        processed = []
        with self.sessions() as locking, patch.object(worker, "process_job",
                side_effect=lambda db, job, provider: processed.append(job.dedupe_key)):
            locking.query(MarketingJob).filter_by(dedupe_key="priority-1").with_for_update().one()
            result = worker.process_batch(10)
            self.assertEqual(processed, ["priority-2", "priority-3", "priority-0"])
            self.assertEqual(result["processed"], 3)
            self.assertEqual(result["failed_count"], 0)
            locking.rollback()
        with self.sessions() as db:
            self.assertEqual({job.dedupe_key for job in db.query(MarketingJob).filter_by(status="queued")},
                             {"priority-1", "priority-4"})

    def test_sync_completes_covered_jobs_in_the_same_transaction(self):
        with self.sessions() as db:
            contact = MarketingContact(email="owner@example.test", revision=3, synced_revision=2)
            db.add(contact)
            db.flush()
            db.add_all([MarketingJob(dedupe_key=f"covered-{index}", job_type="contact", entity_id=str(contact.id), revision=revision)
                for index, revision in enumerate([2, 3, 4, None])])
            db.commit()

        def synchronized(db, contact, provider):
            contact.synced_revision = contact.revision
            db.flush()

        with self.sessions() as db, patch.object(worker, "sync_contact", side_effect=synchronized):
            job = db.query(MarketingJob).filter_by(dedupe_key="covered-0").one()
            worker.process_job(db, job, Mock())
            db.rollback()
        with self.sessions() as db:
            self.assertEqual(db.query(MarketingJob).filter_by(status="queued").count(), 4)
            self.assertEqual(db.query(MarketingContact).one().synced_revision, 2)
            job = db.query(MarketingJob).filter_by(dedupe_key="covered-0").one()
            with patch.object(worker, "sync_contact", side_effect=synchronized):
                worker.process_job(db, job, Mock())
            db.commit()
        with self.sessions() as db:
            states = {job.dedupe_key: job.status for job in db.query(MarketingJob)}
            self.assertEqual(states, {"covered-0": "succeeded", "covered-1": "succeeded",
                                      "covered-2": "queued", "covered-3": "queued"})
            self.assertEqual(db.query(MarketingContact).one().synced_revision, 3)
