import json
import types
import unittest
from datetime import timedelta
from unittest.mock import patch

from fastapi import BackgroundTasks, HTTPException, Request
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.models import DataIngestionJob, DataSourceConnection, IngestionWorkerHeartbeat, utc_now
from app.modules.datasets import router as routes
from app.modules.datasets.router import (
    record_scheduled_connector_failure,
    run_data_source_sync_with_oauth_retry,
)
from app.modules.datasets.services.connectors import ConnectorUnavailable
from app.modules.oauth.service import OAuthProviderUnavailable


class FakeDb:
    def __init__(self):
        self.rollback_count = 0
        self.commit_count = 0

    def rollback(self):
        self.rollback_count += 1

    def commit(self):
        self.commit_count += 1


class ConnectorSchedulerApiTests(unittest.TestCase):
    def test_provider_reported_expiry_forces_one_refresh_and_retries(self):
        db = FakeDb()
        connection = types.SimpleNamespace(
            id=26,
            source_type="quickbooks",
        )
        payload = object()
        successful_sync = ["sync-result"]

        with patch(
            "app.modules.datasets.router.run_data_source_sync",
            side_effect=[
                ConnectorUnavailable("QuickBooks access token has expired"),
                successful_sync,
            ],
        ) as run_sync, patch(
            "app.modules.datasets.router.refresh_oauth_access_token_if_due",
            return_value=True,
        ) as refresh_token:
            result = run_data_source_sync_with_oauth_retry(
                db,
                connection,
                payload,
            )

        self.assertEqual(result, successful_sync)
        self.assertEqual(run_sync.call_count, 2)
        refresh_token.assert_called_once_with(
            db,
            connection,
            force_refresh=True,
        )

    def test_expired_oauth_for_any_connector_is_nonfatal(self):
        failures = (
            (
                "salesforce",
                OAuthProviderUnavailable("Salesforce refresh token expired"),
            ),
            (
                "quickbooks",
                ConnectorUnavailable("QuickBooks access token has expired"),
            ),
        )

        for source_type, error in failures:
            with self.subTest(source_type=source_type):
                db = FakeDb()
                connection = types.SimpleNamespace(
                    id=26,
                    source_type=source_type,
                    status="connected",
                    authorization_error=None,
                    authorization_error_at=None,
                )
                results = []

                with patch(
                    "app.modules.datasets.router.notify_workspace_owner_of_authorization_failure",
                    side_effect=RuntimeError("mail service unavailable"),
                ):
                    record_scheduled_connector_failure(
                        db,
                        connection,
                        error,
                        results,
                    )

                self.assertEqual(connection.status, "draft")
                self.assertIn("expired", connection.authorization_error)
                self.assertEqual(db.commit_count, 1)
                self.assertEqual(results[0]["connection_id"], 26)
                self.assertEqual(results[0]["status"], "failed")


class ConnectorSchedulerQueueTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool,
        )
        for model in (DataSourceConnection, DataIngestionJob, IngestionWorkerHeartbeat):
            model.__table__.create(self.engine)
        self.sessions = sessionmaker(bind=self.engine)
        self.patches = (
            patch.object(routes, "SessionLocal", self.sessions),
            patch.object(routes, "get_connectors_scheduler_secret", return_value="test-only"),
            patch.object(routes, "durable_ingestion_enabled", return_value=True),
        )
        for item in self.patches:
            item.start()
            self.addCleanup(item.stop)
        self.addCleanup(self.engine.dispose)
        with self.sessions() as db:
            db.add(IngestionWorkerHeartbeat(name="ingestion", last_seen_at=utc_now()))
            db.commit()

    def add_connection(self, workspace="workspace-a", **config):
        with self.sessions() as db:
            connection = DataSourceConnection(
                user_id=f"owner-{workspace}", workspace_id=workspace,
                source_type="meta_ads", display_name="Test Ads", status="connected",
                last_synced_at=utc_now() - timedelta(days=2),
                connection_config=json.dumps({
                    routes.INITIAL_CONNECTOR_SYNC_STATUS_KEY: routes.INITIAL_CONNECTOR_SYNC_COMPLETE,
                    routes.CONNECTOR_ANALYSIS_STATUS_KEY: routes.CONNECTOR_ANALYSIS_COMPLETE,
                    **config,
                }),
            )
            db.add(connection)
            db.commit()
            return connection.id

    def fill_queue(self, workspace="workspace-a"):
        with self.sessions() as db:
            db.add_all([
                DataIngestionJob(user_id=f"owner-{workspace}", workspace_id=workspace,
                                 job_type="file_upload", status="running" if index == 0 else "queued")
                for index in range(5)
            ])
            db.commit()

    def schedule(self, secret="test-only"):
        request = Request({
            "type": "http",
            "headers": [(b"x-connectors-scheduler-secret", secret.encode())],
        })
        return routes.sync_due_source_connections(request, BackgroundTasks())

    def test_full_workspace_is_deferred_and_other_workspace_is_queued(self):
        deferred_id = self.add_connection()
        queued_id = self.add_connection("workspace-b")
        self.fill_queue()

        result = self.schedule()
        self.assertEqual(result["failed_count"], 0)
        self.assertEqual(result["deferred_count"], 1)
        self.assertEqual(result["queued_count"], 1)
        self.assertEqual(result["results"][0]["connection_id"], deferred_id)
        self.assertEqual(result["results"][0]["status"], "deferred")
        self.assertEqual(result["results"][0]["reason"], "workspace_queue_full")
        with self.sessions() as db:
            self.assertIsNone(db.query(DataIngestionJob).filter_by(connection_id=deferred_id).first())
            self.assertEqual(db.query(DataIngestionJob).filter_by(connection_id=queued_id).count(), 1)

    def test_scheduler_queues_only_five_jobs_then_retries_deferred_without_duplicates(self):
        connection_ids = [self.add_connection() for _ in range(7)]
        first = self.schedule()
        self.assertEqual(first["queued_count"], 5)
        self.assertEqual(first["deferred_count"], 2)

        repeated = self.schedule()
        self.assertEqual(repeated["queued_count"], 0)
        self.assertEqual(repeated["in_progress_count"], 5)
        self.assertEqual(repeated["deferred_count"], 2)
        with self.sessions() as db:
            self.assertEqual(db.query(DataIngestionJob).count(), 5)
            first_connection = db.get(DataSourceConnection, connection_ids[0])
            job = db.query(DataIngestionJob).filter_by(connection_id=first_connection.id).one()
            job.status = "succeeded"
            first_connection.last_synced_at = utc_now()
            db.commit()

        retried = self.schedule()
        self.assertEqual(retried["queued_count"], 1)
        self.assertEqual(retried["deferred_count"], 1)
        with self.sessions() as db:
            self.assertEqual(db.query(DataIngestionJob).count(), 6)
            self.assertEqual(db.query(DataIngestionJob).filter_by(status="queued").count(), 5)

    def test_existing_ingestion_is_reported_even_when_workspace_is_full(self):
        connection_id = self.add_connection()
        self.fill_queue()
        with self.sessions() as db:
            job = db.query(DataIngestionJob).first()
            job.connection_id = connection_id
            db.commit()
        result = self.schedule()
        self.assertEqual(result["in_progress_count"], 1)
        self.assertEqual(result["deferred_count"], 0)

    def test_backfill_queue_limit_does_not_abort_other_workspaces(self):
        config = {
            routes.INITIAL_CONNECTOR_SYNC_STATUS_KEY: routes.INITIAL_CONNECTOR_SYNC_FAILED,
            "_initial_connector_backfill_start_date": "2025-01-01",
            "_initial_connector_backfill_end_date": "2025-12-31",
        }
        self.add_connection(**config)
        self.add_connection("workspace-b", **config)
        self.fill_queue()
        result = self.schedule()
        self.assertEqual(result["deferred_count"], 1)
        self.assertEqual(result["results"][1]["status"], "initial_backfill_queued")
        with self.sessions() as db:
            self.assertEqual(db.query(DataIngestionJob).filter_by(workspace_id="workspace-b").count(), 1)

    def test_manual_enqueue_still_rejects_a_full_workspace(self):
        connection_id = self.add_connection()
        self.fill_queue()
        with self.sessions() as db:
            connection = db.get(DataSourceConnection, connection_id)
            with self.assertRaises(HTTPException) as raised:
                routes.enqueue_connector_ingestion_job(
                    db, connection, routes.DataSourceConnectionSync(), BackgroundTasks(),
                )
            self.assertEqual(raised.exception.status_code, 429)

    def test_missing_or_stale_worker_reports_unavailability_without_enqueuing(self):
        self.add_connection()
        for missing in (True, False):
            with self.subTest(missing=missing), self.sessions() as db:
                db.query(IngestionWorkerHeartbeat).delete()
                if not missing:
                    db.add(IngestionWorkerHeartbeat(
                        name="ingestion", last_seen_at=utc_now() - timedelta(minutes=5),
                    ))
                db.commit()
                with self.assertRaises(HTTPException) as raised:
                    self.schedule()
                self.assertEqual(raised.exception.status_code, 503)
                self.assertIn("ingestion worker", raised.exception.detail.lower())
                self.assertEqual(db.query(DataIngestionJob).count(), 0)

    def test_scheduler_authentication_still_precedes_processing(self):
        self.add_connection()
        with self.assertRaises(HTTPException) as raised:
            self.schedule(secret="")
        self.assertEqual(raised.exception.status_code, 401)
        with self.sessions() as db:
            self.assertEqual(db.query(DataIngestionJob).count(), 0)

    def test_other_http_errors_are_not_disguised_as_queue_deferrals(self):
        self.add_connection()
        for status_code in (429, 503):
            with self.subTest(status_code=status_code), patch.object(
                routes, "enqueue_connector_ingestion_job",
                side_effect=HTTPException(status_code, "Unrelated service failure"),
            ):
                with self.assertRaises(HTTPException) as raised:
                    self.schedule()
                self.assertEqual(raised.exception.status_code, status_code)

    def test_development_background_execution_does_not_require_a_worker(self):
        self.add_connection()
        with self.sessions() as db:
            db.query(IngestionWorkerHeartbeat).delete()
            db.commit()
        with patch.object(routes, "durable_ingestion_enabled", return_value=False):
            self.assertEqual(self.schedule()["queued_count"], 1)

    def test_disabled_and_not_due_connections_are_not_queued(self):
        self.add_connection(_sync_enabled=False)
        recent_id = self.add_connection()
        with self.sessions() as db:
            db.get(DataSourceConnection, recent_id).last_synced_at = utc_now()
            db.commit()
        result = self.schedule()
        self.assertEqual(result["processed_count"], 0)
        self.assertEqual(result["queued_count"], 0)
        self.assertEqual(result["deferred_count"], 0)


if __name__ == "__main__":
    unittest.main()
