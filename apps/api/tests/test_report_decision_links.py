import asyncio
from contextlib import ExitStack
import json
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.modules.decisions.models import Decision, DecisionDuplicate
from app.modules.decisions.titles import is_legacy_evidence_placeholder
from app.modules.reports.service import attach_report_decisions, decisions_for_report, legacy_decision_drafts
from app.modules.reports import router as reports_router
from app.modules.reports.models import BusinessReport
from app.modules.reports.schemas import ReportDefinition
from app.modules.alerts import router as alerts_router
from tests.test_business_reports import definition, fixture


class ReportDecisionLinkTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://")
        self.addCleanup(self.engine.dispose)
        Decision.__table__.create(self.engine)
        DecisionDuplicate.__table__.create(self.engine)
        self.Session = sessionmaker(bind=self.engine)

    def add(self, db, title="Shift campaign budget", action="Run a two-week budget test", report_id=None, status="planned", workspace="workspace", datasets=None):
        item = Decision(clerk_user_id="owner", workspace_id=workspace, dataset_id=1, title=title, action=action,
                        recommendation_context=json.dumps({"report_id": report_id}) if report_id else "Joined evidence from two datasets", status=status)
        item.evidence_dataset_ids = [1, 2] if datasets is None else datasets
        db.add(item)
        db.flush()
        return item

    def test_screenshot_records_are_not_decisions_for_a_report_just_because_datasets_match(self):
        with self.Session() as db:
            for title, status in (("Review joined evidence: marketing-demo.csv + revenue-demo.csv", "planned"),
                                  ("Review joined dataset evidence", "planned"), ("Review joined dataset evidence", "archived")):
                self.add(db, title=title, action=None, status=status)
            db.commit()
            self.assertEqual(decisions_for_report(db, "workspace", {1, 2}), [])
            self.assertEqual(decisions_for_report(db, "workspace", {1, 2}, "report-1"), [])
            self.assertEqual(db.query(Decision).count(), 3)

    def test_only_one_explicitly_linked_action_is_returned_and_identifies_its_report(self):
        with self.Session() as db:
            linked = self.add(db, report_id="report-1")
            self.add(db)
            self.add(db, report_id="report-2")
            self.add(db, report_id="report-1", workspace="other")
            self.add(db, report_id="report-1", datasets=[1, 3])
            db.commit()
            result = decisions_for_report(db, "workspace", {1, 2}, "report-1")
            self.assertEqual([item["id"] for item in result], [linked.id])
            self.assertEqual(result[0]["report_id"], "report-1")
            self.assertEqual(result[0]["action"], "Run a two-week budget test")

    def test_linked_generated_placeholders_are_not_outcomes_but_are_not_deleted(self):
        with self.Session() as db:
            self.add(db, title="Review joined dataset evidence", action="Review the joined metrics and agree on the next action.", report_id="report-1")
            self.add(db, title="Review joined evidence: a.csv + b.csv", action=None, report_id="report-1", status="archived")
            db.commit()
            self.assertEqual(decisions_for_report(db, "workspace", {1, 2}, "report-1"), [])
            self.assertEqual(db.query(Decision).count(), 2)

    def test_archiving_a_real_linked_decision_does_not_create_or_remove_its_report_link(self):
        with self.Session() as db:
            decision = self.add(db, report_id="report-1")
            db.commit()
            identity = decision.id
            decision.status = "archived"
            db.commit()
            result = decisions_for_report(db, "workspace", {1, 2}, "report-1")
            self.assertEqual([(item["id"], item["status"]) for item in result], [(identity, "archived")])
            self.assertEqual(db.query(Decision).count(), 1)

    def test_multiple_deliberate_actions_are_allowed_and_review_can_be_a_real_action(self):
        with self.Session() as db:
            self.add(db, report_id="report-1")
            self.add(db, report_id="report-1", title="Review supplier contracts", action="Compare renewal terms")
            self.add(db, report_id="report-1", title="Review joined dataset evidence", action="Move 10% of budget to campaign B")
            db.commit()
            self.assertEqual(len(decisions_for_report(db, "workspace", {1, 2}, "report-1")), 3)

    def test_placeholder_detection_is_narrow_and_consistent_for_legacy_title_variants(self):
        self.assertTrue(is_legacy_evidence_placeholder("Review joined evidence: a.csv + b.csv", "Review joined dataset evidence"))
        self.assertFalse(is_legacy_evidence_placeholder("Review supplier contracts", "Compare renewal terms"))
        self.assertFalse(is_legacy_evidence_placeholder("Review joined dataset evidence", "Run a controlled budget test"))

    def test_three_older_records_keep_one_active_source_draft_without_claiming_a_report_link(self):
        with self.Session() as db:
            self.add(db, title="Review joined evidence: a.csv + b.csv", action=None)
            current = self.add(db, title="Review joined dataset evidence", action=None)
            self.add(db, title="Review joined dataset evidence", action=None, status="archived")
            db.commit()
            for report_id in (None, "report-1"):
                report = {}
                attach_report_decisions(report, db, "workspace", {1, 2}, report_id)
                self.assertEqual(report["decisions"], [])
                self.assertEqual([item["id"] for item in report["decision_drafts"]], [current.id])
                self.assertIsNone(report["decision_drafts"][0]["report_id"])
                self.assertEqual(report["decision_drafts"][0]["evidence_dataset_ids"], [1, 2])
            self.assertEqual(db.query(Decision).count(), 3)

    def test_drafts_require_the_exact_source_set_and_workspace_and_never_cross_report_links(self):
        with self.Session() as db:
            for values in ({"workspace": "other"}, {"datasets": [1]}, {"datasets": [1, 2, 3]},
                           {"report_id": "another-report"}, {"status": "archived"}):
                self.add(db, title="Review joined dataset evidence", action=None, **values)
            self.add(db, title="A genuine unlinked action", action="Pause campaign B")
            db.commit()
            self.assertEqual(legacy_decision_drafts(db, "workspace", {1, 2}, "report-1"), [])
            self.assertEqual(legacy_decision_drafts(db, "workspace", {1}, "report-1"), [])

    def test_a_current_linked_action_replaces_the_legacy_draft_instead_of_showing_both(self):
        with self.Session() as db:
            self.add(db, title="Review joined dataset evidence", action=None)
            current = self.add(db, report_id="report-1")
            db.commit()
            report = {}
            attach_report_decisions(report, db, "workspace", {1, 2}, "report-1")
            self.assertEqual([item["id"] for item in report["decisions"]], [current.id])
            self.assertEqual(report["decision_drafts"], [])

    def test_a_report_linked_placeholder_is_kept_as_one_draft_not_discarded(self):
        with self.Session() as db:
            draft = self.add(db, title="Review joined dataset evidence", action=None, report_id="report-1")
            db.commit()
            report = {}
            attach_report_decisions(report, db, "workspace", {1, 2}, "report-1")
            self.assertEqual(report["decisions"], [])
            self.assertEqual([item["id"] for item in report["decision_drafts"]], [draft.id])

    def test_actual_preview_save_and_detail_routes_return_the_same_existing_draft(self):
        BusinessReport.__table__.create(self.engine)
        frames = fixture()
        with self.Session() as db:
            self.add(db, title="Review joined evidence: a.csv + b.csv", action=None)
            current = self.add(db, title="Review joined dataset evidence", action=None)
            self.add(db, title="Review joined dataset evidence", action=None, status="archived")
            db.commit()
            with patch.object(reports_router, "identity", return_value=("owner", "workspace")), \
                 patch.object(reports_router, "get_workspace_role", return_value="owner"), \
                 patch.object(reports_router, "authorize_datasets", return_value={identity: value[0] for identity, value in frames.items()}), \
                 patch.object(reports_router, "load_dataframe_from_dataset", side_effect=lambda dataset: frames[dataset.id][1].copy()):
                payload = ReportDefinition(**definition())
                preview = reports_router.preview(None, payload, db)
                saved = reports_router.save(None, payload, db)
                detail = reports_router.detail(saved["report_id"], None, db)
            for response in (preview, saved, detail):
                self.assertEqual(response["decisions"], [])
                self.assertEqual([item["id"] for item in response["decision_drafts"]], [current.id])
                self.assertIsNone(response["decision_drafts"][0]["report_id"])
            self.assertEqual(db.query(Decision).count(), 3)

    def weekly_digest(self, db, preference, asynchronous):
        digest = SimpleNamespace(cross_dataset_report={}, metrics=[SimpleNamespace(dataset_id=1), SimpleNamespace(dataset_id=2)])

        async def inline(function, *args, **kwargs):
            return function(*args, **kwargs)

        with ExitStack() as stack:
            for name, value in (("build_weekly_report_preference_response", None), ("get_alert_datasets", []),
                                ("build_weekly_report_relationships", []), ("get_weekly_report_branding", {"brand_name": "Decisionate"}),
                                ("build_workspace_decision_learning_context", None), ("build_weekly_report_learning_filter", None),
                                ("weekly_business_template", None), ("build_weekly_report_digest", digest)):
                stack.enter_context(patch.object(alerts_router, name, return_value=value))
            stack.enter_context(patch.object(alerts_router.asyncio, "to_thread", inline))
            if asynchronous:
                return asyncio.run(alerts_router.build_weekly_report_digest_for_workspace_async(db, "owner", "workspace", preference, include_ai_analysis=False))
            return alerts_router.build_weekly_report_digest_for_workspace(db, "owner", "workspace", preference)

    def test_weekly_reports_keep_explicit_template_links_without_claiming_to_be_saved_snapshots(self):
        with self.Session() as db:
            decision = self.add(db, report_id="report-1")
            self.add(db, title="Review joined dataset evidence", action=None)
            db.commit()
            for asynchronous in (False, True):
                with self.subTest(asynchronous=asynchronous):
                    report = self.weekly_digest(db, SimpleNamespace(business_report_id="report-1"), asynchronous).cross_dataset_report
                    self.assertEqual(report["decision_report_id"], "report-1")
                    self.assertEqual([item["id"] for item in report["decisions"]], [decision.id])
                    self.assertNotIn("report_id", report)

    def test_weekly_reports_without_a_template_do_not_adopt_dataset_matching_decisions(self):
        with self.Session() as db:
            self.add(db, report_id="report-1")
            db.commit()
            for asynchronous in (False, True):
                report = self.weekly_digest(db, None, asynchronous).cross_dataset_report
                self.assertIsNone(report["decision_report_id"])
                self.assertEqual(report["decisions"], [])


if __name__ == "__main__":
    unittest.main()
