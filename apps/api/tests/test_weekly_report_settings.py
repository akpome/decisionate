import ast
import json
from pathlib import Path
import unittest
from datetime import date, timedelta
from unittest.mock import patch

import pandas as pd

from fastapi import HTTPException
from sqlalchemy import create_engine, text
from app.db.database import get_table_columns

from app.db.models import WeeklyReportPreference
from app.infrastructure import analysis_worker
from app.modules.alerts import router as alerts
from app.modules.reports import jobs
from app.modules.reports.cleanup import cleanup_source, cleanup_workspace
from app.modules.reports.models import BusinessReport, ReportAnalysisJob
from tests import test_business_reports as fixtures


class WeeklyReportSettingsTests(unittest.TestCase):
    setUp = fixtures.BusinessReportWorkflowTests.setUp

    def settings(self, **updates):
        value = fixtures.definition(grain="weekly", **updates)
        value.pop("date_range")
        return value

    def put(self, **updates):
        response = self.client.put("/api/v2/business-reports/weekly-settings", json=self.settings(**updates))
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_settings_have_automatic_dates_fixed_weekly_grouping_and_no_delivery_side_effect(self):
        value = self.put()
        self.assertEqual(value["definition"]["grain"], "weekly")
        self.assertFalse(value["enabled"])
        start, end = (date.fromisoformat(value["window"][key]) for key in ("start", "end"))
        self.assertEqual((end - start).days, 6)
        self.assertEqual(start.weekday(), 0)
        self.assertEqual(end.weekday(), 6)
        self.assertEqual(date.fromisoformat(value["history_window"]["end"]), start - timedelta(days=1))
        bad = {**self.settings(), "grain": "daily"}
        self.assertEqual(self.client.put("/api/v2/business-reports/weekly-settings", json=bad).status_code, 422)
        with self.Session() as db:
            preference = db.query(WeeklyReportPreference).one()
            self.assertIsNone(preference.business_report_id)
            self.assertIsNone(preference.recipient_emails)
            self.assertEqual(db.query(BusinessReport).count(), 0)

    def test_saved_settings_ignore_manual_dates_and_preserve_recipients(self):
        with self.Session() as db:
            db.add(WeeklyReportPreference(workspace_id="owner", enabled=1, recipient_emails='["owner@example.test"]', delivery_day="friday"))
            db.commit()
        payload = {**self.settings(), "date_range": {"start": "2000-01-01", "end": "2000-01-02"}}
        response = self.client.put("/api/v2/business-reports/weekly-settings", json=payload)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertNotEqual(response.json()["definition"]["date_range"], payload["date_range"])
        with self.Session() as db:
            preference = db.query(WeeklyReportPreference).one()
            self.assertEqual(preference.enabled, 1)
            self.assertEqual(preference.delivery_day, "friday")
            self.assertEqual(json.loads(preference.recipient_emails), ["owner@example.test"])

    def test_weekly_settings_and_instant_snapshot_are_independent(self):
        saved = fixtures.BusinessReportWorkflowTests.save(self)
        self.client.post(f"/api/v2/business-reports/{saved['report_id']}/weekly")
        self.put(name="Independent weekly report", method="spearman", seasonal_business=True)
        self.assertEqual(self.client.get(f"/api/v2/business-reports/{saved['report_id']}").json()["definition"], saved["definition"])
        self.client.post("/api/v2/business-reports", json=fixtures.definition(grain="monthly"))
        self.client.delete(f"/api/v2/business-reports/{saved['report_id']}")
        value = self.client.get("/api/v2/business-reports/weekly-settings").json()
        self.assertEqual(value["definition"]["name"], "Independent weekly report")
        self.assertEqual(value["definition"]["grain"], "weekly")

    def test_legacy_daily_template_resets_timing_without_mutating_the_snapshot(self):
        payload = fixtures.definition(lag={"enabled": True, "minimum": 1, "maximum": 3, "direction": "a_leads_b"})
        saved = self.client.post("/api/v2/business-reports", json=payload).json()
        self.client.post(f"/api/v2/business-reports/{saved['report_id']}/weekly")
        value = self.client.get("/api/v2/business-reports/weekly-settings").json()["definition"]
        self.assertEqual(value["grain"], "weekly")
        self.assertEqual(value["lag"]["minimum"], 0)
        self.assertEqual(value["lag"]["maximum"], 12)
        self.assertFalse(value["pair_directions"])
        self.assertEqual(self.client.get(f"/api/v2/business-reports/{saved['report_id']}").json()["definition"], saved["definition"])

    def test_permission_and_source_checks_apply_to_weekly_settings(self):
        with patch.object(fixtures.router, "require_workspace_data_manager", side_effect=HTTPException(403, "Read only")):
            self.assertEqual(self.client.put("/api/v2/business-reports/weekly-settings", json=self.settings()).status_code, 403)
            self.assertEqual(self.client.delete("/api/v2/business-reports/weekly-settings").status_code, 403)
        payload = self.settings()
        payload["metrics"][1]["dataset_id"] = 3
        self.assertIn(self.client.put("/api/v2/business-reports/weekly-settings", json=payload).status_code, (403, 404))
        self.put()
        with patch.object(fixtures.router, "authorize_datasets", side_effect=HTTPException(403, "Access revoked")):
            self.assertEqual(self.client.get("/api/v2/business-reports/weekly-settings").status_code, 403)

    def test_deleting_settings_pauses_delivery_but_keeps_snapshots(self):
        fixtures.BusinessReportWorkflowTests.save(self)
        self.put()
        with self.Session() as db:
            db.query(WeeklyReportPreference).one().enabled = 1
            db.commit()
        response = self.client.delete("/api/v2/business-reports/weekly-settings")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertIsNone(response.json()["definition"])
        self.assertFalse(response.json()["enabled"])
        with self.Session() as db:
            self.assertEqual(db.query(BusinessReport).count(), 1)

    def test_source_removal_clears_its_weekly_settings_and_pauses_delivery(self):
        self.put()
        with self.Session() as db:
            preference = db.query(WeeklyReportPreference).one()
            preference.enabled = 1
            cleanup_source(db, 1)
            db.commit()
            self.assertIsNone(preference.weekly_report_definition)
            self.assertEqual(preference.enabled, 0)

    def test_workspace_retention_cleanup_removes_weekly_configuration_only_in_that_workspace(self):
        self.put()
        with self.Session() as db:
            db.add(WeeklyReportPreference(workspace_id="other", enabled=1, weekly_report_definition='{"private":"other workspace"}'))
            db.commit()
            cleanup_workspace(db, "owner")
            db.commit()
            db.expire_all()
            self.assertIsNone(db.query(WeeklyReportPreference).filter_by(workspace_id="owner").one().weekly_report_definition)
            other = db.query(WeeklyReportPreference).filter_by(workspace_id="other").one()
            self.assertEqual(other.enabled, 1)
            self.assertEqual(json.loads(other.weekly_report_definition), {"private": "other workspace"})

    def test_worker_uses_weekly_settings_and_lists_snapshots_separately(self):
        self.put(filters={"minimum_observations": 52})
        with self.Session() as db:
            preference = db.query(WeeklyReportPreference).one()
            job = jobs.enqueue_weekly(db, "owner", "owner", preference, include_ai=False, report_only=True)
            identity = job.id
            frozen = json.loads(job.definition)
            frozen["anchor"] = "2026-04-01"
            job.definition = json.dumps(frozen)
            db.commit()
        with patch.object(alerts, "load_dataframe_from_dataset", side_effect=lambda dataset: self.frames[dataset.id][1].copy()):
            analysis_worker.execute_job(identity)
        response = self.client.get(f"/api/v2/business-reports/jobs/{identity}").json()
        self.assertEqual(response["status"], "succeeded", response)
        report = response["result"]
        self.assertTrue(report["weekly_report"])
        self.assertEqual(report["grain"], "daily")
        self.assertEqual(report["analysis_grain"], "weekly")
        self.assertEqual(report["definition"]["filters"]["minimum_observations"], 52)
        self.assertTrue(all(metric["grain"] == "daily" for metric in report["anomaly_analysis"]["metrics"]))
        saved = self.client.post(f"/api/v2/business-reports/jobs/{identity}/save")
        self.assertEqual(saved.status_code, 201, saved.text)
        self.assertEqual(len(self.client.get("/api/v2/business-reports?workflow=weekly").json()), 1)
        self.assertEqual(self.client.get("/api/v2/business-reports?workflow=instant").json(), [])
        # Older weekly snapshots have job provenance but no workflow marker.
        with self.Session() as db:
            snapshot = db.get(BusinessReport, saved.json()["report_id"])
            legacy = json.loads(snapshot.snapshot)
            legacy.pop("weekly_report")
            legacy["grain"] = "daily"
            snapshot.snapshot = json.dumps(legacy)
            db.commit()
        reopened = self.client.get(f"/api/v2/business-reports/{saved.json()['report_id']}").json()
        self.assertTrue(reopened["weekly_report"])
        self.assertEqual(reopened["grain"], "daily")
        self.assertEqual(len(self.client.get("/api/v2/business-reports?workflow=weekly").json()), 1)

    def test_changing_weekly_analysis_settings_invalidates_queued_work(self):
        self.put()
        with self.Session() as db:
            identity = jobs.enqueue_weekly(db, "owner", "owner", db.query(WeeklyReportPreference).one(), include_ai=False).id
        self.put(seasonal_business=True)
        with patch.object(alerts, "build_weekly_report_digest_for_workspace", side_effect=AssertionError("Changed settings")):
            analysis_worker.execute_job(identity)
        response = self.client.get(f"/api/v2/business-reports/jobs/{identity}").json()
        self.assertEqual(response["status"], "failed")
        self.assertIn("settings changed", response["error"])

    def test_weekly_relationship_history_excludes_the_partial_week_at_the_three_year_cutoff(self):
        frames = fixtures.fixture()
        dates = pd.date_range("2023-04-01", "2026-03-29")
        for identity, (dataset, _) in list(frames.items()):
            metric = "spend" if identity == 1 else "net_sales"
            frames[identity] = dataset, pd.DataFrame({"date": dates, metric: range(1, len(dates) + 1)})
        preference = alerts.build_weekly_report_preference_response(None)
        report = alerts.build_weekly_cross_dataset_report(frames, preference, self.settings(), analysis_date=date(2026, 4, 1))
        expected = len(pd.date_range("2023-04-03", "2026-03-16", freq="W-MON"))
        self.assertEqual(report["findings"][0]["observations"], expected)

    def test_startup_migration_copies_only_same_workspace_legacy_settings_once(self):
        source = Path(__file__).resolve().parents[1] / "app/main.py"
        function = next(node for node in ast.parse(source.read_text()).body
                        if isinstance(node, ast.FunctionDef) and node.name == "ensure_weekly_report_delivery_columns")
        engine = create_engine("sqlite://")
        self.addCleanup(engine.dispose)
        with engine.begin() as connection:
            connection.execute(text("CREATE TABLE weekly_report_preferences (id INTEGER PRIMARY KEY, workspace_id TEXT, enabled INTEGER, delivery_day TEXT, business_report_id TEXT)"))
            connection.execute(text("CREATE TABLE business_reports (id TEXT PRIMARY KEY, workspace_id TEXT, definition TEXT)"))
            connection.execute(text("INSERT INTO business_reports VALUES ('saved', 'owner', :definition)"), {"definition": json.dumps(fixtures.definition())})
            connection.execute(text("INSERT INTO weekly_report_preferences VALUES (1, 'owner', 1, 'friday', 'saved'), (2, 'other', 1, 'monday', 'saved')"))
        namespace = {"engine": engine, "text": text, "get_table_columns": get_table_columns}
        exec(compile(ast.Module(body=[function], type_ignores=[]), str(source), "exec"), namespace)
        migrate = namespace[function.name]
        migrate()
        with engine.begin() as connection:
            records = connection.execute(text("SELECT weekly_report_definition, enabled, delivery_day FROM weekly_report_preferences ORDER BY id")).all()
            self.assertEqual(json.loads(records[0][0]), fixtures.definition())
            self.assertEqual(records[0][1:], (1, "friday"))
            self.assertIsNone(records[1][0])
            connection.execute(text("UPDATE business_reports SET definition = '{}'"))
        migrate()
        with engine.begin() as connection:
            self.assertEqual(json.loads(connection.execute(text("SELECT weekly_report_definition FROM weekly_report_preferences WHERE id=1")).scalar()), fixtures.definition())
