import copy
import json
import unittest
from unittest.mock import patch

from app.infrastructure import analysis_worker as worker
from app.modules.decisions.activity_models import DecisionActivity
from app.modules.decisions.models import Decision
from app.modules.reports import router
from app.modules.reports.cleanup import cleanup_source, cleanup_workspace
from app.modules.reports.models import BusinessReport, CurrentWeeklyReport, DecisionImpactReview, ReportAnalysisJob
from tests import test_business_impact as fixtures


class DecisionImpactReviewTests(unittest.TestCase):
    def setUp(self):
        fixtures.BusinessImpactWorkflowTests.setUp(self)

    def enqueue(self, **updates):
        payload = copy.deepcopy(self.definition)
        payload["impact"].update(updates)
        response = self.client.post("/api/v2/business-reports/jobs", json=payload)
        self.assertEqual(response.status_code, 202, response.text)
        return response.json()["job_id"]

    def save(self):
        identity = self.enqueue()
        worker.execute_job(identity)
        response = self.client.post(f"/api/v2/business-reports/jobs/{identity}/save")
        self.assertEqual(response.status_code, 201, response.text)
        return identity, response.json()

    def weekly_preview(self):
        payload = copy.deepcopy(self.definition)
        response = self.client.post("/api/v2/business-reports/weekly-preview-jobs", json=payload)
        self.assertEqual(response.status_code, 202, response.text)
        identity = response.json()["job_id"]
        with patch("app.modules.alerts.router.load_dataframe_from_dataset", side_effect=lambda dataset: self.frames[dataset.id][1].copy()):
            worker.execute_job(identity)
        result = self.client.get(f"/api/v2/business-reports/jobs/{identity}").json()
        self.assertEqual(result["status"], "succeeded", result)
        return identity

    def test_weekly_preview_does_not_attach_an_assessment_until_the_single_explicit_save(self):
        from app.db.models import WeeklyReportPreference

        identity = self.weekly_preview()
        with self.Session() as db:
            self.assertEqual(db.query(DecisionImpactReview).count(), 0)
            self.assertEqual(db.query(BusinessReport).count(), 0)
            self.assertEqual(db.query(WeeklyReportPreference).count(), 0)
        response = self.client.post(f"/api/v2/business-reports/jobs/{identity}/save-weekly")
        self.assertEqual(response.status_code, 201, response.text)
        self.assertTrue(response.json()["report"]["decision_review_id"])
        again = self.client.post(f"/api/v2/business-reports/jobs/{identity}/save-weekly")
        self.assertEqual(response.json()["report"]["report_id"], again.json()["report"]["report_id"])
        with self.Session() as db:
            self.assertEqual(db.query(Decision).count(), 1)
            self.assertEqual(db.query(DecisionImpactReview).count(), 1)
            self.assertEqual(db.query(BusinessReport).count(), 1)
            self.assertEqual(db.query(WeeklyReportPreference).count(), 1)
            self.assertEqual(db.query(DecisionActivity).count(), 1)

    def test_changed_decision_blocks_saving_the_weekly_preview_and_setup(self):
        from app.db.models import WeeklyReportPreference

        identity = self.weekly_preview()
        with self.Session() as db:
            db.get(Decision, self.decision_id).action = "A different business action"
            db.commit()
        response = self.client.post(f"/api/v2/business-reports/jobs/{identity}/save-weekly")
        self.assertEqual(response.status_code, 409, response.text)
        with self.Session() as db:
            self.assertEqual(db.query(DecisionImpactReview).count(), 0)
            self.assertEqual(db.query(BusinessReport).count(), 0)
            self.assertEqual(db.query(WeeklyReportPreference).count(), 0)

    def test_replacing_current_weekly_assessment_preserves_previous_decision_evidence(self):
        first = self.weekly_preview()
        original = self.client.post(f"/api/v2/business-reports/jobs/{first}/save-weekly").json()["report"]
        second = self.weekly_preview()
        updated = self.client.post(f"/api/v2/business-reports/jobs/{second}/save-weekly")
        self.assertEqual(updated.status_code, 201, updated.text)
        self.assertNotEqual(updated.json()["report"]["report_id"], original["report_id"])
        original_again = self.client.get(f"/api/v2/business-reports/{original['report_id']}").json()
        self.assertEqual(original_again["impact_analysis"], original["impact_analysis"])
        self.assertEqual(original_again["decision_review_id"], original["decision_review_id"])
        self.assertEqual(self.client.get("/api/v2/business-reports?workflow=weekly").json(), [])
        with self.Session() as db:
            self.assertEqual(db.query(CurrentWeeklyReport).count(), 1)
            self.assertEqual(db.query(DecisionImpactReview).count(), 2)
            self.assertEqual(db.query(Decision).count(), 1)
            db.get(Decision, self.decision_id).action = "Updated action"
            db.commit()
        # A historical assessment must not prevent opening and editing the setup.
        self.assertEqual(self.client.get("/api/v2/business-reports/weekly-settings").status_code, 200)

    def test_choices_and_prefill_reuse_existing_action_outcome_and_revision_without_loading_files(self):
        with self.Session() as db:
            db.get(Decision, self.decision_id).recommendation_context = json.dumps({
                "evidence_kind": "business_report", "report_id": "original-correlation",
                "definition": {"scope": "multi", "metrics": self.definition["metrics"]},
            })
            db.commit()
        with patch.object(router, "load_dataframe_from_dataset", side_effect=AssertionError("No source scans")):
            choices = self.client.get("/api/v2/business-reports/review-decisions").json()
            self.assertEqual([item["id"] for item in choices["decisions"]], [self.decision_id])
            context = self.client.get(f"/api/v2/business-reports/review-decisions/{self.decision_id}").json()
        self.assertEqual(context["decision"]["action"], self.definition["impact"]["change"])
        self.assertEqual(context["outcome"], {"dataset_id": 1, "metric_key": "orders"})
        self.assertTrue(context["decision_revision"])
        self.assertIsNone(context["latest_review"])
        self.assertIsNone(context["decision_period"])

    def test_prefill_uses_the_decisions_saved_evidence_period_and_date_column_without_scanning_sources(self):
        evidence = {"evidence_kind": "business_report", "definition": {"date_range": {"start": "2024-01-01", "end": "2025-12-28"},
                    "metrics": [{"dataset_id": 1, "metric_key": "orders", "date_column": "sale_date"}]}}
        with self.Session() as db:
            db.get(Decision, self.decision_id).recommendation_context = json.dumps(evidence)
            db.commit()
        with patch.object(router, "load_dataframe_from_dataset", side_effect=AssertionError("No source scans")):
            response = self.client.get(f"/api/v2/business-reports/review-decisions/{self.decision_id}")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["decision_period"], evidence["definition"]["date_range"])
        self.assertEqual(response.json()["outcome_date_column"], "sale_date")

    def test_invalid_or_unrelated_evidence_cannot_invent_a_decision_period(self):
        from app.modules.reports.decision_reviews import decision_data_period
        from types import SimpleNamespace

        outcome = {"dataset_id": 1, "metric_key": "orders"}
        for value in ("bad-json", "[]", '{"evidence_kind":"other"}', json.dumps({"evidence_kind": "business_report",
                "definition": {"metrics": [{"dataset_id": 2, "metric_key": "orders"}], "date_range": {"start": "2024-01-01", "end": "2025-01-01"}}})):
            self.assertEqual(decision_data_period(SimpleNamespace(recommendation_context=value), outcome), (None, None))
        evidence = {"evidence_kind": "business_report", "definition": {"metrics": [{**outcome, "date_column": "date"}],
                    "date_range": {"start": "not-a-date", "end": "2025-01-01"}}}
        self.assertEqual(decision_data_period(SimpleNamespace(recommendation_context=json.dumps(evidence)), outcome), (None, "date"))

    def test_one_idempotent_assessment_updates_the_same_decision_without_replacing_its_outcome_or_reasoning(self):
        with self.Session() as db:
            decision = db.get(Decision, self.decision_id)
            decision.actual_outcome, decision.lessons_learned, decision.notes = "Human outcome", "Human lesson", "Human notes"
            decision.recommendation_context = '{"original_evidence":true}'
            db.commit()
        identity, saved = self.save()
        second = self.client.post(f"/api/v2/business-reports/jobs/{identity}/save").json()
        self.assertEqual(saved["decision_review_id"], second["decision_review_id"])
        self.assertEqual(saved["report_id"], second["report_id"])
        self.assertEqual(saved["review_decision"]["id"], self.decision_id)
        with self.Session() as db:
            self.assertEqual(db.query(Decision).count(), 1)
            self.assertEqual(db.query(DecisionImpactReview).count(), 1)
            self.assertEqual(db.query(DecisionActivity).count(), 1)
            decision = db.get(Decision, self.decision_id)
            self.assertEqual((decision.actual_outcome, decision.lessons_learned, decision.notes), ("Human outcome", "Human lesson", "Human notes"))
            self.assertEqual(decision.recommendation_context, '{"original_evidence":true}')
            self.assertIsNone(decision.outcome_status)
            self.assertIsNone(decision.outcome_measured_value)
        history = self.client.get(f"/api/v2/business-reports/decision-reviews/{self.decision_id}").json()
        self.assertEqual(len(history["reviews"]), 1)
        self.assertEqual(history["reviews"][0]["analysis"], saved["impact_analysis"])

    def test_missing_decision_is_rejected_instead_of_creating_a_parallel_action(self):
        payload = copy.deepcopy(self.definition)
        payload["impact"]["decision_id"] = None
        with patch.object(router, "load_dataframe_from_dataset") as load:
            response = self.client.post("/api/v2/business-reports/jobs", json=payload)
            self.assertEqual(response.status_code, 400, response.text)
            load.assert_not_called()

    def test_wrong_workspace_and_nonexistent_decisions_are_not_disclosed(self):
        with self.Session() as db:
            db.add(Decision(id=99, clerk_user_id="other", workspace_id="other", dataset_id=3, title="Private action", action="Private decision action"))
            db.commit()
        for identity in (99, 999):
            path = f"/api/v2/business-reports/review-decisions/{identity}"
            self.assertEqual(self.client.get(path).status_code, 404)
            payload = copy.deepcopy(self.definition); payload["impact"]["decision_id"] = identity
            self.assertEqual(self.client.post("/api/v2/business-reports/jobs", json=payload).status_code, 404)
        self.assertEqual(self.client.get(f"/api/v2/business-reports/decision-reviews/{self.decision_id}", headers={"X-Workspace-Id": "other"}).status_code, 404)

    def test_tampered_action_cannot_replace_the_decisions_real_action(self):
        identity = self.enqueue(change="An invented business action")
        with self.Session() as db:
            study = json.loads(db.get(ReportAnalysisJob, identity).definition)["impact"]
            self.assertEqual(study["change"], self.definition["impact"]["change"])
            self.assertTrue(study["decision_revision"])

    def test_review_outcome_cannot_be_a_different_selected_metric(self):
        payload = copy.deepcopy(self.definition)
        payload["impact"]["outcome"], payload["impact"]["comparison"] = payload["impact"]["comparison"], payload["impact"]["outcome"]
        self.assertEqual(self.client.post("/api/v2/business-reports/jobs", json=payload).status_code, 409)

    def test_action_change_before_execution_rejects_the_queued_assessment(self):
        identity = self.enqueue()
        with self.Session() as db:
            db.get(Decision, self.decision_id).action = "Changed the business action"
            db.commit()
        with patch.object(router, "load_dataframe_from_dataset", side_effect=AssertionError("Stale action")):
            worker.execute_job(identity)
        with self.Session() as db:
            job = db.get(ReportAnalysisJob, identity)
            self.assertEqual(job.status, "failed")
            self.assertEqual(job.error_status, 409)

    def test_decision_change_during_computation_cannot_publish_an_assessment(self):
        identity = self.enqueue()
        calculate = router.build_report
        def change(*args, **kwargs):
            result = calculate(*args, **kwargs)
            with self.Session() as db:
                db.get(Decision, self.decision_id).expected_outcome = "A different target"
                db.commit()
            return result
        with patch.object(router, "build_report", side_effect=change):
            worker.execute_job(identity)
        with self.Session() as db:
            job = db.get(ReportAnalysisJob, identity)
            self.assertEqual(job.status, "failed")
            self.assertIsNone(job.result)

    def test_changed_decision_after_preview_cannot_receive_a_stale_saved_assessment(self):
        identity = self.enqueue()
        worker.execute_job(identity)
        with self.Session() as db:
            db.get(Decision, self.decision_id).metric_column = "another_metric"
            db.commit()
        self.assertEqual(self.client.post(f"/api/v2/business-reports/jobs/{identity}/save").status_code, 409)
        with self.Session() as db:
            self.assertEqual(db.query(DecisionImpactReview).count(), 0)
            self.assertEqual(db.query(BusinessReport).count(), 0)

    def test_clients_cannot_submit_or_attach_reviews_even_when_they_can_save_reports(self):
        identity = self.enqueue(); worker.execute_job(identity)
        for role in ("client_owner", "client_viewer", "viewer"):
            with patch.object(router, "get_workspace_role", return_value=role):
                self.assertEqual(self.client.post("/api/v2/business-reports/jobs", json=self.definition).status_code, 403)
                self.assertEqual(self.client.post(f"/api/v2/business-reports/jobs/{identity}/save").status_code, 403)
        with self.Session() as db:
            self.assertEqual(db.query(DecisionImpactReview).count(), 0)

    def test_archived_decisions_keep_assessments_but_cannot_receive_new_ones(self):
        _, saved = self.save()
        with self.Session() as db:
            db.get(Decision, self.decision_id).status = "archived"
            db.commit()
        self.assertEqual(self.client.post("/api/v2/business-reports/jobs", json=self.definition).status_code, 409)
        result = self.client.get(f"/api/v2/business-reports/decision-reviews/{self.decision_id}").json()
        self.assertEqual(result["reviews"][0]["analysis"], saved["impact_analysis"])

    def test_report_deletion_keeps_the_assessment_on_the_decision(self):
        _, saved = self.save()
        self.assertEqual(self.client.delete(f"/api/v2/business-reports/{saved['report_id']}").status_code, 200)
        result = self.client.get(f"/api/v2/business-reports/decision-reviews/{self.decision_id}").json()["reviews"][0]
        self.assertIsNone(result["report_id"])
        self.assertEqual(result["analysis"], saved["impact_analysis"])
        with self.Session() as db:
            cleanup_source(db, 2); db.commit()
            self.assertEqual(db.query(DecisionImpactReview).count(), 0)

    def test_source_and_workspace_cleanup_remove_derived_assessments(self):
        for clean, identity in ((cleanup_source, 2), (cleanup_workspace, "owner")):
            self.save()
            with self.Session() as db:
                clean(db, identity); db.commit()
                self.assertEqual(db.query(DecisionImpactReview).count(), 0)

    def test_saved_assessments_are_immutable_but_mark_changed_action_as_historical(self):
        _, saved = self.save()
        with self.Session() as db:
            db.get(Decision, self.decision_id).action = "A new business action"
            db.commit()
        history = self.client.get(f"/api/v2/business-reports/decision-reviews/{self.decision_id}").json()
        self.assertFalse(history["reviews"][0]["matches_current_decision"])
        self.assertEqual(history["reviews"][0]["analysis"], saved["impact_analysis"])

    def test_weekly_settings_save_the_authoritative_action_and_revision_not_a_client_supplied_copy(self):
        from app.db.models import WeeklyReportPreference
        payload = copy.deepcopy(self.definition)
        payload["impact"]["change"] = "Invented action from an old client"
        response = self.client.put("/api/v2/business-reports/weekly-settings", json=payload)
        self.assertEqual(response.status_code, 200, response.text)
        with self.Session() as db:
            study = json.loads(db.query(WeeklyReportPreference).one().weekly_report_definition)["impact"]
            self.assertEqual(study["change"], self.definition["impact"]["change"])
            self.assertTrue(study["decision_revision"])

    def test_job_expiry_does_not_remove_a_saved_decision_assessment(self):
        identity, saved = self.save()
        with self.Session() as db:
            db.query(ReportAnalysisJob).filter_by(id=identity).delete(); db.commit()
        history = self.client.get(f"/api/v2/business-reports/decision-reviews/{self.decision_id}").json()
        self.assertEqual(history["reviews"][0]["analysis"], saved["impact_analysis"])

    def test_revoked_source_access_hides_evidence_without_lying_that_no_assessment_exists(self):
        from app.db.models import Dataset
        self.save()
        with self.Session() as db:
            db.get(Dataset, 2).workspace_id = "other"
            db.commit()
        response = self.client.get(f"/api/v2/business-reports/decision-reviews/{self.decision_id}")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["reviews"], [])
        self.assertTrue(response.json()["restricted"])

    def test_legacy_standalone_snapshot_remains_readable_without_creating_another_decision(self):
        from app.modules.reports.service import build_report
        legacy = copy.deepcopy(self.definition)
        legacy["impact"].pop("decision_id", None)
        legacy["impact"].pop("decision_revision", None)
        result = build_report(self.frames, legacy)
        with self.Session() as db:
            report = BusinessReport(user_id="owner", workspace_id="owner", name=legacy["name"], definition=json.dumps(legacy), snapshot=json.dumps(result))
            db.add(report); db.commit(); identity = report.id
        response = self.client.get(f"/api/v2/business-reports/{identity}")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["impact_analysis"], result["impact_analysis"])
        self.assertNotIn("review_decision", response.json())
        self.assertEqual(self.client.post("/api/v2/business-reports/jobs", json=legacy).status_code, 400)
