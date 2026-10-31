from datetime import date
import json
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.database import Base
from app.db.models import Dataset, IngestionWorkerHeartbeat, utc_now
from app.modules.budget_planner.engine import allocate_cents, exposure, plan_matrix
from app.modules.budget_planner.models import BudgetPlan
from app.modules.budget_planner.schemas import BudgetDefinition
from app.modules.budget_planner.service import build_plan, validate_dates
from app.modules.budget_planner import router
from app.modules.correlation.service import encode
from app.modules.reports.models import ReportAnalysisJob

TODAY = date(2026, 10, 31)


def definition(**changes):
    fields = dict(name="Channel test", outcome=dict(dataset_id=1, metric_key="revenue", date_column="date", data_grain="weekly"),
        options=[dict(dataset_id=i, metric_key="spend", date_column="date", name=f"Option {i}", data_grain="weekly") for i in (2, 3)],
        budget=8000, currency="CAD", start_date="2026-11-02", weeks=4,
        comparable_spend_confirmed=True, business_context_confirmed=True)
    return BudgetDefinition(**(fields | changes))


def observations(n=156):
    rng = np.random.default_rng(8)
    spend = rng.uniform(500, 1500, (n, 2))
    outcome = 200 + np.log1p(exposure(spend, .3) / 1000) @ [800, 200] + rng.normal(0, 5, n)
    return spend, outcome


def frames(n=156):
    spend, outcome = observations(n)
    dates = pd.date_range(end="2026-10-19", periods=n, freq="W-MON")
    result = {}
    for identity, key, values in [(1, "revenue", outcome), (2, "spend", spend[:, 0]), (3, "spend", spend[:, 1])]:
        dataset = SimpleNamespace(id=identity, file_name=f"source-{identity}.csv", source_type="csv",
            source_config=json.dumps({"selected_metric_columns": [key]}))
        result[identity] = dataset, pd.DataFrame({"date": dates, key: values})
    return result


class BudgetEngineTests(unittest.TestCase):
    def calculate(self, spend=None, outcome=None, **changes):
        s, y = observations()
        s, y = s if spend is None else spend, y if outcome is None else outcome
        return plan_matrix(s, y, np.empty((len(y), 0)), np.arange(len(y)), definition(**changes))

    def test_supported_response_preserves_budget_and_shifts_to_stronger_option(self):
        result = self.calculate()
        self.assertEqual(result["status"], "ready", result)
        self.assertEqual(round(sum(row["suggested"] for row in result["allocations"]), 2), 8000)
        self.assertGreater(result["allocations"][0]["suggested"], result["allocations"][0]["current"])
        self.assertGreater(result["estimate"]["lower"], 0)
        for row in result["allocations"]:
            self.assertGreaterEqual(row["suggested"], row["minimum"])
            self.assertLessEqual(row["suggested"], row["maximum"])

    def test_weak_data_does_not_create_allocations(self):
        s, y = observations()
        cases = [dict(spend=s[:80], outcome=y[:80]), dict(spend=np.ones_like(s)), dict(spend=np.c_[s[:, 0], s[:, 0]]),
                 dict(outcome=np.random.default_rng(9).uniform(1, 10000, len(y))), dict(spend=-s),
                 dict(budget=1000000), dict(comparable_spend_confirmed=False), dict(business_context_confirmed=False)]
        for case in cases:
            with self.subTest(case=list(case)):
                result = self.calculate(**case)
                self.assertEqual(result["status"], "needs_evidence")
                self.assertEqual(result["allocations"], [])

    def test_cent_rounding_keeps_limits_and_total(self):
        actual = allocate_cents(np.array([33.333, 33.333, 33.334]), np.array([0., 0., 0.]), np.array([34., 34., 34.]), 100)
        self.assertEqual(actual.sum(), 100)
        with self.assertRaises(ValueError):
            allocate_cents(np.array([1.]), np.array([1.001]), np.array([1.009]), 1)

    def test_unconfirmed_or_overlapping_option_inputs_rejected(self):
        same = dict(dataset_id=2, metric_key="spend", date_column="date")
        with self.assertRaises(ValidationError):
            definition(options=[dict(same, name="A"), dict(same, name="B")])
        valid = definition(options=[dict(same, name=name, dimension_filter={"column": "channel", "values": [name]}) for name in ("A", "B")])
        self.assertEqual(len(valid.options), 2)
        with self.assertRaises(ValidationError):
            definition(budget=float("inf"))
        with self.assertRaises(ValidationError):
            definition(budget=1.001)

    def test_future_planning_week_validation(self):
        validate_dates(definition(), TODAY)
        for start in ("2026-10-26", "2026-11-03", "2027-01-04"):
            with self.assertRaises(HTTPException):
                validate_dates(definition(start_date=start), TODAY)


