import asyncio
import json
import unittest
from datetime import date, datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch

import pandas as pd
from fastapi import HTTPException
from pydantic import ValidationError

from app.db.models import Dataset, DatasetAnalysis, DataSourceConnection, DataIngestionJob, WeeklyReportPreference
from app.modules.ai import service as ai
from app.modules.alerts import router as alerts
from app.modules.alerts.schemas import WeeklyReportPreferenceResponse
from app.modules.decisions import router as decisions
from app.modules.decisions.models import Decision
from app.modules.decisions.schemas import DecisionCreate
from app.modules.reports.intelligence import build_intelligence, deterministic_summary, narrative_statements, scope_key, select_investigation_pairs
from app.modules.reports.intelligence_decisions import attach_continuity, attach_ingestion_quality
from app.modules.reports import jobs
from app.modules.reports.models import BusinessReport
from app.modules.reports.schemas import WeeklyReportSettings
from app.modules.reports.weekly import weekly_context, preference_timezone
from tests import test_business_reports as fixtures
from tests.test_ai_service import FakeAIResponse


def preference():
    return WeeklyReportPreferenceResponse(enabled=False, cadence="weekly", delivery_day="monday", recipient_emails=[],
        metric_focus=["1:spend", "2:net_sales"], include_recommendations=True)


def report_for(frames, anchor=date(2026, 4, 1), **changes):
    report = alerts.build_weekly_cross_dataset_report(frames, preference(), fixtures.definition(**changes), analysis_date=anchor)
    report["intelligence"] = build_intelligence(report)
    report["intelligence"]["summary"] = deterministic_summary(report)
    return report


