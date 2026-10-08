import asyncio
from io import BytesIO, StringIO
from contextlib import contextmanager, redirect_stdout
from datetime import timedelta
import json
import hashlib
import hmac
from pathlib import Path
import tempfile
import threading
import time
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, Mock, patch

import pandas as pd
from fastapi import BackgroundTasks, HTTPException, UploadFile
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from starlette.requests import Request
from starlette.applications import Starlette
from starlette.routing import Route
from starlette.responses import JSONResponse

from app import main
from app.db.database import Base
from app.db.models import DataIngestionJob, DatasetAnalysis, DataSourceConnection, WorkspaceSubscription
from app.infrastructure import ingestion_jobs, ingestion_worker, monitoring
from app.modules import auth_context
from app.modules.ai import credits
from app.modules.billing.lifecycle import build_subscription_access_state
from app.modules.billing import notifications, router as billing_routes
from app.modules.datasets import router as routes
from app.modules.datasets.services.file_loader import validate_dataset_dataframe
from app.modules.datasets.services import file_loader
from app.modules.organizations.router import claim_pending_invites
from app.security.request_limits import RequestBodyLimitMiddleware
from app.security import rate_limits
from app.infrastructure import readiness
from app.db.models import IngestionWorkerHeartbeat, utc_now
from scripts import check_mvp_readiness as release_check


class ProductionIdentityTests(unittest.TestCase):
    def test_email_header_cannot_link_a_verified_subject_to_another_user(self):
        with patch.object(auth_context, "get_auth_jwks_url", return_value="https://issuer/jwks"), patch.object(
            auth_context, "verify_clerk_bearer_token_identity", return_value=("attacker", None)
        ), patch.object(auth_context, "resolve_external_identity", return_value="usr_attacker") as resolve, patch.object(
            auth_context, "get_verified_workspace_access", return_value=("usr_attacker", "owner")
        ):
            context = auth_context.get_auth_context(SimpleNamespace(headers={
                "Authorization": "Bearer valid", "X-User-Email": "victim@example.test",
            }))
        self.assertIsNone(context.email)
        self.assertFalse(context.email_verified)
        self.assertIsNone(resolve.call_args.kwargs["email"])

    def test_signed_but_unverified_email_is_not_eligible_for_linking(self):
        client = Mock()
        with patch.object(auth_context, "get_auth_jwks_url", return_value="https://issuer/jwks"), patch.object(
            auth_context, "get_jwks_client", return_value=client
        ), patch.object(auth_context.jwt, "decode", return_value={
            "sub": "subject", "email": "victim@example.test", "email_verified": False,
        }):
            self.assertEqual(auth_context.verify_clerk_bearer_token_identity("Bearer token"), ("subject", None))

    def test_unverified_email_cannot_claim_an_invite(self):
        db = Mock()
        self.assertEqual(claim_pending_invites(db, "attacker", "victim@example.test"), 0)
        db.query.assert_not_called()


