import asyncio
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, MagicMock, Mock, patch
from zipfile import ZipFile

from fastapi import HTTPException
import pandas as pd

from app.infrastructure import ingestion_limits as limits, ingestion_worker
from app.modules.datasets import router as routes
from app.modules.datasets.services import connector_partition_merge, connectors, file_loader
from app.security import request_limits


class FileSizeTests(unittest.TestCase):
    def test_tabular_limits_reject_before_pandas_materializes_sparse_or_wide_files(self):
        inputs = {
            "table.csv": ("one,two,three\n1,2,3\n4,5,6\n", "read_csv"),
            "table.json": ('[{"a":1,"b":2,"c":3},{"d":4}]', "read_json"),
            "table.jsonl": ('{"a":1,"b":2,"c":3}\n{"d":4}\n', "read_json"),
        }
        with TemporaryDirectory() as directory, patch.object(limits, "MAX_DATASET_CELLS", 5):
            for name, (contents, reader) in inputs.items():
                with self.subTest(name=name), patch.object(file_loader.pd, reader) as parse:
                    path = Path(directory) / name
                    path.write_text(contents)
                    with self.assertRaises(HTTPException) as error:
                        file_loader.load_dataset_file(str(path))
                    self.assertEqual(error.exception.status_code, 413)
                    self.assertIn("cell limit", error.exception.detail)
                    parse.assert_not_called()

    def test_parquet_and_spreadsheet_preflight_precedes_full_decode(self):
        with TemporaryDirectory() as directory:
            parquet = Path(directory) / "table.parquet"
            pd.DataFrame({"a": [1, 2], "b": [3, 4]}).to_parquet(parquet)
            with patch.object(limits, "MAX_DATASET_CELLS", 3), patch.object(file_loader.pd, "read_parquet") as parse:
                with self.assertRaises(HTTPException) as error:
                    file_loader.load_dataset_file(str(parquet))
                self.assertEqual(error.exception.status_code, 413)
                parse.assert_not_called()

            with patch.object(limits, "MAX_DATASET_CELLS", 3):
                self.assertEqual(file_loader.load_dataset_file(str(parquet), existing=True)[1].shape, (2, 2))

            workbook = Path(directory) / "temporary-download"
            with ZipFile(workbook, "w") as archive:
                archive.writestr("xl/worksheets/sheet1.xml", b"12345678")
            with patch.object(file_loader, "MAX_WORKBOOK_EXPANDED_BYTES", 4), patch.object(file_loader.pd, "ExcelFile") as parse:
                with self.assertRaises(HTTPException) as error:
                    file_loader.load_dataset_file(str(workbook), "table.xlsx")
                self.assertEqual(error.exception.status_code, 413)
                parse.assert_not_called()


