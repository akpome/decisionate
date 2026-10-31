from datetime import datetime
import json
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.modules.decisions.models import Decision, DecisionDuplicate
from app.modules.reports.decision_reviews import has_multi_dataset_analysis, impact_readiness, review_choices


def evidence(**updates):
    return {"evidence_kind": "business_report", "report_id": "saved-analysis",
            "definition": {"scope": "multi", "metrics": [
                {"dataset_id": 1, "metric_key": "spend"}, {"dataset_id": 2, "metric_key": "orders"},
            ], "impact": None}, **updates}


class ImpactDecisionSourceTests(unittest.TestCase):
    def eligible(self, context):
        return has_multi_dataset_analysis(SimpleNamespace(recommendation_context=json.dumps(context)))

    def test_multi_dataset_sources_include_legacy_and_weekly_analysis_without_requiring_a_coefficient(self):
        self.assertTrue(self.eligible(evidence()))
        legacy = evidence()
        del legacy["definition"]["scope"]
        self.assertTrue(self.eligible(legacy))
        self.assertTrue(self.eligible(evidence(weekly_report=True, findings=[])))
        # Provenance survives deletion of a snapshot; no report or dataset lookup is needed.
        self.assertTrue(self.eligible(evidence(report_id="deleted-report")))

    def test_only_selected_source_metrics_establish_dataset_count(self):
        selected = evidence()["definition"]["metrics"]
        for definition in (
            {"scope": "single", "metrics": selected},
            {"scope": "multi", "metrics": selected[:1]},
            {"metrics": [selected[0], {"dataset_id": 1, "metric_key": "visits"}]},
            {"scope": "unexpected", "metrics": selected},
            {"metrics": selected, "impact": {"decision_id": 7}},
            {"metrics": selected, "impact": {}},
        ):
            with self.subTest(definition=definition):
                self.assertFalse(self.eligible(evidence(definition=definition, dataset_count=2, metrics=selected)))
        self.assertFalse(self.eligible(evidence(impact_analysis={"status": "estimated"})))

    def test_unknown_manual_or_malformed_provenance_is_not_inferred_from_cached_datasets(self):
        for context in (None, [], "not evidence", {}, evidence(evidence_kind="joined_data"),
                        evidence(report_id=None), evidence(report_id=" "), evidence(definition=[]),
                        evidence(definition={"metrics": []}), evidence(definition={"metrics": "two"})):
            with self.subTest(context=context):
                self.assertFalse(self.eligible(context))
        for raw in (None, "not-json", "Joined evidence from 2 datasets"):
            self.assertFalse(has_multi_dataset_analysis(SimpleNamespace(recommendation_context=raw,
                                                                       evidence_dataset_ids=[1, 2])))
        selected = evidence()["definition"]["metrics"]
        for invalid in (None, "orders", {}, {"dataset_id": True, "metric_key": "orders"},
                        {"dataset_id": "2", "metric_key": "orders"}, {"dataset_id": -2, "metric_key": "orders"},
                        {"dataset_id": 2, "metric_key": ""}):
            with self.subTest(reference=invalid):
                self.assertFalse(self.eligible(evidence(definition={"metrics": [*selected, invalid]})))


class ImpactDecisionChoiceTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite://")
        self.addCleanup(engine.dispose)
        Decision.__table__.create(engine)
        DecisionDuplicate.__table__.create(engine)
        self.db = sessionmaker(bind=engine)()
        self.addCleanup(self.db.close)

    def add(self, context=None, **updates):
        decision = Decision(**{
            "clerk_user_id": "owner", "workspace_id": "workspace", "dataset_id": 1,
            "title": "Shift advertising budget", "action": "Increase the campaign budget by 10%",
            "status": "planned", "created_at": datetime(2026, 1, 1),
            "recommendation_context": json.dumps(evidence() if context is None else context), **updates,
        })
        self.db.add(decision)
        self.db.flush()
        return decision

    def choices(self, **kwargs):
        return review_choices(self.db, "owner", "workspace", **kwargs)

    def test_choices_remain_scoped_active_canonical_and_backed_by_multi_dataset_analysis(self):
        eligible = self.add()
        legacy_owner = self.add(workspace_id=None)
        self.add(evidence(definition={"scope": "single", "metrics": [{"dataset_id": 1, "metric_key": "orders"}]}))
        manual = self.add(recommendation_context=None)
        manual.evidence_dataset_ids = [1, 2]
        self.add(status="archived")
        self.add(status="cancelled")
        self.add(workspace_id="other")
        self.add(workspace_id=None, clerk_user_id="another-owner")
        self.add(action=None)
        self.add(action="   ")
        self.add(title="Review joined dataset evidence", action="Review the joined metrics and agree on the next action.")
        duplicate = self.add()
        self.db.add(DecisionDuplicate(duplicate_id=duplicate.id, canonical_id=eligible.id))
        self.db.commit()
        before = [(row.id, row.recommendation_context, row.status) for row in self.db.query(Decision).order_by(Decision.id)]
        result = self.choices()
        self.assertEqual([item["id"] for item in result["decisions"]], [legacy_owner.id, eligible.id])
        self.assertIsNone(result["next_offset"])
        self.assertEqual(before, [(row.id, row.recommendation_context, row.status) for row in self.db.query(Decision).order_by(Decision.id)])

    def test_pages_skip_ineligible_batches_without_losing_or_repeating_eligible_choices(self):
        ids = []
        single = evidence(definition={"scope": "single", "metrics": [{"dataset_id": 1, "metric_key": "orders"}]})
        for _ in range(61):
            ids.append(self.add().id)
            for _ in range(3):
                self.add(single)
        for _ in range(120):
            self.add(single)
        self.db.commit()
        found, sizes, offset = [], [], 0
        while True:
            result = self.choices(offset=offset)
            sizes.append(len(result["decisions"]))
            found.extend(item["id"] for item in result["decisions"])
            if result["next_offset"] is None:
                break
            self.assertGreater(result["next_offset"], offset)
            offset = result["next_offset"]
        self.assertEqual(sizes, [25, 25, 11])
        self.assertEqual(found, list(reversed(ids)))

    def test_exactly_full_last_page_does_not_offer_an_empty_next_page(self):
        for _ in range(120):
            self.add({})
        for _ in range(25):
            self.add()
        self.db.commit()
        result = self.choices()
        self.assertEqual(len(result["decisions"]), 25)
        self.assertIsNone(result["next_offset"])

    def test_search_and_empty_results_apply_the_same_source_filter(self):
        match = self.add(title="Improve STORE orders")
        self.add(title="Adjust advertising")
        for _ in range(110):
            self.add({}, title="Improve store orders")
        self.db.commit()
        result = self.choices(search="store")
        self.assertEqual(result, {"decisions": [{"id": match.id, "title": match.title,
                                                "readiness": impact_readiness(None, None)}], "next_offset": None})
        self.assertEqual(self.choices(search="missing"), {"decisions": [], "next_offset": None})
        self.assertEqual(self.choices(offset=1000), {"decisions": [], "next_offset": None})

    def test_readiness_keeps_missing_evidence_visible_and_uses_the_authorized_timing_check(self):
        missing_outcome = self.add()
        needs_evidence = self.add(metric_column="orders", outcome_dataset_id=2)
        needs_relationship = self.add(metric_column="orders", outcome_dataset_id=2)
        ready = self.add(metric_column="orders", outcome_dataset_id=2)
        results = {ready.id: {"status": "supported"}, needs_relationship.id: {"status": "choose_relationship"},
                   needs_evidence.id: {"status": "unavailable", "message": "The original correlation report is unavailable. Timing has not been assumed."}}
        with patch("app.modules.reports.impact_timing.decision_timing", side_effect=lambda db, row, outcome, user, workspace: results[row.id]) as timing:
            choices = {item["id"]: item["readiness"] for item in self.choices()["decisions"]}
        self.assertEqual(choices[ready.id]["status"], "ready")
        self.assertIn("still need checking", choices[ready.id]["reason"])
        self.assertEqual(choices[needs_relationship.id]["status"], "needs_relationship")
        self.assertEqual(choices[needs_evidence.id]["reason"], results[needs_evidence.id]["message"])
        self.assertEqual(choices[missing_outcome.id]["status"], "needs_outcome")
        self.assertEqual(timing.call_count, 3)
        for call in timing.call_args_list:
            self.assertEqual(call.args[2:], ({"dataset_id": 2, "metric_key": "orders"}, "owner", "workspace"))

    def test_readiness_is_checked_only_for_the_returned_page_not_all_eligible_decisions(self):
        for _ in range(27):
            self.add(metric_column="orders")
        with patch("app.modules.reports.impact_timing.decision_timing", return_value={"status": "unavailable", "message": "Timing needs checking."}) as timing:
            first = self.choices()
            self.assertEqual(timing.call_count, 25)
            self.assertEqual(len(first["decisions"]), 25)
            last = self.choices(offset=first["next_offset"])
            self.assertEqual(timing.call_count, 27)
            self.assertEqual(len(last["decisions"]), 2)

    def test_absent_or_unknown_timing_never_claims_readiness(self):
        for timing in (None, {}, {"status": "unknown"}):
            self.assertEqual(impact_readiness({"dataset_id": 1, "metric_key": "orders"}, timing)["status"], "needs_evidence")


if __name__ == "__main__":
    unittest.main()
