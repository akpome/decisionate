import json
import unittest
from datetime import date, timedelta
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.models import DataIngestionJob, DataSourceConnection, utc_now
from app.infrastructure import ingestion_worker
from app.modules.datasets import router as routes
from app.modules.datasets.schemas import DataSourceConnectionSync
from app.modules.datasets.services import connector_range_sync as ranges
from app.modules.datasets.services.connectors import ConnectorNoData, ConnectorUnavailable


class ConnectorRangeSyncTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        for model in (DataSourceConnection, DataIngestionJob):
            model.__table__.create(self.engine)
        self.sessions = sessionmaker(bind=self.engine)
        self.addCleanup(self.engine.dispose)
        for item in (
            patch.object(routes, "SessionLocal", self.sessions),
            patch.object(routes, "durable_ingestion_enabled", return_value=True),
            patch.object(routes, "get_dataset_source", return_value=None),
            patch.object(routes, "purge_expired_connector_dataset", return_value=None),
            patch.object(routes, "_build_connector_sync_job_result", return_value={"datasets": []}),
        ):
            item.start()
            self.addCleanup(item.stop)
        with self.sessions() as db:
            connection = DataSourceConnection(
                user_id="owner", workspace_id="workspace", source_type="meta_ads", display_name="Ads",
                status="connected", last_synced_at=utc_now() - timedelta(days=1),
                connection_config=json.dumps({
                    routes.INITIAL_CONNECTOR_SYNC_STATUS_KEY: routes.INITIAL_CONNECTOR_SYNC_COMPLETE,
                    routes.HISTORY_VERSION_KEY: routes.HISTORY_POLICY_VERSION,
                    routes.HISTORY_START_KEY: routes.connector_retention_cutoff_date().isoformat(),
                    routes.HISTORY_NEXT_END_KEY: (routes.connector_retention_cutoff_date() - timedelta(days=1)).isoformat(),
                    routes.CONNECTOR_ANALYSIS_STATUS_KEY: routes.CONNECTOR_ANALYSIS_COMPLETE,
                    "_sync_enabled": False,
                }),
            )
            db.add(connection)
            db.commit()
            self.identity, self.watermark = connection.id, connection.last_synced_at

    def enqueue(self, days, *, end=None, resource_type=None):
        end = end or date.today()
        with self.sessions() as db:
            job = routes.enqueue_connector_ingestion_job(
                db, db.get(DataSourceConnection, self.identity), DataSourceConnectionSync(
                    advanced_date_range=True, start_date=end - timedelta(days=days - 1), end_date=end,
                    resource_type=resource_type,
                ), None, job_type="manual_connector_sync", launch=False,
            )
            return job.id

    def read(self):
        with self.sessions() as db:
            connection = db.get(DataSourceConnection, self.identity)
            jobs = db.query(DataIngestionJob).order_by(DataIngestionJob.id).all()
            return json.loads(connection.connection_config), [
                (job.id, job.status, json.loads(job.request_payload), job.job_type, job.parent_job_id)
                for job in jobs
            ], connection.last_synced_at

    def drain(self, fetch):
        for _ in range(100):
            pending = [job for job in self.read()[1] if job[1] == "queued" and job[4] is None]
            if not pending:
                return
            with patch.object(routes, "run_data_source_sync_with_oauth_retry", side_effect=fetch):
                routes.run_connector_ingestion_job(pending[0][0])
        self.fail("Import did not finish within the expected number of chunks")

    def test_90_days_remain_one_request_and_91_days_are_chunked(self):
        first = self.enqueue(90)
        config, jobs, _ = self.read()
        self.assertNotIn(ranges.RANGE_SYNC_KEY, config)
        self.assertEqual(jobs[0][3], "manual_connector_sync")
        with patch.object(routes, "run_data_source_sync_with_oauth_retry", return_value=[]) as fetch:
            routes.run_connector_ingestion_job(first)
        self.assertEqual((fetch.call_args.args[2].end_date - fetch.call_args.args[2].start_date).days + 1, 90)
        self.enqueue(91)
        config, jobs, _ = self.read()
        self.assertEqual(jobs[-1][3], ranges.RANGE_SYNC_JOB_TYPE)
        self.assertEqual(config[ranges.RANGE_SYNC_KEY]["start_date"], (date.today() - timedelta(days=90)).isoformat())
        self.assertEqual((date.fromisoformat(jobs[-1][2]["end_date"]) - date.fromisoformat(jobs[-1][2]["start_date"])).days + 1, 30)
        self.assertEqual(sum(job[1] == "queued" for job in jobs), 1)

    def test_full_three_year_range_is_contiguous_and_yields_after_each_chunk(self):
        cutoff = routes.connector_retention_cutoff_date()
        self.enqueue((date.today() - cutoff).days + 1)
        windows = []

        def fetch(db, connection, payload):
            windows.append((payload.start_date, payload.end_date))
            self.assertLessEqual((payload.end_date - payload.start_date).days + 1, 30)
            connection.last_synced_at = utc_now()
            return []

        self.drain(fetch)
        config, jobs, watermark = self.read()
        self.assertEqual(config[ranges.RANGE_SYNC_KEY]["status"], "complete")
        self.assertEqual(windows[0][1], date.today())
        self.assertEqual(windows[-1][0], cutoff)
        self.assertEqual(sum((end - start).days + 1 for start, end in windows), (date.today() - cutoff).days + 1)
        for newer, older in zip(windows, windows[1:]):
            self.assertEqual(older[1] + timedelta(days=1), newer[0])
        self.assertEqual(len(jobs), len(windows))
        self.assertTrue(all(job[1] == "succeeded" for job in jobs))
        self.assertGreater(watermark, self.watermark)
        self.assertEqual(watermark.isoformat(), config[ranges.RANGE_SYNC_KEY]["completed_watermark"])

    def test_explicit_resource_and_smaller_chunk_size_survive_continuations(self):
        with patch.dict("os.environ", {"CONNECTOR_BACKFILL_CHUNK_DAYS": "7"}):
            self.enqueue(91, resource_type="invoices")
            calls = []

            def fetch(db, connection, payload):
                calls.append(payload)
                self.assertEqual(payload.resource_type, "invoices")
                self.assertLessEqual((payload.end_date - payload.start_date).days + 1, 7)
                return []

            self.drain(fetch)
        self.assertEqual(len(calls), 13)

    def test_historical_only_import_never_advances_recent_watermark(self):
        self.enqueue(91, end=date.today() - timedelta(days=30))

        def fetch(db, connection, payload):
            self.assertEqual(connection.last_synced_at, self.watermark)
            connection.last_synced_at = utc_now()
            return []

        self.drain(fetch)
        self.assertEqual(self.read()[2], self.watermark)

    def test_empty_chunks_advance_until_the_entire_range_is_complete(self):
        self.enqueue(91)

        def fetch(*args):
            raise ConnectorNoData("No observations in this chunk")

        self.drain(fetch)
        config, jobs, _ = self.read()
        self.assertEqual(len(jobs), 4)
        self.assertTrue(all(job[1] == "no_data" for job in jobs))
        self.assertEqual(config[ranges.RANGE_SYNC_KEY]["status"], "complete")

    def test_failure_retains_cursor_and_same_range_resumes_it(self):
        identity = self.enqueue(91)
        before = self.read()[0][ranges.RANGE_SYNC_KEY]
        with patch.object(routes, "run_data_source_sync_with_oauth_retry", side_effect=ConnectorUnavailable("Temporary failure")):
            routes.run_connector_ingestion_job(identity)
        config, jobs, watermark = self.read()
        self.assertEqual(jobs[0][1], "failed")
        self.assertEqual(config[ranges.RANGE_SYNC_KEY]["next_end_date"], before["next_end_date"])
        self.assertEqual(config[ranges.RANGE_SYNC_KEY]["status"], "failed")
        self.assertEqual(watermark, self.watermark)
        self.enqueue(91)
        self.assertEqual(self.read()[1][0][2], self.read()[1][1][2])

    def test_capacity_deferral_preserves_progress_and_scheduler_resumes_with_auto_sync_disabled(self):
        identity = self.enqueue(91)
        with patch.object(routes, "run_data_source_sync_with_oauth_retry", return_value=[]), patch.object(
            routes, "queue_connector_range_sync", side_effect=routes.WorkspaceIngestionQueueFull()
        ):
            routes.run_connector_ingestion_job(identity)
        config, jobs, _ = self.read()
        self.assertEqual(jobs[0][1], "succeeded")
        cursor = config[ranges.RANGE_SYNC_KEY]["next_end_date"]
        with self.sessions() as db:
            result = routes.queue_due_source_connection(db, db.get(DataSourceConnection, self.identity), None, utc_now())
        self.assertEqual(result["status"], "ingestion_queued")
        self.assertEqual(self.read()[1][-1][2]["end_date"], cursor)
        self.assertFalse(routes.queue_connector_range_sync(None, self.identity))

    def test_older_queued_monolithic_request_is_bounded_before_provider_io(self):
        with self.sessions() as db:
            job = DataIngestionJob(
                connection_id=self.identity, workspace_id="workspace", user_id="owner",
                job_type="manual_connector_sync", status="queued", request_payload=routes.serialize_sync_payload(
                    DataSourceConnectionSync(advanced_date_range=True, start_date=routes.connector_retention_cutoff_date(), end_date=date.today())
                ),
            )
            db.add(job)
            db.commit()
            identity = job.id
        with patch.object(routes, "run_data_source_sync_with_oauth_retry", return_value=[]) as fetch:
            routes.run_connector_ingestion_job(identity)
        self.assertLessEqual((fetch.call_args.args[2].end_date - fetch.call_args.args[2].start_date).days + 1, 30)
        self.assertEqual(self.read()[1][0][3], ranges.RANGE_SYNC_JOB_TYPE)

    def test_stale_scheduled_incremental_import_is_also_chunked(self):
        with self.sessions() as db:
            connection = db.get(DataSourceConnection, self.identity)
            connection.last_synced_at = utc_now() - timedelta(days=120)
            job = routes.enqueue_connector_ingestion_job(db, connection, DataSourceConnectionSync(), None, job_type="scheduled_connector_sync", launch=False)
            self.assertEqual(job.job_type, ranges.RANGE_SYNC_JOB_TYPE)
            payload = json.loads(job.request_payload)
            self.assertLessEqual((date.fromisoformat(payload["end_date"]) - date.fromisoformat(payload["start_date"])).days + 1, 30)

    def test_worker_restart_preserves_range_cursor_and_restores_watermark(self):
        identity = self.enqueue(91)
        cursor = self.read()[0][ranges.RANGE_SYNC_KEY]["next_end_date"]
        with self.sessions() as db:
            db.get(DataIngestionJob, identity).status = "running"
            db.get(DataSourceConnection, self.identity).last_synced_at = utc_now()
            db.commit()
        with patch.object(ingestion_worker, "SessionLocal", self.sessions):
            ingestion_worker.fail_interrupted_jobs()
        config, jobs, watermark = self.read()
        self.assertEqual(jobs[0][1], "failed")
        self.assertEqual(config[ranges.RANGE_SYNC_KEY]["next_end_date"], cursor)
        self.assertEqual(watermark, self.watermark)

    def test_multi_object_partial_failure_does_not_advance_cursor(self):
        with patch.object(routes, "get_configured_connector_resource_types", return_value=["invoices", "customers"]):
            identity = self.enqueue(91)
        cursor = self.read()[0][ranges.RANGE_SYNC_KEY]["next_end_date"]
        windows = []

        def child_run(child_id):
            with self.sessions() as db:
                child = db.get(DataIngestionJob, child_id)
                windows.append(json.loads(child.request_payload))
                child.status = "failed" if child.object_type == "customers" else "succeeded"
                child.error_message = "Provider failure" if child.status == "failed" else None
                child.result_payload = json.dumps({"datasets": [{"dataset_id": 99}]} if child.status == "succeeded" else {})
                db.get(DataSourceConnection, self.identity).last_synced_at = utc_now()
                db.commit()

        with patch.object(routes, "run_connector_object_ingestion_job", side_effect=child_run):
            routes.run_connector_ingestion_job(identity)
        config, jobs, watermark = self.read()
        self.assertEqual(jobs[0][1], "failed")
        self.assertEqual(len(jobs), 3)
        self.assertEqual(config[ranges.RANGE_SYNC_KEY]["next_end_date"], cursor)
        self.assertEqual(config[ranges.RANGE_SYNC_KEY]["status"], "failed")
        self.assertEqual(watermark, self.watermark)
        self.assertEqual(windows[0]["start_date"], windows[1]["start_date"])
        self.assertEqual(windows[0]["end_date"], windows[1]["end_date"])

    def test_corrupt_checkpoint_fails_without_fetch_and_can_be_repaired_by_resubmission(self):
        identity = self.enqueue(91)
        with self.sessions() as db:
            connection = db.get(DataSourceConnection, self.identity)
            config = json.loads(connection.connection_config)
            config[ranges.RANGE_SYNC_KEY]["next_end_date"] = "not-a-date"
            connection.connection_config = json.dumps(config)
            db.commit()
        with patch.object(routes, "run_data_source_sync_with_oauth_retry") as fetch:
            routes.run_connector_ingestion_job(identity)
        fetch.assert_not_called()
        self.assertEqual(self.read()[1][0][1], "failed")
        self.enqueue(91)
        self.assertEqual(self.read()[0][ranges.RANGE_SYNC_KEY]["next_end_date"], date.today().isoformat())

    def test_expired_range_is_completed_without_provider_io(self):
        identity = self.enqueue(91)
        with self.sessions() as db:
            connection = db.get(DataSourceConnection, self.identity)
            config = json.loads(connection.connection_config)
            plan = config[ranges.RANGE_SYNC_KEY]
            plan.update({"start_date": "2019-01-01", "end_date": "2020-01-01", "next_end_date": "2020-01-01"})
            connection.connection_config = json.dumps(config)
            db.commit()
        with patch.object(routes, "run_data_source_sync_with_oauth_retry") as fetch:
            routes.run_connector_ingestion_job(identity)
        fetch.assert_not_called()
        config, jobs, _ = self.read()
        self.assertEqual(config[ranges.RANGE_SYNC_KEY]["status"], "complete")
        self.assertEqual(jobs[0][1], "no_data")

    def test_continuation_joins_after_other_connections_already_in_the_queue(self):
        identity = self.enqueue(91)
        with self.sessions() as db:
            other = DataIngestionJob(user_id="other", workspace_id="other", job_type="file_upload", status="queued")
            db.add(other)
            db.commit()
            other_id = other.id
        with patch.object(routes, "run_data_source_sync_with_oauth_retry", return_value=[]):
            routes.run_connector_ingestion_job(identity)
        with patch.object(ingestion_worker, "SessionLocal", self.sessions):
            self.assertEqual(ingestion_worker.next_queued_job(), other_id)

    def test_successful_multi_object_chunk_advances_only_after_both_objects_finish(self):
        with patch.object(routes, "get_configured_connector_resource_types", return_value=["invoices", "customers"]):
            identity = self.enqueue(91)
            cursor = self.read()[0][ranges.RANGE_SYNC_KEY]["next_end_date"]

            def child_run(child_id):
                self.assertEqual(self.read()[0][ranges.RANGE_SYNC_KEY]["next_end_date"], cursor)
                with self.sessions() as db:
                    child = db.get(DataIngestionJob, child_id)
                    child.status = "succeeded"
                    child.result_payload = json.dumps({"datasets": [{"dataset_id": child.id}]})
                    db.commit()

            with patch.object(routes, "run_connector_object_ingestion_job", side_effect=child_run):
                routes.run_connector_ingestion_job(identity)
        config, jobs, _ = self.read()
        self.assertNotEqual(config[ranges.RANGE_SYNC_KEY]["next_end_date"], cursor)
        self.assertEqual(jobs[0][1], "succeeded")
        self.assertEqual(sum(job[1] == "queued" and job[4] is None for job in jobs), 1)

    def test_future_checkpoint_is_rejected_without_fetching(self):
        identity = self.enqueue(91)
        with self.sessions() as db:
            connection = db.get(DataSourceConnection, self.identity)
            config = json.loads(connection.connection_config)
            config[ranges.RANGE_SYNC_KEY]["next_end_date"] = (date.today() + timedelta(days=1)).isoformat()
            connection.connection_config = json.dumps(config)
            db.commit()
        with patch.object(routes, "run_data_source_sync_with_oauth_retry") as fetch:
            routes.run_connector_ingestion_job(identity)
        fetch.assert_not_called()
        self.assertEqual(self.read()[1][0][1], "failed")

    def test_scheduler_survives_a_corrupt_checkpoint_and_watermark(self):
        identity = self.enqueue(91)
        with self.sessions() as db:
            connection = db.get(DataSourceConnection, self.identity)
            config = json.loads(connection.connection_config)
            config[ranges.RANGE_SYNC_KEY].update({"next_end_date": "invalid", "recent_synced_at": "invalid"})
            connection.connection_config = json.dumps(config)
            db.commit()
        with patch.object(routes, "run_data_source_sync_with_oauth_retry") as fetch:
            routes.run_connector_ingestion_job(identity)
        fetch.assert_not_called()
        config, jobs, watermark = self.read()
        self.assertEqual(jobs[0][1], "failed")
        self.assertIsNone(watermark)
        self.assertFalse(routes.queue_connector_range_sync(None, self.identity))

    def test_new_explicit_short_range_replaces_failed_pending_range(self):
        identity = self.enqueue(91)
        with patch.object(routes, "run_data_source_sync_with_oauth_retry", side_effect=ConnectorUnavailable("Retry later")):
            routes.run_connector_ingestion_job(identity)
        self.enqueue(30)
        config, jobs, _ = self.read()
        self.assertNotIn(ranges.RANGE_SYNC_KEY, config)
        self.assertEqual(jobs[-1][3], "manual_connector_sync")


if __name__ == "__main__":
    unittest.main()
