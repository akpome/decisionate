import json
import unittest
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pandas as pd

from fastapi import HTTPException

from app.db.models import Dataset, IngestionWorkerHeartbeat, WeeklyReportDeliveryLog, WeeklyReportPreference, utc_now
from app.infrastructure import analysis_worker as worker
from app.modules.alerts import router as alerts
from app.modules.reports import jobs
from app.modules.reports.cleanup import cleanup_source, cleanup_workspace
from app.modules.reports.models import BusinessReport, ReportAnalysisJob
from tests import test_business_reports as fixtures


class AnalysisJobTests(unittest.TestCase):
    def setUp(self):
        fixtures.BusinessReportWorkflowTests.setUp(self)

    def enqueue(self, **updates):
        response = self.client.post("/api/v2/business-reports/jobs", json=fixtures.definition(**updates))
        self.assertEqual(response.status_code, 202, response.text)
        return response.json()["job_id"]

    def state(self, identity):
        return self.client.get(f"/api/v2/business-reports/jobs/{identity}").json()

    def test_api_enqueues_without_reading_files_or_calculating(self):
        with patch.object(fixtures.router, "load_dataframe_from_dataset", side_effect=AssertionError("API must not load files")):
            identity = self.enqueue(seasonal_business=True)
            self.assertEqual(self.state(identity)["status"], "queued")
        worker.execute_job(identity)
        result = self.state(identity)
        self.assertEqual(result["status"], "succeeded", result)
        self.assertTrue(result["result"]["anomaly_analysis"]["seasonal_business"])
        self.assertEqual([item["id"] for item in result["result"]["metrics"]], ["1:spend", "2:net_sales"])
        self.assertEqual(result["result"]["definition"]["filters"]["minimum_observations"], 24)

    def test_save_reuses_completed_snapshot_and_is_idempotent(self):
        identity = self.enqueue()
        worker.execute_job(identity)
        expected = self.state(identity)["result"]
        self.frames[1][1]["spend"] = 1e9
        with patch.object(fixtures.router, "generate", side_effect=AssertionError("Do not recompute")):
            first = self.client.post(f"/api/v2/business-reports/jobs/{identity}/save")
            second = self.client.post(f"/api/v2/business-reports/jobs/{identity}/save")
        self.assertEqual(first.status_code, 201, first.text)
        self.assertEqual(first.json()["report_id"], second.json()["report_id"])
        self.assertEqual(first.json()["metrics"], expected["metrics"])
        self.assertEqual(self.state(identity)["result"]["report_id"], first.json()["report_id"])
        with self.Session() as db:
            self.assertEqual(db.query(BusinessReport).count(), 1)

    def test_deleting_a_saved_report_also_removes_its_temporary_analysis_result(self):
        identity = self.enqueue()
        worker.execute_job(identity)
        saved = self.client.post(f"/api/v2/business-reports/jobs/{identity}/save").json()
        self.assertEqual(self.client.delete(f"/api/v2/business-reports/{saved['report_id']}").status_code, 200)
        self.assertEqual(self.client.get(f"/api/v2/business-reports/jobs/{identity}").status_code, 404)
        self.assertEqual(self.client.post(f"/api/v2/business-reports/jobs/{identity}/save").status_code, 404)

    def test_queued_job_cannot_be_saved_and_cancelled_work_is_not_executed(self):
        identity = self.enqueue()
        self.assertEqual(self.client.post(f"/api/v2/business-reports/jobs/{identity}/save").status_code, 409)
        self.assertEqual(self.client.post(f"/api/v2/business-reports/jobs/{identity}/cancel").json()["status"], "cancelled")
        with patch.object(fixtures.router, "generate", side_effect=AssertionError("Cancelled")):
            worker.execute_job(identity)
        self.assertEqual(self.state(identity)["status"], "cancelled")

    def test_idempotency_replays_but_cannot_change_definition(self):
        path = "/api/v2/business-reports/jobs"
        headers = {"Idempotency-Key": "same-request"}
        first = self.client.post(path, json=fixtures.definition(), headers=headers)
        second = self.client.post(path, json=fixtures.definition(), headers=headers)
        self.assertEqual(first.json()["job_id"], second.json()["job_id"])
        self.assertEqual(self.client.post(path, json=fixtures.definition(seasonal_business=True), headers=headers).status_code, 409)

    def test_source_changes_are_rejected_before_computation(self):
        identity = self.enqueue()
        with self.Session() as db:
            db.get(Dataset, 1).row_count += 1
            db.commit()
        with patch.object(fixtures.router, "generate", side_effect=AssertionError("Stale")):
            worker.execute_job(identity)
        result = self.state(identity)
        self.assertEqual(result["status"], "failed")
        self.assertIn("changed", result["error"])

    def test_cancellation_while_computing_cannot_publish_a_result(self):
        identity = self.enqueue()
        calculate = fixtures.router.build_report
        def cancel_then_finish(*args, **kwargs):
            result = calculate(*args, **kwargs)
            with self.Session() as db:
                jobs.cancel_job(db, db.get(ReportAnalysisJob, identity))
            return result
        with patch.object(fixtures.router, "build_report", side_effect=cancel_then_finish):
            worker.execute_job(identity)
        self.assertEqual(self.state(identity)["status"], "cancelled")
        self.assertIsNone(self.state(identity)["result"])

    def test_change_during_computation_is_not_published_as_current_evidence(self):
        identity = self.enqueue()
        calculate = fixtures.router.build_report
        def change_then_finish(*args, **kwargs):
            result = calculate(*args, **kwargs)
            with self.Session() as db:
                db.get(Dataset, 1).source_config = '{"selected_metric_columns":[]}'
                db.commit()
            return result
        with patch.object(fixtures.router, "build_report", side_effect=change_then_finish):
            worker.execute_job(identity)
        self.assertEqual(self.state(identity)["status"], "failed")
        self.assertIsNone(self.state(identity)["result"])

    def test_permission_revocation_prevents_execution_and_result_access(self):
        identity = self.enqueue()
        with self.Session() as db:
            db.get(Dataset, 1).workspace_id = "someone-else"
            db.commit()
        worker.execute_job(identity)
        self.assertEqual(self.client.get(f"/api/v2/business-reports/jobs/{identity}").status_code, 403)
        self.assertEqual(self.client.post(f"/api/v2/business-reports/jobs/{identity}/save").status_code, 403)
        self.assertEqual(self.client.get(f"/api/v2/business-reports/jobs/{identity}", headers={"X-Workspace-Id": "other"}).status_code, 404)
        with self.Session() as db:
            self.assertEqual(db.get(ReportAnalysisJob, identity).status, "failed")

    def test_worker_and_queue_capacity_are_checked_without_inline_fallback(self):
        for _ in range(3):
            self.enqueue()
        self.assertEqual(self.client.post("/api/v2/business-reports/jobs", json=fixtures.definition()).status_code, 429)
        with self.Session() as db:
            db.query(ReportAnalysisJob).delete()
            db.get(IngestionWorkerHeartbeat, jobs.WORKER_NAME).last_seen_at = utc_now() - timedelta(minutes=2)
            db.commit()
        self.assertEqual(self.client.post("/api/v2/business-reports/jobs", json=fixtures.definition()).status_code, 503)

    def test_restart_retries_computation_once_but_not_ai_or_delivery(self):
        identity = self.enqueue()
        with self.Session() as db:
            job = db.get(ReportAnalysisJob, identity)
            job.status, job.phase, job.attempts = "running", "computing", 1
            db.commit()
        worker.recover_interrupted_jobs()
        self.assertEqual(self.state(identity)["status"], "queued")
        with self.Session() as db:
            job = db.get(ReportAnalysisJob, identity)
            job.status, job.attempts = "running", 2
            db.commit()
        worker.recover_interrupted_jobs()
        self.assertEqual(self.state(identity)["status"], "failed")
        with self.Session() as db:
            job = db.get(ReportAnalysisJob, identity)
            job.status, job.phase, job.attempts = "running", "sending", 1
            db.commit()
        worker.recover_interrupted_jobs()
        self.assertIn("No automatic resend", self.state(identity)["error"])

    def test_cleanup_removes_pending_and_completed_derived_data(self):
        self.enqueue()
        with self.Session() as db:
            cleanup_source(db, 1)
            db.commit()
            self.assertEqual(db.query(ReportAnalysisJob).count(), 0)
        self.enqueue()
        with self.Session() as db:
            cleanup_workspace(db, "owner")
            db.commit()
            self.assertEqual(db.query(ReportAnalysisJob).count(), 0)

    def test_workspace_fairness_gives_a_waiting_workspace_a_turn(self):
        first = self.enqueue()
        with self.Session() as db:
            db.get(ReportAnalysisJob, first).started_at = utc_now()
            other = ReportAnalysisJob(workspace_id="other", user_id="other", kind="report", request_key="other-job", definition="{}", sources="{}")
            db.add(other); db.commit()
            expected = other.id
        self.assertEqual(worker.next_job(), expected)

    def test_supervisor_timeout_kills_the_child_without_requeueing(self):
        identity = self.enqueue()
        with self.Session() as db:
            job = db.get(ReportAnalysisJob, identity)
            job.status, job.phase, job.attempts = "running", "computing", 1
            db.commit()
        child = MagicMock(pid=12345)
        child.poll.return_value = None
        with patch.object(worker.subprocess, "Popen", return_value=child), patch.object(worker.os, "killpg") as kill, \
             patch.object(worker.time, "monotonic", side_effect=[0, 31]), patch.dict("os.environ", {"ANALYSIS_JOB_TIMEOUT_SECONDS": "30"}):
            worker.supervise_job(identity, MagicMock(), "worker.py")
        kill.assert_called_once()
        child.wait.assert_called_once()
        self.assertEqual(self.state(identity)["status"], "failed")
        self.assertIn("execution limit", self.state(identity)["error"])

    def weekly(self):
        with self.Session() as db:
            preference = WeeklyReportPreference(workspace_id="owner", enabled=1, cadence="weekly", delivery_day="monday",
                recipient_emails='["owner@example.test"]', metric_focus='["1:spend","2:net_sales"]', include_recommendations=0)
            db.add(preference); db.commit()
            return jobs.enqueue_weekly(db, "owner", "owner", preference, include_ai=False).id

    def test_weekly_preview_uses_frozen_complete_week_and_existing_engine(self):
        identity = self.weekly()
        with self.Session() as db:
            job = db.get(ReportAnalysisJob, identity)
            value = json.loads(job.definition); value["anchor"] = "2026-04-01"
            job.definition = json.dumps(value); db.commit()
        with patch.object(alerts, "load_dataframe_from_dataset", side_effect=lambda dataset: self.frames[dataset.id][1].copy()):
            worker.execute_job(identity)
        result = self.state(identity)
        self.assertEqual(result["status"], "succeeded", result)
        report = result["result"]["cross_dataset_report"]
        self.assertEqual(report["window"], {"start": "2026-03-23", "end": "2026-03-29"})
        self.assertEqual(report["anomaly_analysis"]["lookback_years"], 3)

    def test_scheduled_delivery_has_one_claim_per_completed_week(self):
        self.weekly()
        with self.Session() as db:
            preference = db.query(WeeklyReportPreference).one()
            first = jobs.enqueue_weekly(db, "owner", "owner", preference, send=True, scheduled=True)
            first_id = first.id
            preference.subject_prefix = "Changed template"; db.commit()
            second = jobs.enqueue_weekly(db, "owner", "owner", preference, send=True, scheduled=True)
            self.assertEqual(first_id, second.id)
            self.assertEqual(db.query(ReportAnalysisJob).filter_by(kind="weekly_send").count(), 1)

    def test_changed_weekly_settings_block_analysis_and_sends(self):
        identity = self.weekly()
        with self.Session() as db:
            db.query(WeeklyReportPreference).one().enabled = 0
            db.commit()
        with patch.object(alerts, "build_weekly_report_digest_for_workspace", side_effect=AssertionError("Changed settings")):
            worker.execute_job(identity)
        self.assertEqual(self.state(identity)["status"], "failed")
        self.assertIn("settings changed", self.state(identity)["error"])

    def test_weekly_sending_runs_only_in_worker_and_records_one_delivery(self):
        self.weekly()
        for _, frame in self.frames.values():
            frame["date"] = pd.date_range(end=pd.Timestamp.now().normalize(), periods=len(frame))
        with self.Session() as db:
            preference = db.query(WeeklyReportPreference).one()
            identity = jobs.enqueue_weekly(db, "owner", "owner", preference, send=True, scheduled=True, include_ai=False).id
        with patch.object(alerts, "load_dataframe_from_dataset", side_effect=lambda dataset: self.frames[dataset.id][1].copy()), \
             patch.object(alerts, "send_weekly_report_email", return_value={"recipients": ["owner@example.test"], "delivered_count": 1}) as send:
            worker.execute_job(identity)
            worker.execute_job(identity)
        self.assertEqual(self.state(identity)["status"], "succeeded", self.state(identity))
        send.assert_called_once()
        with self.Session() as db:
            self.assertEqual(db.query(WeeklyReportDeliveryLog).filter_by(status="sent").count(), 1)
            self.assertEqual(db.query(WeeklyReportPreference).one().last_send_status, "sent")

    def test_delivery_cannot_be_cancelled_once_external_sending_started(self):
        identity = self.weekly()
        with self.Session() as db:
            job = db.get(ReportAnalysisJob, identity)
            job.kind, job.status, job.phase = "weekly_send", "running", "sending"
            db.commit()
        self.assertEqual(self.client.post(f"/api/v2/business-reports/jobs/{identity}/cancel").status_code, 409)

    def test_report_only_weekly_preview_does_not_expose_delivery_configuration(self):
        self.weekly()
        with patch.object(fixtures.router, "get_workspace_role", return_value="viewer"):
            response = self.client.post("/api/v2/business-reports/weekly-jobs")
            self.assertEqual(response.status_code, 202, response.text)
            self.assertEqual(self.client.post("/api/v2/business-reports/weekly-jobs?report_only=false").status_code, 403)
            self.assertEqual(self.client.post("/api/v2/business-reports/weekly-jobs?send=true").status_code, 403)
        identity = response.json()["job_id"]
        with patch.object(alerts, "load_dataframe_from_dataset", side_effect=lambda dataset: self.frames[dataset.id][1].copy()):
            worker.execute_job(identity)
        result = self.state(identity)["result"]
        self.assertIn("metrics", result)
        self.assertNotIn("recipient_emails", result)
        self.assertNotIn("sender_email", result)

    def test_delivery_role_is_rechecked_after_enqueue(self):
        from app.modules import auth_context
        identity = self.weekly()
        with self.Session() as db:
            job = db.get(ReportAnalysisJob, identity)
            job.kind, job.user_id = "weekly_send", "former-manager"
            db.commit()
        with patch.object(auth_context, "verify_workspace_membership", return_value="viewer"), \
             patch.object(alerts, "send_weekly_report_email") as send:
            worker.execute_job(identity)
            with self.Session() as db:
                job = db.get(ReportAnalysisJob, identity)
                self.assertEqual(job.status, "failed")
                self.assertEqual(job.error_status, 403)
            send.assert_not_called()
            with patch.object(fixtures.router, "get_user_id", return_value="former-manager"):
                self.assertEqual(self.client.get(f"/api/v2/business-reports/jobs/{identity}").status_code, 403)

    def test_scheduler_only_enqueues_and_repeated_runs_share_one_weekly_claim(self):
        self.weekly()
        with patch.object(alerts, "SessionLocal", self.Session), patch.object(alerts, "require_alerts_scheduler_secret"), \
             patch.object(alerts, "get_delivery_day_for_time", return_value="monday"), \
             patch.object(alerts, "load_dataframe_from_dataset", side_effect=AssertionError("No API calculations")), \
             patch.object(alerts, "send_weekly_report_email", side_effect=AssertionError("No API delivery")):
            for _ in range(2):
                response = alerts.send_due_weekly_reports(SimpleNamespace(headers={}))
                self.assertEqual(response.queued_count, 1)
                self.assertEqual(response.sent_count, 0)
                self.assertEqual(response.failed_count, 0)
        with self.Session() as db:
            self.assertEqual(db.query(ReportAnalysisJob).filter_by(kind="weekly_send").count(), 1)

    def test_one_invalid_weekly_template_does_not_abort_other_workspaces(self):
        self.weekly()
        with self.Session() as db:
            db.add(WeeklyReportPreference(workspace_id="other", enabled=1, delivery_day="monday"))
            db.commit()
        def enqueue(db, user, workspace, preference, **kwargs):
            if workspace == "owner":
                raise ValueError("Corrupt template")
            return SimpleNamespace(id="other-job", status="queued", error=None)
        with patch.object(alerts, "SessionLocal", self.Session), patch.object(alerts, "require_alerts_scheduler_secret"), \
             patch.object(alerts, "get_delivery_day_for_time", return_value="monday"), patch.object(jobs, "enqueue_weekly", side_effect=enqueue):
            response = alerts.send_due_weekly_reports(SimpleNamespace(headers={}))
        self.assertEqual(response.failed_count, 1)
        self.assertEqual(response.queued_count, 1)


if __name__ == "__main__":
    unittest.main()
