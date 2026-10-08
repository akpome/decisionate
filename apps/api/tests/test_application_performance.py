import asyncio
import inspect
import json
import threading
import unittest
from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import pandas as pd
from fastapi import HTTPException
from fastapi.routing import run_endpoint_function

from app import main
from app.modules.datasets import router as routes
from app.modules.datasets.services.joins import JOIN_RESULT_VERSION


async def dispatch(endpoint, **values):
    return await run_endpoint_function(
        dependant=SimpleNamespace(call=endpoint),
        values=values,
        is_coroutine=inspect.iscoroutinefunction(endpoint),
    )


class DatasetReadConcurrencyTests(unittest.IsolatedAsyncioTestCase):
    async def test_storage_read_does_not_block_other_requests(self):
        loop = asyncio.get_running_loop()
        event_loop_thread = threading.get_ident()
        started = asyncio.Event()
        release = threading.Event()
        threads = {}

        def open_db():
            threads["open"] = threading.get_ident()
            return SimpleNamespace(close=lambda: threads.update(close=threading.get_ident()))

        def slow_load(dataset, **kwargs):
            threads["load"] = threading.get_ident()
            loop.call_soon_threadsafe(started.set)
            release.wait(1)
            return pd.DataFrame({"revenue": [10, 20]})

        with patch.object(routes, "SessionLocal", side_effect=open_db), patch.object(
            routes, "get_user_id", return_value="user-1"
        ), patch.object(routes, "get_workspace_id", return_value="workspace-1"), patch.object(
            routes, "load_dataset", return_value=SimpleNamespace(id=1)
        ), patch.object(routes, "verify_dataset_owner"), patch.object(
            routes, "load_dataframe_from_dataset", side_effect=slow_load
        ), patch.object(routes, "connector_dataset_display_name", return_value="data.csv"):
            request = asyncio.create_task(dispatch(routes.dataset_metrics, request=object(), dataset_id=1))
            try:
                await asyncio.wait_for(started.wait(), 0.5)
                self.assertFalse(request.done())
                self.assertNotEqual(threads["load"], event_loop_thread)
                self.assertNotIn("close", threads)
            finally:
                release.set()
                result = await request

        self.assertEqual(result["metrics"][0]["total"], 30)
        self.assertEqual(threads["open"], threads["load"])
        self.assertEqual(threads["load"], threads["close"])

    async def test_heavy_dataset_reads_use_framework_worker_dispatch(self):
        for name in (
            "dataset_preview", "dataset_metrics", "dataset_insights", "dataset_chart_data",
            "dataset_anomalies", "dataset_details", "dataset_ai_analysis", "get_dataset_join_cache",
            "sync_due_source_connections",
        ):
            with self.subTest(endpoint=name):
                self.assertFalse(inspect.iscoroutinefunction(getattr(routes, name)))

    async def test_details_are_encoded_once_on_the_worker_thread(self):
        event_loop_thread = threading.get_ident()
        encoding_threads = []
        original_encoder = routes.jsonable_encoder

        def encode(value):
            encoding_threads.append(threading.get_ident())
            return original_encoder(value)

        db = SimpleNamespace(close=Mock())
        with patch.object(routes, "SessionLocal", return_value=db), patch.object(
            routes, "get_user_id", return_value="user-1"
        ), patch.object(routes, "get_workspace_id", return_value="workspace-1"), patch.object(
            routes, "_load_owned_dataset_dataframe", return_value=(SimpleNamespace(id=1), pd.DataFrame())
        ), patch.object(routes, "build_dataset_details_response", return_value={"id": 1, "chart": {"data": []}}), patch.object(
            routes, "jsonable_encoder", side_effect=encode
        ):
            response = await dispatch(
                routes.dataset_details, request=object(), dataset_id=1, include_all_rows=False,
                include_ai_analysis=False, start_date=None, period_filter=None,
                aggregation=None, aggregation_type=None,
            )
        self.assertEqual(json.loads(response.body), {"id": 1, "chart": {"data": []}})
        self.assertEqual(len(encoding_threads), 1)
        self.assertNotEqual(encoding_threads[0], event_loop_thread)
        db.close.assert_called_once()

    async def test_denied_access_does_not_load_dataset_storage(self):
        with patch.object(routes, "load_dataset", return_value=SimpleNamespace(id=1)), patch.object(
            routes, "verify_dataset_owner", side_effect=HTTPException(403, "Forbidden")
        ), patch.object(routes, "load_dataframe_from_dataset") as load:
            with self.assertRaises(HTTPException) as error:
                routes._load_owned_dataset_dataframe(object(), 1, "user", "workspace")
        self.assertEqual(error.exception.status_code, 403)
        load.assert_not_called()


