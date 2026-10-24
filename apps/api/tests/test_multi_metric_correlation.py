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
from app.db.models import Dataset, IngestionWorkerHeartbeat, utc_now
from app.modules.correlation import router
from app.modules.correlation.catalog import prepare_series
from app.modules.correlation.engine import adjust_bh, compute_pair, metric_id, metric_pairs
from app.modules.correlation.models import CorrelationAnalysis, CorrelationInsight, CorrelationMetric, CorrelationResult, CorrelationRun, CorrelationWidget
from app.modules.correlation.service import encode, snapshot
from app.modules.reports import router as reports_router
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


class RetiredExplorerTests(unittest.TestCase):
    def setUp(self):
        env = patch.dict("os.environ", FLAGS)
        env.start(); self.addCleanup(env.stop)
        self.engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine)
        self.addCleanup(self.engine.dispose)
        self.frames = {}
        self.definition = AnalysisCreate(**definition()).model_dump(mode="json")
        self.definition["reporting_timezone"] = "UTC"
        with self.Session() as db:
            db.add(IngestionWorkerHeartbeat(name="reports-analysis", last_seen_at=utc_now()))
            for identity in range(1, 4):
                key = "spend" if identity == 1 else "revenue"
                frame = pd.DataFrame({"date": pd.date_range("2026-01-01", periods=40), key: [float(day * identity + day % 7) for day in range(40)]})
                self.frames[identity] = frame
                db.add(Dataset(id=identity, user_id="owner", workspace_id="owner", file_name=f"Source {identity}.csv",
                               file_path=f"unused-{identity}", source_type="csv", source_config=encode({"selected_metric_columns": [key]}),
                               row_count=40, column_count=2))
            db.flush()
            datasets = {item.id: item for item in db.query(Dataset).all()}
            analysis = CorrelationAnalysis(id="historical-analysis", workspace_id="owner", user_id="owner", name="Historical association",
                                           definition=encode(self.definition), request_hash="historical", creation_key="historical",
                                           latest_successful_run_id="historical-run")
            metadata = {metric_id(ref): {**ref, "id": metric_id(ref), "dataset_label": datasets[ref["dataset_id"]].file_name,
                                         "label": ref["metric_key"], "connector": "csv", "unit": "number", "currency": None}
                        for ref in self.definition["metrics"]}
            run = CorrelationRun(id="historical-run", analysis_id=analysis.id, workspace_id="owner", user_id="owner",
                                 identity_hash="historical", definition=encode(self.definition), watermark=encode(snapshot(datasets)),
                                 engine_version="legacy.shared-periods.v1", code_version="historical", status="completed", phase="completed",
                                 total_pairs=3, completed_pairs=3, prepared_metrics=3, completed_at=utc_now(),
                                 summary=encode({"metrics": metadata}))
            db.add(analysis); db.add(run)
            prepared, _ = prepare_series({key: (datasets[key], value) for key, value in self.frames.items()}, self.definition["metrics"], self.definition)
            for index, (left, right) in enumerate(metric_pairs(self.definition["metrics"])):
                row = compute_pair(left, right, prepared, self.definition)[0]
                db.add(CorrelationResult(id=f"historical-result-{index}", run_id=run.id, workspace_id="owner",
                                         metric_a=row["metric_a"], metric_b=row["metric_b"], lead_metric=row["lead_metric"], lag=row["lag"],
                                         coefficient=row["coefficient"], observations=row["observations"], p_value=row["p_value"],
                                         adjusted_p_value=row["p_value"], score=row["score"], selected=True, eligible=row["eligible"],
                                         reliability="exploratory", flags=encode(row["flags"]), evidence=encode(row["evidence"])))
            for position, ref in enumerate(self.definition["metrics"]):
                db.add(CorrelationMetric(analysis_id=analysis.id, dataset_id=ref["dataset_id"], metric_key=ref["metric_key"], position=position))
            db.add(CorrelationInsight(id="historical-insight", workspace_id="owner", user_id="owner", result_id="historical-result-0", evidence="{}"))
            for kind in ("top_relationships", "outcome_drivers", "saved_relationship"):
                db.add(CorrelationWidget(id=kind, workspace_id="owner", user_id="owner", analysis_id=analysis.id,
                                         dashboard_key="general-business", widget_type=kind,
                                         configuration=encode({"pinned_run_id": run.id, "outcome_metric": "1:spend",
                                                               "metric_a": "1:spend", "metric_b": "2:revenue"})))
            db.commit()
        for module in (router, reports_router):
            for target, value in (("SessionLocal", self.Session), ("get_user_id", lambda req: "owner"),
                                  ("get_workspace_id", lambda req, user: req.headers.get("X-Workspace-Id", "owner")),
                                  ("require_workspace_data_manager", lambda req: None)):
                item = patch.object(module, target, value); item.start(); self.addCleanup(item.stop)
        from app.modules.reports import jobs
        from app.infrastructure import analysis_worker
        for module in (jobs, analysis_worker):
            item = patch.object(module, "SessionLocal", self.Session); item.start(); self.addCleanup(item.stop)
        async def drain_job(identity, user, workspace):
            analysis_worker.execute_job(identity)
            return await jobs.wait_for_job(identity, user, workspace, timeout=.1)
        item = patch.object(reports_router, "wait_for_job", drain_job); item.start(); self.addCleanup(item.stop)
        app = FastAPI(); app.include_router(router.router); app.include_router(reports_router.router)
        self.client = TestClient(app); self.addCleanup(self.client.close)

    def test_environment_flags_cannot_restore_retired_explorer_or_enqueue_jobs(self):
        for rollout in ("all", "internal"):
            with patch.dict("os.environ", {**FLAGS, "MULTI_METRIC_CORRELATION_ROLLOUT": rollout}):
                caps = self.client.get("/api/v2/correlation-capabilities").json()
                self.assertTrue(caps["retired"])
                self.assertTrue(all(caps[key] is False for key in ("api", "ui", "widgets", "lag", "ai")))
                self.assertEqual(caps["replacement_url"], "/dashboard/reports")
                for path, body in (
                    ("correlation-analyses", definition()),
                    ("correlation-analyses/historical-analysis/runs", {}),
                    ("correlation-widgets", {"analysis_id": "historical-analysis", "widget_type": "top_relationships"}),
                    ("correlation-results/historical-result-0/evidence", {"kind": "insight"}),
                    ("correlation-results/historical-result-0/evidence", {"kind": "decision"}),
                ):
                    response = self.client.post(f"/api/v2/{path}", json=body)
                    self.assertEqual(response.status_code, 410, response.text)
                self.assertEqual(self.client.get("/api/v2/correlation-analyses/catalog").status_code, 410)
        with self.Session() as db:
            self.assertEqual(db.query(CorrelationRun).count(), 1)
            self.assertEqual(db.query(CorrelationAnalysis).count(), 1)
            self.assertEqual(db.query(CorrelationInsight).count(), 1)
            self.assertEqual(db.query(CorrelationWidget).count(), 3)

    def test_frozen_run_matrix_and_result_evidence_remain_readable_without_flags(self):
        with patch.dict("os.environ", {key: "false" for key in FLAGS if key != "CORRELATION_REPORTING_TIMEZONE"}):
            for path in ("correlation-analyses", "correlation-analyses/historical-analysis", "correlation-runs/historical-run",
                         "correlation-runs/historical-run/matrix", "correlation-runs/historical-run/relationships",
                         "correlation-results/historical-result-0"):
                response = self.client.get(f"/api/v2/{path}")
                self.assertEqual(response.status_code, 200, response.text)
        matrix = self.client.get("/api/v2/correlation-runs/historical-run/matrix").json()
        self.assertEqual(len(matrix["metrics"]), 3)
        self.assertEqual(len(matrix["cells"]), 3)
        detail = self.client.get("/api/v2/correlation-results/historical-result-0").json()
        self.assertTrue(detail["evidence"])
        self.assertEqual(detail["engine_version"], "legacy.shared-periods.v1")
        self.assertEqual(detail["lag"]["unit"], "shared daily periods")

    def test_history_gets_do_not_load_source_data_or_recalculate_results(self):
        with patch.object(reports_router, "load_dataframe_from_dataset", side_effect=AssertionError("Must not scan sources")), \
             patch("app.modules.correlation.engine.compute_pair", side_effect=AssertionError("Must not recalculate history")):
            for path in ("correlation-runs/historical-run/matrix", "correlation-results/historical-result-0", "correlation-insights", "correlation-widgets"):
                response = self.client.get(f"/api/v2/{path}")
                self.assertEqual(response.status_code, 200, response.text)

    def test_saved_insights_and_all_widget_types_survive_pending_or_failed_runs_without_polling(self):
        with self.Session() as db:
            original = db.get(CorrelationRun, "historical-run")
            db.add(CorrelationRun(id="unfinished-run", analysis_id=original.analysis_id, workspace_id="owner", user_id="owner",
                                  identity_hash="unfinished", definition=original.definition, watermark=original.watermark,
                                  engine_version=original.engine_version, code_version=original.code_version, total_pairs=3))
            db.commit()
        self.assertEqual(len(self.client.get("/api/v2/correlation-insights").json()), 1)
        for status in ("queued", "running", "failed", "canceled"):
            with self.Session() as db:
                db.get(CorrelationRun, "unfinished-run").status = status; db.commit()
            widgets = self.client.get("/api/v2/correlation-widgets").json()
            self.assertEqual(len(widgets), 3)
            self.assertTrue(all(widget["retired"] and not widget["updating"] and widget["cards"] for widget in widgets))
        self.assertEqual(self.client.get("/api/v2/correlation-runs/unfinished-run").status_code, 200)
        self.assertEqual(self.client.get("/api/v2/correlation-runs/unfinished-run/matrix").status_code, 409)

    def test_cross_workspace_historical_evidence_and_removal_remain_denied(self):
        headers = {"X-Workspace-Id": "someone-else"}
        for path in ("correlation-analyses/historical-analysis", "correlation-runs/historical-run",
                     "correlation-runs/historical-run/matrix", "correlation-results/historical-result-0"):
            self.assertEqual(self.client.get(f"/api/v2/{path}", headers=headers).status_code, 404)
        for path in ("correlation-analyses", "correlation-insights", "correlation-widgets"):
            self.assertEqual(self.client.get(f"/api/v2/{path}", headers=headers).json(), [])
        self.assertEqual(self.client.delete("/api/v2/correlation-widgets/top_relationships", headers=headers).status_code, 404)

    def test_source_access_revocation_hides_existing_evidence(self):
        with self.Session() as db:
            db.get(Dataset, 1).workspace_id = "someone-else"; db.commit()
        for path in ("correlation-runs/historical-run", "correlation-results/historical-result-0"):
            self.assertEqual(self.client.get(f"/api/v2/{path}").status_code, 403)
        self.assertEqual(self.client.get("/api/v2/correlation-insights").json(), [])
        self.assertEqual(self.client.get("/api/v2/correlation-widgets").json(), [])

    def test_existing_widget_deletion_is_permission_checked_and_does_not_remove_evidence(self):
        with patch.object(router, "require_workspace_data_manager", side_effect=HTTPException(403, "Owner required")):
            self.assertEqual(self.client.delete("/api/v2/correlation-widgets/top_relationships").status_code, 403)
        self.assertEqual(self.client.delete("/api/v2/correlation-widgets/top_relationships").status_code, 200)
        with self.Session() as db:
            self.assertEqual(db.query(CorrelationWidget).count(), 2)
            self.assertEqual(db.query(CorrelationRun).count(), 1)
            self.assertEqual(db.query(CorrelationResult).count(), 3)

    def test_historical_definition_can_seed_reports_but_uses_reports_current_rules(self):
        response = self.client.get("/api/v2/business-reports/from-run/historical-run")
        self.assertEqual(response.status_code, 200, response.text)
        from app.modules.reports.schemas import ReportDefinition
        payload = response.json()
        payload.pop("reporting_timezone", None)
        payload["filters"]["minimum_observations"] = 24
        payload = ReportDefinition(**payload).model_dump(mode="json")
        with patch.object(reports_router, "load_dataframe_from_dataset", side_effect=lambda dataset: self.frames[dataset.id].copy()):
            response = self.client.post("/api/v2/business-reports/preview", json=payload)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["dataset_count"], 3)
        self.assertEqual(response.json()["source_analysis"]["run_id"], "historical-run")
        with self.Session() as db:
            self.assertEqual(db.query(CorrelationRun).count(), 1)

    def test_existing_report_and_decision_keep_their_original_historical_evidence(self):
        from app.modules.decisions.models import Decision
        from app.modules.reports.models import BusinessReport
        from app.modules.reports.schemas import ReportDefinition
        from app.modules.reports.service import build_report

        Base.metadata.create_all(self.engine)
        payload = {**self.definition, "business_question": "Which selected changes deserve investigation?", "source_run_id": "historical-run"}
        payload.pop("reporting_timezone", None)
        payload["filters"] = {**payload["filters"], "minimum_observations": 24}
        payload = ReportDefinition(**payload).model_dump(mode="json")
        with self.Session() as db:
            sources = {key: (db.get(Dataset, key), frame) for key, frame in self.frames.items()}
            evidence = build_report(sources, payload)
            evidence["source_analysis"] = {"run_id": "historical-run", "engine_version": "legacy.shared-periods.v1", "note": "Original saved evidence"}
            context = encode({"evidence_kind": "correlation_v2", "run_id": "historical-run", "result_id": "historical-result-0",
                              "evidence_url": "/dashboard/relationships/explorer?run=historical-run&result=historical-result-0"})
            db.add(BusinessReport(id="historical-report", workspace_id="owner", user_id="owner", name=payload["name"],
                                  definition=encode(payload), snapshot=encode(evidence)))
            db.add(Decision(id=7, clerk_user_id="owner", workspace_id="owner", dataset_id=1, title="Keep the budget unchanged",
                            action="Keep the current budget for the next review period", recommendation_context=context))
            db.commit()
        for path in ("correlation-analyses", "correlation-analyses/historical-analysis/runs"):
            self.assertEqual(self.client.post(f"/api/v2/{path}", json=definition()).status_code, 410)
        saved = self.client.get("/api/v2/business-reports/historical-report")
        self.assertEqual(saved.status_code, 200, saved.text)
        self.assertEqual(saved.json()["metrics"], evidence["metrics"])
        self.assertEqual(saved.json()["source_analysis"], evidence["source_analysis"])
        with self.Session() as db:
            self.assertEqual(db.get(Decision, 7).recommendation_context, context)
            self.assertEqual(db.query(Decision).count(), 1)

    def assert_historical_graph_removed(self, cleanup, identity):
        with self.Session() as db:
            cleanup(db, identity); db.commit()
            for model in (CorrelationAnalysis, CorrelationResult, CorrelationInsight, CorrelationWidget):
                self.assertEqual(db.query(model).count(), 0)

    def test_deleting_source_still_cleans_up_historical_graph(self):
        from app.modules.correlation.cleanup import cleanup_source
        self.assert_historical_graph_removed(cleanup_source, 1)

    def test_deleting_workspace_still_cleans_up_historical_graph(self):
        from app.modules.correlation.cleanup import cleanup_workspace
        self.assert_historical_graph_removed(cleanup_workspace, "owner")
