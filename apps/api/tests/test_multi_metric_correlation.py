import asyncio
import json
from datetime import timedelta
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.database import Base
from app.db.models import Dataset, utc_now
from app.modules.correlation import router, worker
from app.modules.correlation.catalog import prepare_series
from app.modules.correlation.engine import adjust_bh, compute_pair, metric_id, metric_pairs
from app.modules.correlation.models import CorrelationAnalysis, CorrelationEvent, CorrelationResult, CorrelationRun
from app.modules.correlation.schemas import AnalysisCreate
from tests.test_correlation_characterization import frozen_relationship


FLAGS = {
    "MULTI_METRIC_CORRELATION_API": "true", "MULTI_METRIC_CORRELATION_UI": "true",
    "MULTI_METRIC_CORRELATION_ROLLOUT": "all", "CORRELATION_DASHBOARD_WIDGETS": "true",
    "CORRELATION_LAG_MATRIX": "true", "CURATED_METRIC_DEFAULTS_BACKEND": "false",
    "CORRELATION_REPORTING_TIMEZONE": "UTC",
}


def definition(count=3, **kwargs):
    return {"name": "Retail associations", "metrics": [
        {"dataset_id": index + 1, "metric_key": "spend" if index == 0 else "revenue", "date_column": "date", "aggregation": "sum"}
        for index in range(count)], "method": "pearson", "grain": "daily",
        "date_range": {"start": "2026-01-01", "end": "2026-03-01"},
        "filters": {"minimum_abs_coefficient": .3, "minimum_observations": 4},
        **kwargs}


