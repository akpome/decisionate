import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import pandas as pd
from fastapi import HTTPException

from app.db.models import AppUser, Organization, OrganizationMember, WeeklyReportDeliveryLog, WeeklyReportPreference
from app.infrastructure import analysis_worker as worker
from app.modules.alerts import router as alerts
from app.modules.alerts.schemas import WeeklyReportPreferenceUpdate
from app.modules.reports import jobs
from app.modules.reports.models import ReportAnalysisJob
from tests import test_business_reports as fixtures


class WeeklyAutomaticOwnerDeliveryTests(unittest.TestCase):
    def setUp(self):
        fixtures.BusinessReportWorkflowTests.setUp(self)
        for _, frame in self.frames.values():
            frame["date"] = pd.date_range(end=pd.Timestamp.now(tz="UTC").tz_localize(None).normalize(), periods=len(frame))
        with self.Session() as db:
            db.add(AppUser(id="owner", email="actual-owner@example.test"))
            db.add(Organization(name="Owner workspace", owner_user_id="owner"))
            db.commit()
        self.save_report()

    def save_report(self):
        response = self.client.put("/api/v2/business-reports/weekly-settings",
                                   json=fixtures.definition(grain="weekly", include_relationships=False, include_anomalies=False))
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def configure(self, *, enabled=True, recipients=None):
        with patch.object(alerts, "SessionLocal", self.Session), \
             patch.object(alerts, "get_auth_context", return_value=SimpleNamespace(workspace_id="owner", workspace_role="owner")):
            return asyncio.run(alerts.update_weekly_report_preference(SimpleNamespace(), WeeklyReportPreferenceUpdate(
                enabled=enabled, recipient_emails=recipients or [], metric_focus=["1:spend", "2:net_sales"])))

    def enqueue(self):
        with self.Session() as db:
            return jobs.enqueue_weekly(db, "owner", "owner", db.query(WeeklyReportPreference).one(),
                                       send=True, scheduled=True, include_ai=False).id

    def execute(self, identity):
        with patch.object(alerts, "load_dataframe_from_dataset", side_effect=lambda dataset: self.frames[dataset.id][1].copy()), \
             patch.object(alerts, "send_weekly_report_email", side_effect=lambda digest: {
                 "recipients": digest.recipient_emails, "delivered_count": len(digest.recipient_emails)}) as send:
            worker.execute_job(identity)
        return send

    def test_saving_enables_monday_delivery_without_configuring_recipients_or_sending(self):
        with self.Session() as db:
            preference = db.query(WeeklyReportPreference).one()
            self.assertEqual(preference.enabled, 1)
            self.assertEqual(preference.delivery_day, "monday")
            self.assertFalse(preference.delivery_settings_configured)
            self.assertIsNone(preference.recipient_emails)
            self.assertEqual(db.query(WeeklyReportDeliveryLog).count(), 0)
            self.assertEqual(db.query(ReportAnalysisJob).count(), 0)

    def test_scheduler_sends_to_owner_once_without_email_configuration(self):
        with patch.object(alerts, "SessionLocal", self.Session), patch.object(alerts, "require_alerts_scheduler_secret"), \
             patch.object(alerts, "get_delivery_day_for_time", return_value="monday"):
            for _ in range(2):
                result = alerts.send_due_weekly_reports(SimpleNamespace(headers={}))
                self.assertEqual(result.queued_count, 1)
                self.assertEqual(result.failed_count, 0)
        with self.Session() as db:
            identity = db.query(ReportAnalysisJob).one().id
        send = self.execute(identity)
        worker.execute_job(identity)
        send.assert_called_once()
        self.assertEqual(send.call_args.args[0].recipient_emails, ["actual-owner@example.test"])
        with self.Session() as db:
            self.assertEqual(db.get(ReportAnalysisJob, identity).status, "succeeded")
            self.assertEqual(db.query(WeeklyReportDeliveryLog).one().status, "sent")
            self.assertEqual(db.query(WeeklyReportPreference).one().last_send_status, "sent")
            self.assertIsNone(db.query(WeeklyReportPreference).one().recipient_emails)

    def test_additional_recipients_include_owner_once(self):
        self.configure(recipients=["team@example.test", "ACTUAL-OWNER@example.test", "team@example.test"])
        send = self.execute(self.enqueue())
        send.assert_called_once()
        self.assertEqual(send.call_args.args[0].recipient_emails, ["actual-owner@example.test", "team@example.test"])

    def test_explicit_pause_survives_saving_report_and_sending_test(self):
        self.configure(enabled=False)
        self.assertFalse(self.save_report()["enabled"])
        send = self.send_test()
        send.assert_called_once()
        self.assertFalse(self.save_report()["enabled"])
        with self.Session() as db:
            preference = db.query(WeeklyReportPreference).one()
            self.assertTrue(preference.delivery_settings_configured)
            with self.assertRaises(HTTPException):
                jobs.enqueue_weekly(db, "owner", "owner", preference, send=True, scheduled=True)

    def send_test(self):
        with patch.object(alerts, "SessionLocal", self.Session), \
             patch.object(alerts, "get_auth_context", return_value=SimpleNamespace(workspace_id="owner", workspace_role="owner")), \
             patch.object(alerts, "send_weekly_report_email", side_effect=lambda digest: {
                 "recipients": digest.recipient_emails, "delivered_count": len(digest.recipient_emails)}) as send:
            result = asyncio.run(alerts.send_weekly_report_test_email(SimpleNamespace()))
        self.assertEqual(result.delivered_count, len(send.call_args.args[0].recipient_emails))
        return send

    def test_test_email_works_without_saved_report_or_data_or_addresses(self):
        with self.Session() as db:
            db.query(WeeklyReportPreference).delete()
            db.commit()
        with patch.object(alerts, "load_dataframe_from_dataset", side_effect=AssertionError("A test must not load report data")):
            send = self.send_test()
        digest = send.call_args.args[0]
        self.assertEqual(digest.recipient_emails, ["actual-owner@example.test"])
        self.assertEqual(digest.metrics, [])
        with self.Session() as db:
            self.assertEqual(db.query(WeeklyReportPreference).count(), 0)
            self.assertEqual(db.query(WeeklyReportDeliveryLog).one().status, "test_sent")

    def test_test_email_includes_saved_additional_recipients(self):
        self.configure(recipients=["team@example.test"])
        self.assertEqual(self.send_test().call_args.args[0].recipient_emails,
                         ["actual-owner@example.test", "team@example.test"])

    def test_saving_test_addresses_before_first_report_does_not_disable_default_delivery(self):
        with self.Session() as db:
            db.query(WeeklyReportPreference).delete()
            db.commit()
        self.configure(enabled=False, recipients=["team@example.test"])
        self.send_test()
        self.assertTrue(self.save_report()["enabled"])
        send = self.execute(self.enqueue())
        send.assert_called_once()
        self.assertEqual(send.call_args.args[0].recipient_emails, ["actual-owner@example.test", "team@example.test"])

    def test_insufficient_current_week_data_still_blocks_delivery(self):
        for _, frame in self.frames.values():
            frame["date"] = pd.date_range("2025-01-01", periods=len(frame))
        identity = self.enqueue()
        self.execute(identity).assert_not_called()
        with self.Session() as db:
            job = db.get(ReportAnalysisJob, identity)
            self.assertEqual(job.status, "failed")
            self.assertEqual(job.error_status, 400)
            self.assertTrue(jobs.job_response(job)["retry_safe"])

    def test_owner_change_prevents_queued_send(self):
        identity = self.enqueue()
        with self.Session() as db:
            db.get(AppUser, "owner").email = "replacement@example.test"
            db.commit()
        self.execute(identity).assert_not_called()
        with self.Session() as db:
            self.assertIn("owner's email changed", db.get(ReportAnalysisJob, identity).error)

    def test_managed_workspace_includes_client_owner_not_agency_owner(self):
        with self.Session() as db:
            organization = Organization(name="Client", owner_user_id="owner:client:example")
            db.add(organization)
            db.flush()
            db.add(AppUser(id="client-owner", email="client@example.test"))
            db.add(OrganizationMember(organization_id=organization.id, clerk_user_id="client-owner", role="client_owner"))
            db.commit()
            self.assertEqual(jobs.weekly_delivery_recipients(db, organization.owner_user_id, ["team@example.test"]),
                             ["client@example.test", "team@example.test"])

    def test_additional_recipient_change_invalidates_queued_send(self):
        identity = self.enqueue()
        self.configure(recipients=["new@example.test"])
        self.execute(identity).assert_not_called()
        with self.Session() as db:
            self.assertIn("settings changed", db.get(ReportAnalysisJob, identity).error)

    def test_missing_owner_blocks_send_instead_of_sending_only_to_additional_addresses(self):
        self.configure(recipients=["team@example.test"])
        with self.Session() as db:
            db.get(AppUser, "owner").email = None
            db.commit()
        with self.assertRaises(HTTPException):
            self.enqueue()
        with patch.object(alerts, "send_weekly_report_email") as send:
            with self.assertRaises(HTTPException):
                self.send_test()
        send.assert_not_called()
