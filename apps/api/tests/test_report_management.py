import json
import unittest
from unittest.mock import patch

from fastapi import HTTPException

from app.db.models import Dataset, WeeklyReportPreference
from app.modules.decisions.models import Decision
from app.modules.reports import router
from app.modules.reports.models import BusinessReport
from tests import test_business_reports as fixtures


class ReportManagementTests(unittest.TestCase):
    def setUp(self):
        fixtures.BusinessReportWorkflowTests.setUp(self)
        self.report = fixtures.BusinessReportWorkflowTests.save(self)
        self.report_id = self.report["report_id"]
        with self.Session() as db:
            preference = WeeklyReportPreference(workspace_id="owner", enabled=1, business_report_id=self.report_id,
                recipient_emails='["owner@example.test"]', cadence="weekly", delivery_day="friday", metric_focus='["1:spend","2:net_sales"]')
            decision = Decision(clerk_user_id="owner", workspace_id="owner", dataset_id=1,
                title="Hold campaign spending steady", action="Hold spending steady for two weeks", status="planned",
                recommendation_context=json.dumps({"evidence_kind": "business_report", "report_id": self.report_id, "metrics": self.report["metrics"], "definition": self.report["definition"]}))
            decision.evidence_dataset_ids = [1, 2]
            db.add_all([preference, decision]); db.commit()
            self.decision_id = decision.id

    def test_weekly_template_can_be_inspected_without_loading_any_source_files(self):
        with patch.object(router, "load_dataframe_from_dataset", side_effect=AssertionError("No file reads")):
            response = self.client.get("/api/v2/business-reports/weekly-template")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), {"report_id": self.report_id, "name": self.report["name"], "enabled": True})
        self.assertIsNone(self.client.get("/api/v2/business-reports/weekly-template", headers={"X-Workspace-Id": "other"}).json()["report_id"])

    def test_removing_template_keeps_report_decisions_recipients_and_schedule_but_pauses_sends(self):
        for _ in range(2):
            response = self.client.delete(f"/api/v2/business-reports/weekly-template?report_id={self.report_id}")
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json(), {"report_id": None, "name": None, "enabled": False})
        with self.Session() as db:
            self.assertIsNotNone(db.get(BusinessReport, self.report_id))
            self.assertIsNotNone(db.get(Decision, self.decision_id))
            preference = db.query(WeeklyReportPreference).one()
            self.assertIsNone(preference.business_report_id)
            self.assertIsNone(preference.metric_focus)
            self.assertEqual(preference.enabled, 0)
            self.assertEqual(preference.delivery_day, "friday")
            self.assertEqual(json.loads(preference.recipient_emails), ["owner@example.test"])

    def test_deleting_selected_template_report_preserves_linked_decision_evidence_and_datasets(self):
        with self.Session() as db:
            evidence = db.get(Decision, self.decision_id).recommendation_context
        response = self.client.delete(f"/api/v2/business-reports/{self.report_id}")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.json()["weekly_template_removed"])
        self.assertEqual(self.client.get(f"/api/v2/business-reports/{self.report_id}").status_code, 404)
        self.assertEqual(self.client.post(f"/api/v2/business-reports/{self.report_id}/weekly").status_code, 404)
        self.assertEqual(self.client.get("/api/v2/business-reports").json(), [])
        with self.Session() as db:
            self.assertEqual(db.get(Decision, self.decision_id).recommendation_context, evidence)
            self.assertIsNotNone(db.get(Dataset, 1))
            preference = db.query(WeeklyReportPreference).one()
            self.assertIsNone(preference.business_report_id)
            self.assertEqual(preference.enabled, 0)
            self.assertEqual(preference.delivery_day, "friday")

    def test_deleting_another_snapshot_does_not_pause_the_current_weekly_template(self):
        another = fixtures.BusinessReportWorkflowTests.save(self)
        response = self.client.delete(f"/api/v2/business-reports/{another['report_id']}")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertFalse(response.json()["weekly_template_removed"])
        with self.Session() as db:
            preference = db.query(WeeklyReportPreference).one()
            self.assertEqual(preference.business_report_id, self.report_id)
            self.assertEqual(preference.enabled, 1)

    def test_cross_workspace_and_read_only_deletions_are_rejected(self):
        response = self.client.delete(f"/api/v2/business-reports/{self.report_id}", headers={"X-Workspace-Id": "other"})
        self.assertEqual(response.status_code, 404)
        with patch.object(router, "require_workspace_data_manager", side_effect=HTTPException(403, "Read only")):
            self.assertEqual(self.client.delete(f"/api/v2/business-reports/{self.report_id}").status_code, 403)
            self.assertEqual(self.client.delete(f"/api/v2/business-reports/weekly-template?report_id={self.report_id}").status_code, 403)
        with self.Session() as db:
            self.assertIsNotNone(db.get(BusinessReport, self.report_id))
            self.assertEqual(db.query(WeeklyReportPreference).one().enabled, 1)

    def test_stale_template_delete_cannot_remove_a_different_replacement(self):
        another = fixtures.BusinessReportWorkflowTests.save(self)
        self.client.post(f"/api/v2/business-reports/{another['report_id']}/weekly")
        response = self.client.delete(f"/api/v2/business-reports/weekly-template?report_id={self.report_id}")
        self.assertEqual(response.status_code, 409)
        with self.Session() as db:
            preference = db.query(WeeklyReportPreference).one()
            self.assertEqual(preference.business_report_id, another["report_id"])
            self.assertEqual(preference.enabled, 1)

    def test_report_metadata_can_be_deleted_even_if_its_datasets_are_no_longer_available(self):
        with self.Session() as db:
            report = db.get(BusinessReport, self.report_id)
            value = json.loads(report.definition)
            value["metrics"][0]["dataset_id"] = 999
            report.definition = json.dumps(value)
            db.commit()
        self.assertEqual(self.client.delete(f"/api/v2/business-reports/{self.report_id}").status_code, 200)

    def test_stale_template_removal_does_not_pause_a_reenabled_default_report(self):
        with self.Session() as db:
            preference = db.query(WeeklyReportPreference).one()
            preference.business_report_id = None
            db.commit()
        response = self.client.delete(f"/api/v2/business-reports/weekly-template?report_id={self.report_id}")
        self.assertEqual(response.status_code, 409)
        with self.Session() as db:
            self.assertEqual(db.query(WeeklyReportPreference).one().enabled, 1)


if __name__ == "__main__":
    unittest.main()
