import json
import os
import tempfile
import unittest
from datetime import date, timedelta
from types import SimpleNamespace
from unittest.mock import patch

import pandas as pd
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.models import DataIngestionJob, DataSourceConnection, utc_now
from app.db.database import Base
from app.modules.datasets import router as routes
from app.modules.datasets.services import connector_history as history
from app.modules.datasets.services import retention
from app.modules.datasets.services.connector_partition_merge import merge_connector_partitions
from app.modules.datasets.services.connectors import ConnectorNoData, ConnectorUnavailable
from app.modules.datasets.schemas import DataSourceConnectionSync


class ConnectorHistoryPolicyTests(unittest.TestCase):
    def test_three_total_years_split_into_contiguous_bounded_chunks(self):
        today = date.today()
        start, end = routes.get_initial_connector_backfill_window(today)
        self.assertEqual(start, retention.connector_retention_cutoff_date(today))
        self.assertEqual(end, today - timedelta(days=60))
        config = history.prepare_history({}, start, end)
        chunks = []
        while chunk := history.next_history_chunk(config, as_of=today):
            self.assertLessEqual((chunk[1] - chunk[0]).days + 1, 30)
            chunks.append(chunk)
            config = history.advance_history(config, *chunk)
        self.assertEqual(chunks[0][1], end)
        self.assertEqual(chunks[-1][0], start)
        for newer, older in zip(chunks, chunks[1:]):
            self.assertEqual(older[1] + timedelta(days=1), newer[0])

    def test_completed_legacy_history_extends_only_missing_older_dates(self):
        config = history.prepare_history({history.HISTORY_START_KEY: "2024-09-29"}, date(2023, 10, 22), date(2026, 8, 23), completed=True)
        self.assertEqual(config[history.HISTORY_NEXT_END_KEY], "2024-09-28")
        self.assertEqual(config[history.HISTORY_START_KEY], "2023-10-22")

    def test_repreparing_current_history_preserves_its_checkpoint(self):
        today = date.today()
        config = history.prepare_history({}, today - timedelta(days=100), today - timedelta(days=60))
        updated = history.advance_history(config, *history.next_history_chunk(config))
        self.assertEqual(history.prepare_history(updated, today, today), updated)
        with self.assertRaises(ValueError):
            history.advance_history(updated, today, today)

    def test_aged_backfills_never_request_deleted_dates(self):
        config = history.prepare_history({}, date(2020, 1, 1), date(2020, 2, 1))
        self.assertIsNone(history.next_history_chunk(config, as_of=date(2026, 10, 22)))

    def test_chunk_setting_is_bounded_and_invalid_values_are_safe(self):
        for setting, expected in [("7", 7), ("0", 1), ("99999", 30), ("invalid", 30)]:
            with self.subTest(setting=setting), patch.dict(os.environ, {"CONNECTOR_BACKFILL_CHUNK_DAYS": setting}):
                self.assertEqual(history.backfill_chunk_days(), expected)


class ConnectorHistoryQueueTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        for model in (DataSourceConnection, DataIngestionJob):
            model.__table__.create(self.engine)
        self.sessions = sessionmaker(bind=self.engine)
        self.addCleanup(self.engine.dispose)
        for item in [patch.object(routes, "SessionLocal", self.sessions), patch.object(routes, "durable_ingestion_enabled", return_value=True),
                     patch.object(routes, "get_dataset_source", return_value=None), patch.object(routes, "purge_expired_connector_dataset", return_value=None),
                     patch.object(routes, "_build_connector_sync_job_result", return_value={"datasets": []}),
                     patch.object(routes, "queue_connector_initial_analysis", return_value=True)]:
            item.start()
            self.addCleanup(item.stop)
        with self.sessions() as db:
            connection = DataSourceConnection(user_id="owner", workspace_id="workspace", source_type="meta_ads", display_name="Ads", status="connected",
                                              last_synced_at=utc_now() - timedelta(days=1), connection_config="{}")
            db.add(connection)
            db.commit()
            self.identity, self.watermark = connection.id, connection.last_synced_at

    def read(self):
        with self.sessions() as db:
            connection = db.get(DataSourceConnection, self.identity)
            jobs = db.query(DataIngestionJob).order_by(DataIngestionJob.id).all()
            return json.loads(connection.connection_config), [(job.id, job.status, json.loads(job.request_payload)) for job in jobs], connection.last_synced_at

    def test_only_one_chunk_is_queued_and_success_checkpoints_before_next(self):
        self.assertTrue(routes.queue_connector_initial_backfill(None, self.identity))
        self.assertFalse(routes.queue_connector_initial_backfill(None, self.identity))
        before, jobs, _ = self.read()
        self.assertEqual(len(jobs), 1)
        with patch.object(routes, "run_data_source_sync_with_oauth_retry", return_value=[]) as fetch:
            routes.run_connector_ingestion_job(jobs[0][0])
        after, jobs, watermark = self.read()
        self.assertEqual(jobs[0][1], "succeeded")
        self.assertEqual(jobs[1][1], "queued")
        self.assertEqual(after[history.HISTORY_NEXT_END_KEY], (date.fromisoformat(jobs[0][2]["start_date"]) - timedelta(days=1)).isoformat())
        self.assertNotEqual(before[history.HISTORY_NEXT_END_KEY], after[history.HISTORY_NEXT_END_KEY])
        self.assertEqual(watermark, self.watermark)
        self.assertLessEqual((fetch.call_args.args[2].end_date - fetch.call_args.args[2].start_date).days + 1, 30)

    def test_failure_keeps_cursor_and_retry_reuses_same_window(self):
        routes.queue_connector_initial_backfill(None, self.identity)
        before, jobs, _ = self.read()
        with patch.object(routes, "run_data_source_sync_with_oauth_retry", side_effect=ConnectorUnavailable("Rate limit; retry later")):
            routes.run_connector_ingestion_job(jobs[0][0])
        after, failed, _ = self.read()
        self.assertEqual(failed[0][1], "failed")
        self.assertEqual(before[history.HISTORY_NEXT_END_KEY], after[history.HISTORY_NEXT_END_KEY])
        self.assertTrue(routes.queue_connector_initial_backfill(None, self.identity))
        self.assertEqual(self.read()[1][-1][2], jobs[0][2])

    def test_empty_chunk_advances_and_does_not_end_the_whole_backfill(self):
        routes.queue_connector_initial_backfill(None, self.identity)
        _, jobs, _ = self.read()
        with patch.object(routes, "run_data_source_sync_with_oauth_retry", side_effect=ConnectorNoData("No records in this chunk")):
            routes.run_connector_ingestion_job(jobs[0][0])
        config, jobs, _ = self.read()
        self.assertEqual(jobs[0][1], "no_data")
        self.assertEqual(jobs[1][1], "queued")
        self.assertEqual(config[routes.INITIAL_CONNECTOR_SYNC_STATUS_KEY], "backfill")

    def test_legacy_monolithic_job_is_rebounded_before_provider_io(self):
        with self.sessions() as db:
            connection = db.get(DataSourceConnection, self.identity)
            job = routes.enqueue_connector_ingestion_job(db, connection, DataSourceConnectionSync(advanced_date_range=True, start_date=date(2020, 1, 1), end_date=date.today()),
                                                        None, job_type=routes.INITIAL_CONNECTOR_BACKFILL_JOB_TYPE, launch=False)
            identity = job.id
        with patch.object(routes, "run_data_source_sync_with_oauth_retry", return_value=[]) as fetch:
            routes.run_connector_ingestion_job(identity)
        payload = fetch.call_args.args[2]
        self.assertLessEqual((payload.end_date - payload.start_date).days + 1, 30)
        self.assertGreaterEqual(payload.start_date, retention.connector_retention_cutoff_date())

    def test_final_chunk_marks_complete_without_queueing_another_import(self):
        cutoff = retention.connector_retention_cutoff_date()
        config = history.prepare_history({}, cutoff, cutoff)
        config[routes.INITIAL_CONNECTOR_SYNC_STATUS_KEY] = "backfill"
        with self.sessions() as db:
            db.get(DataSourceConnection, self.identity).connection_config = json.dumps(config)
            db.commit()
        routes.queue_connector_initial_backfill(None, self.identity)
        _, jobs, _ = self.read()
        with patch.object(routes, "run_data_source_sync_with_oauth_retry", return_value=[]):
            routes.run_connector_ingestion_job(jobs[0][0])
        config, jobs, _ = self.read()
        self.assertEqual(config[routes.INITIAL_CONNECTOR_SYNC_STATUS_KEY], "complete")
        self.assertEqual(len(jobs), 1)

    def test_multi_object_failure_does_not_advance_and_retry_bounds_all_children(self):
        with patch.object(routes, "get_configured_connector_resource_types", return_value=["invoices", "customers"]):
            routes.queue_connector_initial_backfill(None, self.identity)
        before, jobs, _ = self.read()
        parent = jobs[0][0]
        calls = []

        def child_run(identity):
            with self.sessions() as db:
                child = db.get(DataIngestionJob, identity)
                calls.append(json.loads(child.request_payload))
                child.status = "failed" if child.object_type == "customers" else "succeeded"
                child.error_message = "Temporary provider failure" if child.status == "failed" else None
                child.result_payload = json.dumps({"datasets": [{"dataset_id": 99}]} if child.status == "succeeded" else {})
                db.get(DataSourceConnection, self.identity).last_synced_at = utc_now()
                db.commit()

        with patch.object(routes, "run_connector_object_ingestion_job", side_effect=child_run):
            routes.run_connector_ingestion_job(parent)
        after, jobs, watermark = self.read()
        self.assertEqual(jobs[0][1], "failed")
        self.assertEqual(before[history.HISTORY_NEXT_END_KEY], after[history.HISTORY_NEXT_END_KEY])
        self.assertEqual(watermark, self.watermark)
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[0]["start_date"], calls[1]["start_date"])
        self.assertLessEqual((date.fromisoformat(calls[0]["end_date"]) - date.fromisoformat(calls[0]["start_date"])).days + 1, 30)

    def test_capacity_deferral_keeps_successful_cursor_and_terminal_job(self):
        routes.queue_connector_initial_backfill(None, self.identity)
        _, jobs, _ = self.read()
        with patch.object(routes, "run_data_source_sync_with_oauth_retry", return_value=[]), patch.object(routes, "queue_connector_initial_backfill", side_effect=routes.WorkspaceIngestionQueueFull()):
            routes.run_connector_ingestion_job(jobs[0][0])
        config, jobs, _ = self.read()
        self.assertEqual(jobs[0][1], "succeeded")
        self.assertEqual(config[routes.INITIAL_CONNECTOR_SYNC_STATUS_KEY], "backfill")
        self.assertEqual(config[history.HISTORY_NEXT_END_KEY], (date.fromisoformat(jobs[0][2]["start_date"]) - timedelta(days=1)).isoformat())

    def test_malformed_checkpoint_restarts_a_bounded_plan_without_claiming_coverage(self):
        with self.sessions() as db:
            connection = db.get(DataSourceConnection, self.identity)
            connection.connection_config = json.dumps({history.HISTORY_VERSION_KEY: history.HISTORY_POLICY_VERSION,
                history.HISTORY_START_KEY: "2025-01-01", history.HISTORY_NEXT_END_KEY: "not-a-date",
                routes.INITIAL_CONNECTOR_SYNC_STATUS_KEY: "complete"})
            db.commit()
            self.assertTrue(routes.initial_connector_backfill_is_required(connection))
        self.assertTrue(routes.queue_connector_initial_backfill(None, self.identity))
        config, jobs, _ = self.read()
        self.assertEqual(config[history.HISTORY_START_KEY], retention.connector_retention_cutoff_date().isoformat())
        self.assertEqual(len(jobs), 1)

    def test_expired_multi_object_chunk_finishes_without_provider_io(self):
        with patch.object(routes, "get_configured_connector_resource_types", return_value=["invoices", "customers"]):
            routes.queue_connector_initial_backfill(None, self.identity)
        _, jobs, _ = self.read()
        with self.sessions() as db:
            connection = db.get(DataSourceConnection, self.identity)
            config = json.loads(connection.connection_config)
            config[history.HISTORY_NEXT_END_KEY] = "2020-01-01"
            connection.connection_config = json.dumps(config)
            db.commit()
        with patch.object(routes, "run_connector_object_ingestion_job") as fetch:
            routes.run_connector_ingestion_job(jobs[0][0])
        fetch.assert_not_called()
        config, jobs, _ = self.read()
        self.assertEqual(config[routes.INITIAL_CONNECTOR_SYNC_STATUS_KEY], "complete")
        self.assertTrue(all(job[1] == "no_data" for job in jobs))


class ConnectorPartitionMergeTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.connection = SimpleNamespace(id=1, user_id="owner", workspace_id="workspace", source_type="stripe")
        self.partition = os.path.join(self.directory.name, "existing")
        os.makedirs(routes.build_connector_hot_dir(self.partition))
        self.storage = routes.get_object_storage()
        for item in [patch.object(routes, "build_connector_partition_dir", return_value=os.path.join(self.directory.name, "next"))]:
            item.start()
            self.addCleanup(item.stop)

    def write(self, month, rows):
        pd.DataFrame(rows).to_parquet(os.path.join(routes.build_connector_hot_dir(self.partition), f"month={month}.parquet"), index=False)

    def test_incremental_merge_retains_other_months_without_full_history_loading(self):
        self.write("2026-08", [{"date": "2026-08-01", "charge_id": "a", "amount": 1}])
        self.write("2026-09", [{"date": "2026-09-01", "charge_id": "b", "amount": 2}])
        incoming = pd.DataFrame([{"date": "2026-09-01", "charge_id": "b", "amount": 5}, {"date": "2026-10-01", "charge_id": "c", "amount": 3}])
        with patch.object(routes, "load_connector_raw_dataframe", side_effect=AssertionError("Full history must not be loaded")):
            _, result, _, previous = merge_connector_partitions(self.connection, incoming, {"date_column": "date"}, self.partition, self.storage)
        stored = routes.load_connector_raw_dataframe(result["partition_dir"])
        self.assertEqual(previous, 2)
        self.assertEqual(result["hot_row_count"], 3)
        self.assertEqual(dict(zip(stored.charge_id, stored.amount)), {"a": 1, "b": 5, "c": 3})
        self.assertTrue(os.path.isdir(self.partition), "Previous revision must remain intact until commit")

    def test_updated_identity_can_move_to_a_different_month_without_duplication(self):
        self.write("2026-08", [{"date": "2026-08-01", "charge_id": "a", "amount": 1}])
        incoming = pd.DataFrame([{"date": "2026-09-01", "charge_id": "a", "amount": 9}])
        _, result, _, _ = merge_connector_partitions(self.connection, incoming, {"date_column": "date"}, self.partition, self.storage)
        stored = routes.load_connector_raw_dataframe(result["partition_dir"])
        self.assertEqual(stored.charge_id.tolist(), ["a"])
        self.assertEqual(stored.amount.tolist(), [9])

    def test_purge_deletes_expired_partitions_and_exact_boundary_rows(self):
        cutoff = retention.connector_retention_cutoff_date()
        yesterday = cutoff - timedelta(days=1)
        self.write(yesterday.strftime("%Y-%m"), [{"date": yesterday.isoformat(), "charge_id": "old", "amount": 1},
                                               {"date": cutoff.isoformat(), "charge_id": "keep", "amount": 2}])
        self.write("2020-01", [{"date": "2020-01-01", "charge_id": "expired", "amount": 3}])
        _, result, _, _ = merge_connector_partitions(self.connection, pd.DataFrame(), {"date_column": "date"}, self.partition, self.storage)
        stored = routes.load_connector_raw_dataframe(result["partition_dir"])
        self.assertEqual(stored.charge_id.tolist(), ["keep"])
        self.assertFalse(os.path.exists(os.path.join(result["partition_dir"], "hot", "month=2020-01.parquet")))

    def test_retry_is_idempotent_and_partition_failure_keeps_previous_revision(self):
        self.write("2026-09", [{"date": "2026-09-01", "charge_id": "a", "amount": 1}])
        incoming = pd.DataFrame([{"date": "2026-09-01", "charge_id": "a", "amount": 5}])
        _, result, _, _ = merge_connector_partitions(self.connection, incoming, {"date_column": "date"}, self.partition, self.storage)
        _, retried, _, _ = merge_connector_partitions(self.connection, incoming, {"date_column": "date"}, result["partition_dir"], self.storage)
        self.assertEqual(retried["hot_row_count"], 1)
        with patch.object(pd.DataFrame, "to_parquet", side_effect=OSError("Disk full")), self.assertRaises(OSError):
            merge_connector_partitions(self.connection, incoming, {"date_column": "date"}, self.partition, self.storage)
        self.assertTrue(os.path.isfile(os.path.join(self.partition, "hot", "month=2026-09.parquet")))

    def test_complete_transaction_items_replace_deleted_lines(self):
        self.connection.source_type = "shopify"
        self.write("2026-09", [{"created_at": "2026-09-01", "order_id": "order", "line_item_id": "removed", "quantity": 1},
                               {"created_at": "2026-09-01", "order_id": "order", "line_item_id": "kept", "quantity": 2}])
        incoming = pd.DataFrame([{"created_at": "2026-09-01", "order_id": "order", "line_item_id": "kept", "quantity": 3}])
        config = {"date_column": "created_at", "resource": "orders", "dedup_keys": ["order_id", "line_item_id"],
                  "complete_document_items": True, "line_item_key": "line_item_id", "line_item_parent_keys": ["order_id"]}
        _, result, _, _ = merge_connector_partitions(self.connection, incoming, config, self.partition, self.storage)
        stored = routes.load_connector_raw_dataframe(result["partition_dir"])
        self.assertEqual(stored.line_item_id.tolist(), ["kept"])
        self.assertEqual(stored.quantity.tolist(), [3])

    def test_raw_history_does_not_double_count_a_legacy_summary_month(self):
        os.makedirs(routes.build_connector_historical_dir(self.partition))
        pd.DataFrame({routes.SUMMARY_MONTH_COLUMN: ["2026-09"], "amount": [100], routes.SUMMARY_MARKER_COLUMN: [True]}).to_parquet(
            routes.build_connector_historical_year_path(self.partition, "2026"), index=False)
        incoming = pd.DataFrame([{"date": "2026-09-01", "charge_id": "a", "amount": 5}])
        _, result, _, _ = merge_connector_partitions(self.connection, incoming, {"date_column": "date"}, self.partition, self.storage)
        self.assertEqual(result["historical_summary_row_count"], 0)

    def test_persisted_incremental_dataset_keeps_identity_selection_and_committed_revision(self):
        engine = create_engine("sqlite://")
        self.addCleanup(engine.dispose)
        Base.metadata.create_all(engine)
        sessions = sessionmaker(bind=engine)
        with sessions() as db:
            connection = DataSourceConnection(user_id="owner", workspace_id="workspace", source_type="stripe", display_name="Payments", connection_config="{}")
            db.add(connection)
            db.commit()
            config = {"date_column": "date", "resource": "charges"}
            first = pd.DataFrame([{"date": "2026-08-01", "charge_id": "a", "amount": 10}])
            dataset, _, _, _ = routes.persist_connector_dataframe(db, connection, first, config)
            db.commit()
            identity, previous = dataset.id, dataset.file_path
            stored_config = json.loads(dataset.source_config)
            stored_config["selected_metric_columns"] = ["amount"]
            dataset.source_config = json.dumps(stored_config)
            db.commit()
            incoming = pd.DataFrame([{"date": "2026-09-01", "charge_id": "b", "amount": 20}])
            with patch.object(routes, "load_connector_raw_dataframe", side_effect=AssertionError("Full history read")):
                updated, report, _, replaced = routes.persist_connector_dataframe(db, connection, incoming, config)
            self.assertEqual(updated.id, identity)
            self.assertEqual(updated.row_count, 2)
            self.assertEqual(report["added_row_count"], 1)
            self.assertEqual(json.loads(updated.source_config)["selected_metric_columns"], ["amount"])
            self.assertEqual(replaced, previous)
            self.assertTrue(os.path.isdir(previous))
            db.commit()
            routes.remove_dataset_file(replaced)
            self.assertFalse(os.path.exists(previous))
            self.assertEqual(len(routes.load_connector_raw_dataframe(updated.file_path)), 2)
            current_files = set(os.listdir(self.directory.name))
            with patch.object(type(self.storage), "put_directory", side_effect=OSError("Storage unavailable")), self.assertRaises(OSError):
                routes.persist_connector_dataframe(db, connection, incoming, config)
            self.assertEqual(set(os.listdir(self.directory.name)), current_files)
            self.assertTrue(os.path.isdir(updated.file_path))