class ProductionBoundaryTests(unittest.IsolatedAsyncioTestCase):
    async def test_anonymous_webhook_still_requires_a_valid_signature(self):
        body = b'{"id":"evt_review","type":"test.event","data":{"object":{}}}'
        timestamp = int(time.time())
        signature = hmac.new(b"test-secret", str(timestamp).encode() + b"." + body, hashlib.sha256).hexdigest()
        async def invoke(header):
            request = Request({
                "type": "http", "method": "POST", "path": "/billing/webhook",
                "headers": [(b"stripe-signature", header.encode())],
            }, AsyncMock(return_value={"type": "http.request", "body": body, "more_body": False}))
            async def callback(request):
                return await billing_routes.billing_webhook(request)
            return await main.enforce_product_route_auth(request, callback)

        db = Mock()
        db.query.return_value.filter.return_value.first.return_value = None
        with patch.dict("os.environ", {"STRIPE_WEBHOOK_SECRET": "test-secret"}), patch.object(
            main, "get_auth_context", side_effect=HTTPException(401, "Missing token")
        ) as verify, patch.object(billing_routes, "SessionLocal", return_value=db), patch.object(
            billing_routes, "apply_stripe_billing_event"
        ) as apply:
            with self.assertRaises(HTTPException) as error:
                await invoke(f"t={timestamp},v1=invalid")
            self.assertEqual(error.exception.status_code, 400)
            apply.assert_not_called()
            result = await invoke(f"t={timestamp},v1={signature}")
            self.assertTrue(result["received"])
            apply.assert_called_once_with(db, "test.event", {})
            verify.assert_not_called()

    async def test_webhook_bypasses_session_auth_but_product_routes_do_not(self):
        callback = AsyncMock(return_value=SimpleNamespace(status_code=200))
        with patch.object(main, "get_auth_context", side_effect=HTTPException(401, "Missing token")) as verify:
            request = Request({"type": "http", "method": "POST", "path": "/billing/webhook", "headers": []})
            response = await main.enforce_product_route_auth(request, callback)
            self.assertEqual(response.status_code, 200)
            verify.assert_not_called()
            request = Request({"type": "http", "method": "POST", "path": "/billing/checkout", "headers": []})
            response = await main.enforce_product_route_auth(request, callback)
            self.assertEqual(response.status_code, 401)

    async def test_oversized_request_rejected_before_parsing(self):
        application = AsyncMock()
        send = AsyncMock()
        await RequestBodyLimitMiddleware(application)({
            "type": "http", "path": "/datasets/upload",
            "headers": [(b"content-length", b"200000000")],
        }, AsyncMock(), send)
        application.assert_not_called()
        self.assertEqual(send.call_args_list[0].args[0]["status"], 413)

    async def test_upload_overflow_removes_partial_file(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "data.csv"
            with patch.object(routes, "get_user_id", return_value="user"), patch.object(
                routes, "get_workspace_id", return_value="workspace"
            ), patch.object(routes, "require_workspace_data_manager"), patch.object(
                routes, "get_dataset_upload_dir", return_value=directory
            ), patch.object(routes, "build_dataset_upload_path", return_value=str(path)), patch.object(
                routes, "UPLOAD_MAX_BYTES", 3
            ):
                with self.assertRaises(HTTPException) as error:
                    routes.upload_dataset(object(), BackgroundTasks(), UploadFile(file=BytesIO(b"value\n10\n"), filename="data.csv"))
            self.assertEqual(error.exception.status_code, 413)
            self.assertFalse(path.exists())

    async def test_chunked_json_overflow_returns_413(self):
        async def endpoint(request):
            await request.body()
            return JSONResponse({"ok": True})
        application = RequestBodyLimitMiddleware(Starlette(routes=[Route("/data", endpoint, methods=["POST"])]))
        send = AsyncMock()
        with patch("app.security.request_limits.REQUEST_MAX_BYTES", 3):
            await application({
                "type": "http", "method": "POST", "path": "/data", "headers": [],
            }, AsyncMock(return_value={"type": "http.request", "body": b"1234", "more_body": False}), send)
        self.assertEqual(send.call_args_list[0].args[0]["status"], 413)


class SignedFileSecurityTests(unittest.TestCase):
    def test_partition_budget_is_checked_before_loading_frames(self):
        with tempfile.TemporaryDirectory() as directory:
            for filename in ("a.parquet", "b.parquet"):
                (Path(directory) / filename).touch()
            metadata = SimpleNamespace(num_rows=600_000, num_row_groups=0, schema=SimpleNamespace(names=["value"]))
            with patch("pyarrow.parquet.read_metadata", return_value=metadata), patch.object(
                file_loader.pd, "read_parquet"
            ) as read:
                with self.assertRaises(HTTPException) as error:
                    file_loader.load_dataset_file(directory, "dataset.parquet")
            self.assertEqual(error.exception.status_code, 413)
            read.assert_not_called()

    def test_redirect_to_metadata_service_is_rejected_before_request(self):
        with self.assertRaises(HTTPException):
            routes.SignedFileRedirectHandler().redirect_request(
                routes.UrlRequest("https://drive.google.com/file"), None, 302, "Found", {},
                "http://169.254.169.254/latest/meta-data/",
            )

    def test_private_dns_target_is_rejected(self):
        with patch.object(routes.socket, "getaddrinfo", return_value=[(2, 1, 6, "", ("127.0.0.1", 443))]):
            with self.assertRaises(HTTPException):
                routes.validate_signed_file_destination("https://drive.google.com/file")

    def test_nonstandard_https_port_is_rejected(self):
        with self.assertRaises(HTTPException):
            routes.validate_signed_file_url("https://drive.google.com:8443/file")

    def test_wide_dataset_is_rejected(self):
        with self.assertRaises(HTTPException) as error:
            validate_dataset_dataframe(pd.DataFrame([[1] * 501]))
        self.assertEqual(error.exception.status_code, 413)

    def test_socket_connection_uses_only_the_checked_public_ip(self):
        sock = Mock()
        with patch.object(routes.socket, "getaddrinfo", return_value=[(2, 1, 6, "", ("8.8.8.8", 443))]), patch.object(
            routes.socket, "socket", return_value=sock
        ):
            self.assertIs(routes.create_public_file_connection(("drive.google.com", 443), 60), sock)
        sock.connect.assert_called_once_with(("8.8.8.8", 443))


class ProductionQueueTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine)

    def tearDown(self):
        self.engine.dispose()

    def test_worker_mode_does_not_launch_in_api_process(self):
        tasks = BackgroundTasks()
        with patch.dict("os.environ", {"INGESTION_EXECUTION_MODE": "worker"}):
            routes.launch_connector_ingestion_job(tasks, 1)
            routes.launch_connector_analysis_job(tasks, 2)
        self.assertEqual(tasks.tasks, [])

    def test_a_job_can_only_be_claimed_once(self):
        with self.sessions() as db:
            job = DataIngestionJob(user_id="user", workspace_id="workspace", status="queued")
            db.add(job)
            db.commit()
            self.assertTrue(ingestion_jobs.claim_ingestion_job(db, job))
            self.assertFalse(ingestion_jobs.claim_ingestion_job(db, job))

    def test_interrupted_parent_and_children_fail_and_allow_retry(self):
        with self.sessions() as db:
            parent = DataIngestionJob(user_id="user", workspace_id="workspace", connection_id=1, status="running")
            db.add(parent)
            db.flush()
            db.add(DataIngestionJob(user_id="user", workspace_id="workspace", connection_id=1, parent_job_id=parent.id, status="queued"))
            db.commit()
        with patch.object(ingestion_worker, "SessionLocal", self.sessions):
            ingestion_worker.fail_interrupted_jobs()
        with self.sessions() as db:
            self.assertEqual({job.status for job in db.query(DataIngestionJob).all()}, {"failed"})
            self.assertIsNone(routes.get_active_ingestion_job(db, 1))

    def test_running_import_blocks_workspace_deletion(self):
        with self.sessions() as db:
            db.add(DataIngestionJob(user_id="user", workspace_id="workspace", status="running"))
            db.commit()
            with self.assertRaises(HTTPException) as error:
                ingestion_jobs.ensure_workspace_jobs_idle(db, ["workspace"])
            self.assertEqual(error.exception.status_code, 409)

    def test_timed_out_job_is_killed_and_has_actionable_failure(self):
        child = Mock(pid=123)
        child.poll.return_value = None
        with patch.object(ingestion_worker.subprocess, "Popen", return_value=child), patch.object(
            ingestion_worker.time, "monotonic", side_effect=[0, 31]
        ), patch.dict("os.environ", {"INGESTION_JOB_TIMEOUT_SECONDS": "30"}), patch.object(
            ingestion_worker.os, "killpg"
        ) as kill, patch.object(ingestion_worker, "record_heartbeat"), patch.object(
            ingestion_worker, "fail_interrupted_jobs"
        ) as fail, patch.object(ingestion_worker, "cleanup_terminal_file_jobs"):
            with self.assertRaises(TimeoutError):
                ingestion_worker.supervise_job(1, Mock(), "worker.py")
        kill.assert_called_once_with(123, ingestion_worker.signal.SIGKILL)
        child.wait.assert_called_once()
        self.assertIn("deadline", fail.call_args.args[1])

    def test_retention_runs_for_disconnected_connections_and_all_objects(self):
        with self.sessions() as db:
            db.add(DataSourceConnection(id=1, user_id="user", workspace_id="workspace", source_type="hubspot", display_name="HubSpot", status="draft"))
            db.commit()
        with patch.object(routes, "SessionLocal", self.sessions), patch.object(
            routes, "find_connector_datasets", return_value=[SimpleNamespace(id=1), SimpleNamespace(id=2)]
        ), patch.object(routes, "purge_expired_connector_dataset", return_value={"replaced_file_path": None}) as purge:
            self.assertEqual(routes.sweep_connector_retention(), 2)
        self.assertEqual(purge.call_count, 2)

    def test_billing_disabled_does_not_expire_a_workspace(self):
        with patch.dict("os.environ", {"BILLING_ENFORCEMENT_ENABLED": "false"}):
            state = build_subscription_access_state(WorkspaceSubscription(plan="free", status="canceled"))
        self.assertTrue(state.access_allowed)
        self.assertFalse(state.requires_billing_action)
        self.assertEqual(state.status, "disabled")

    def test_billing_disabled_does_not_send_email_or_delete_data(self):
        db = Mock()
        with patch.dict("os.environ", {"BILLING_ENFORCEMENT_ENABLED": "false"}), patch.object(
            notifications, "purge_workspace_data_after_expiry"
        ) as purge:
            result = notifications.send_due_billing_lifecycle_notifications(db)
        self.assertEqual(result["data_purged"], 0)
        self.assertEqual(result["notified"], 0)
        db.query.assert_not_called()
        purge.assert_not_called()

    def test_failed_staging_cleanup_keeps_reference_for_retry(self):
        with self.sessions() as db:
            job = DataIngestionJob(
                user_id="user", workspace_id="workspace", job_type="file_upload", status="running",
                request_payload=json.dumps({"staged_file_reference": "s3://bucket/staged.csv"}),
            )
            db.add(job)
            db.commit()
            job_id = job.id
        with patch.object(ingestion_worker, "SessionLocal", self.sessions), patch.object(
            ingestion_worker, "cleanup_ingestion_staging", side_effect=OSError("Storage unavailable")
        ), self.assertLogs(ingestion_worker.logger, level="ERROR"):
            ingestion_worker.fail_interrupted_jobs()
        with self.sessions() as db:
            job = db.get(DataIngestionJob, job_id)
            self.assertEqual(job.status, "failed")
            self.assertIn("staged_file_reference", job.request_payload)
        with patch.object(ingestion_worker, "SessionLocal", self.sessions), patch.object(
            ingestion_worker, "cleanup_ingestion_staging"
        ) as cleanup:
            ingestion_worker.cleanup_terminal_file_jobs()
        cleanup.assert_called_once()
        with self.sessions() as db:
            self.assertIsNone(db.get(DataIngestionJob, job_id).request_payload)

    def test_retention_does_not_reauthorize_a_disconnected_connection(self):
        connection = SimpleNamespace(
            status="draft", last_synced_at=None, connection_config='{"sync_enabled":false}',
            authorization_error="Access revoked", authorization_error_at=None,
        )
        dataset = SimpleNamespace(id=1, source_config="{}")
        def persist(*args):
            connection.status = "connected"
            connection.authorization_error = None
            connection.connection_config = "{}"
            return dataset, {}, "new-file", "old-file"
        with patch.object(routes, "connector_dataset_requires_retention_cleanup", return_value=True), patch.object(
            routes, "cleanup_deleted_dataset_join_caches", return_value=["old-join"]
        ), patch.object(routes, "persist_connector_dataframe", side_effect=persist), patch.object(routes, "remove_dataset_file") as remove:
            result = routes.purge_expired_connector_dataset(Mock(), connection, dataset)
            remove.assert_not_called()
            self.assertEqual(connection.status, "draft")
            self.assertEqual(connection.authorization_error, "Access revoked")
            self.assertEqual(connection.connection_config, '{"sync_enabled":false}')
            routes.remove_retention_replaced_files(result)
        self.assertEqual([call.args[0] for call in remove.call_args_list], ["old-file", "old-join"])

    def test_shared_request_budget_resets_and_is_workspace_scoped(self):
        with patch.object(rate_limits, "SessionLocal", self.sessions), patch.dict(
            "os.environ", {"WORKSPACE_REQUESTS_PER_MINUTE": "30"}
        ):
            for _ in range(30):
                self.assertTrue(rate_limits.consume_workspace_request("workspace"))
            self.assertFalse(rate_limits.consume_workspace_request("workspace"))
            self.assertTrue(rate_limits.consume_workspace_request("other-workspace"))
            with patch.object(rate_limits, "utc_now", return_value=utc_now() + timedelta(minutes=1)):
                self.assertTrue(rate_limits.consume_workspace_request("workspace"))

    def test_readiness_requires_a_fresh_worker_heartbeat(self):
        with patch.object(readiness, "SessionLocal", self.sessions), patch.object(
            readiness, "durable_ingestion_enabled", return_value=True
        ):
            self.assertFalse(readiness.check_service_readiness()["ready"])
            with self.sessions() as db:
                db.add(IngestionWorkerHeartbeat(name="ingestion", last_seen_at=utc_now()))
                db.commit()
            self.assertTrue(readiness.check_service_readiness()["ready"])
            with self.sessions() as db:
                db.get(IngestionWorkerHeartbeat, "ingestion").last_seen_at = utc_now() - timedelta(seconds=60)
                db.commit()
            self.assertFalse(readiness.check_service_readiness()["ready"])

    def test_worker_can_materialize_upload_staging_after_local_file_disappears(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "object.csv"
            path.write_text("revenue\n100\n")
            destination = Path(directory) / "worker-copy.csv"
            @contextmanager
            def materialize(reference):
                self.assertEqual(reference, "s3://bucket/ingestion/file.csv")
                yield str(path)
            storage = Mock()
            storage.materialize = materialize
            with self.sessions() as db:
                job = DataIngestionJob(
                    user_id="user", workspace_id="workspace", job_type="file_upload", status="queued",
                    request_payload=json.dumps({
                        "file_path": "/missing/api-local-file.csv", "upload_filename": "data.csv",
                        "staged_file_reference": "s3://bucket/ingestion/file.csv",
                    }),
                )
                db.add(job)
                db.commit()
                job_id = job.id
            dataset = SimpleNamespace(id=1, workspace_id="workspace", file_name="data.csv", file_path="stored", row_count=1, column_count=1)
            with patch.object(routes, "SessionLocal", self.sessions), patch.object(
                routes, "get_object_storage", return_value=storage
            ), patch.object(routes, "build_dataset_upload_path", return_value=str(destination)), patch.object(
                routes, "persist_dataset_file", return_value=dataset
            ) as persist, patch.object(routes, "build_dataset_source_metadata", return_value={}), patch.object(routes, "remove_dataset_file"):
                routes.run_file_ingestion_job(job_id)
            self.assertEqual(persist.call_args.args[3], str(destination))
            with self.sessions() as db:
                self.assertEqual(db.get(DataIngestionJob, job_id).status, "succeeded")


class ConcurrentCreditTests(unittest.TestCase):
    def test_last_credit_cannot_be_reserved_twice(self):
        with tempfile.TemporaryDirectory() as directory:
            engine = create_engine(f"sqlite:///{directory}/credits.db", connect_args={"check_same_thread": False})
            WorkspaceSubscription.__table__.create(engine)
            from app.db.models import AIUsageEvent
            AIUsageEvent.__table__.create(engine)
            sessions = sessionmaker(bind=engine)
            with sessions() as db:
                db.add(WorkspaceSubscription(workspace_id="workspace", plan="free", status="trialing"))
                db.commit()
            barrier = threading.Barrier(2)
            outcomes = []

            def reserve():
                barrier.wait(timeout=5)
                try:
                    credits.reserve_ai_credits(workspace_id="workspace", operation="test", estimated_tokens=1)
                    outcomes.append("accepted")
                except credits.AICreditLimitExceeded:
                    outcomes.append("denied")

            with patch.object(credits, "SessionLocal", sessions), patch.object(
                credits, "_get_recurring_credit_limit", return_value=1
            ), patch.object(credits, "resolve_billing_workspace_id", side_effect=lambda value: value), patch.object(
                credits, "_maybe_notify_low_balance"
            ):
                threads = [threading.Thread(target=reserve) for _ in range(2)]
                for thread in threads:
                    thread.start()
                for thread in threads:
                    thread.join(timeout=10)
                    self.assertFalse(thread.is_alive())
            self.assertCountEqual(outcomes, ["accepted", "denied"])
            with sessions() as db:
                self.assertEqual(db.query(AIUsageEvent).count(), 1)
                self.assertEqual(db.query(WorkspaceSubscription).one().ai_credits_used, 1)
            engine.dispose()


class ProductionReleaseGateTests(unittest.TestCase):
    def test_error_monitoring_does_not_capture_bodies_or_stack_locals(self):
        sdk = Mock()
        runtime = SimpleNamespace(sentry_dsn="https://public@sentry.example/1", app_env="production", sentry_traces_sample_rate="0")
        with patch.dict("sys.modules", {"sentry_sdk": sdk}), patch.object(
            monitoring, "get_runtime_configuration", return_value=runtime
        ):
            monitoring.configure_error_monitoring()
        self.assertFalse(sdk.init.call_args.kwargs["send_default_pii"])
        self.assertFalse(sdk.init.call_args.kwargs["include_local_variables"])
        self.assertEqual(sdk.init.call_args.kwargs["max_request_body_size"], "never")

    def readiness(self):
        return {
            "runtime": {"ready": True}, "ai": {"ready": False},
            "analytics": {"ready": True}, "storage": {"configured": True},
            "alerts": {"server_email_ready": True, "scheduler_ready": True},
            "connectors": {"scheduler_ready": True},
            "billing": {"enabled": False, "ready": False, "webhook_ready": False},
            "security": {"production_guard_enabled": True, "production_ready": True},
        }

    def test_core_release_does_not_require_deferred_integrations(self):
        for extra, expected in (([], 0), (["--with-ai"], 1), (["--with-billing"], 1)):
            with self.subTest(extra=extra), patch.object(release_check, "build_readiness", return_value=self.readiness()), patch(
                "sys.argv", ["check_mvp_readiness", "--strict", "--json", *extra]
            ), redirect_stdout(StringIO()):
                self.assertEqual(release_check.main(), expected)

    def test_core_release_requires_a_live_worker_and_enabled_billing(self):
        for section, field, value in (("runtime", "ready", False), ("billing", "enabled", True)):
            status = self.readiness()
            status[section][field] = value
            with self.subTest(section=section), patch.object(release_check, "build_readiness", return_value=status), patch(
                "sys.argv", ["check_mvp_readiness", "--strict", "--json"]
            ), redirect_stdout(StringIO()):
                self.assertEqual(release_check.main(), 1)
