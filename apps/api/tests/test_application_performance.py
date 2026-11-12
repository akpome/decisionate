import asyncio
import inspect
import json
import threading
import unittest
from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.routing import run_endpoint_function
from fastapi.testclient import TestClient

from app import main
from app.modules.datasets import router as routes
from app.modules.datasets.schemas import DatasetMetricSelectionUpdate, EntityMatchingRequest
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
            "get_dataset_join_metadata", "dataset_dimensions",
            "sync_due_source_connections",
            "update_dataset_metric_selection",
            "get_entity_matching_metadata", "preview_entity_matching", "run_entity_matching",
        ):
            with self.subTest(endpoint=name):
                self.assertFalse(inspect.iscoroutinefunction(getattr(routes, name)))

    async def test_join_metadata_does_not_block_other_requests_during_storage_or_profiling(self):
        loop = asyncio.get_running_loop()
        event_loop_thread = threading.get_ident()
        for blocked_stage in ("load", "profile"):
            with self.subTest(stage=blocked_stage):
                threads = {}
                started = asyncio.Event()
                release = threading.Event()
                dataset = SimpleNamespace(id=103)
                frame = pd.DataFrame({"revenue": [10]})

                def stage(name, result=None):
                    def call(*args, **kwargs):
                        threads[name] = threading.get_ident()
                        if name == blocked_stage:
                            loop.call_soon_threadsafe(started.set)
                            release.wait(1)
                        return result
                    return call

                db = SimpleNamespace(close=stage("close"))
                query, load = stage("query", dataset), stage("load", frame)
                with ExitStack() as stack:
                    for name, value in (
                        ("SessionLocal", stage("open", db)),
                        ("get_user_id", stage("auth", "owner")),
                        ("get_workspace_id", stage("workspace", "workspace")),
                        ("load_dataset", query),
                        ("verify_dataset_owner", stage("ownership")),
                        ("load_dataframe_from_dataset", load),
                        ("build_join_dataset_metadata", stage("profile", {"dataset_id": 103})),
                    ):
                        stack.enter_context(patch.object(routes, name, side_effect=value))
                    stack.enter_context(patch("app.modules.datasets.services.dataset_loader.load_dataset", side_effect=query))
                    stack.enter_context(patch("app.modules.datasets.services.dataset_loader.load_dataframe_from_dataset", side_effect=load))
                    request = asyncio.create_task(dispatch(routes.get_dataset_join_metadata, request=object(), dataset_ids=[103]))
                    try:
                        await asyncio.wait_for(started.wait(), 0.5)
                        self.assertFalse(request.done())
                        self.assertNotEqual(threads[blocked_stage], event_loop_thread)
                        health = await asyncio.wait_for(dispatch(main.root), 0.5)
                        self.assertEqual(health, {"message": "Decisionate API"})
                        self.assertNotIn("close", threads)
                    finally:
                        release.set()
                        result = await request
                self.assertEqual(result, {"datasets": [{"dataset_id": 103}]})
                self.assertEqual(set(threads.values()), {threads["open"]})
                self.assertIn("close", threads)

    async def test_join_metadata_checks_dataset_access_before_opening_storage(self):
        db = SimpleNamespace(close=Mock())
        load = Mock(return_value=pd.DataFrame({"revenue": [10]}))
        with patch.object(routes, "SessionLocal", return_value=db), patch.object(
            routes, "get_user_id", return_value="owner"
        ), patch.object(routes, "get_workspace_id", return_value="workspace"), patch.object(
            routes, "load_dataset", return_value=SimpleNamespace(id=103)
        ), patch("app.modules.datasets.services.dataset_loader.load_dataset", return_value=SimpleNamespace(id=103)), patch.object(
            routes, "verify_dataset_owner", side_effect=HTTPException(403, "Forbidden")
        ), patch.object(routes, "load_dataframe_from_dataset", load), patch(
            "app.modules.datasets.services.dataset_loader.load_dataframe_from_dataset", load
        ):
            with self.assertRaises(HTTPException) as error:
                await dispatch(routes.get_dataset_join_metadata, request=object(), dataset_ids=[103])
        self.assertEqual(error.exception.status_code, 403)
        load.assert_not_called()
        db.close.assert_called_once()

    async def test_entity_workflows_keep_io_and_database_on_one_worker_thread(self):
        loop = asyncio.get_running_loop()
        event_loop_thread = threading.get_ident()
        for name in ("get_entity_matching_metadata", "preview_entity_matching", "run_entity_matching"):
            with self.subTest(endpoint=name):
                threads = {}
                started = asyncio.Event()
                release = threading.Event()

                def stage(name, result=None):
                    def call(*args, **kwargs):
                        threads[name] = threading.get_ident()
                        if name == "load":
                            loop.call_soon_threadsafe(started.set)
                            release.wait(2)
                        return result
                    return call

                frame = pd.DataFrame({"email": ["a@example.test"], "revenue": [10]})
                dataset = SimpleNamespace(id=1, file_name="customers.csv", source_type="csv")
                db = Mock()
                db.query.return_value.filter.return_value.all.return_value = []
                db.commit.side_effect = stage("commit")
                db.close.side_effect = stage("close")
                result = {"entities": [], "matched_row_count": 0, "unmatched_row_count": 2}
                with ExitStack() as stack:
                    for target, callback in (
                        ("SessionLocal", stage("open", db)),
                        ("get_user_id", stage("auth", "user")),
                        ("get_workspace_id", stage("workspace", "workspace")),
                        ("require_workspace_data_manager", stage("permission")),
                        ("load_dataset", stage("query", dataset)),
                        ("verify_dataset_owner", stage("ownership")),
                        ("load_dataframe_from_dataset", stage("load", frame)),
                        ("build_metric_selection_profile", stage("profile", {"fields": []})),
                        ("build_entity_resolution", stage("resolve", result)),
                        ("_find_entity_matching_dataset", stage("existing")),
                        ("build_linked_entity_history", stage("history", (frame, {"date_columns": {}, "policy": {"selected": []}}, []))),
                        ("persist_entity_matching_dataframe", stage("persist", ("linked", "local", "linked"))),
                    ):
                        stack.enter_context(patch.object(routes, target, side_effect=callback))
                    values = {"request": object()}
                    if name == "get_entity_matching_metadata":
                        values.update(dataset_ids=[1, 2], entity_type="customer")
                    else:
                        values["payload"] = EntityMatchingRequest(dataset_ids=[1, 2], entity_type="customer")
                    request = asyncio.create_task(dispatch(getattr(routes, name), **values))
                    try:
                        await asyncio.wait_for(started.wait(), 1)
                        self.assertFalse(request.done())
                        self.assertNotEqual(threads["load"], event_loop_thread)
                        self.assertNotIn("close", threads)
                    finally:
                        release.set()
                        await request
                self.assertEqual(set(threads.values()), {threads["open"]})
                self.assertIn("close", threads)
                if name == "run_entity_matching":
                    self.assertIn("persist", threads)
                    self.assertIn("commit", threads)

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

    async def test_metric_save_keeps_database_and_dataframe_work_on_one_worker_thread(self):
        event_loop_thread = threading.get_ident()
        loop = asyncio.get_running_loop()
        for blocked_stage in ("recommendations", "commit"):
            with self.subTest(stage=blocked_stage):
                threads = {}
                started = asyncio.Event()
                release = threading.Event()

                def stage(name, result=None):
                    def call(*args, **kwargs):
                        threads[name] = threading.get_ident()
                        if name == blocked_stage:
                            loop.call_soon_threadsafe(started.set)
                            release.wait(2)
                        return result
                    return call

                dataset = SimpleNamespace(id=1, source_config="{}")
                db = Mock()
                db.commit.side_effect = stage("commit")
                db.refresh.side_effect = stage("refresh")
                db.close.side_effect = stage("close")
                profile = {"available_metric_columns": ["revenue"], "fields": []}
                recommendations = {"policyVersion": "v1", "recommended": [{"columnKey": "revenue"}], "optional": [], "derived": []}
                with ExitStack() as stack:
                    for name, callback in (
                        ("SessionLocal", stage("open", db)),
                        ("get_user_id", stage("auth", "user")),
                        ("get_workspace_id", stage("workspace", "workspace")),
                        ("require_workspace_data_manager", stage("permission")),
                        ("load_dataset", stage("query", dataset)),
                        ("verify_dataset_owner", stage("ownership")),
                        ("load_dataframe_from_dataset", stage("load", pd.DataFrame({"revenue": [10, 20]}))),
                        ("build_metric_selection_profile", stage("profile", profile)),
                        ("resolve_metric_recommendations", stage("recommendations", recommendations)),
                        ("metric_default_flags", stage("flags", {"backend": True})),
                        ("selection_provenance", stage("provenance", {})),
                        ("connector_dataset_display_name", stage("name", "data.csv")),
                    ):
                        stack.enter_context(patch.object(routes, name, side_effect=callback))
                    request = asyncio.create_task(dispatch(
                        routes.update_dataset_metric_selection, request=object(), dataset_id=1,
                        payload=DatasetMetricSelectionUpdate(selected_metric_columns=["revenue"], use_curated_recommendations=True, policy_version="v1"),
                    ))
                    try:
                        await asyncio.wait_for(started.wait(), 1)
                        self.assertFalse(request.done())
                        self.assertNotEqual(threads[blocked_stage], event_loop_thread)
                        self.assertNotIn("close", threads)
                    finally:
                        release.set()
                        result = await request
                self.assertEqual(result["selected_metric_columns"], ["revenue"])
                self.assertEqual(set(threads.values()), {threads["open"]})
                self.assertIn("close", threads)

    async def test_denied_access_does_not_load_dataset_storage(self):
        with patch.object(routes, "load_dataset", return_value=SimpleNamespace(id=1)), patch.object(
            routes, "verify_dataset_owner", side_effect=HTTPException(403, "Forbidden")
        ), patch.object(routes, "load_dataframe_from_dataset") as load:
            with self.assertRaises(HTTPException) as error:
                routes._load_owned_dataset_dataframe(object(), 1, "user", "workspace")
        self.assertEqual(error.exception.status_code, 403)
        load.assert_not_called()