class WeeklyIntelligenceTests(unittest.TestCase):
    def setUp(self):
        p = patch.dict("os.environ", fixtures.FLAGS); p.start(); self.addCleanup(p.stop)
        self.frames = fixtures.fixture()

    def test_complete_week_values_and_evidence_only_actions(self):
        report = report_for(self.frames)
        self.assertEqual(report["window"], {"start": "2026-03-23", "end": "2026-03-29"})
        self.assertEqual(report["previous_window"], {"start": "2026-03-16", "end": "2026-03-22"})
        self.assertEqual(report["metrics"][0]["value"], sum(range(82, 89)))
        self.assertEqual(report["metrics"][0]["previous_value"], sum(range(75, 82)))
        intelligence = report["intelligence"]
        self.assertEqual(len(intelligence["findings"]), 2)
        self.assertIn("not_established", [item["status"] for item in intelligence["investigations"]])
        self.assertLessEqual(len(intelligence["summary"].split()), 250)
        self.assertIn("not calculated", intelligence["forecast_status"])
        findings = {item["id"] for item in intelligence["findings"]}
        for action in intelligence["recommendations"]:
            self.assertIn(action["finding_id"], findings)
            self.assertIn(action["success_metric_id"], [metric["id"] for metric in report["metrics"]])
            self.assertIn("before changing", action["action"])

    def test_missing_values_are_not_zero_or_supported_actions(self):
        self.frames[1] = self.frames[1][0], self.frames[1][1].iloc[:80].copy()
        result = report_for(self.frames)
        self.assertIsNone(result["metrics"][0]["value"])
        self.assertIsNone(result["metrics"][0]["change"])
        self.assertEqual(result["status"], "limited_coverage")
        self.assertFalse(any(action["success_metric_id"] == "1:spend" for action in result["intelligence"]["recommendations"]))
        self.assertTrue(result["intelligence"]["quality"])
        empty = report_for({})
        self.assertEqual(empty["intelligence"]["recommendations"], [])
        self.assertIn("No supported priority change", empty["intelligence"]["summary"])

    def test_stable_sources_can_have_no_findings_or_recommendations(self):
        for identity, (_, frame) in self.frames.items():
            frame["spend" if identity == 1 else "net_sales"] = 10
        result = report_for(self.frames)
        self.assertEqual(result["intelligence"]["findings"], [])
        self.assertEqual(result["intelligence"]["recommendations"], [])
        self.assertEqual(result["findings"], [])

    def test_incompatible_currencies_are_separate_and_not_tested(self):
        self.frames[2][1]["currency"] = "USD"
        result = report_for(self.frames)
        self.assertEqual([item["currency"] for item in result["metrics"]], ["CAD", "USD"])
        self.assertFalse(result["intelligence"]["investigations"])
        self.assertTrue(any("monetary units" in text for text in result["intelligence"]["quality"]))
        self.assertTrue(any("not consolidated" in text for text in result["intelligence"]["quality"]))

    def test_selection_is_bounded_before_relationship_testing(self):
        metrics = [{"id": f"{i}:sales", "dataset_id": i, "metric_key": "sales", "change": i,
                    "change_percent": i, "observations": 7, "expected_periods": 7,
                    "previous_observations": 7, "previous_expected_periods": 7} for i in range(1, 26)]
        pairs = [(a, b) for a in metrics for b in metrics if a["dataset_id"] < b["dataset_id"]]
        selected, warnings = select_investigation_pairs(metrics, pairs)
        self.assertEqual(len(selected), 12)
        self.assertTrue(warnings)
        self.assertTrue(all(any(metric["dataset_id"] > 20 for metric in pair) for pair in selected))

    def test_scope_identifiers_are_stable_but_include_filters_units_and_timezone(self):
        report = report_for(self.frames)
        metric = report["metrics"][0]
        definition = {**report["definition"], "dimension_filters": [{"dataset_id": 1, "column": "region", "values": ["West", "East"]}]}
        key = scope_key(definition, metric)
        self.assertEqual(key, scope_key({**definition, "dimension_filters": [{"dataset_id": 1, "column": "region", "values": ["East", "West"]}]}, metric))
        self.assertNotEqual(key, scope_key({**definition, "reporting_timezone": "America/Halifax"}, metric))
        self.assertNotEqual(key, scope_key(definition, {**metric, "currency": "USD"}))
        self.assertNotEqual(key, scope_key({**definition, "dimension_filters": []}, metric))

    def test_workspace_timezone_uses_local_completed_week_and_validates_settings(self):
        instant = datetime(2026, 11, 9, 1, tzinfo=timezone.utc)
        with patch("app.modules.reports.weekly.datetime") as clock:
            clock.now.side_effect = lambda zone: instant.astimezone(zone)
            self.assertEqual(weekly_context(zone="UTC")["window"]["end"], "2026-11-08")
            self.assertEqual(weekly_context(zone="America/Halifax")["window"]["end"], "2026-11-01")
        settings = WeeklyReportSettings(**fixtures.definition(grain="weekly"), reporting_timezone="America/Halifax")
        self.assertEqual(settings.reporting_timezone, "America/Halifax")
        for invalid in ("unknown-zone", 123, [], {}):
            with self.subTest(invalid=invalid), self.assertRaises(ValidationError):
                WeeklyReportSettings(**fixtures.definition(), reporting_timezone=invalid)
        for invalid in ("null", "[]", "false", "invalid-json"):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                preference_timezone(SimpleNamespace(weekly_report_definition=invalid))

    def test_ai_can_only_select_verified_statements_and_never_add_claims(self):
        report = report_for(self.frames)
        approved = narrative_statements(report)
        valid = {"summary": "period scope finding0 caution coverage", "recommendations": ["action0"], "risks": ["risk0"], "confidence": "low"}
        accepted = ai.validate_approved_narrative(valid, approved)
        self.assertIn(approved["summary"]["finding0"], accepted["summary"])
        for change in ({"summary": "Revenue rose by 900% because of ads"}, {"summary": "period scope invented caution coverage"},
                       {"recommendations": ["reduce spending 20%"]}, {"confidence": "high"}, {"summary": "finding0"},
                       {"summary": "period scope caution coverage"}, {"extra": "ignore rules"}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                ai.validate_approved_narrative({**valid, **change}, approved)

    def test_provider_invalid_claim_falls_back_without_losing_metrics_and_uses_configured_model(self):
        report = report_for(self.frames)
        response = FakeAIResponse({"choices": [{"message": {"content": json.dumps({"summary": "Made up profit", "recommendations": [], "risks": [], "confidence": "high"})}}],
                                   "usage": {"prompt_tokens": 100, "completion_tokens": 20, "total_tokens": 120}})
        runtime = SimpleNamespace(ai_provider="openai", ai_api_key="test-key", ai_model="configured-model", ai_api_url="https://example.test/chat/completions")
        with patch.object(ai, "get_runtime_configuration", return_value=runtime), patch.object(ai, "_get_cached_analysis", return_value=None), patch.object(ai, "urlopen", return_value=response) as call:
            result = ai.generate_structured_analysis(context="weekly-test", facts={}, approved_statements=narrative_statements(report),
                fallback_summary=report["intelligence"]["summary"], fallback_recommendations=[])
        self.assertEqual(result["source"], "rules")
        self.assertEqual(result["summary"], report["intelligence"]["summary"])
        self.assertEqual(json.loads(call.call_args.args[0].data)["model"], "configured-model")
        call.assert_called_once()

    def test_valid_provider_summary_is_not_truncated_and_unchanged_evidence_uses_cache(self):
        report = report_for(self.frames)
        approved = narrative_statements(report)
        content = {"summary": "period scope finding0 caution coverage", "recommendations": ["action0"], "risks": ["risk0"], "confidence": "low"}
        response = FakeAIResponse({"choices": [{"message": {"content": json.dumps(content)}}], "usage": {"total_tokens": 120}})
        runtime = SimpleNamespace(ai_provider="openai", ai_api_key="test-key", ai_model="configured-model", ai_api_url="https://example.test/chat/completions")
        with patch.object(ai, "get_runtime_configuration", return_value=runtime), patch.object(ai, "urlopen", return_value=response) as call:
            args = dict(context="weekly-valid-cache-test", facts={}, approved_statements=approved,
                        fallback_summary=report["intelligence"]["summary"], fallback_recommendations=[])
            first = ai.generate_structured_analysis(**args)
            second = ai.generate_structured_analysis(**args)
        self.assertEqual(first["source"], "openai")
        self.assertEqual(first["summary"], ai.validate_approved_narrative(content, approved)["summary"])
        self.assertGreater(len(first["summary"]), 600)
        self.assertEqual(first, second)
        call.assert_called_once()


class WeeklyIntelligenceAdoptionTests(unittest.TestCase):
    def setUp(self):
        fixtures.BusinessReportWorkflowTests.setUp(self)
        # More than a year of matched history, with a reproducible weekly change.
        for identity, (dataset, _) in self.frames.items():
            dates = pd.date_range("2024-10-01", "2026-04-07")
            values = [100 + (i * 37 % 83) + (i // 7 % 11) * 4 for i in range(len(dates))]
            key = "spend" if identity == 1 else "net_sales"
            self.frames[identity] = dataset, pd.DataFrame({"date": dates, key: [v * identity for v in values], "currency": "CAD"})
        self.report = report_for(self.frames)
        with self.Session() as db:
            saved = BusinessReport(workspace_id="owner", user_id="owner", name="Weekly intelligence", definition=json.dumps(self.report["definition"]), snapshot=json.dumps(self.report))
            db.add(saved); db.commit(); self.report_id = saved.id

    def test_connector_quality_reports_failures_without_disclosing_credentials_or_other_workspace(self):
        with self.Session() as db:
            connection = DataSourceConnection(user_id="owner", workspace_id="owner", source_type="meta_ads", display_name="Advertising",
                status="connected", authorization_error="private provider credentials", last_synced_at=datetime(2026, 3, 25))
            other = DataSourceConnection(user_id="another", workspace_id="another", source_type="shopify", display_name="Private store", authorization_error="private other error")
            db.add_all([connection, other]); db.flush()
            db.add_all([DatasetAnalysis(dataset_id=1, connection_id=connection.id, user_id="owner", workspace_id="owner"),
                        DatasetAnalysis(dataset_id=2, connection_id=other.id, user_id="another", workspace_id="another"),
                        DataIngestionJob(connection_id=connection.id, user_id="owner", workspace_id="owner", status="failed")])
            db.commit()
            attach_ingestion_quality(self.report, db, "owner")
        sources = self.report["source_quality"]
        self.assertTrue(any("failed" in warning for warning in sources[0]["warnings"]))
        self.assertTrue(any("authorization issue" in warning for warning in sources[0]["warnings"]))
        self.assertEqual(sources[1]["connection_status"], "not_verified")
        self.assertNotIn("private", json.dumps(sources))

    def test_workspace_timezone_persists_and_is_frozen_in_weekly_job(self):
        settings = {**fixtures.definition(grain="weekly"), "reporting_timezone": "America/Halifax"}
        settings.pop("date_range")
        result = self.client.put("/api/v2/business-reports/weekly-settings", json=settings)
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json()["definition"]["reporting_timezone"], "America/Halifax")
        with self.Session() as db:
            preference = db.query(WeeklyReportPreference).filter_by(workspace_id="owner").one()
            job = jobs.enqueue_weekly(db, "owner", "owner", preference, include_ai=False, report_only=True)
            self.assertEqual(json.loads(job.definition)["configuration"]["template"]["reporting_timezone"], "America/Halifax")

    def test_saved_weekly_setup_does_not_recompute_legacy_relationships(self):
        with self.Session() as db, \
             patch.object(alerts, "get_alert_datasets", return_value=[item[0] for item in self.frames.values()]), \
             patch.object(alerts, "get_weekly_report_branding", return_value={"brand_name": "Decisionate"}), \
             patch.object(alerts, "load_dataframe_from_dataset", side_effect=lambda dataset: self.frames[dataset.id][1].copy()), \
             patch.object(alerts, "build_weekly_report_relationships", side_effect=AssertionError("Use selected report pairs only")):
            digest = alerts.build_weekly_report_digest_for_workspace(db, "owner", "owner", None,
                include_ai_analysis=False, analysis_date=date(2026, 4, 1), template_override=fixtures.definition())
        self.assertEqual(digest.cross_dataset_report["status"], "ready")
        self.assertTrue(digest.cross_dataset_report["intelligence"]["investigations"])

    def test_scheduler_uses_workspace_local_delivery_day_and_isolates_invalid_timezone(self):
        with self.Session() as db:
            for workspace, zone in (("owner", "UTC"), ("other", "America/Halifax"), ("broken", "invalid-zone")):
                db.add(WeeklyReportPreference(workspace_id=workspace, enabled=1, delivery_day="monday",
                    weekly_report_definition=json.dumps({"reporting_timezone": zone})))
            db.commit()
        with patch.object(alerts, "SessionLocal", self.Session), patch.object(alerts, "require_alerts_scheduler_secret"), \
             patch.object(alerts, "get_utc_now", return_value=datetime(2026, 11, 9, 1, tzinfo=timezone.utc)), \
             patch.object(jobs, "enqueue_weekly", return_value=SimpleNamespace(id="job", status="queued", error=None)) as enqueue:
            result = alerts.send_due_weekly_reports(SimpleNamespace(headers={}))
        self.assertEqual(result.queued_count, 1)
        self.assertEqual(result.failed_count, 1)
        self.assertEqual(enqueue.call_args.args[2], "owner")

    def handoff(self, finding_id=None):
        action = self.report["intelligence"]["recommendations"][0]
        return self.client.post(f"/api/v2/business-reports/{self.report_id}/decision-evidence", json={
            "finding_id": finding_id or action["finding_id"], "outcome_metric": action["success_metric_id"],
            "title": "Investigate campaign changes", "action": action["action"], "reasoning": "Compare channel and product records before making a budget change.",
            "expected_outcome": "Identify and verify the source of the change", "review_date": "2027-01-01"})

    def create(self, payload, key="adopt-once"):
        with patch.object(decisions, "SessionLocal", self.Session), \
             patch.object(decisions, "get_active_user_id", side_effect=lambda user: user), \
             patch.object(decisions, "get_active_workspace_id", side_effect=lambda user, workspace: workspace), \
             patch.object(decisions, "get_accessible_dataset", side_effect=lambda db, identity, user, workspace: db.query(Dataset).filter_by(id=identity, workspace_id=workspace).first()):
            return asyncio.run(decisions.create_decision(DecisionCreate(**payload), "owner", "owner", key))

    def test_acceptance_adopt_track_repeat_and_reopen_frozen_evidence(self):
        self.assertGreaterEqual(self.report["findings"][0]["observations"], 30)
        self.assertTrue(self.report["intelligence"]["investigations"])
        with self.Session() as db:
            self.assertEqual(db.query(Decision).count(), 0)
            original_snapshot = db.get(BusinessReport, self.report_id).snapshot
        response = self.handoff()
        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()["decision_payload"]
        created = self.create(payload)
        duplicate = self.create({**payload, "title": "Different editable title"}, "second-request")
        self.assertEqual(created.id, duplicate.id)
        self.assertEqual(self.handoff().status_code, 409)
        with self.Session() as db:
            decision = db.get(Decision, created.id)
            decision.status = "in_progress"
            decision.created_at = datetime(2026, 4, 1)
            decision.review_date = datetime(2026, 4, 5)
            db.commit()
            next_report = report_for(self.frames, date(2026, 4, 8))
            attach_continuity(next_report, db, "owner")
            self.assertEqual(next_report["intelligence"]["decisions"][0]["assessment"], "Review overdue")
            followup = next(item for item in next_report["intelligence"]["recommendations"] if item["finding_id"] == json.loads(payload["recommendation_context"])["intelligence_finding"]["id"])
            self.assertEqual(followup["related_decision_id"], created.id)
            self.assertTrue(followup["follow_up"])
            self.assertTrue(any(item["continuity"].startswith("Reported last week") for item in next_report["intelligence"]["findings"]))
            self.assertEqual(db.query(Decision).count(), 1)
            self.assertEqual(db.get(BusinessReport, self.report_id).snapshot, original_snapshot)
            decision.actual_outcome = "We checked the records; no attribution was established."
            decision.outcome_status = "inconclusive"
            db.commit()
            attach_continuity(next_report, db, "owner")
            self.assertEqual(next_report["intelligence"]["decisions"][0]["recorded_outcome"], decision.actual_outcome)
            metric_id = f"{payload.get('outcome_dataset_id') or payload['dataset_id']}:{payload['metric_column']}"
            for legacy in ({"metrics": False}, {"metrics": [None]}, {"metrics": [{"id": metric_id}], "definition": False}):
                decision.recommendation_context = json.dumps(legacy)
                attach_continuity(next_report, db, "owner")
                self.assertIsNone(next_report["intelligence"]["decisions"][0]["observed_value"])
        reopened = self.client.get(f"/api/v2/business-reports/{self.report_id}").json()
        self.assertEqual(reopened["intelligence"], self.report["intelligence"])

    def test_forged_finding_and_other_workspace_are_rejected(self):
        self.assertEqual(self.handoff("invented").status_code, 404)
        response = self.client.get(f"/api/v2/business-reports/{self.report_id}", headers={"X-Workspace-Id": "someone-else"})
        self.assertEqual(response.status_code, 404)
        response = self.handoff()
        payload = response.json()["decision_payload"]
        value = json.loads(payload["recommendation_context"])
        value["report_id"] = "another-report"
        payload["recommendation_context"] = json.dumps(value)
        with self.assertRaises(HTTPException):
            self.create(payload)
        with self.Session() as db:
            self.assertEqual(db.query(Decision).count(), 0)

    def test_stored_provenance_is_rebuilt_not_trusted_from_browser(self):
        payload = self.handoff().json()["decision_payload"]
        context = json.loads(payload["recommendation_context"])
        context["intelligence_finding"]["observation"] = "Unsupported claim"
        payload["recommendation_context"] = json.dumps(context)
        decision = self.create(payload)
        stored = json.loads(decision.recommendation_context)
        self.assertNotEqual(stored["intelligence_finding"]["observation"], "Unsupported claim")
        self.assertEqual(set(decision.evidence_dataset_ids), {1, 2})
