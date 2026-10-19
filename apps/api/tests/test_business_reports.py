import json
import random
from datetime import date
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.database import Base
from app.db.models import Dataset, WeeklyReportPreference
from app.modules.reports import router
from app.modules.reports.schemas import ReportDefinition
from app.modules.reports.models import BusinessReport
from app.modules.reports.cleanup import cleanup_source, cleanup_workspace
from app.modules.reports.service import build_report, complete_week, previous_window, metric_value, prepare_report_series, decisions_for_report
from app.modules.datasets.services.metric_policy import FRAME_POLICY_KEY
from app.modules.decisions.models import Decision
from app.modules.alerts.router import build_weekly_cross_dataset_report, build_weekly_report_digest, validate_weekly_report_digest_for_delivery
from app.modules.alerts.schemas import WeeklyReportPreferenceResponse
from app.modules.alerts.email_delivery import build_weekly_report_email_html, build_weekly_report_email_text


FLAGS = {"CURATED_METRIC_DEFAULTS_BACKEND": "false", "CORRELATION_REPORTING_TIMEZONE": "UTC"}


def fixture():
    frames = {}
    for identity, key in ((1, "spend"), (2, "net_sales")):
        dataset = SimpleNamespace(id=identity, source_type="csv", file_name=f"Source {identity}.csv",
                                  source_config=json.dumps({"selected_metric_columns": [key]}))
        values = [float(i + 1) if identity == 1 else float(100 - i) for i in range(90)]
        frames[identity] = dataset, pd.DataFrame({"date": pd.date_range("2026-01-01", periods=90), key: values, "currency": "CAD"})
    return frames


def definition(**updates):
    return ReportDefinition(**{
        "name": "Marketing and sales review", "business_question": "How do advertising spending and store sales change together?",
        "metrics": [{"dataset_id": 1, "metric_key": "spend", "date_column": "date", "aggregation": "sum"},
                    {"dataset_id": 2, "metric_key": "net_sales", "date_column": "date", "aggregation": "sum"}],
        "date_range": {"start": "2026-03-23", "end": "2026-03-29"}, "grain": "daily", "method": "pearson",
        **updates,
    }).model_dump(mode="json")


