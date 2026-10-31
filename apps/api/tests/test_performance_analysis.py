import json
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.database import Base
from app.db.models import Dataset, IngestionWorkerHeartbeat, utc_now
from app.modules.correlation.service import encode
from app.modules.performance import router
from app.modules.performance.models import PerformanceAnalysis
from app.modules.performance.schemas import PerformanceDefinition
from app.modules.performance.service import calculate
from app.modules.reports.models import ReportAnalysisJob


def selection(identity=1, metric="revenue", **changes):
    return dict(dataset_id=identity, metric_key=metric, date_column="date", **changes)


def definition(**changes):
    return PerformanceDefinition(**(dict(kind="return", date_range={"start": "2025-01-01", "end": "2025-01-03"},
        currency="CAD", amounts_confirmed=True,
        items=[dict(name=name, revenue=selection(identity), costs=[selection(identity, "ad_spend")])
               for identity, name in [(1, "Channel A"), (2, "Channel B")]]) | changes))


def frames():
    result = {}
    for identity, revenue, cost in [(1, [100, 300, 500], [50, 50, 50]), (2, [100, 100, 100], [50, 50, 50])]:
        dataset = SimpleNamespace(id=identity, file_name=f"source{identity}.csv", source_type="csv",
            source_config=json.dumps({"selected_metric_columns": ["revenue", "ad_spend"]}))
        result[identity] = dataset, pd.DataFrame({"date": pd.date_range("2025-01-01", periods=3),
            "revenue": revenue, "ad_spend": cost, "currency": "CAD"})
    return result