class JoinMetadataResponseTests(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(routes.router, prefix="/datasets")
        self.origin = "https://www.decisionate.ca"
        app.add_middleware(CORSMiddleware, allow_origins=[self.origin], allow_headers=["*"], allow_methods=["*"])
        self.client = TestClient(app)
        self.db = SimpleNamespace(close=Mock())
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        for name, value in (("SessionLocal", self.db), ("get_user_id", "owner"), ("get_workspace_id", "workspace"),
                            ("build_join_dataset_metadata", {"dataset_id": 103})):
            self.stack.enter_context(patch.object(routes, name, return_value=value))
        self.load = self.stack.enter_context(patch.object(routes, "_load_owned_dataset_dataframe",
            return_value=(SimpleNamespace(id=103), pd.DataFrame({"revenue": [10]}))))

    def request(self, query="dataset_ids=103"):
        return self.client.get("/datasets/join/metadata?" + query, headers={"Origin": self.origin})

    def test_success_preserves_metadata_and_cors_headers(self):
        response = self.request()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"datasets": [{"dataset_id": 103}]})
        self.assertEqual(response.headers["access-control-allow-origin"], self.origin)
        self.load.assert_called_once_with(self.db, 103, "owner", "workspace", apply_metric_selection=False)
        self.db.close.assert_called_once()

    def test_storage_failures_return_a_readable_cors_enabled_error(self):
        self.load.side_effect = RuntimeError("Private storage diagnostics")
        with patch.object(routes.logger, "exception"):
            response = self.request()
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.headers["access-control-allow-origin"], self.origin)
        self.assertEqual(response.json()["detail"], "Dataset metadata is temporarily unavailable. Try again shortly.")
        self.assertNotIn("Private storage", response.text)
        self.db.close.assert_called_once()

    def test_denied_requests_keep_their_status_and_cors_header(self):
        self.load.side_effect = HTTPException(403, "Forbidden")
        response = self.request()
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.headers["access-control-allow-origin"], self.origin)
        self.db.close.assert_called_once()

    def test_invalid_selections_do_not_load_any_files(self):
        for query in ("dataset_ids=103&dataset_ids=103", "&".join(f"dataset_ids={identity}" for identity in range(6))):
            with self.subTest(query=query):
                self.assertEqual(self.request(query).status_code, 400)
        self.load.assert_not_called()


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

    def get_cache(self, dataset_id=1):
        return routes.get_dataset_join_cache(object(), dataset_id=dataset_id, dashboard="general-business")

    def test_selected_joined_dataset_loads_its_own_cached_evidence(self):
        self.assertEqual(self.get_cache(200), self.result)
        self.assertEqual(self.owner.call_count, 2)
        self.load.assert_not_called()
        self.persist.assert_not_called()

    def test_unrelated_dataset_never_restores_another_join(self):
        self.assertIsNone(self.get_cache(3))
        self.owner.assert_not_called()
        self.load.assert_not_called()
        self.persist.assert_not_called()

    def test_selected_join_still_requires_access_to_all_sources(self):
        self.owner.side_effect = HTTPException(403, "Forbidden")
        with self.assertRaises(HTTPException) as error:
            self.get_cache(200)
        self.assertEqual(error.exception.status_code, 403)
        self.fingerprint.assert_not_called()

    def test_deleted_selected_join_cannot_be_recreated_by_its_cache(self):
        self.derived = None
        self.assertIsNone(self.get_cache(200))
        self.db.delete.assert_called_once_with(self.cache)
        self.persist.assert_not_called()

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