class ConnectorVolumeTests(unittest.TestCase):
    def test_connector_get_and_post_share_one_response_budget(self):
        seen = []

        def respond(request, **_options):
            seen.append(request.get_method())
            response = BytesIO(b'{"x":1}')
            response.headers = {}
            return response

        with patch.object(limits, "MAX_CONNECTOR_FETCH_BYTES", 13), patch.object(connectors, "urlopen", side_effect=respond):
            with limits.connector_fetch_budget():
                self.assertEqual(connectors.connector_json_request("https://provider.example", {}), {"x": 1})
                with self.assertRaisesRegex(limits.IngestionLimitExceeded, "too much data"):
                    connectors.connector_json_post_request("https://provider.example", {}, {})
            with limits.connector_fetch_budget():
                self.assertEqual(connectors.connector_json_post_request("https://provider.example", {}, {}), {"x": 1})
        self.assertEqual(seen, ["GET", "POST", "POST"])

    def test_excess_pages_are_rejected_before_the_next_http_request(self):
        with patch.object(limits, "MAX_CONNECTOR_REQUESTS", 1), patch.object(connectors, "urlopen") as request:
            with limits.connector_fetch_budget():
                limits.count_connector_request()
                with self.assertRaisesRegex(limits.IngestionLimitExceeded, "too many pages"):
                    connectors.connector_json_request("https://provider.example", {})
        request.assert_not_called()

    @unittest.skipIf(connectors.curl_requests is None, "Browser-compatible transport is optional")
    def test_curl_stops_reading_oversized_response_without_fallback(self):
        def respond(_url, *, content_callback, **_options):
            self.assertEqual(content_callback(b'123'), 3)
            self.assertEqual(content_callback(b'45'), connectors.CURL_WRITEFUNC_ERROR)
            raise RuntimeError("Transfer cancelled")

        with patch.object(limits, "MAX_CONNECTOR_PAGE_BYTES", 4), patch.object(
            connectors.curl_requests, "get", side_effect=respond,
        ), patch.object(connectors, "urlopen") as fallback:
            with self.assertRaisesRegex(limits.IngestionLimitExceeded, "too much data"):
                connectors.connector_json_request("https://provider.example", {}, source_type="sage")
        fallback.assert_not_called()

    def test_sql_chunks_reject_before_reads_or_persistence_continue(self):
        def rows():
            yield pd.DataFrame({"value": [1, 2]})
            yield pd.DataFrame({"value": [3, 4]})
            self.fail("Read another chunk after reaching the row cap")

        engine = Mock()
        connection = Mock(source_type="postgresql", connection_config='{"query":"SELECT value FROM data"}')
        database = MagicMock()
        database.connect.return_value.__enter__.return_value = database
        engine.create_engine.return_value = database
        with patch.object(limits, "MAX_DATASET_ROWS", 3), patch.object(connectors.importlib, "import_module", return_value=engine), patch.object(
            connectors, "get_provider_setting", return_value="database-url",
        ), patch.object(connectors.pd, "read_sql_query", return_value=rows()) as query:
            with self.assertRaises(limits.IngestionLimitExceeded):
                connectors.load_database_dataframe(connection)
        database.execution_options.assert_called_once_with(stream_results=True)
        self.assertEqual(query.call_args.kwargs["chunksize"], 2_000)
        database.dispose.assert_called_once()

    def test_accumulated_connector_limit_does_not_replace_saved_partitions(self):
        dataset = SimpleNamespace(file_path="original", source_config="{}")
        connection = SimpleNamespace(source_type="shopify")
        storage = Mock()
        storage.is_directory_reference.return_value = True
        staged = {"partition_dir": "new-revision", "hot_row_count": 4, "historical_summary_row_count": 0, "column_count": 1}
        with patch.object(limits, "MAX_DATASET_ROWS", 3), patch.object(routes, "find_connector_dataset", return_value=dataset), patch.object(
            routes, "get_dataset_storage_reference", return_value="original",
        ), patch.object(routes, "get_object_storage", return_value=storage), patch.object(
            connector_partition_merge, "merge_connector_partitions", return_value=(pd.DataFrame(), staged, {}, 3),
        ), patch.object(routes, "remove_dataset_file") as cleanup:
            with self.assertRaises(limits.IngestionLimitExceeded):
                routes.persist_connector_dataframe(Mock(), connection, pd.DataFrame({"value": [1]}), {})
        cleanup.assert_called_once_with("new-revision")
        storage.put_directory.assert_not_called()
        self.assertEqual(dataset.file_path, "original")


class RequestAndWorkerLimitsTests(unittest.IsolatedAsyncioTestCase):
    async def test_upload_slots_fail_fast_and_are_released(self):
        started, finish = asyncio.Event(), asyncio.Event()
        inner = AsyncMock(side_effect=self._hold_upload(started, finish))
        with patch.object(request_limits, "MAX_CONCURRENT_UPLOADS", 1):
            app = request_limits.RequestBodyLimitMiddleware(inner)
        scope = {"type": "http", "method": "POST", "path": "/datasets/upload", "headers": []}
        first = asyncio.create_task(app(scope, AsyncMock(), AsyncMock()))
        try:
            await asyncio.wait_for(started.wait(), timeout=2)
            send = AsyncMock()
            await asyncio.wait_for(app(scope, AsyncMock(), send), timeout=2)
            self.assertEqual(send.call_args_list[0].args[0]["status"], 429)
            self.assertEqual(inner.await_count, 1)
        finally:
            finish.set()
            await first
        await app(scope, AsyncMock(), AsyncMock())
        self.assertEqual(inner.await_count, 2)

    @staticmethod
    def _hold_upload(started, finish):
        async def run(_scope, _receive, _send):
            started.set()
            await finish.wait()
        return run

    def test_worker_kills_one_over_budget_job_with_a_clear_message(self):
        child = Mock(pid=123, **{"poll.return_value": None})
        with patch.object(ingestion_worker.subprocess, "Popen", return_value=child), patch.object(
            ingestion_worker, "ingestion_memory_budget_bytes", return_value=100,
        ), patch.object(ingestion_worker, "process_memory", return_value={"rss_bytes": 101}), patch.object(
            ingestion_worker.os, "killpg",
        ) as kill, patch.object(ingestion_worker, "record_heartbeat"), patch.object(
            ingestion_worker, "fail_interrupted_jobs",
        ) as fail, patch.object(ingestion_worker, "cleanup_terminal_file_jobs"):
            ingestion_worker.supervise_job(1, Mock(), "worker.py")
        kill.assert_called_once_with(123, ingestion_worker.signal.SIGKILL)
        child.wait.assert_called_once()
        self.assertIn("memory limit", fail.call_args.args[1])