class PerformanceCalculationTests(unittest.TestCase):
    def test_return_uses_ratio_of_totals_not_mean_of_row_ratios(self):
        source = frames()
        source[1][1]["ad_spend"] = [1, 49, 100]
        result = calculate(source, definition())
        self.assertEqual(result["status"], "ready", result)
        self.assertEqual(result["winner"], "Channel A")
        self.assertEqual(result["rows"][0]["return_per_dollar"], 6)
        self.assertEqual(result["rows"][0]["revenue"], 900)

    def test_profit_is_explicitly_after_selected_costs(self):
        result = calculate(frames(), definition(kind="profit"))
        self.assertEqual(result["rows"][0]["money_left"], 750)
        self.assertAlmostEqual(result["rows"][0]["margin_percent"], 83.33)
        self.assertIn("selected costs", result["headline"])
        self.assertIn("not net profit", result["limitations"][-1])

    def test_partial_missing_values_or_dates_never_produces_a_winner(self):
        for fault in ("amount", "gap", "date", "currency", "zero"):
            with self.subTest(fault=fault):
                source = frames()
                if fault == "amount": source[1][1].loc[1, "ad_spend"] = float("nan")
                if fault == "gap": source[1] = source[1][0], source[1][1].drop(index=1)
                if fault == "date": source[1][1].loc[1, "date"] = pd.NaT
                if fault == "currency": source[1][1]["currency"] = "USD"
                if fault == "zero": source[1][1]["ad_spend"] = 0
                result = calculate(source, definition())
                self.assertEqual(result["status"], "partial", result)
                self.assertIsNone(result["winner"])
                self.assertTrue(next(row for row in result["rows"] if row["name"] == "Channel A")["issues"])

    def test_no_confirmation_or_no_dates_does_not_invent_results(self):
        for payload in (definition(amounts_confirmed=False), definition(date_range={"start": "2024-01-01", "end": "2024-01-03"})):
            result = calculate(frames(), payload)
            self.assertEqual(result["status"], "needs_data")
            self.assertIsNone(result["winner"])

    def test_extreme_amounts_produce_notes_not_nonfinite_json_or_a_winner(self):
        for revenue, cost in [(1e308, 50), (100, 1e-309)]:
            source = frames()
            source[1][1]["revenue"] = revenue
            source[1][1]["ad_spend"] = cost
            result = calculate(source, definition())
            self.assertIsNone(result["winner"])
            self.assertEqual(result["status"], "partial")
            json.dumps(result, allow_nan=False)

    def test_platform_reported_sales_do_not_claim_a_fair_ranking(self):
        result = calculate(frames(), definition(revenue_basis="platform_reported"))
        self.assertEqual(result["status"], "ready")
        self.assertIsNone(result["winner"])
        self.assertIn("without an overall winner", result["headline"])
        empty = calculate(frames(), definition(revenue_basis="platform_reported",
            date_range={"start": "2024-01-01", "end": "2024-01-03"}))
        self.assertEqual(empty["status"], "needs_data")
        self.assertIn("Complete the records", empty["headline"])
        source = frames()
        source[1][1].loc[1, "revenue"] = float("nan")
        partial = calculate(source, definition(revenue_basis="platform_reported"))
        self.assertEqual(partial["status"], "partial")
        self.assertIn("incomplete", partial["headline"])

    def test_one_dataset_groups_and_transaction_filters_are_supported(self):
        source = frames()
        source[1][1]["channel"] = "A"
        source[2][1]["channel"] = "B"
        source[1] = source[1][0], pd.concat([source[1][1], source[2][1]], ignore_index=True)
        payload = definition(items=[dict(name="Channels", revenue=selection(), costs=[selection(metric="ad_spend")])], group_column="channel")
        result = calculate(source, payload)
        self.assertEqual(result["winner"], "A", result)
        self.assertEqual({row["name"]: row["revenue"] for row in result["rows"]}, {"A": 900, "B": 300})
        self.assertEqual(len(source[1][1]), 6)

    def test_transaction_records_can_be_sparse_but_not_missing_amounts(self):
        source = frames()
        source[1] = source[1][0], source[1][1].drop(index=1)
        payload = definition()
        for item in payload.items:
            for item_selection in [item.revenue, *item.costs]: item_selection.records = "transactions"
        self.assertEqual(calculate(source, payload)["status"], "ready")
        source[1][1].loc[0, "revenue"] = float("nan")
        self.assertNotEqual(calculate(source, payload)["status"], "ready")

    def test_monthly_totals_require_full_months(self):
        source = frames()
        for _, frame in source.values(): frame["date"] = pd.date_range("2025-01-01", periods=3, freq="MS")
        payload = definition(date_range={"start": "2025-01-01", "end": "2025-03-31"})
        for item in payload.items:
            for item_selection in [item.revenue, *item.costs]: item_selection.records = "monthly"
        self.assertEqual(calculate(source, payload)["status"], "ready")
        payload.date_range.end = pd.Timestamp("2025-03-15").date()
        self.assertEqual(calculate(source, payload)["status"], "needs_data")

    def test_ties_refunds_and_losses_are_not_hidden(self):
        source = frames()
        source[2][1]["revenue"] = source[1][1]["revenue"]
        result = calculate(source, definition())
        self.assertIsNone(result["winner"])
        self.assertIn("tied", result["headline"])
        source[1][1]["revenue"] = [-100, 50, 25]
        source[2][1]["revenue"] = [1, 1, 1]
        result = calculate(source, definition(kind="profit"))
        self.assertIn("All groups lost money", result["headline"])
        self.assertTrue(all(row["money_left"] < 0 for row in result["rows"]))

    def test_duplicate_revenue_and_costs_are_rejected(self):
        with self.assertRaises(ValidationError):
            definition(items=[dict(name=name, revenue=selection(), costs=[selection(i, "ad_spend")]) for i, name in [(1, "A"), (2, "B")]])
        with self.assertRaises(ValidationError):
            definition(kind="profit", items=[dict(name="A", revenue=selection(), costs=[selection(metric="ad_spend")] * 2)])
        payload = definition(items=[dict(name=name, revenue=selection(dimension_filter={"column": "channel", "values": [name]}),
            costs=[selection(metric="ad_spend", dimension_filter={"column": "channel", "values": [name]})]) for name in ("A", "B")])
        self.assertEqual(len(payload.items), 2)
        with self.assertRaises(ValidationError): definition(group_column="channel")

    def test_unapproved_metrics_and_nonadditive_policies_are_blocked(self):
        from app.modules.datasets.services.metric_policy import FRAME_POLICY_KEY
        source = frames()
        source[1][1].attrs[FRAME_POLICY_KEY] = {"selected": ["revenue", "ad_spend"], "descriptors": {
            "revenue": {"columnKey": "revenue", "label": "Revenue", "aggregation": "SUM", "unit": "currency", "currency": "CAD", "reason": "Approved revenue"},
            "ad_spend": {"columnKey": "ad_spend", "label": "Average spend", "aggregation": "AVG", "unit": "currency", "currency": "CAD", "reason": "Average, not additive"}}}
        result = calculate(source, definition())
        self.assertEqual(result["status"], "partial")
        self.assertIsNone(result["winner"])
        self.assertTrue(any("total" in issue for row in result["rows"] for issue in row["issues"]))

    def test_group_values_exclude_records_outside_selected_dates(self):
        source = frames()
        source[1][1]["channel"] = ["A", "A", "A"]
        extra = source[1][1].iloc[[0]].copy()
        extra["date"], extra["channel"] = pd.Timestamp("2024-01-01"), "Old channel"
        source[1] = source[1][0], pd.concat([source[1][1], extra], ignore_index=True)
        payload = definition(group_column="channel", items=[dict(name="Channels", revenue=selection(), costs=[selection(metric="ad_spend")])])
        self.assertEqual([row["name"] for row in calculate(source, payload)["rows"]], ["A"])


class PerformanceRoutesTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine)
        app = FastAPI()
        app.include_router(router.router)
        def database():
            with self.sessions() as db: yield db
        app.dependency_overrides[router.database] = database
        self.client = TestClient(app)
        self.addCleanup(self.client.close)
        self.addCleanup(self.engine.dispose)
        for name, value in (("identity", ("owner", "owner")), ("require_report_writer", None)):
            mocked = patch.object(router, name, return_value=value)
            mocked.start(); self.addCleanup(mocked.stop)
        with self.sessions() as db:
            for identity in (1, 2):
                db.add(Dataset(id=identity, user_id="owner", workspace_id="owner", file_name=f"{identity}.csv", file_path="missing.csv", source_type="csv", row_count=3, column_count=3))
            db.add(IngestionWorkerHeartbeat(name="reports-analysis", last_seen_at=utc_now()))
            db.commit()

    def preview(self):
        response = self.client.post("/api/v2/performance-analyses/jobs", json=definition().model_dump(mode="json"), headers={"Idempotency-Key": "test"})
        self.assertEqual(response.status_code, 202, response.text)
        return response.json()["job_id"]

    def complete(self, job_id):
        with self.sessions() as db:
            job = db.get(ReportAnalysisJob, job_id)
            job.status, job.result = "succeeded", encode(calculate(frames(), definition()))
            db.commit()

    def test_preview_then_save_once_separate_histories_and_delete(self):
        job = self.preview()
        self.assertEqual(self.preview(), job)
        path = f"/api/v2/performance-analyses/jobs/{job}/save"
        self.assertEqual(self.client.post(path).status_code, 409)
        self.complete(job)
        saved = self.client.post(path)
        self.assertEqual(saved.status_code, 201, saved.text)
        identity = saved.json()["analysis_id"]
        self.assertEqual(self.client.post(path).json()["analysis_id"], identity)
        self.assertEqual(len(self.client.get("/api/v2/performance-analyses?kind=return").json()["analyses"]), 1)
        self.assertEqual(self.client.get("/api/v2/performance-analyses?kind=profit").json()["analyses"], [])
        self.assertEqual(self.client.delete(f"/api/v2/performance-analyses/{identity}").status_code, 200)
        self.assertEqual(self.client.post(path).status_code, 410)

    def test_workspace_and_job_kind_boundaries(self):
        job = self.preview(); self.complete(job)
        identity = self.client.post(f"/api/v2/performance-analyses/jobs/{job}/save").json()["analysis_id"]
        with patch.object(router, "identity", return_value=("other", "other")):
            for path in (f"/{identity}", f"/jobs/{job}"):
                self.assertEqual(self.client.get("/api/v2/performance-analyses" + path).status_code, 404)
            self.assertEqual(self.client.get("/api/v2/performance-analyses?kind=return").json()["analyses"], [])
        with self.sessions() as db:
            db.get(ReportAnalysisJob, job).kind = "report"; db.commit()
        self.assertEqual(self.client.get(f"/api/v2/performance-analyses/jobs/{job}").status_code, 404)

    def test_changed_sources_readonly_and_cancellation(self):
        job = self.preview(); self.complete(job)
        path = f"/api/v2/performance-analyses/jobs/{job}/save"
        with patch.object(router, "require_report_writer", side_effect=HTTPException(403, "Read only")):
            self.assertEqual(self.client.post(path).status_code, 403)
        with self.sessions() as db:
            db.get(Dataset, 1).row_count = 10; db.commit()
        self.assertEqual(self.client.post(path).status_code, 409)
        with self.sessions() as db:
            db.get(ReportAnalysisJob, job).status = "queued"; db.commit()
        self.assertEqual(self.client.delete(f"/api/v2/performance-analyses/jobs/{job}").json()["status"], "cancelled")

    def test_worker_dispatch_and_source_cleanup(self):
        from app.infrastructure import analysis_worker
        from app.modules.reports.cleanup import cleanup_source, cleanup_workspace
        job = self.preview()
        with patch.object(analysis_worker, "SessionLocal", self.sessions), patch("app.modules.performance.service.generate", return_value=calculate(frames(), definition())) as generate:
            analysis_worker.execute_job(job)
        generate.assert_called_once()
        saved = self.client.post(f"/api/v2/performance-analyses/jobs/{job}/save")
        self.assertEqual(saved.status_code, 201, saved.text)
        with self.sessions() as db:
            cleanup_source(db, 1); db.commit()
            self.assertEqual(db.query(PerformanceAnalysis).count(), 0)
            db.add(PerformanceAnalysis(workspace_id="owner", user_id="owner", kind="return", job_id="other", name="test", definition=encode(definition().model_dump(mode="json")), snapshot="{}"))
            db.commit()
            cleanup_workspace(db, "owner"); db.commit()
            self.assertEqual(db.query(PerformanceAnalysis).count(), 0)

    def test_saved_evidence_creates_only_one_decision_and_retains_filters(self):
        from unittest.mock import AsyncMock
        from app.modules.decisions.models import Decision
        job = self.preview(); self.complete(job)
        saved = self.client.post(f"/api/v2/performance-analyses/jobs/{job}/save").json()["analysis_id"]
        payload = {"title": "Review the channel mix", "action": "Review the recorded spending and sales with the team.",
                   "expected_outcome": "Agree on a measured test after checking costs.", "review_date": "2026-11-30"}
        with self.sessions() as db:
            db.add(Decision(id=88, clerk_user_id="owner", workspace_id="owner", dataset_id=1,
                            title=payload["title"], action=payload["action"]))
            db.commit()
        create = AsyncMock(return_value=SimpleNamespace(id=88))
        with patch("app.modules.decisions.router.require_decision_manager"), patch("app.modules.decisions.router.create_decision", create):
            path = f"/api/v2/performance-analyses/{saved}/decision"
            response = self.client.post(path, json=payload)
            self.assertEqual(response.status_code, 201, response.text)
            self.assertEqual(self.client.post(path, json=payload).json()["decision_id"], 88)
        create.assert_awaited_once()
        evidence = json.loads(create.call_args.args[0].recommendation_context)
        self.assertEqual(evidence["evidence_kind"], "performance")
        self.assertEqual(evidence["definition"], definition().model_dump(mode="json"))
        self.assertEqual(create.call_args.args[0].evidence_dataset_ids, [1, 2])
