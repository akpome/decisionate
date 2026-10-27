"""Exercise the actual Linux child entry point without a production database."""

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import pandas as pd
from sqlalchemy import create_engine, inspect
from sqlalchemy.orm import sessionmaker

from app.db.models import Dataset
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