class AuthenticationConcurrencyTests(unittest.IsolatedAsyncioTestCase):
    def request(self):
        return SimpleNamespace(method="GET", url=SimpleNamespace(path="/datasets/1/details"), state=SimpleNamespace())

    async def test_auth_and_billing_checks_run_off_the_event_loop_on_every_request(self):
        event_loop_thread = threading.get_ident()
        threads = []

        def auth(request):
            threads.append(threading.get_ident())
            return SimpleNamespace(workspace_id="workspace-1")

        def subscription(workspace_id):
            threads.append(threading.get_ident())
            return SimpleNamespace(access_allowed=True)

        call_next = AsyncMock(return_value="response")
        with patch.object(main, "get_auth_context", side_effect=auth) as authenticate, patch.object(
            main, "_load_subscription_access_state", side_effect=subscription
        ) as check_billing, patch.object(main, "is_subscription_exempt_path", return_value=False):
            for _ in range(2):
                self.assertEqual(await main.enforce_product_route_auth(self.request(), call_next), "response")

        self.assertEqual(authenticate.call_count, 2)
        self.assertEqual(check_billing.call_count, 2)
        self.assertTrue(all(thread != event_loop_thread for thread in threads))

    async def test_authentication_failure_still_blocks_the_endpoint(self):
        call_next = AsyncMock()
        with patch.object(main, "get_auth_context", side_effect=HTTPException(401, "Sign in")):
            response = await main.enforce_product_route_auth(self.request(), call_next)
        self.assertEqual(response.status_code, 401)
        call_next.assert_not_awaited()

    async def test_expired_subscription_still_blocks_the_endpoint(self):
        call_next = AsyncMock()
        state = SimpleNamespace(access_allowed=False, status="expired", current_period_end=None, grace_period_end=None)
        with patch.object(main, "get_auth_context", return_value=SimpleNamespace(workspace_id="workspace-1")), patch.object(
            main, "_load_subscription_access_state", return_value=state
        ), patch.object(main, "is_subscription_exempt_path", return_value=False), patch.object(
            main, "subscription_access_error", return_value="Subscription expired"
        ):
            response = await main.enforce_product_route_auth(self.request(), call_next)
        self.assertEqual(response.status_code, 402)
        self.assertEqual(json.loads(response.body)["subscription_status"], "expired")
        call_next.assert_not_awaited()


class JoinedDatasetCacheTests(unittest.TestCase):
    def setUp(self):
        self.result = {
            "join_version": JOIN_RESULT_VERSION, "derived_dataset_id": 200,
            "dataset_ids": [1, 2], "rows": [{"date": "2026-01-01", "revenue": 30}],
        }
        self.cache = SimpleNamespace(
            definition=json.dumps({"selections": [{"dataset_id": 1}, {"dataset_id": 2}]}),
            dataset_ids="[1, 2]", result=json.dumps(self.result), source_fingerprint="same",
        )
        self.derived = SimpleNamespace(id=200)
        self.db = Mock()
        self.db.query.side_effect = lambda model: SimpleNamespace(
            filter=lambda *args: SimpleNamespace(first=lambda: self.cache if model is routes.DatasetJoinCache else self.derived)
        )
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.object(routes, "SessionLocal", return_value=self.db))
        self.stack.enter_context(patch.object(routes, "get_user_id", return_value="user"))
        self.stack.enter_context(patch.object(routes, "get_workspace_id", return_value="workspace"))
        self.stack.enter_context(patch.object(routes, "load_dataset", side_effect=lambda db, id: SimpleNamespace(id=id)))
        self.owner = self.stack.enter_context(patch.object(routes, "verify_dataset_owner"))
        self.fingerprint = self.stack.enter_context(patch.object(routes, "build_dataset_source_fingerprint", return_value="same"))
        self.load = self.stack.enter_context(patch.object(routes, "load_dataframe_from_dataset", return_value=pd.DataFrame({"revenue": [10]})))
        self.build = self.stack.enter_context(patch.object(routes, "build_joined_dataset", return_value=self.result))
        self.persist = self.stack.enter_context(patch.object(routes, "materialize_joined_dataset_record", return_value=(self.result, "new.parquet", None)))
        self.stack.enter_context(patch.object(routes, "build_join_dataset_metadata", return_value={}))
        self.stack.enter_context(patch.object(routes, "remove_dataset_file"))

    def get_cache(self):
        return routes.get_dataset_join_cache(object(), dataset_id=1, dashboard="general-business")

    def test_unchanged_sources_skip_all_dataframe_loading(self):
        self.assertEqual(self.get_cache(), self.result)
        self.assertEqual(self.owner.call_count, 2)
        self.load.assert_not_called()
        self.build.assert_not_called()
        self.persist.assert_not_called()
        self.db.close.assert_called_once()

    def test_changed_sources_rebuild_and_persist_the_join(self):
        self.fingerprint.return_value = "changed"
        self.assertEqual(self.get_cache(), self.result)
        self.assertEqual(self.load.call_count, 2)
        self.build.assert_called_once()
        self.persist.assert_called_once()
        self.db.commit.assert_called_once()
        self.assertEqual(self.cache.source_fingerprint, "changed")

    def test_denied_source_never_reuses_cached_evidence(self):
        self.owner.side_effect = HTTPException(403, "Forbidden")
        with self.assertRaises(HTTPException) as error:
            self.get_cache()
        self.assertEqual(error.exception.status_code, 403)
        self.load.assert_not_called()
        self.fingerprint.assert_not_called()

    def test_deleted_derived_dataset_is_not_recreated(self):
        self.derived = None
        self.assertIsNone(self.get_cache())
        self.db.delete.assert_called_once_with(self.cache)
        self.load.assert_not_called()
        self.persist.assert_not_called()

    def test_legacy_cache_can_materialize_without_reloading_unchanged_sources(self):
        self.result.pop("derived_dataset_id")
        self.cache.result = json.dumps(self.result)
        self.assertEqual(self.get_cache(), self.result)
        self.load.assert_not_called()
        self.persist.assert_called_once()


if __name__ == "__main__":
    unittest.main()
