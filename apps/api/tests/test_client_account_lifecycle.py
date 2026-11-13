import unittest
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import BackgroundTasks, FastAPI, HTTPException, Request, Response
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.database import Base
from app.db.models import AppUser, AuthIdentity, DataIngestionJob, Dataset, Organization, OrganizationInvite, OrganizationMember, WeeklyReportPreference, WorkspaceSubscription
from app.infrastructure.ingestion_jobs import claim_ingestion_job, ensure_workspace_queue_capacity
from app.modules import auth_context, public_dashboard, workspace_lifecycle
from app.modules.auth_context import AuthContext
from app.modules.alerts import router as alerts
from app.modules.datasets import router as datasets
from app.modules.organizations import router
from app.modules.reports import jobs
from app.modules.reports.models import ReportAnalysisJob


class ClientAccountLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine)
        self.actor = AuthContext("agency", "agency", "owner")
        self.workspace = "agency:client:one"
        self.patches = [patch.object(router, "SessionLocal", self.Session), patch.object(workspace_lifecycle, "SessionLocal", self.Session)]
        for item in self.patches:
            item.start()
            self.addCleanup(item.stop)
        self.addCleanup(self.engine.dispose)
        with self.Session() as db:
            db.add_all([
                Organization(id=1, name="Agency", owner_user_id="agency"),
                Organization(id=2, name="Client", owner_user_id=self.workspace),
                Organization(id=3, name="Other client", owner_user_id="other:client:one"),
                WorkspaceSubscription(workspace_id="agency", plan="agency", status="active"),
                OrganizationMember(organization_id=2, clerk_user_id="client", role="client_user"),
                OrganizationInvite(organization_id=2, email="new@example.test", role="client_user", status="pending"),
                Dataset(id=1, file_name="client.csv", file_path="manual_upload", row_count=1, column_count=1, user_id="client", workspace_id=self.workspace),
            ])
            db.commit()
        app = FastAPI()

        @app.middleware("http")
        async def actor(request, call_next):
            request.state.auth_context = self.actor
            return await call_next(request)

        app.include_router(router.router, prefix="/organizations")
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def status(self, paused=True, identity=2):
        return self.client.patch(f"/organizations/client-workspaces/{identity}", json={"is_paused": paused})

    def test_pause_and_resume_preserve_data_members_invites_and_billing(self):
        self.assertTrue(self.status().json()["is_paused"])
        with self.Session() as db:
            self.assertTrue(db.get(Organization, 2).is_paused)
            self.assertIsNotNone(db.get(Dataset, 1))
            self.assertEqual(db.query(OrganizationMember).count(), 1)
            self.assertEqual(db.query(OrganizationInvite).count(), 1)
            subscription = db.query(WorkspaceSubscription).one()
            self.assertEqual((subscription.plan, subscription.status), ("agency", "active"))
            self.assertEqual(router.claim_pending_invites(db, "new-client", "new@example.test", email_verified=True), 0)
        listing = self.client.get("/organizations/workspaces?include_managed_client_workspaces=true").json()
        self.assertTrue(next(item for item in listing if item["id"] == 2)["is_paused"])
        self.assertFalse(self.status(False).json()["is_paused"])
        with self.Session() as db:
            workspace_lifecycle.require_workspace_active(self.workspace, db)
            self.assertEqual(router.claim_pending_invites(db, "new-client", "new@example.test", email_verified=True), 1)

    def test_status_requires_a_boolean(self):
        for value in ("false", 1, None):
            self.assertEqual(self.client.patch("/organizations/client-workspaces/2", json={"is_paused": value}).status_code, 422)

    def test_only_managing_agency_owner_can_pause_or_delete(self):
        for actor in (AuthContext("agency-member", "agency", "member"), AuthContext("client", self.workspace, "client_owner")):
            self.actor = actor
            self.assertEqual(self.status().status_code, 403)
            self.assertEqual(self.client.delete("/organizations/client-workspaces/2").status_code, 403)
        self.actor = AuthContext("agency", "agency", "owner")
        for identity in (1, 3):
            self.assertEqual(self.status(identity=identity).status_code, 403)
            self.assertEqual(self.client.delete(f"/organizations/client-workspaces/{identity}").status_code, 403)
        self.assertEqual(self.status(identity=999).status_code, 404)

    def test_pause_is_idempotent_and_requires_no_client_data_access_grant(self):
        for _ in range(2):
            self.assertEqual(self.status().status_code, 200)
        self.assertEqual(self.status(False).status_code, 200)

    def test_active_or_queued_imports_and_analyses_prevent_pause_and_delete(self):
        for kind in ("import", "report"):
            for status in ("queued", "running"):
                with self.subTest(kind=kind, status=status):
                    with self.Session() as db:
                        model = DataIngestionJob if kind == "import" else ReportAnalysisJob
                        item = (DataIngestionJob(user_id="client", workspace_id=self.workspace, job_type="file_upload", status=status, request_payload="{}")
                                if kind == "import" else ReportAnalysisJob(user_id="client", workspace_id=self.workspace, kind="report", status=status,
                                                                        request_key=kind + status, definition="{}", sources="{}"))
                        db.add(item)
                        db.commit()
                    self.assertEqual(self.status().status_code, 409)
                    self.assertEqual(self.client.delete("/organizations/client-workspaces/2").status_code, 409)
                    with self.Session() as db:
                        self.assertFalse(db.get(Organization, 2).is_paused)
                        self.assertIsNotNone(db.get(Dataset, 1))
                        db.query(model).delete()
                        db.commit()

    def test_paused_access_is_blocked_but_workspace_discovery_is_available(self):
        self.status()
        for path in ("/datasets/1", "/api/v2/business-reports", "/organizations/workspaces"):
            request = Request({"type": "http", "path": path, "headers": []})
            with patch.object(auth_context, "get_verified_user_identity", return_value=("external-client", None, False)), patch.object(
                auth_context, "resolve_external_identity", return_value="client"
            ), patch.object(auth_context, "get_verified_workspace_access", return_value=(self.workspace, "client_owner")):
                if path == "/organizations/workspaces":
                    self.assertEqual(auth_context.get_auth_context(request).workspace_id, self.workspace)
                else:
                    with self.assertRaises(HTTPException) as error:
                        auth_context.get_auth_context(request)
                    self.assertEqual(error.exception.status_code, 403)
                    self.assertIn("paused", error.exception.detail)

    def test_paused_workspace_cannot_enqueue_or_claim_background_jobs(self):
        self.status()
        with self.Session() as db:
            job = DataIngestionJob(user_id="client", workspace_id=self.workspace, job_type="file_upload", status="queued", request_payload="{}")
            db.add(job)
            db.commit()
            for action in (lambda: ensure_workspace_queue_capacity(db, self.workspace), lambda: claim_ingestion_job(db, job),
                           lambda: jobs.enqueue(db, "client", self.workspace, "report", {}, {}),
                           lambda: jobs.verify_job_actor(SimpleNamespace(workspace_id=self.workspace))):
                with self.assertRaises(HTTPException) as error:
                    action()
                self.assertEqual(error.exception.status_code, 403)
            self.assertEqual(job.status, "queued")
            result = datasets.queue_due_source_connection(db, SimpleNamespace(id=99, workspace_id=self.workspace), BackgroundTasks(), None)
            self.assertEqual(result["status"], "skipped")

    def test_public_shared_dashboard_is_unavailable_while_paused(self):
        self.status()
        with patch.object(public_dashboard, "SessionLocal", self.Session), patch.object(public_dashboard, "load_dataframe_from_dataset") as load:
            with self.Session() as db:
                db.get(Dataset, 1).share_token = "test-token"
                db.commit()
            with self.assertRaises(HTTPException) as error:
                public_dashboard.get_public_shared_dashboard(1, Response(), token="test-token")
            self.assertEqual(error.exception.status_code, 404)
            load.assert_not_called()

    def test_weekly_scheduler_skips_paused_clients_without_changing_delivery_settings(self):
        self.status()
        with self.Session() as db:
            db.add(WeeklyReportPreference(workspace_id=self.workspace, enabled=1, delivery_day="monday"))
            db.commit()
        with patch.object(alerts, "SessionLocal", self.Session), patch.object(alerts, "require_alerts_scheduler_secret"), patch.object(
            alerts, "get_utc_now", return_value=datetime(2026, 11, 9, 8)
        ), patch.object(alerts, "get_delivery_day_for_time", return_value="monday"), patch.object(jobs, "enqueue_weekly") as enqueue:
            result = alerts.send_due_weekly_reports(Request({"type": "http", "headers": []}))
        self.assertEqual(result.skipped_count, 1)
        self.assertEqual(result.failed_count, 0)
        enqueue.assert_not_called()
        with self.Session() as db:
            self.assertEqual(db.query(WeeklyReportPreference).one().enabled, 1)

    def test_existing_workspaces_default_to_active_after_schema_upgrade(self):
        from app import main
        legacy = create_engine("sqlite:///:memory:")
        self.addCleanup(legacy.dispose)
        with legacy.begin() as connection:
            connection.execute(text("CREATE TABLE organizations (id INTEGER PRIMARY KEY, name VARCHAR, owner_user_id VARCHAR)"))
            connection.execute(text("INSERT INTO organizations VALUES (1, 'Existing client', 'agency:client:existing')"))
        with patch.object(main, "engine", legacy):
            main.ensure_organization_branding_columns()
            main.ensure_organization_branding_columns()
        with legacy.connect() as connection:
            self.assertEqual(connection.execute(text("SELECT is_paused FROM organizations WHERE id=1")).scalar(), 0)

    def test_delete_paused_client_preserves_other_workspaces_and_shared_user_identity(self):
        self.status()
        with self.Session() as db:
            db.add_all([
                AppUser(id="client"), AuthIdentity(user_id="client", provider="clerk", subject="external-client"),
                OrganizationMember(organization_id=3, clerk_user_id="client", role="member"),
            ])
            db.commit()
        result = self.client.delete("/organizations/client-workspaces/2")
        self.assertEqual(result.status_code, 200, result.text)
        self.assertTrue(result.json()["deleted"])
        with self.Session() as db:
            self.assertIsNone(db.get(Organization, 2))
            self.assertIsNone(db.get(Dataset, 1))
            self.assertEqual(db.query(OrganizationInvite).count(), 0)
            self.assertIsNotNone(db.get(Organization, 1))
            self.assertIsNotNone(db.get(Organization, 3))
            self.assertIsNotNone(db.get(AppUser, "client"))
            self.assertEqual(db.query(AuthIdentity).filter_by(user_id="client").count(), 1)


if __name__ == "__main__":
    unittest.main()
