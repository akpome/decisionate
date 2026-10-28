"""Exercise the actual Linux child entry point without a production database."""

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

import pandas as pd
from sqlalchemy import create_engine, inspect
from sqlalchemy.orm import sessionmaker

from app.db.models import AppUser, Dataset, IngestionWorkerHeartbeat, Organization, WeeklyReportPreference, utc_now
from app.modules.decisions.models import Decision
from app.modules.correlation.service import encode, snapshot
from app.modules.reports.models import ReportAnalysisJob
from app.modules.reports.schemas import ReportDefinition


API_ROOT = Path(__file__).resolve().parents[1]


def worker_environment(url):
    return {**os.environ, "DATABASE_URL": url, "APP_ENV": "development", "OBJECT_STORAGE_PROVIDER": "local",
            "BILLING_ENFORCEMENT_ENABLED": "false", "CURATED_METRIC_DEFAULTS_BACKEND": "false",
            "MARKETING_ENABLED": "false", "MARKETING_SEND_ENABLED": "false", "PYTHONDONTWRITEBYTECODE": "1",
            "OPENBLAS_NUM_THREADS": "1", "OMP_NUM_THREADS": "1", "MKL_NUM_THREADS": "1", "NUMEXPR_MAX_THREADS": "2",
            "SENTRY_DSN": "",
            "AI_PROVIDER": "", "AI_API_KEY": "", "OPENAI_API_KEY": ""}