class MultiMetricEngineTests(unittest.TestCase):
    def test_unique_deterministic_pairs_at_limits(self):
        for count in (3, 10, 50):
            refs = [{"dataset_id": i, "metric_key": "revenue"} for i in range(count)]
            pairs = list(metric_pairs(refs))
            self.assertEqual(len(pairs), count * (count - 1) // 2)
            self.assertEqual(pairs, list(metric_pairs(list(reversed(refs)))))

    def test_benjamini_hochberg_known_fixture_and_nulls(self):
        self.assertEqual(adjust_bh([.01, .04, .03, .002, None]), [.02, .04, .04, .008, None])
        self.assertEqual(adjust_bh([None]), [None])

    def test_exact_two_metric_parity_including_missing_values_and_lag(self):
        for method in ("pearson", "spearman"):
            for lag in (0, 1, 2):
                for left, right in (([2, 9, 1, 8, 4, 7, 3, 6], [99, 2, 9, 1, 8, 4, 7, 3]), ([1, None, 3, 4], [2, 0, 6, 8]), ([1, 2, 2, 4], [1, 2, 3, 4])):
                    old, frames, _ = frozen_relationship(left, right, method=method, lag=lag)
                    payload = AnalysisCreate(**definition(2, method=method, lag={"enabled": True, "minimum": 0, "maximum": 2})).model_dump(mode="json")
                    payload["filters"]["minimum_observations"] = 2
                    prepared, _ = prepare_series({item.id: (item, frame) for item, frame in frames}, payload["metrics"], payload)
                    result = compute_pair(*payload["metrics"], prepared, payload)[lag]
                    self.assertEqual(result["observations"], old["matched_period_count"])
                    if old["correlation"] is None:
                        self.assertIsNone(result["coefficient"])
                    else:
                        self.assertAlmostEqual(result["coefficient"], old["correlation"], places=12)

    def test_pairwise_overlap_does_not_use_global_complete_cases(self):
        refs = definition()["metrics"]
        frames = {}
        for index, ref in enumerate(refs):
            dates = pd.date_range("2026-01-01", periods=12 if index < 2 else 4)
            dataset = SimpleNamespace(id=index + 1, file_name="Metrics")
            frames[index + 1] = dataset, pd.DataFrame({"date": dates, ref["metric_key"]: range(len(dates))})
        payload = AnalysisCreate(**definition()).model_dump(mode="json")
        prepared, _ = prepare_series(frames, refs, payload)
        counts = [compute_pair(a, b, prepared, payload)[0]["observations"] for a, b in metric_pairs(refs)]
        self.assertEqual(counts, [12, 4, 4])

    def test_average_last_and_timezone_boundaries(self):
        item = SimpleNamespace(id=1, file_name="Balance")
        frame = pd.DataFrame({"date": ["2026-01-02T01:00:00Z", "2026-01-02T02:00:00Z", "2026-01-03T02:00:00Z"], "balance": [10, 30, 50]})
        payload = AnalysisCreate(**definition(2)).model_dump(mode="json")
        with patch.dict("os.environ", {"CORRELATION_REPORTING_TIMEZONE": "America/Halifax"}):
            for aggregation, expected in (("avg", 20), ("last", 30)):
                ref = {"dataset_id": 1, "metric_key": "balance", "date_column": "date", "aggregation": aggregation}
                result, _ = prepare_series({1: (item, frame)}, [ref], payload)
                self.assertEqual(str(result["1:balance"].period.iloc[0].date()), "2026-01-01")
                self.assertEqual(result["1:balance"].value.iloc[0], expected)

    def test_no_overlap_and_constants_are_typed_non_results(self):
        payload = AnalysisCreate(**definition(2)).model_dump(mode="json")
        refs = payload["metrics"]
        for right_dates in (pd.date_range("2026-02-01", periods=5), pd.date_range("2026-01-01", periods=5)):
            prepared = {metric_id(refs[0]): pd.DataFrame({"period": pd.date_range("2026-01-01", periods=5), "value": [1] * 5}),
                        metric_id(refs[1]): pd.DataFrame({"period": right_dates, "value": range(5)})}
            row = compute_pair(*refs, prepared, payload)[0]
            self.assertIsNone(row["coefficient"])
            self.assertFalse(row["eligible"])
            self.assertTrue(set(row["flags"]) & {"constant", "insufficient_overlap"})

    def test_reverse_lag_keeps_evidence_labels_canonical(self):
        payload = AnalysisCreate(**definition(2, lag={"enabled": True, "maximum": 1, "direction": "b_leads_a"})).model_dump(mode="json")
        refs = payload["metrics"]
        dates = pd.date_range("2026-01-01", periods=5)
        prepared = {metric_id(refs[0]): pd.DataFrame({"period": dates, "value": [2, 5, 1, 8, 6]}), metric_id(refs[1]): pd.DataFrame({"period": dates, "value": [9, 3, 7, 4, 1]})}
        result = compute_pair(*refs, prepared, payload)[1]
        self.assertEqual(result["lead_metric"], "2:revenue")
        self.assertAlmostEqual(result["evidence"][0]["a"], 0)
        self.assertGreater(result["evidence"][0]["b"], 1)

    def test_ten_metrics_supported_history_performance(self):
        payload = AnalysisCreate(**definition(10)).model_dump(mode="json")
        refs = payload["metrics"]
        prepared = {metric_id(ref): pd.DataFrame({"period": pd.date_range("2020-01-01", periods=3653), "value": [((day + index) ** 2 % 97) for day in range(3653)]}) for index, ref in enumerate(refs)}
        start = time.monotonic()
        results = [compute_pair(a, b, prepared, payload) for a, b in metric_pairs(refs)]
        self.assertEqual(len(results), 45)
        self.assertLess(time.monotonic() - start, 15)


class CorrelationWorkflowTests(unittest.TestCase):
    def setUp(self):
        env = patch.dict("os.environ", FLAGS)
        env.start()
        self.addCleanup(env.stop)
        self.engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine)
        self.addCleanup(self.engine.dispose)
        self.frames = {}
        dates = pd.date_range("2026-01-01", periods=40)
        with self.Session() as db:
            for index in range(1, 5):
                key = "spend" if index == 1 else "revenue"
                frame = pd.DataFrame({"date": dates, key: [float((day * day + day * 3) % 23 + index * day) for day in range(40)], "account_id": range(40), "unknown_number": range(40)})
                self.frames[index] = frame
                db.add(Dataset(id=index, user_id="owner", workspace_id="owner", file_name=["Google Ads", "GA4", "Lightspeed", "Accounting"][index-1], file_path=f"unused-{index}", source_type="csv", source_config=json.dumps({"selected_metric_columns": [key]}), row_count=40, column_count=4))
            db.commit()
        for target, value in (("SessionLocal", self.Session), ("get_user_id", lambda req: "owner"), ("get_workspace_id", lambda req, user: req.headers.get("X-Workspace-Id", "owner")), ("require_workspace_data_manager", lambda req: None), ("load_dataframe_from_dataset", lambda dataset: self.frames[dataset.id].copy())):
            p = patch.object(router, target, value)
            p.start()
            self.addCleanup(p.stop)
        p = patch.object(worker, "load_dataframe_from_dataset", lambda dataset: self.frames[dataset.id].copy())
        p.start()
        self.addCleanup(p.stop)
        p = patch.object(worker, "check_worker_access")
        self.access = p.start()
        self.addCleanup(p.stop)
        app = FastAPI()
        app.include_router(router.router)
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def create(self, payload=None, **kwargs):
        response = self.client.post("/api/v2/correlation-analyses", json=payload or definition(), **kwargs)
        self.assertEqual(response.status_code, 202, response.text)
        return response.json()

    def execute(self):
        claimed = worker.claim_next(self.Session)
        self.assertIsNotNone(claimed)
        worker.process_run(*claimed, session_factory=self.Session)
        return claimed[0]

    def test_catalogue_requires_selected_semantic_metrics_not_numeric_blanket(self):
        response = self.client.get("/api/v2/correlation-analyses/catalog")
        self.assertEqual(response.status_code, 200, response.text)
        catalog = response.json()["datasets"]
        self.assertEqual(catalog[0]["date_columns"], ["date"])
        self.assertEqual([item["metric_key"] for item in catalog[0]["metrics"]], ["spend"])
        self.assertNotIn("unknown_number", str(catalog))

    def test_async_four_connector_run_and_contracts(self):
        created = self.create(definition(4))
        self.assertEqual(created["status"], "queued")
        self.assertEqual(created["progress"]["total_pairs"], 6)
        identity = self.execute()
        status = self.client.get(f"/api/v2/correlation-runs/{identity}").json()
        self.assertEqual(status["status"], "completed", status)
        self.assertEqual(status["progress"]["completed_pairs"], 6)
        rows = self.client.get(f"/api/v2/correlation-runs/{identity}/relationships?include_insufficient=true").json()
        matrix = self.client.get(f"/api/v2/correlation-runs/{identity}/matrix").json()
        self.assertEqual(rows["total"], 6)
        self.assertEqual(len(matrix["cells"]), 6)
        by_id = {item["result_id"]: item for item in rows["items"]}
        for cell in matrix["cells"]:
            self.assertEqual(cell["coefficient"], by_id[cell["result_id"]]["coefficient"])
        detail = self.client.get(f"/api/v2/correlation-results/{rows['items'][0]['result_id']}").json()
        self.assertEqual(len(detail["evidence"]), 40)
        self.assertEqual(detail["reliability"], "reliable")
        self.assertIsNotNone(detail["adjusted_p_value"])
        self.assertLessEqual(detail["adjusted_p_value"], .05)

    def test_enqueue_does_not_load_observations_and_creation_is_idempotent(self):
        with patch.object(router, "load_dataframe_from_dataset", side_effect=AssertionError("Request loaded data")):
            first = self.create(headers={"Idempotency-Key": "create-1"})
            second = self.create(headers={"Idempotency-Key": "create-1"})
        self.assertEqual(first["run_id"], second["run_id"])
        changed = definition(name="A different request")
        self.assertEqual(self.client.post("/api/v2/correlation-analyses", json=changed, headers={"Idempotency-Key": "create-1"}).status_code, 409)

    def test_rerun_reuses_watermark_and_idempotency_key(self):
        created = self.create()
        self.execute()
        url = f"/api/v2/correlation-analyses/{created['analysis_id']}/runs"
        first = self.client.post(url, headers={"Idempotency-Key": "refresh-1"}).json()
        with self.Session() as db:
            item = db.get(Dataset, 1)
            item.source_config = json.dumps({"selected_metric_columns": ["spend"], "revision": 2})
            db.commit()
        replay = self.client.post(url, headers={"Idempotency-Key": "refresh-1"}).json()
        self.assertEqual(replay["run_id"], first["run_id"])
        fresh = self.client.post(url, headers={"Idempotency-Key": "refresh-2"}).json()
        self.assertNotEqual(fresh["run_id"], first["run_id"])

    def test_completed_manual_retry_is_reused_after_an_earlier_failure(self):
        created = self.create()
        with patch.object(worker, "load_dataframe_from_dataset", side_effect=ValueError("Unusable source")):
            self.execute()
        url = f"/api/v2/correlation-analyses/{created['analysis_id']}/runs"
        retried = self.client.post(url).json()
        self.assertNotEqual(retried["run_id"], created["run_id"])
        duplicate = self.client.post(url).json()
        self.assertEqual(duplicate["run_id"], retried["run_id"])
        self.execute()
        cached = self.client.post(url).json()
        self.assertEqual(cached["run_id"], retried["run_id"])

    def test_cross_workspace_create_view_cancel_results_and_widget_denied(self):
        created = self.create()
        identity = self.execute()
        result_id = self.client.get(f"/api/v2/correlation-runs/{identity}/relationships").json()["items"][0]["result_id"]
        headers = {"X-Workspace-Id": "another"}
        self.assertEqual(self.client.post("/api/v2/correlation-analyses", json=definition(), headers=headers).status_code, 403)
        for path in (f"correlation-analyses/{created['analysis_id']}", f"correlation-runs/{identity}", f"correlation-runs/{identity}/relationships", f"correlation-runs/{identity}/matrix", f"correlation-results/{result_id}"):
            self.assertEqual(self.client.get(f"/api/v2/{path}", headers=headers).status_code, 404)
        self.assertEqual(self.client.post(f"/api/v2/correlation-runs/{identity}/cancel", headers=headers).status_code, 404)
        self.assertEqual(self.client.post("/api/v2/correlation-widgets", json={"analysis_id": created["analysis_id"], "widget_type": "top_relationships"}, headers=headers).status_code, 404)

    def test_worker_rechecks_revoked_access(self):
        created = self.create()
        self.access.side_effect = HTTPException(403, "Revoked")
        self.execute()
        status = self.client.get(f"/api/v2/correlation-runs/{created['run_id']}").json()
        self.assertEqual(status["error_code"], "access_revoked")

    def test_retry_does_not_duplicate_rows(self):
        created = self.create()
        with patch.object(worker, "load_dataframe_from_dataset", side_effect=OSError("Private storage error")):
            self.execute()
        self.assertEqual(self.client.get(f"/api/v2/correlation-runs/{created['run_id']}").json()["status"], "queued")
        self.execute()
        with self.Session() as db:
            self.assertEqual(db.query(CorrelationResult).filter_by(run_id=created["run_id"]).count(), 3)
            run = db.get(CorrelationRun, created["run_id"])
            self.assertEqual(run.attempts, 2)
            worker.process_run(run.id, run.worker_token, self.Session)
            self.assertEqual(db.query(CorrelationResult).filter_by(run_id=run.id).count(), 3)

    def test_cancel_before_and_during_run_preserves_success(self):
        initial = self.create()
        self.execute()
        with self.Session() as db:
            item = db.get(Dataset, 1)
            item.row_count = 41
            db.commit()
        next_run = self.client.post(f"/api/v2/correlation-analyses/{initial['analysis_id']}/runs").json()
        claimed = worker.claim_next(self.Session)
        self.client.post(f"/api/v2/correlation-runs/{next_run['run_id']}/cancel")
        worker.process_run(*claimed, self.Session)
        self.assertEqual(self.client.get(f"/api/v2/correlation-runs/{next_run['run_id']}").json()["status"], "canceled")
        detail = self.client.get(f"/api/v2/correlation-analyses/{initial['analysis_id']}").json()
        self.assertEqual(detail["latest_successful_run_id"], initial["run_id"])

    def test_all_three_widgets_keep_results_during_refresh_failure_and_rollback(self):
        created = self.create()
        identity = self.execute()
        result = self.client.get(f"/api/v2/correlation-runs/{identity}/relationships").json()["items"][0]
        for kind in ("top_relationships", "outcome_drivers", "saved_relationship"):
            payload = {"analysis_id": created["analysis_id"], "widget_type": kind, "result_id": result["result_id"], "outcome_metric": "1:spend"}
            response = self.client.post("/api/v2/correlation-widgets", json=payload)
            self.assertEqual(response.status_code, 201, response.text)
        with self.Session() as db:
            db.get(Dataset, 1).row_count = 41
            db.commit()
        self.client.post(f"/api/v2/correlation-analyses/{created['analysis_id']}/runs")
        widgets = self.client.get("/api/v2/correlation-widgets").json()
        self.assertTrue(all(widget["updating"] and widget["cards"] for widget in widgets))
        with patch.object(worker, "load_dataframe_from_dataset", side_effect=ValueError("Private data")):
            self.execute()
        with patch.dict("os.environ", {"MULTI_METRIC_CORRELATION_API": "false", "CORRELATION_DASHBOARD_WIDGETS": "false"}):
            self.assertEqual(self.client.post("/api/v2/correlation-analyses", json=definition()).status_code, 404)
            widgets = self.client.get("/api/v2/correlation-widgets").json()
            self.assertTrue(all(widget["cards"] and widget["last_refresh_status"] == "failed" for widget in widgets))

    def test_historical_access_is_rechecked_after_dataset_moves(self):
        created = self.create()
        self.execute()
        with self.Session() as db:
            db.get(Dataset, 1).workspace_id = "another"
            db.commit()
        self.assertEqual(self.client.get(f"/api/v2/correlation-runs/{created['run_id']}").status_code, 403)

    def test_limits_unsafe_metrics_lag_flag_and_stale_sources(self):
        for change in ({"metric_key": "account_id"}, {"metric_key": "unknown_number"}, {"aggregation": "avg"}):
            payload = definition()
            payload["metrics"][0].update(change)
            self.assertEqual(self.client.post("/api/v2/correlation-analyses", json=payload).status_code, 400)
        payload = definition(lag={"enabled": True, "maximum": 15})
        self.assertEqual(self.client.post("/api/v2/correlation-analyses", json=payload).status_code, 400)
        with patch.dict("os.environ", {"CORRELATION_LAG_MATRIX": "false"}):
            payload = definition(lag={"enabled": True})
            self.assertEqual(self.client.post("/api/v2/correlation-analyses", json=payload).status_code, 400)
        with self.assertRaises(ValueError):
            AnalysisCreate(**definition(26))
        created = self.create()
        with self.Session() as db:
            db.get(Dataset, 1).row_count = 41
            db.commit()
        self.execute()
        self.assertEqual(self.client.get(f"/api/v2/correlation-runs/{created['run_id']}").json()["error_code"], "source_changed")

    def test_insight_evidence_and_decision_draft_preserve_links(self):
        created = self.create()
        identity = self.execute()
        result = self.client.get(f"/api/v2/correlation-runs/{identity}/relationships").json()["items"][0]
        path = f"/api/v2/correlation-results/{result['result_id']}/evidence"
        first = self.client.post(path, json={"kind": "insight"}).json()
        second = self.client.post(path, json={"kind": "insight"}).json()
        self.assertEqual(first["insight_id"], second["insight_id"])
        self.assertEqual(len(self.client.get("/api/v2/correlation-insights").json()), 1)
        draft = self.client.post(path, json={"kind": "decision"}).json()["decision_payload"]
        self.assertEqual(draft["recommendation_source"], "rules")
        self.assertEqual(json.loads(draft["recommendation_context"])["evidence_kind"], "correlation_v2")
        self.assertIn("run=", draft["description"])
        self.assertEqual(len(draft["evidence_dataset_ids"]), 2)
        with self.Session() as db:
            self.assertGreater(db.query(CorrelationEvent).count(), 3)

    def test_evidence_draft_creates_a_real_existing_decision(self):
        from app.modules.decisions import router as decisions
        from app.modules.decisions.schemas import DecisionCreate
        from app.modules.decisions.activity_models import DecisionActivity
        Base.metadata.create_all(self.engine)
        self.create()
        identity = self.execute()
        result = self.client.get(f"/api/v2/correlation-runs/{identity}/relationships").json()["items"][0]
        draft = self.client.post(f"/api/v2/correlation-results/{result['result_id']}/evidence", json={"kind": "decision"}).json()["decision_payload"]
        with patch.object(decisions, "SessionLocal", self.Session), patch.object(decisions, "get_active_user_id", return_value="owner"), patch.object(decisions, "get_active_workspace_id", return_value="owner"), patch.object(decisions, "get_accessible_dataset", side_effect=lambda db, key, *_: db.get(Dataset, key)):
            saved = asyncio.run(decisions.create_decision(DecisionCreate(**draft), x_user_id="owner", x_workspace_id="owner"))
        self.assertEqual(saved.dataset_id, result["metric_b"]["dataset_id"])
        self.assertEqual(saved.metric_column, result["metric_b"]["metric_key"])
        self.assertEqual(json.loads(saved.recommendation_context)["result_id"], result["result_id"])
        with self.Session() as db:
            self.assertEqual(db.query(DecisionActivity).filter_by(decision_id=saved.id).count(), 1)

    def test_curated_connector_metrics_share_safe_preparation(self):
        from app.modules.datasets.services.metric_recommendations import initialize_curated_selection
        from app.modules.datasets.services.metric_selection import filter_dataframe_to_selected_metrics
        with patch.dict("os.environ", {"CURATED_METRIC_DEFAULTS_BACKEND": "true", "CURATED_METRIC_DEFAULTS_NEW_DATASETS": "true", "CURATED_METRIC_DEFAULTS_ROLLOUT": "all"}):
            with self.Session() as db:
                first, second = db.get(Dataset, 1), db.get(Dataset, 2)
                first.source_type, first.source_config = "google_search_console", json.dumps({"resource": "search_analytics"})
                second.source_type, second.source_config = "google_analytics", json.dumps({"dimensions": ["date"]})
                dates = pd.date_range("2026-01-01", periods=40)
                self.frames[1] = pd.DataFrame({"date": dates, "clicks": range(1, 41), "impressions": range(20, 60), "position": [2] * 40})
                self.frames[2] = pd.DataFrame({"date": dates, "sessions": range(4, 44)})
                initialize_curated_selection(first, self.frames[1]); initialize_curated_selection(second, self.frames[2])
                db.commit()
            payload = definition()
            payload["metrics"] = [{"dataset_id": 1, "metric_key": key, "date_column": "date", "aggregation": "policy"} for key in ("clicks", "ctr")] + [{"dataset_id": 2, "metric_key": "sessions", "date_column": "date", "aggregation": "policy"}]
            with patch.object(worker, "load_dataframe_from_dataset", side_effect=lambda item: filter_dataframe_to_selected_metrics(item, self.frames[item.id])):
                created = self.create(payload)
                self.execute()
            status = self.client.get(f"/api/v2/correlation-runs/{created['run_id']}").json()
            self.assertEqual(status["status"], "completed", status)

    def test_deleting_source_removes_all_derived_results_and_widgets(self):
        from app.modules.correlation.cleanup import cleanup_source
        created = self.create()
        self.execute()
        self.client.post("/api/v2/correlation-widgets", json={"analysis_id": created["analysis_id"], "widget_type": "top_relationships"})
        with self.Session() as db:
            cleanup_source(db, 1)
            db.commit()
            self.assertEqual(db.query(CorrelationAnalysis).count(), 0)
            self.assertEqual(db.query(CorrelationResult).count(), 0)
        self.assertEqual(self.client.get("/api/v2/correlation-widgets").json(), [])

    def test_stale_lease_recovery_fences_old_worker(self):
        created = self.create()
        first = worker.claim_next(self.Session)
        with self.Session() as db:
            db.get(CorrelationRun, created["run_id"]).heartbeat_at = utc_now() - timedelta(minutes=6)
            db.commit()
        second = worker.claim_next(self.Session)
        self.assertNotEqual(first[1], second[1])
        worker.process_run(*first, self.Session)
        with self.Session() as db:
            self.assertEqual(db.query(CorrelationResult).count(), 0)
        worker.process_run(*second, self.Session)
        self.assertEqual(self.client.get(f"/api/v2/correlation-runs/{created['run_id']}").json()["status"], "completed")

    def test_correction_is_persisted_across_entire_run(self):
        self.create()
        with patch("app.modules.correlation.engine.p_value", side_effect=[.01, .03, .04]):
            self.execute()
        with self.Session() as db:
            results = db.query(CorrelationResult).order_by(CorrelationResult.p_value).all()
            self.assertEqual([row.adjusted_p_value for row in results], [.03, .04, .04])

    def test_widget_retains_pinned_results_after_many_empty_successes(self):
        created = self.create()
        self.execute()
        self.client.post("/api/v2/correlation-widgets", json={"analysis_id": created["analysis_id"], "widget_type": "top_relationships"})
        with self.Session() as db:
            old = db.get(CorrelationRun, created["run_id"])
            for index in range(21):
                db.add(CorrelationRun(analysis_id=old.analysis_id, workspace_id=old.workspace_id, user_id=old.user_id, identity_hash=f"empty-{index}", definition=old.definition, watermark=old.watermark, engine_version=old.engine_version, code_version=old.code_version, status="completed", phase="completed", total_pairs=3, completed_at=utc_now() + timedelta(seconds=index + 1)))
            db.commit()
        result = self.client.get("/api/v2/correlation-widgets").json()
        self.assertEqual(result[0]["cards"][0]["run_id"], created["run_id"])