class BusinessReportEngineTests(unittest.TestCase):
    def setUp(self):
        patcher = patch.dict("os.environ", FLAGS)
        patcher.start(); self.addCleanup(patcher.stop)
        self.frames = fixture()

    def test_complete_week_and_equal_previous_window_exclude_partial_week(self):
        self.assertEqual(complete_week(date(2026, 4, 1)), {"start": "2026-03-23", "end": "2026-03-29"})
        self.assertEqual(complete_week(date(2026, 3, 29)), {"start": "2026-03-16", "end": "2026-03-22"})
        self.assertEqual(previous_window(complete_week(date(2026, 4, 1))), {"start": "2026-03-16", "end": "2026-03-22"})

    def test_weekly_values_are_not_lifetime_totals_and_relationships_use_longer_history(self):
        report = build_report(self.frames, definition())
        spend = report["metrics"][0]
        self.assertEqual(spend["value"], sum(range(82, 89)))
        self.assertEqual(spend["previous_value"], sum(range(75, 82)))
        self.assertEqual(spend["observations"], 7)
        self.assertGreater(report["findings"][0]["observations"], 30)
        self.assertEqual(report["status"], "ready")
        self.assertEqual(len(report["contrasts"]), 1)
        self.assertIn("not attribution", report["findings"][0]["interpretation"])

    def test_missing_days_and_zero_baselines_are_not_fabricated(self):
        dataset, frame = self.frames[1]
        frame.loc[frame.date.between("2026-03-16", "2026-03-22"), "spend"] = 0
        self.frames[1] = dataset, frame.loc[frame.date != "2026-03-24"].copy()
        metric = build_report(self.frames, definition())["metrics"][0]
        self.assertIsNone(metric["change_percent"])
        self.assertEqual(metric["observations"], 6)
        self.assertTrue(any("not treated as zero" in value for value in metric["warnings"]))

    def test_unavailable_dataset_is_limited_coverage_not_success(self):
        report = build_report({1: self.frames[1]}, definition(), unavailable=["Dataset unavailable: sales"])
        self.assertEqual(report["status"], "limited_coverage")
        self.assertEqual(report["findings"], [])
        self.assertTrue(report["warnings"])

    def test_all_null_buckets_and_entire_missing_baseline_remain_unavailable(self):
        dataset, frame = self.frames[1]
        frame.loc[frame.date.between("2026-03-16", "2026-03-22"), "spend"] = float("nan")
        frame.loc[frame.date == "2026-03-24", "spend"] = float("nan")
        report = build_report(self.frames, definition())
        metric = report["metrics"][0]
        self.assertIsNone(metric["previous_value"])
        self.assertIsNone(metric["change_percent"])
        self.assertEqual(metric["observations"], 6)
        self.assertIsNone(next(point["value"] for point in metric["trend"] if point["period"] == "2026-03-24"))

    def test_last_value_policy_follows_time_not_connector_row_order(self):
        frame = pd.DataFrame({"date": pd.to_datetime(["2026-03-24 18:00", "2026-03-24 09:00"]), "balance": [80., 100.]})
        frame.attrs[FRAME_POLICY_KEY] = {"selected": ["balance"], "descriptors": {
            "balance": {"columnKey": "balance", "aggregation": "LAST", "unit": "currency", "components": []}}}
        reference = {"dataset_id": 1, "date_column": "date", "metric_key": "balance", "aggregation": "policy"}
        self.assertEqual(metric_value(frame, frame.date, reference), 80.)
        result = prepare_report_series({1: (self.frames[1][0], frame)}, [reference], {
            "grain": "daily", "date_range": {"start": "2026-03-24", "end": "2026-03-24"}, "reporting_timezone": "UTC"})
        self.assertEqual(result["1:balance"].value.iloc[0], 80.)

    def test_partial_baseline_withholds_comparison_instead_of_inventing_growth(self):
        dataset, frame = self.frames[2]
        self.frames[2] = dataset, frame.loc[frame.date != "2026-03-17"].copy()
        metric = build_report(self.frames, definition())["metrics"][1]
        self.assertIsNone(metric["change_percent"])
        self.assertIsNone(metric["change"])
        self.assertEqual(metric["previous_observations"], 6)

    def test_missing_dates_are_explicit_gaps_in_trend_charts(self):
        dataset, frame = self.frames[1]
        self.frames[1] = dataset, frame.loc[frame.date != "2026-03-24"].copy()
        metric = build_report(self.frames, definition())["metrics"][0]
        self.assertEqual(len(metric["trend"]), 7)
        self.assertIsNone(next(point["value"] for point in metric["trend"] if point["period"] == "2026-03-24"))

    def test_curated_ratios_use_component_totals_not_sums_of_daily_ratios(self):
        frame = pd.DataFrame({"date": pd.to_datetime(["2026-03-23", "2026-03-24"]), "sales": [100, 100], "orders": [1, 9], "aov": [100, 100 / 9]})
        frame.attrs[FRAME_POLICY_KEY] = {"descriptors": {"aov": {"columnKey": "aov", "operation": "ratio", "components": ["sales", "orders"], "aggregation": "AVG"}}}
        value = metric_value(frame, frame.date, {"metric_key": "aov", "aggregation": "policy"})
        self.assertEqual(value, 20)

    def test_different_currencies_are_flagged_without_inventing_conversion(self):
        self.frames[2][1]["currency"] = "USD"
        report = build_report(self.frames, definition())
        self.assertEqual([metric["currency"] for metric in report["metrics"]], ["CAD", "USD"])
        self.assertIn("different_currencies_no_conversion", report["findings"][0]["warnings"])

    def test_report_lag_is_calendar_aligned_even_when_one_source_has_missing_dates(self):
        rng = random.Random(5)
        values = [rng.uniform(10, 100) for _ in range(90)]
        self.frames[1][1]["spend"] = values
        self.frames[2][1]["net_sales"] = [7., 8., *values[:-2]]
        dataset, frame = self.frames[1]
        self.frames[1] = dataset, frame.loc[frame.date != "2026-02-14"].copy()
        report = build_report(self.frames, definition(lag={"enabled": True, "maximum": 3}))
        finding = report["findings"][0]
        self.assertEqual(finding["lag"], 2)
        self.assertAlmostEqual(finding["coefficient"], 1, places=10)
        self.assertIn("calendar", finding["lag_unit"])
        self.assertIn("incomplete_shared_history", finding["warnings"])

    def test_unapproved_metrics_and_aggregation_are_rejected(self):
        for key, value in (("metric_key", "currency"), ("aggregation", "avg"), ("date_column", "unknown")):
            payload = definition()
            payload["metrics"][0][key] = value
            with self.assertRaises(ValueError):
                build_report(self.frames, payload)

    def test_report_preserves_selected_findings_and_does_not_require_correlation(self):
        report = build_report(self.frames, definition(included_findings=[]))
        self.assertEqual(report["included_findings"], [])
        self.assertTrue(report["observations"])
        self.assertTrue(report["metrics"])
        self.assertTrue(report["findings"])
        with self.assertRaises(ValueError):
            build_report(self.frames, definition(included_findings=["not-a-finding"]))

    def test_weekly_digest_uses_cross_dataset_review_and_escaped_email_content(self):
        preference = WeeklyReportPreferenceResponse(enabled=True, cadence="weekly", delivery_day="monday",
            recipient_emails=["owner@example.test"], metric_focus=["1:spend", "2:net_sales"], include_recommendations=True)
        frames = {item.id: frame for item, frame in self.frames.values()}
        with patch("app.modules.alerts.router.complete_week", return_value=definition()["date_range"]), \
             patch("app.modules.alerts.router.load_dataframe_from_dataset", side_effect=lambda dataset: frames[dataset.id]):
            digest = build_weekly_report_digest(preference, [item for item, _ in self.frames.values()], include_ai_analysis=False)
        self.assertEqual(digest.metrics[0].total, sum(range(82, 89)))
        self.assertEqual(digest.cross_dataset_report["dataset_count"], 2)
        validate_weekly_report_digest_for_delivery(digest)
        digest.cross_dataset_report["business_question"] = "<script>unsafe</script>"
        markup = build_weekly_report_email_html(digest)
        self.assertIn("&lt;script&gt;unsafe", markup)
        self.assertNotIn("<script>", markup)
        self.assertIn("Previous window:", build_weekly_report_email_text(digest))
        self.assertIn("Value:", build_weekly_report_email_text(digest))
        self.assertNotIn("Average:", build_weekly_report_email_text(digest))
        digest.cross_dataset_report["status"] = "limited_coverage"
        with self.assertRaises(HTTPException):
            validate_weekly_report_digest_for_delivery(digest)

    def test_weekly_template_does_not_reinterpret_monthly_lag_as_days(self):
        preference = WeeklyReportPreferenceResponse(enabled=False, cadence="weekly", delivery_day="monday", recipient_emails=[], metric_focus=[], include_recommendations=True)
        template = definition(grain="monthly", lag={"enabled": True, "minimum": 0, "maximum": 3, "direction": "a_leads_b"})
        with patch("app.modules.alerts.router.complete_week", return_value=definition()["date_range"]):
            report = build_weekly_cross_dataset_report(self.frames, preference, template)
        self.assertFalse(report["definition"]["lag"]["enabled"])
        self.assertTrue(any("not reused" in warning for warning in report["warnings"]))

    def test_weekly_ai_receives_bounded_summaries_not_raw_trends_or_evidence(self):
        preference = WeeklyReportPreferenceResponse(enabled=False, cadence="weekly", delivery_day="monday", recipient_emails=[], metric_focus=["1:spend", "2:net_sales"], include_recommendations=True)
        with patch("app.modules.alerts.router.complete_week", return_value=definition()["date_range"]), \
             patch("app.modules.alerts.router.load_dataframe_from_dataset", side_effect=lambda dataset: self.frames[dataset.id][1].copy()), \
             patch("app.modules.alerts.router.generate_structured_analysis", return_value=None) as ai:
            build_weekly_report_digest(preference, [pair[0] for pair in self.frames.values()])
        facts = ai.call_args.kwargs["facts"]["cross_dataset_report"]
        self.assertEqual(len(facts["metrics"]), 2)
        self.assertTrue(all("trend" not in metric for metric in facts["metrics"]))
        self.assertTrue(all("evidence" not in finding for finding in facts["findings"]))


