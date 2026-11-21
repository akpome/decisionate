import json
from datetime import datetime, timedelta
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.database import Base
from app.db.models import (
    DashboardShare, DataIngestionJob, DataSourceConnection, Dataset, ExpiredDatasetObject, Organization,
    OrganizationMember, WeeklyReportPreference, WorkspaceSubscription,
)
from app.infrastructure.object_storage import get_object_storage
from app.modules.datasets.services.dataset_loader import load_dataframe_from_dataset
from app.modules.datasets.services.retention import connector_retention_cutoff_date
from app.modules import workspace_record_retention as retention
from app.modules.decisions.activity_models import DecisionActivity
from app.modules.decisions.models import Decision
from app.modules.reports.models import BusinessReport, CurrentWeeklyReport, ReportShare
from app.modules.sharing_links import SharedLink


class WorkspaceRecordRetentionTests(unittest.TestCase):
    now = datetime(2026, 11, 21, 12)
    boundary = datetime(2023, 11, 21)
    expired = boundary - timedelta(seconds=1)

    def setUp(self):
        self.folder = Path(self.enterContext(TemporaryDirectory()))
        engine = create_engine("sqlite://")
        self.addCleanup(engine.dispose)
        Base.metadata.create_all(engine)
        self.sessions = sessionmaker(bind=engine)
        self.enterContext(patch.object(retention, "SessionLocal", self.sessions))

    def dataset(self, db, id, *, age=None, kind="csv", workspace="owner", path=None, config=None):
        path = path or self.folder / f"dataset-{id}.csv"
        path.write_text("date,sales\n2023-01-01,1\n", encoding="utf-8")
        db.add(Dataset(id=id, workspace_id=workspace, user_id=workspace, file_name=path.name,
                       file_path=str(path), storage_provider="local", source_type=kind, row_count=1, column_count=2,
                       source_config=json.dumps(config) if config else None, created_at=age or self.expired))
        return path

    def test_expiry_keeps_workspace_member_subscription_and_connector(self):
        with self.sessions() as db:
            db.add(Organization(id=1, name="Long-running business", owner_user_id="owner", created_at=self.expired))
            db.add(OrganizationMember(organization_id=1, clerk_user_id="member", role="member", created_at=self.expired))
            db.add(WorkspaceSubscription(workspace_id="owner", plan="professional", status="active", created_at=self.expired))
            old = self.dataset(db, 1)
            live = self.dataset(db, 2, age=self.boundary)
            db.add(DataSourceConnection(id=30, user_id="owner", workspace_id="owner", source_type="shopify", display_name="Shop"))
            connector = self.dataset(db, 3, kind="shopify", config={"connection_id": 30})
            derived = self.dataset(db, 4, age=self.now, kind="joined", config={"derived_from_dataset_ids": [1, 2]})
            db.add_all([
                DashboardShare(id=1, dataset_id=1, dashboard_key="general-business", share_token="expires-by-source", created_at=self.now),
                DashboardShare(id=2, dataset_id=2, dashboard_key="general-business", share_token="expires-by-age", created_at=self.expired),
                DashboardShare(id=3, dataset_id=3, dashboard_key="general-business", share_token="keep", created_at=self.boundary),
            ])
            db.commit()

        result = retention.sweep_workspace_record_retention(now=self.now)
        self.assertEqual(result["datasets"], 2)
        self.assertFalse(old.exists())
        self.assertFalse(derived.exists())
        self.assertTrue(live.exists())
        self.assertTrue(connector.exists())
        with self.sessions() as db:
            self.assertEqual([row.id for row in db.query(Dataset).order_by(Dataset.id)], [2, 3])
            self.assertEqual(db.query(DashboardShare).one().id, 3)
            self.assertEqual(db.query(Organization).one().name, "Long-running business")
            self.assertEqual(db.query(OrganizationMember).one().clerk_user_id, "member")
            self.assertEqual(db.query(WorkspaceSubscription).one().status, "active")

    def test_expired_saved_record_and_dependents_removed_without_touching_newer_decision(self):
        with self.sessions() as db:
            self.dataset(db, 1, age=self.boundary)
            for id, age in ((1, self.expired), (2, self.boundary)):
                db.add(Decision(id=id, clerk_user_id="owner", workspace_id="owner", dataset_id=1, title=f"Decision {id}", created_at=age))
                db.add(DecisionActivity(decision_id=id, workspace_id="owner", activity_type="recorded", message="Recorded", created_at=self.now))
            db.add(BusinessReport(id="expired", workspace_id="owner", user_id="owner", name="Old report",
                                  definition='{"metrics":[{"dataset_id":1}]}', snapshot="{}", created_at=self.expired))
            db.add(ReportShare(report_id="expired", token="old-report"))
            db.add(SharedLink(id="link", workspace_id="owner", user_id="owner", kind="report", delivery_id="fixture",
                              report_id="expired", recipient="reader@example.test", token_hash="fixture", created_at=self.now))
            db.add(WeeklyReportPreference(workspace_id="owner", business_report_id="expired", enabled=1))
            db.add(CurrentWeeklyReport(workspace_id="owner", user_id="owner", job_id="current", definition="{}", snapshot="{}", updated_at=self.boundary))
            db.commit()

        retention.sweep_workspace_record_retention(now=self.now)
        with self.sessions() as db:
            self.assertEqual(db.query(Decision).one().id, 2)
            self.assertEqual(db.query(DecisionActivity).one().decision_id, 2)
            for model in (BusinessReport, ReportShare, SharedLink):
                self.assertEqual(db.query(model).count(), 0)
            self.assertIsNone(db.query(WeeklyReportPreference).one().business_report_id)
            self.assertEqual(db.query(CurrentWeeklyReport).one().job_id, "current")
        self.assertEqual(retention.sweep_workspace_record_retention(now=self.now), {"datasets": 0, "records": 0, "detached_connectors": 0})

    def test_detached_connector_is_pruned_without_an_active_connection(self):
        with self.sessions() as db:
            self.dataset(db, 1, kind="shopify", config={"connection_id": 30})
            db.commit()
        with patch("app.modules.datasets.router.purge_expired_connector_dataset", return_value=None) as prune:
            retention.sweep_workspace_record_retention(now=self.now)
            _, connection, dataset = prune.call_args.args
            self.assertEqual((connection.id, connection.workspace_id, connection.source_type), (30, "owner", "shopify"))
            self.assertEqual(dataset.id, 1)

    def test_detached_connector_rewrites_its_own_partition_and_removes_replaced_file(self):
        cutoff = connector_retention_cutoff_date()
        with self.sessions() as db:
            old_file = self.dataset(db, 1, kind="google_analytics",
                                    config={"connection_id": 20, "partition_date_column": "date"})
            old_file.write_text(f"date,sessions\n{cutoff - timedelta(days=1)},7\n{datetime.now().date()},11\n", encoding="utf-8")
            db.commit()
        with patch.dict("os.environ", {"DATASET_UPLOAD_DIR": str(self.folder), "OBJECT_STORAGE_PROVIDER": "local"}):
            outcome = retention.sweep_workspace_record_retention(now=self.now)
            self.assertEqual(outcome["detached_connectors"], 1)
            with self.sessions() as db:
                dataset = db.query(Dataset).one()
                self.assertEqual(dataset.id, 1)
                self.assertEqual(dataset.row_count, 1, dataset.source_config)
                self.assertEqual(load_dataframe_from_dataset(dataset)["sessions"].tolist(), [11])
        self.assertFalse(old_file.exists())

    def test_busy_workspace_is_skipped_and_storage_failures_are_retried(self):
        with self.sessions() as db:
            busy = self.dataset(db, 1, workspace="busy")
            old = self.dataset(db, 2)
            reused = self.dataset(db, 3)
            self.dataset(db, 4, age=self.now, path=reused)
            db.add(DataIngestionJob(user_id="busy", workspace_id="busy", status="running", created_at=self.expired))
            db.commit()
        storage = get_object_storage()
        with patch.object(storage, "delete", side_effect=OSError("unavailable")):
            retention.sweep_workspace_record_retention(now=self.now)
        with self.sessions() as db:
            self.assertEqual(db.query(ExpiredDatasetObject).one().reference, str(old))
            self.assertIsNotNone(db.get(Dataset, 1))
            self.assertIsNone(db.get(Dataset, 2))
            self.assertIsNone(db.get(Dataset, 3))
        self.assertTrue(old.exists())
        retention.sweep_workspace_record_retention(now=self.now + timedelta(hours=1))
        self.assertFalse(old.exists())
        self.assertTrue(busy.exists())
        self.assertTrue(reused.exists())

    def test_cutoff_uses_calendar_years_and_handles_leap_day(self):
        self.assertEqual(retention.record_cutoff(datetime(2028, 2, 29, 15)), datetime(2025, 2, 28))
