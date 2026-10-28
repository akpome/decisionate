import json
import unittest
from unittest.mock import patch

import pandas as pd

from app.db.models import AppUser, Dataset, Organization, OrganizationMember, WeeklyReportDeliveryLog, WeeklyReportPreference
from app.infrastructure import analysis_worker as worker
from app.modules.alerts import router as alerts
from app.modules.reports import jobs
from app.modules.reports.models import ReportAnalysisJob
from tests import test_business_reports as fixtures


class WeeklyOwnerSendTests(unittest.TestCase):
    def setUp(self):
        fixtures.BusinessReportWorkflowTests.setUp(self)
        for _, frame in self.frames.values():
            frame["date"] = pd.date_range(end=pd.Timestamp.now(tz="UTC").tz_localize(None).normalize(), periods=len(frame))
        with self.Session() as db:
            db.add(AppUser(id="owner", email="actual-owner@example.test"))
            db.add(Organization(name="Owner workspace", owner_user_id="owner"))
            db.commit()
        response = self.client.put("/api/v2/business-reports/weekly-settings", json=fixtures.definition(grain="weekly"))
        self.assertEqual(response.status_code, 200, response.text)
        with self.Session() as db:
            preference = db.query(WeeklyReportPreference).one()
            preference.recipient_emails = '["scheduled-recipient@example.test"]'
            db.commit()

    def enqueue(self, key="owner-send", *, include_ai=False):
        return self.client.post(f"/api/v2/business-reports/weekly-owner-jobs?include_ai_analysis={str(include_ai).lower()}",
                                headers={"Idempotency-Key": key})

    def execute(self, identity, **send_options):
        with patch.object(alerts, "load_dataframe_from_dataset", side_effect=lambda dataset: self.frames[dataset.id][1].copy()), \
             patch.object(alerts, "send_weekly_report_email", **send_options) as send:
            worker.execute_job(identity)
        return send

    def test_paused_schedule_can_send_once_to_owner_without_changing_preferences(self):
        first, second = self.enqueue(), self.enqueue()
        self.assertEqual(first.status_code, 202, first.text)
        identity = first.json()["job_id"]
        self.assertEqual(second.json()["job_id"], identity)
        self.assertEqual(first.json()["kind"], "weekly_owner_send")
        send = self.execute(identity, return_value={"recipients": ["actual-owner@example.test"], "delivered_count": 1})
        worker.execute_job(identity)
        send.assert_called_once()
        digest = send.call_args.args[0]
        self.assertEqual(digest.recipient_emails, ["actual-owner@example.test"])
        self.assertTrue(digest.enabled)
        self.assertEqual(digest.cross_dataset_report["grain"], "daily")
        with self.Session() as db:
            self.assertEqual(db.get(ReportAnalysisJob, identity).status, "succeeded")
            preference = db.query(WeeklyReportPreference).one()
            self.assertFalse(preference.enabled)
            self.assertIsNone(preference.last_sent_at)
            self.assertIsNone(preference.last_send_status)
            self.assertEqual(json.loads(preference.recipient_emails), ["scheduled-recipient@example.test"])
            log = db.query(WeeklyReportDeliveryLog).one()
            self.assertEqual(json.loads(log.recipient_emails), ["actual-owner@example.test"])

    def test_template_send_only_loads_and_snapshots_selected_datasets(self):
        with self.Session() as db:
            db.add(Dataset(id=4, user_id="owner", workspace_id="owner", file_name="Unrelated large dataset",
                           file_path="do-not-load.csv", source_type="csv", row_count=1000000, column_count=300))
            db.commit()
        identity = self.enqueue().json()["job_id"]
        with self.Session() as db:
            self.assertEqual(set(json.loads(db.get(ReportAnalysisJob, identity).sources)), {"1", "2"})
            db.get(Dataset, 4).row_count += 1
            db.commit()
        send = self.execute(identity, return_value={"recipients": ["actual-owner@example.test"], "delivered_count": 1})
        send.assert_called_once()
        self.assertEqual(send.call_args.args[0].dataset_count, 2)

    def test_historical_files_fail_with_actual_week_and_no_external_send_or_ai_call(self):
        for _, frame in self.frames.values():
            frame["date"] = pd.date_range("2025-01-01", periods=len(frame))
        identity = self.enqueue(include_ai=True).json()["job_id"]
        with patch.object(alerts, "generate_structured_analysis") as ai:
            send = self.execute(identity)
        send.assert_not_called(); ai.assert_not_called()
        with self.Session() as db:
            job = db.get(ReportAnalysisJob, identity)
            self.assertEqual(job.status, "failed")
            self.assertEqual(job.error_status, 400)
            window = alerts.complete_week()
            self.assertIn(window["start"], job.error)
            self.assertIn(window["end"], job.error)
            self.assertIn("Business Analysis", job.error)
            self.assertTrue(jobs.job_response(job)["retry_safe"])
            self.assertIsNone(jobs.job_response(job, include_result=True)["result"])

    def test_owner_email_is_rechecked_before_execution(self):
        identity = self.enqueue().json()["job_id"]
        with self.Session() as db:
            db.get(AppUser, "owner").email = "changed-owner@example.test"
            db.commit()
        send = self.execute(identity)
        send.assert_not_called()
        with self.Session() as db:
            job = db.get(ReportAnalysisJob, identity)
            self.assertEqual(job.status, "failed")
            self.assertIn("email changed", job.error)

    def test_owner_change_during_calculation_prevents_the_external_send(self):
        identity = self.enqueue().json()["job_id"]
        calculate = alerts.build_weekly_report_digest_for_workspace
        def change_owner(*args, **kwargs):
            digest = calculate(*args, **kwargs)
            with self.Session() as db:
                db.get(AppUser, "owner").email = "changed-owner@example.test"
                db.commit()
            return digest
        with patch.object(alerts, "build_weekly_report_digest_for_workspace", side_effect=change_owner):
            send = self.execute(identity)
        send.assert_not_called()

    def test_owner_send_does_not_consume_a_scheduled_delivery_claim(self):
        with self.Session() as db:
            db.query(WeeklyReportPreference).one().enabled = 1
            db.commit()
        identity = self.enqueue().json()["job_id"]
        self.execute(identity, return_value={"recipients": ["actual-owner@example.test"], "delivered_count": 1})
        with self.Session() as db:
            preference = db.query(WeeklyReportPreference).one()
            self.assertIsNone(preference.last_sent_at)
            scheduled = jobs.enqueue_weekly(db, "owner", "owner", preference, send=True, scheduled=True, include_ai=False)
            self.assertNotEqual(scheduled.id, identity)
            self.assertNotIn("delivery", json.loads(scheduled.definition))

    def test_failure_and_interrupted_delivery_do_not_change_scheduled_delivery_state(self):
        identity = self.enqueue().json()["job_id"]
        self.execute(identity, side_effect=RuntimeError("test provider unavailable"))
        with self.Session() as db:
            preference = db.query(WeeklyReportPreference).one()
            self.assertIsNone(preference.last_send_status)
            self.assertEqual(db.get(ReportAnalysisJob, identity).status, "failed")
            self.assertFalse(jobs.job_response(db.get(ReportAnalysisJob, identity))["retry_safe"])
            job = db.get(ReportAnalysisJob, identity)
            job.status, job.phase = "running", "sending"
            db.commit()
        worker.recover_interrupted_jobs(identity)
        with self.Session() as db:
            self.assertIsNone(db.query(WeeklyReportPreference).one().last_send_status)
            self.assertIn("No automatic resend", db.get(ReportAnalysisJob, identity).error)
            self.assertFalse(jobs.job_response(db.get(ReportAnalysisJob, identity))["retry_safe"])
            self.assertTrue(all(json.loads(log.recipient_emails) == ["actual-owner@example.test"] for log in db.query(WeeklyReportDeliveryLog)))

    def test_legacy_failed_delivery_is_not_assumed_safe_to_resend(self):
        identity = self.enqueue().json()["job_id"]
        with self.Session() as db:
            job = db.get(ReportAnalysisJob, identity)
            job.status, job.phase, job.result = "failed", "failed", None
            self.assertFalse(jobs.job_response(job)["retry_safe"])

    def test_missing_owner_settings_and_readonly_access_are_rejected(self):
        with patch.object(fixtures.router, "get_workspace_role", return_value="viewer"):
            self.assertEqual(self.enqueue().status_code, 403)
        with self.Session() as db:
            db.get(AppUser, "owner").email = None
            db.commit()
        self.assertEqual(self.enqueue().status_code, 400)
        with self.Session() as db:
            db.get(AppUser, "owner").email = "actual-owner@example.test"
            db.query(WeeklyReportPreference).one().weekly_report_definition = None
            db.commit()
        self.assertEqual(self.enqueue().status_code, 400)

    def test_owner_send_cannot_be_cancelled_after_the_external_send_boundary(self):
        identity = self.enqueue().json()["job_id"]
        with self.Session() as db:
            job = db.get(ReportAnalysisJob, identity)
            job.status, job.phase = "running", "sending"
            db.commit()
        self.assertEqual(self.client.post(f"/api/v2/business-reports/jobs/{identity}/cancel").status_code, 409)

    def test_delivery_permissions_are_rechecked_for_owner_jobs(self):
        from app.modules import auth_context
        identity = self.enqueue().json()["job_id"]
        with self.Session() as db:
            db.get(ReportAnalysisJob, identity).user_id = "former-manager"
            db.commit()
        with patch.object(auth_context, "verify_workspace_membership", return_value="viewer"):
            send = self.execute(identity)
        send.assert_not_called()
        with self.Session() as db:
            self.assertEqual(db.get(ReportAnalysisJob, identity).error_status, 403)

    def test_client_workspace_owner_is_not_the_agency_owner(self):
        with self.Session() as db:
            client = Organization(name="Client workspace", owner_user_id="owner:client:one")
            db.add(client)
            db.flush()
            db.add(AppUser(id="client-owner", email="client-owner@example.test"))
            db.add(OrganizationMember(organization_id=client.id, clerk_user_id="client-owner", role="client_owner"))
            db.commit()
            self.assertEqual(jobs.weekly_owner_recipient(db, client.owner_user_id), "client-owner@example.test")