class BusinessReportWorkflowTests(unittest.TestCase):
    def setUp(self):
        patcher = patch.dict("os.environ", FLAGS)
        patcher.start(); self.addCleanup(patcher.stop)
        self.frames = fixture()
        self.engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine)
        self.addCleanup(self.engine.dispose)
        with self.Session() as db:
            for identity, (dataset, frame) in self.frames.items():
                db.add(Dataset(id=identity, user_id="owner", workspace_id="owner", file_name=dataset.file_name,
                               file_path="unused.csv", source_type="csv", source_config=dataset.source_config,
                               row_count=len(frame), column_count=len(frame.columns)))
            db.add(Dataset(id=3, user_id="someone-else", workspace_id="someone-else", file_name="private.csv", file_path="private.csv", source_type="csv", row_count=0, column_count=0))
            db.commit()
        for name, replacement in (("SessionLocal", self.Session), ("get_user_id", lambda request: "owner"),
                                  ("get_workspace_id", lambda request, user: request.headers.get("X-Workspace-Id", "owner")),
                                  ("get_workspace_role", lambda request: "owner"),
                                  ("require_workspace_data_manager", lambda request: None),
                                  ("load_dataframe_from_dataset", lambda dataset: self.frames[dataset.id][1].copy())):
            p = patch.object(router, name, replacement); p.start(); self.addCleanup(p.stop)
        app = FastAPI(); app.include_router(router.router)
        self.client = TestClient(app); self.addCleanup(self.client.close)

    def save(self):
        response = self.client.post("/api/v2/business-reports", json=definition())
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def test_core_reports_are_not_hidden_behind_correlation_rollout_flags(self):
        response = self.client.get("/api/v2/business-reports/catalog")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(len(response.json()["datasets"]), 2)
        self.assertEqual(self.client.post("/api/v2/business-reports/preview", json=definition()).status_code, 200)
        self.assertEqual(self.client.get("/api/v2/business-reports/catalog?dataset_id=3").json()["datasets"], [])

    def test_catalog_exposes_defaults_without_changing_saved_selection(self):
        with self.Session() as db:
            dataset = db.get(Dataset, 1)
            dataset.source_config = "{}"
            db.commit()
        response = self.client.get("/api/v2/business-reports/catalog?dataset_id=1")
        self.assertEqual(response.status_code, 200)
        entry = response.json()["datasets"][0]
        self.assertEqual([metric["metric_key"] for metric in entry["metrics"]], ["spend"])
        self.assertEqual(entry["metric_issues"], [])
        with self.Session() as db:
            self.assertEqual(db.get(Dataset, 1).source_config, "{}")

    def test_unsaved_csv_defaults_work_through_preview_snapshot_and_weekly_template(self):
        with self.Session() as db:
            for identity in (1, 2):
                db.get(Dataset, identity).source_config = "{}"
            db.commit()
        response = self.client.post("/api/v2/business-reports/preview", json=definition())
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["status"], "ready")
        saved = self.save()
        response = self.client.post(f"/api/v2/business-reports/{saved['report_id']}/weekly")
        self.assertEqual(response.status_code, 200, response.text)
        with self.Session() as db:
            for identity in (1, 2):
                self.assertEqual(db.get(Dataset, identity).source_config, "{}")

    def test_legacy_connector_defaults_are_selectable_and_previewable_from_the_same_catalog(self):
        frame = pd.DataFrame({"date": pd.date_range("2026-01-01", periods=90), "quantity": [2.] * 90,
                              "unit_price": [10.] * 90, "line_total": [20.] * 90, "currency": ["CAD"] * 90})
        self.frames[1] = self.frames[1][0], frame
        with self.Session() as db:
            dataset = db.get(Dataset, 1)
            dataset.source_type = "xero"
            dataset.source_config = '{"resource":"invoices"}'
            db.commit()
        response = self.client.get("/api/v2/business-reports/catalog?dataset_id=1")
        self.assertEqual(response.status_code, 200, response.text)
        metric = next(item for item in response.json()["datasets"][0]["metrics"] if item["metric_key"] == "line_total")
        payload = definition(); payload["metrics"][0].update(metric_key=metric["metric_key"], aggregation=metric["aggregation"])
        response = self.client.post("/api/v2/business-reports/preview", json=payload)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["metrics"][0]["value"], 140.)
        with self.Session() as db:
            self.assertEqual(db.get(Dataset, 1).source_config, '{"resource":"invoices"}')

    def test_catalog_keeps_unavailable_datasets_distinct_from_empty_metric_selection(self):
        with patch.object(router, "load_dataframe_from_dataset", side_effect=OSError("Private storage detail")):
            response = self.client.get("/api/v2/business-reports/catalog?dataset_id=1")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["datasets"][0]["error_code"], "dataset_unavailable")
        self.assertNotIn("Private storage detail", response.text)

    def test_cross_dataset_validation_and_scope_are_enforced(self):
        payload = definition(); payload["metrics"][1]["dataset_id"] = 3
        self.assertEqual(self.client.post("/api/v2/business-reports/preview", json=payload).status_code, 403)
        payload = definition(); payload["metrics"][1]["dataset_id"] = 1
        self.assertEqual(self.client.post("/api/v2/business-reports/preview", json=payload).status_code, 422)

    def test_snapshot_persistence_does_not_rewrite_evidence_after_source_changes(self):
        saved = self.save()
        self.frames[1][1]["spend"] = 999
        response = self.client.get(f"/api/v2/business-reports/{saved['report_id']}")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["metrics"], saved["metrics"])
        self.assertEqual(self.client.get(f"/api/v2/business-reports/{saved['report_id']}", headers={"X-Workspace-Id": "other"}).status_code, 404)

    def test_decision_evidence_retains_question_multiple_sources_and_review_requirements(self):
        saved = self.save()
        response = self.client.post(f"/api/v2/business-reports/{saved['report_id']}/decision-evidence", json={
            "title": "Investigate sales changes", "action": "Run a controlled experiment", "reasoning": "Check seasonality and inventory first",
            "expected_outcome": "Measure additional sales without reducing margin", "outcome_metric": "2:net_sales", "review_date": "2026-05-01"})
        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()["decision_payload"]
        self.assertEqual(payload["evidence_dataset_ids"], [1, 2])
        self.assertEqual(payload["metric_column"], "net_sales")
        evidence = json.loads(payload["recommendation_context"])
        self.assertEqual(evidence["report_id"], saved["report_id"])
        self.assertEqual(evidence["window"], saved["window"])
        self.assertTrue(evidence["limitations"])

    def test_decision_handoff_does_not_expand_selected_metrics_from_a_wide_saved_snapshot(self):
        saved = self.save()
        with self.Session() as db:
            report = db.get(BusinessReport, saved["report_id"])
            snapshot = json.loads(report.snapshot)
            snapshot["metrics"].append({**snapshot["metrics"][0], "id": "1:clicks", "metric_key": "clicks", "label": "Clicks"})
            report.snapshot = json.dumps(snapshot)
            db.commit()
        fields = {"title": "Shift campaign budget", "action": "Move 10% of budget to a controlled test", "reasoning": "Compare advertising and sales",
                  "expected_outcome": "Increase orders without increasing spend", "outcome_metric": "2:net_sales", "review_date": "2026-05-01"}
        response = self.client.post(f"/api/v2/business-reports/{saved['report_id']}/decision-evidence", json=fields)
        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()["decision_payload"]
        self.assertEqual([item["metric_column"] for item in payload["evidence_metrics"]], ["spend", "net_sales"])
        self.assertEqual([item["metric_key"] for item in json.loads(payload["recommendation_context"])["metrics"]], ["spend", "net_sales"])
        fields["outcome_metric"] = "1:clicks"
        response = self.client.post(f"/api/v2/business-reports/{saved['report_id']}/decision-evidence", json=fields)
        self.assertEqual(response.status_code, 400, response.text)

    def test_weekly_template_preserves_disabled_sending_and_existing_recipients(self):
        saved = self.save()
        with self.Session() as db:
            db.add(WeeklyReportPreference(workspace_id="owner", enabled=0, recipient_emails='["owner@example.test"]'))
            db.commit()
        response = self.client.post(f"/api/v2/business-reports/{saved['report_id']}/weekly")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertFalse(response.json()["enabled"])
        with self.Session() as db:
            preference = db.query(WeeklyReportPreference).one()
            self.assertEqual(preference.business_report_id, saved["report_id"])
            self.assertEqual(json.loads(preference.recipient_emails), ["owner@example.test"])
            self.assertEqual(json.loads(preference.metric_focus), ["1:spend", "2:net_sales"])

    def test_weekly_template_cannot_be_changed_by_read_only_users(self):
        saved = self.save()
        with patch.object(router, "require_workspace_data_manager", side_effect=HTTPException(403, "Read only")):
            self.assertEqual(self.client.post(f"/api/v2/business-reports/{saved['report_id']}/weekly").status_code, 403)

    def test_weekly_preview_uses_the_saved_template_without_enabling_delivery(self):
        saved = self.save()
        self.client.post(f"/api/v2/business-reports/{saved['report_id']}/weekly")
        with patch("app.modules.alerts.router.complete_week", return_value=definition()["date_range"]), \
             patch("app.modules.alerts.router.load_dataframe_from_dataset", side_effect=lambda dataset: self.frames[dataset.id][1].copy()), \
             patch("app.modules.alerts.router.get_weekly_report_branding", return_value={"brand_name": "Decisionate"}):
            response = self.client.get("/api/v2/business-reports/weekly-preview")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["window"], definition()["date_range"])
        self.assertEqual(response.json()["business_question"], definition()["business_question"])
        self.assertEqual(response.json()["dataset_count"], 2)
        self.assertEqual(response.json()["included_findings"], response.json()["definition"]["included_findings"])
        self.assertEqual(response.json()["decision_report_id"], saved["report_id"])
        self.assertNotIn("report_id", response.json())
        with self.Session() as db:
            self.assertFalse(db.query(WeeklyReportPreference).one().enabled)

    def test_read_only_users_can_explore_but_not_save_shared_reports(self):
        with patch.object(router, "get_workspace_role", return_value="viewer"):
            self.assertEqual(self.client.post("/api/v2/business-reports/preview", json=definition()).status_code, 200)
            self.assertEqual(self.client.post("/api/v2/business-reports", json=definition()).status_code, 403)
        with patch.object(router, "get_workspace_role", return_value="member"):
            self.assertEqual(self.client.post("/api/v2/business-reports", json=definition()).status_code, 201)

    def test_recorded_outcomes_are_scoped_to_the_workspace_and_evidence_datasets(self):
        saved = self.save()
        with self.Session() as db:
            for workspace, sources in (("owner", [1, 2]), ("other", [1, 2]), ("owner", [1, 3])):
                decision = Decision(clerk_user_id="owner", workspace_id=workspace, dataset_id=1, title=f"Decision {workspace} {sources}",
                                    actual_outcome="Recorded result", recommendation_context=json.dumps({"report_id": saved["report_id"]}))
                decision.evidence_dataset_ids = sources
                db.add(decision)
            db.commit()
            outcomes = decisions_for_report(db, "owner", {1, 2}, saved["report_id"])
            self.assertEqual(len(outcomes), 1)
        response = self.client.get(f"/api/v2/business-reports/{saved['report_id']}")
        self.assertEqual(response.json()["decisions"][0]["actual_outcome"], "Recorded result")

    def test_preview_and_new_snapshot_do_not_adopt_three_older_joined_data_decisions(self):
        with self.Session() as db:
            for title, status in (("Review joined evidence: Source 1.csv + Source 2.csv", "planned"),
                                  ("Review joined dataset evidence", "planned"),
                                  ("Review joined dataset evidence", "archived")):
                decision = Decision(clerk_user_id="owner", workspace_id="owner", dataset_id=1,
                                    title=title, status=status, recommendation_context="Joined dataset evidence")
                decision.evidence_dataset_ids = [1, 2]
                db.add(decision)
            db.commit()
        response = self.client.post("/api/v2/business-reports/preview", json=definition())
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["decisions"], [])
        saved = self.save()
        self.assertEqual(saved["decisions"], [])
        self.assertEqual(self.client.get(f"/api/v2/business-reports/{saved['report_id']}").json()["decisions"], [])
        with self.Session() as db:
            self.assertEqual(db.query(Decision).count(), 3)
            self.assertEqual(db.query(Decision).filter_by(status="archived").count(), 1)

    def test_saved_report_only_shows_explicit_links_and_keeps_real_archived_decisions(self):
        saved, other = self.save(), self.save()
        with self.Session() as db:
            for title, status, report_id in (("Move 10% of budget to search", "planned", saved["report_id"]),
                                             ("Pause an ineffective campaign", "archived", saved["report_id"]),
                                             ("Reduce supplier lead times", "planned", other["report_id"])):
                decision = Decision(clerk_user_id="owner", workspace_id="owner", dataset_id=1,
                                    title=title, status=status, recommendation_context=json.dumps({"report_id": report_id}))
                decision.evidence_dataset_ids = [1, 2]
                db.add(decision)
            db.commit()
        decisions = self.client.get(f"/api/v2/business-reports/{saved['report_id']}").json()["decisions"]
        self.assertEqual({item["title"] for item in decisions}, {"Move 10% of budget to search", "Pause an ineffective campaign"})
        self.assertEqual(len(decisions), 2)
        self.assertTrue(any(item["status"] == "archived" for item in decisions))

    def test_older_report_link_is_not_lost_behind_a_hundred_unrelated_decisions(self):
        saved = self.save()
        with self.Session() as db:
            decision = Decision(clerk_user_id="owner", workspace_id="owner", dataset_id=1, title="Reallocate campaign budget",
                                recommendation_context=json.dumps({"report_id": saved["report_id"]}))
            decision.evidence_dataset_ids = [1, 2]
            db.add(decision)
            db.flush()
            for _ in range(101):
                db.add(Decision(clerk_user_id="owner", workspace_id="owner", dataset_id=1, title="Unrelated decision"))
            db.commit()
        decisions = self.client.get(f"/api/v2/business-reports/{saved['report_id']}").json()["decisions"]
        self.assertEqual([item["title"] for item in decisions], ["Reallocate campaign budget"])

    def test_weekly_report_uses_only_decisions_linked_to_its_selected_template(self):
        saved = self.save()
        self.client.post(f"/api/v2/business-reports/{saved['report_id']}/weekly")
        with self.Session() as db:
            for title, context in (("Shift campaign budget", {"report_id": saved["report_id"]}),
                                   ("Review joined dataset evidence", {})):
                decision = Decision(clerk_user_id="owner", workspace_id="owner", dataset_id=1, title=title,
                                    recommendation_context=json.dumps(context))
                decision.evidence_dataset_ids = [1, 2]
                db.add(decision)
            db.commit()
        with patch("app.modules.alerts.router.complete_week", return_value=definition()["date_range"]), \
             patch("app.modules.alerts.router.load_dataframe_from_dataset", side_effect=lambda dataset: self.frames[dataset.id][1].copy()), \
             patch("app.modules.alerts.router.get_weekly_report_branding", return_value={"brand_name": "Decisionate"}):
            response = self.client.get("/api/v2/business-reports/weekly-preview")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual([item["title"] for item in response.json()["decisions"]], ["Shift campaign budget"])

    def test_changed_saved_metric_policy_is_rejected_and_sources_are_reauthorized(self):
        with self.Session() as db:
            dataset = db.get(Dataset, 1)
            dataset.source_config = json.dumps({"selected_metric_columns": []})
            db.commit()
        response = self.client.post("/api/v2/business-reports/preview", json=definition())
        self.assertEqual(response.status_code, 400)

    def test_arbitrary_analysis_provenance_cannot_reference_another_run(self):
        response = self.client.post("/api/v2/business-reports/preview", json=definition(source_run_id="not-accessible"))
        self.assertEqual(response.status_code, 404)

    def test_decision_drafts_require_valid_dates_and_nonblank_actions(self):
        saved = self.save()
        response = self.client.post(f"/api/v2/business-reports/{saved['report_id']}/decision-evidence", json={
            "title": "Investigate sales changes", "action": "   ", "reasoning": "Record competing hypotheses",
            "expected_outcome": "Measure incremental orders", "outcome_metric": "2:net_sales", "review_date": "2026-99-99"})
        self.assertEqual(response.status_code, 422)

    def test_source_deletion_removes_snapshots_and_clears_weekly_template(self):
        saved = self.save()
        self.client.post(f"/api/v2/business-reports/{saved['report_id']}/weekly")
        with self.Session() as db:
            cleanup_source(db, 1)
            db.commit()
            self.assertIsNone(db.get(BusinessReport, saved["report_id"]))
            self.assertIsNone(db.query(WeeklyReportPreference).one().business_report_id)
        self.assertEqual(self.client.get(f"/api/v2/business-reports/{saved['report_id']}").status_code, 404)

    def test_workspace_cleanup_does_not_remove_another_workspaces_reports(self):
        saved = self.save()
        with self.Session() as db:
            other = BusinessReport(workspace_id="other", user_id="other", name="Other report", definition="{}", snapshot="{}")
            db.add(other); db.commit(); identity = other.id
            cleanup_workspace(db, "owner"); db.commit()
            self.assertIsNone(db.get(BusinessReport, saved["report_id"]))
            self.assertIsNotNone(db.get(BusinessReport, identity))


if __name__ == "__main__":
    unittest.main()