class BudgetDataTests(unittest.TestCase):
    def test_curated_sum_policies_are_respected(self):
        from app.modules.datasets.services.metric_policy import FRAME_POLICY_KEY
        sources = frames()
        for dataset, frame in sources.values():
            key = next(column for column in frame if column != "date")
            frame.attrs[FRAME_POLICY_KEY] = {"selected": [key], "descriptors": {key: {"columnKey": key,
                "label": key, "aggregation": "SUM", "unit": "currency", "currency": "CAD", "reason": "Approved amount"}}}
        result = build_plan(sources, definition(), today=TODAY)
        self.assertEqual(result["status"], "ready", result)

    def test_weekly_sources_use_approved_semantics_and_no_join_duplication(self):
        result = build_plan(frames(), definition(), today=TODAY)
        self.assertEqual(result["status"], "ready", result)
        self.assertEqual(result["history"]["weeks"], 156)
        self.assertIn("not proof", result["limitations"][0])

    def test_complete_daily_totals_match_weekly_totals_without_changing_sources(self):
        sources = frames()
        daily = {}
        for identity, (dataset, frame) in sources.items():
            metric = "revenue" if identity == 1 else "spend"
            repeated = frame.loc[frame.index.repeat(7)].reset_index(drop=True)
            repeated["date"] += pd.to_timedelta(np.tile(np.arange(7), len(frame)), unit="D")
            repeated[metric] /= 7
            daily[identity] = dataset, repeated
        payload = definition()
        for item in [payload.outcome, *payload.options]: item.data_grain = "daily"
        result = build_plan(daily, payload, today=TODAY)
        weekly = build_plan(sources, definition(), today=TODAY)
        self.assertEqual(result["allocations"], weekly["allocations"])
        self.assertEqual(result["estimate"], weekly["estimate"])
        self.assertEqual(len(daily[2][1]), 1092)

    def test_same_dataset_dimension_values_remain_separate_options(self):
        sources = frames()
        sources[2][1]["channel"] = "A"
        sources[3][1]["channel"] = "B"
        sources[2] = sources[2][0], pd.concat([sources[2][1], sources[3][1]], ignore_index=True)
        payload = definition(options=[dict(dataset_id=2, metric_key="spend", date_column="date", data_grain="weekly",
                                          name=name, dimension_filter={"column": "channel", "values": [name]}) for name in ("A", "B")])
        result = build_plan(sources, payload, today=TODAY)
        self.assertEqual(result["status"], "ready", result)
        self.assertGreater(result["allocations"][0]["suggested"], result["allocations"][0]["current"])

    def test_stale_missing_year_missing_week_and_wrong_currency_fail_closed(self):
        for problem in ("stale", "yearless", "gap", "currency", "daily", "invalid", "invalid_date"):
            with self.subTest(problem=problem):
                sources = frames()
                dataset, frame = sources[2]
                if problem == "stale":
                    sources = {key: (item, values.assign(date=values.date - pd.Timedelta(days=90))) for key, (item, values) in sources.items()}
                elif problem == "yearless": frame["date"] = "January"
                elif problem == "gap": sources[2] = dataset, frame.drop(index=80)
                elif problem == "currency": frame["currency"] = "USD"
                elif problem == "invalid": frame.loc[80, "spend"] = float("nan")
                elif problem == "invalid_date": frame.loc[80, "date"] = pd.NaT
                payload = definition()
                if problem == "daily": payload.options[0].data_grain = "daily"
                result = build_plan(sources, payload, today=TODAY)
                self.assertEqual(result["status"], "needs_evidence", result)
                self.assertFalse(result["allocations"])


class BudgetRoutesTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine)
        self.app = FastAPI()
        self.app.include_router(router.router)
        def database():
            with self.sessions() as db: yield db
        self.app.dependency_overrides[router.database] = database
        self.client = TestClient(self.app)
        self.addCleanup(self.client.close)
        self.addCleanup(self.engine.dispose)
        for name, value in (("identity", ("owner", "owner")), ("require_report_writer", None), ("validate_dates", None)):
            mocked = patch.object(router, name, return_value=value)
            mocked.start(); self.addCleanup(mocked.stop)
        with self.sessions() as db:
            for identity in (1, 2, 3):
                db.add(Dataset(id=identity, user_id="owner", workspace_id="owner", file_name=f"file{identity}.csv", file_path="missing.csv", source_type="csv", row_count=156, column_count=2))
            db.add(IngestionWorkerHeartbeat(name="reports-analysis", last_seen_at=utc_now()))
            db.commit()

    def preview(self):
        response = self.client.post("/api/v2/budget-plans/jobs", json=definition().model_dump(mode="json"), headers={"Idempotency-Key": "test"})
        self.assertEqual(response.status_code, 202, response.text)
        return response.json()["job_id"]

    def complete(self, job_id, status="ready"):
        with self.sessions() as db:
            job = db.get(ReportAnalysisJob, job_id)
            result = {"definition": definition().model_dump(mode="json"), "status": status, "allocations": []}
            job.status, job.result = "succeeded", encode(result)
            db.commit()

    def test_enqueue_is_idempotent_save_requires_preview_and_is_idempotent(self):
        job = self.preview()
        self.assertEqual(self.preview(), job)
        self.assertEqual(self.client.post(f"/api/v2/budget-plans/jobs/{job}/save").status_code, 409)
        self.complete(job)
        response = self.client.post(f"/api/v2/budget-plans/jobs/{job}/save")
        self.assertEqual(response.status_code, 201, response.text)
        plan_id = response.json()["plan_id"]
        self.assertEqual(self.client.post(f"/api/v2/budget-plans/jobs/{job}/save").json()["plan_id"], plan_id)
        with self.sessions() as db: self.assertEqual(db.query(BudgetPlan).count(), 1)
        self.assertEqual(self.client.delete(f"/api/v2/budget-plans/{plan_id}").status_code, 200)
        self.assertEqual(self.client.post(f"/api/v2/budget-plans/jobs/{job}/save").status_code, 410)

    def test_no_supported_evidence_means_no_saved_plan(self):
        job = self.preview(); self.complete(job, "needs_evidence")
        self.assertEqual(self.client.post(f"/api/v2/budget-plans/jobs/{job}/save").status_code, 409)

    def test_changed_sources_cannot_save_old_preview(self):
        job = self.preview(); self.complete(job)
        with self.sessions() as db:
            db.get(Dataset, 2).row_count = 200; db.commit()
        self.assertEqual(self.client.post(f"/api/v2/budget-plans/jobs/{job}/save").status_code, 409)

    def test_saved_plans_are_not_visible_in_another_workspace(self):
        job = self.preview(); self.complete(job)
        plan = self.client.post(f"/api/v2/budget-plans/jobs/{job}/save").json()["plan_id"]
        with patch.object(router, "identity", return_value=("other", "other")):
            self.assertEqual(self.client.get("/api/v2/budget-plans").json()["plans"], [])
            self.assertEqual(self.client.get(f"/api/v2/budget-plans/{plan}").status_code, 404)
            self.assertEqual(self.client.delete(f"/api/v2/budget-plans/{plan}").status_code, 404)

    def test_workspace_boundary_and_wrong_kind(self):
        job = self.preview()
        with patch.object(router, "identity", return_value=("other", "other")):
            self.assertEqual(self.client.get(f"/api/v2/budget-plans/jobs/{job}").status_code, 404)
        with self.sessions() as db:
            db.get(ReportAnalysisJob, job).kind = "report"; db.commit()
        self.assertEqual(self.client.get(f"/api/v2/budget-plans/jobs/{job}").status_code, 404)

    def test_readonly_cannot_save_and_cancel_does_not_save(self):
        job = self.preview()
        with patch.object(router, "require_report_writer", side_effect=HTTPException(403, "Read only")):
            self.assertEqual(self.client.post(f"/api/v2/budget-plans/jobs/{job}/save").status_code, 403)
        self.assertEqual(self.client.delete(f"/api/v2/budget-plans/jobs/{job}").json()["status"], "cancelled")
        with self.sessions() as db: self.assertEqual(db.query(BudgetPlan).count(), 0)

    def test_worker_executes_new_kind_and_checks_source_revisions(self):
        from app.infrastructure import analysis_worker
        job = self.preview()
        with patch.object(analysis_worker, "SessionLocal", self.sessions), patch("app.modules.budget_planner.service.generate", return_value={"status": "needs_evidence"}) as generate:
            analysis_worker.execute_job(job)
        generate.assert_called_once()
        with self.sessions() as db:
            self.assertEqual(db.get(ReportAnalysisJob, job).status, "succeeded")
            db.get(ReportAnalysisJob, job).status = "queued"
            db.get(Dataset, 2).row_count = 100
            db.commit()
        with patch.object(analysis_worker, "SessionLocal", self.sessions), patch("app.modules.budget_planner.service.generate") as generate:
            analysis_worker.execute_job(job)
        generate.assert_not_called()
        with self.sessions() as db: self.assertEqual(db.get(ReportAnalysisJob, job).error_status, 409)

    def test_cleanup_removes_plans_with_workspace_or_source(self):
        from app.modules.reports.cleanup import cleanup_source, cleanup_workspace
        job = self.preview(); self.complete(job)
        self.client.post(f"/api/v2/budget-plans/jobs/{job}/save")
        with self.sessions() as db:
            cleanup_source(db, 2); db.commit()
            self.assertEqual(db.query(BudgetPlan).count(), 0)
            db.add(BudgetPlan(workspace_id="owner", user_id="owner", job_id="other", name="plan", definition=encode(definition().model_dump(mode="json")), snapshot="{}"))
            db.commit()
            cleanup_workspace(db, "owner"); db.commit()
            self.assertEqual(db.query(BudgetPlan).count(), 0)

    def test_saved_plan_creates_one_real_decision_with_selected_evidence(self):
        from app.modules.decisions import router as decisions
        from app.modules.decisions.models import Decision
        job = self.preview(); self.complete(job)
        plan = self.client.post(f"/api/v2/budget-plans/jobs/{job}/save").json()["plan_id"]
        payload = dict(title="Channel allocation test", action="Run a measured test of this allocation.",
                       expected_outcome="Improve store revenue with the same total spend.", review_date="2026-12-01")
        with patch.object(decisions, "SessionLocal", self.sessions), patch.object(decisions, "require_decision_manager"), patch.object(decisions, "resolve_user_reference", side_effect=lambda value: value):
            first = self.client.post(f"/api/v2/budget-plans/{plan}/decision", json=payload)
            self.assertEqual(first.status_code, 201, first.text)
            second = self.client.post(f"/api/v2/budget-plans/{plan}/decision", json=payload)
            self.assertEqual(first.json(), second.json())
        with self.sessions() as db:
            self.assertEqual(db.query(Decision).count(), 1)
            decision = db.query(Decision).one()
            self.assertEqual(len(decision.evidence_metrics), 3)
            self.assertEqual(json.loads(decision.recommendation_context)["evidence_kind"], "budget_plan")