@unittest.skipUnless(sys.platform.startswith("linux"), "The isolated worker uses Linux process protection")
class AnalysisWorkerSubprocessTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which("gcc"), "Native TLS regression probe requires a C compiler")
    def test_real_child_allows_native_tls_with_large_virtual_reservations_and_low_resident_usage(self):
        with tempfile.TemporaryDirectory() as directory:
            library = str(Path(directory) / "native_tls_probe.so")
            compiled = subprocess.run([shutil.which("gcc"), "-shared", "-fPIC", "-O0",
                str(API_ROOT / "tests/fixtures/native_tls_probe.c"), "-o", library], capture_output=True, text=True, timeout=30)
            self.assertEqual(compiled.returncode, 0, compiled.stderr)
            code = """
import ctypes, json, mmap, os, resource, runpy, sys
from unittest.mock import patch
from app.infrastructure.analysis_resources import process_memory
initial = resource.getrlimit(resource.RLIMIT_AS)
library = sys.argv[1]
def probe(identity):
    assert resource.getrlimit(resource.RLIMIT_AS) == initial
    reservation = mmap.mmap(-1, 3 * 1024**3, prot=0)
    native = ctypes.CDLL(library)
    assert native.probe() == 1
    print(json.dumps(process_memory(os.getpid())))
with patch('app.infrastructure.analysis_worker.execute_job', probe):
    sys.argv = ['scripts/run_analysis_worker.py', '--job-id', 'tls-regression', '--parent-pid', str(os.getppid())]
    runpy.run_path('scripts/run_analysis_worker.py', run_name='__main__')
"""
            result = subprocess.run([sys.executable, "-B", "-c", code, library], cwd=API_ROOT,
                env=worker_environment("sqlite://"), capture_output=True, text=True, timeout=60)
            self.assertEqual(result.returncode, 0, result.stderr[-6000:])
            memory = json.loads(result.stdout.strip())
            self.assertGreater(memory["virtual_bytes"], 3 * 1024**3)
            self.assertLess(memory["rss_bytes"], 256 * 1024 * 1024)

    def test_supervisor_import_does_not_retain_api_or_numeric_libraries(self):
        result = subprocess.run([sys.executable, "-B", "-c",
            "import sys; import app.infrastructure.analysis_worker; "
            "print([name for name in ('app.main', 'numpy', 'pandas', 'scipy', 'statsmodels') if name in sys.modules])"],
            cwd=API_ROOT, env=worker_environment("sqlite://"), capture_output=True, text=True, timeout=60)
        self.assertEqual(result.returncode, 0, result.stderr[-6000:])
        self.assertEqual(result.stdout.strip(), "[]")

    def test_real_bootstrap_child_creates_schema_and_exits_without_processing(self):
        with tempfile.TemporaryDirectory() as directory:
            url = "sqlite:///" + str(Path(directory) / "bootstrap.db")
            result = subprocess.run([sys.executable, "-B", "scripts/run_analysis_worker.py", "--bootstrap",
                "--parent-pid", str(os.getpid())], cwd=API_ROOT, env=worker_environment(url),
                capture_output=True, text=True, timeout=180)
            self.assertEqual(result.returncode, 0, result.stderr[-6000:])
            engine = create_engine(url)
            self.addCleanup(engine.dispose)
            self.assertTrue(inspect(engine).has_table("datasets"))
            self.assertTrue(inspect(engine).has_table(ReportAnalysisJob.__tablename__))
            with sessionmaker(bind=engine)() as db:
                self.assertEqual(db.query(ReportAnalysisJob).count(), 0)

    def test_real_child_completes_a_small_report_with_default_memory_limit(self):
        with tempfile.TemporaryDirectory() as directory:
            url = "sqlite:///" + str(Path(directory) / "worker.db")
            engine = create_engine(url)
            self.addCleanup(engine.dispose)
            Decision.metadata.create_all(engine)
            sessions = sessionmaker(bind=engine)
            metrics = []
            with sessions() as db:
                sources = {}
                for identity, metric in ((1, "spend"), (2, "orders")):
                    path = Path(directory) / f"source-{identity}.csv"
                    pd.DataFrame({"date": pd.date_range("2026-01-01", periods=365),
                                  metric: [100 + i % 17 for i in range(365)]}).to_csv(path, index=False)
                    dataset = Dataset(id=identity, user_id="smoke-owner", workspace_id="smoke-owner", file_name=path.name,
                        file_path=str(path), source_type="csv", source_config=json.dumps({"selected_metric_columns": [metric]}),
                        row_count=365, column_count=2)
                    db.add(dataset)
                    sources[identity] = dataset
                    metrics.append({"dataset_id": identity, "metric_key": metric, "date_column": "date", "aggregation": "sum"})
                definition = ReportDefinition(name="Subprocess smoke test", business_question="How do spending and orders change together?",
                    metrics=metrics, date_range={"start": "2026-11-01", "end": "2026-11-30"}, include_ai_analysis=False)
                job = ReportAnalysisJob(user_id="smoke-owner", workspace_id="smoke-owner", kind="report", request_key="smoke-test",
                    definition=encode(definition.model_dump(mode="json")), sources=encode(snapshot(sources)))
                db.add(job)
                db.commit()
                identity = job.id
            environment = worker_environment(url)
            environment.pop("ANALYSIS_JOB_MEMORY_MB", None)
            result = subprocess.run([sys.executable, "-B", "scripts/run_analysis_worker.py", "--job-id", identity,
                "--parent-pid", str(os.getpid())], cwd=API_ROOT, env=environment, capture_output=True, text=True, timeout=180)
            self.assertEqual(result.returncode, 0, result.stderr[-6000:])
            with sessions() as db:
                job = db.get(ReportAnalysisJob, identity)
                self.assertEqual(job.status, "succeeded", f"{job.error}\n{result.stderr[-6000:]}")
                self.assertEqual(len(json.loads(job.result)["metrics"]), 2)

    def test_real_owner_send_child_handles_historical_files_without_crashing_or_sending(self):
        from app.modules.reports.jobs import enqueue_weekly, job_response

        with tempfile.TemporaryDirectory() as directory:
            url = "sqlite:///" + str(Path(directory) / "weekly.db")
            engine = create_engine(url)
            self.addCleanup(engine.dispose)
            Decision.metadata.create_all(engine)
            sessions = sessionmaker(bind=engine)
            end = pd.Timestamp.now(tz="UTC").tz_localize(None).normalize() - pd.Timedelta(days=400)
            dates = pd.date_range(end=end, periods=60)
            metrics = []
            with sessions() as db:
                for identity, metric in ((1, "spend"), (2, "orders")):
                    path = Path(directory) / f"source-{identity}.csv"
                    pd.DataFrame({"date": dates, metric: [100 + i % 17 for i in range(60)]}).to_csv(path, index=False)
                    db.add(Dataset(id=identity, user_id="smoke-owner", workspace_id="smoke-owner", file_name=path.name,
                        file_path=str(path), source_type="csv", source_config=json.dumps({"selected_metric_columns": [metric]}),
                        row_count=60, column_count=2))
                    metrics.append({"dataset_id": identity, "metric_key": metric, "date_column": "date", "aggregation": "sum"})
                db.add(Dataset(id=3, user_id="smoke-owner", workspace_id="smoke-owner", file_name="Unrelated source",
                    file_path="do-not-load.csv", source_type="csv", row_count=1000000, column_count=300))
                db.add(AppUser(id="smoke-owner", email="owner@example.test"))
                db.add(Organization(owner_user_id="smoke-owner", name="Smoke test"))
                db.add(IngestionWorkerHeartbeat(name="reports-analysis", last_seen_at=utc_now()))
                definition = ReportDefinition(name="Weekly historical files", business_question="How do spending and orders change together?",
                    metrics=metrics, grain="weekly", date_range={"start": str(dates[0].date()), "end": str(dates[-1].date())})
                preference = WeeklyReportPreference(workspace_id="smoke-owner", enabled=0, metric_focus='["1:spend","2:orders"]',
                    weekly_report_definition=encode(definition.model_dump(mode="json")))
                db.add(preference); db.commit()
                job = enqueue_weekly(db, "smoke-owner", "smoke-owner", preference, send=True, owner_only=True, include_ai=True)
                identity = job.id
                self.assertEqual(set(json.loads(job.sources)), {"1", "2"})
            environment = worker_environment(url)
            environment.pop("ANALYSIS_JOB_MEMORY_MB", None)
            result = subprocess.run([sys.executable, "-B", "scripts/run_analysis_worker.py", "--job-id", identity,
                "--parent-pid", str(os.getpid())], cwd=API_ROOT, env=environment, capture_output=True, text=True, timeout=180)
            self.assertEqual(result.returncode, 0, result.stderr[-6000:])
            with sessions() as db:
                job = db.get(ReportAnalysisJob, identity)
                self.assertEqual(job.status, "failed", result.stderr[-6000:])
                self.assertEqual(job.error_status, 400, f"{job.error}\n{result.stderr[-6000:]}")
                self.assertIn("Instant analysis", job.error)
                self.assertTrue(job_response(job)["retry_safe"])
