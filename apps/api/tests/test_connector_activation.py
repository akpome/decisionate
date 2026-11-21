import json
import unittest
from unittest.mock import patch

from fastapi import BackgroundTasks, HTTPException, Request
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.database import Base
from app.db.models import DataSourceConnection, Dataset, OAuthCredential, utc_now
from app.modules.auth_context import AuthContext
from app.modules.datasets import router
from app.modules.datasets.schemas import DataSourceConnectionCreate, DataSourceConnectionUpdate
from app.modules.oauth.router import get_workspace_connection


class ConnectorActivationTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        self.addCleanup(engine.dispose)
        Base.metadata.create_all(engine)
        self.sessions = sessionmaker(bind=engine)
        self.enterContext(patch.object(router, "SessionLocal", self.sessions))
        self.request = self.workspace_request("workspace")

    def workspace_request(self, workspace):
        request = Request({"type": "http", "headers": []})
        request.state._decisionate_auth_context = AuthContext("owner", workspace, "owner")
        return request

    def add_connection(self, source="shopify", *, config=None, user="owner", workspace="workspace", **kwargs):
        with self.sessions() as db:
            row = DataSourceConnection(
                source_type=source, display_name=source, user_id=user, workspace_id=workspace,
                connection_config=json.dumps(config or {}), **kwargs,
            )
            db.add(row)
            db.commit()
            return row.id

    async def list_ids(self, request=None):
        return {row["id"] for row in await router.get_source_connections(request or self.request)}

    async def test_new_workspace_and_old_empty_drafts_stay_off_without_creating_rows(self):
        self.assertEqual(await self.list_ids(), set())
        self.add_connection()
        self.add_connection("stripe", config={"sync_enabled": False, "_migration_marker": True})
        self.add_connection("google_ads", status="needs_setup")
        self.assertEqual(await self.list_ids(), set())
        with self.sessions() as db:
            self.assertEqual(db.query(DataSourceConnection).count(), 3)

    async def test_switching_on_reuses_and_activates_only_the_selected_draft(self):
        selected_id = self.add_connection()
        self.add_connection("stripe")
        payload = DataSourceConnectionCreate(source_type="shopify")
        response = await router.create_source_connection(self.request, payload)
        self.assertEqual(response["id"], selected_id)
        self.assertFalse(response["has_config"])
        self.assertEqual(await self.list_ids(), {selected_id})
        await router.update_source_connection(self.request, selected_id, DataSourceConnectionUpdate(connection_config={}))
        self.assertEqual(await self.list_ids(), {selected_id})
        await router.create_source_connection(self.request, payload)
        with self.sessions() as db:
            self.assertEqual(db.query(DataSourceConnection).count(), 2)
            config = json.loads(db.get(DataSourceConnection, selected_id).connection_config)
            self.assertIs(config.get(router.CONNECTOR_ADDED_KEY), True)
        await router.delete_source_connection(self.request, selected_id)
        self.assertEqual(await self.list_ids(), set())

    async def test_legacy_config_authorization_history_and_imported_data_are_kept(self):
        configured = self.add_connection(config={"shop_domain": "example.myshopify.com"})
        authorized = self.add_connection("google_analytics", status="connected")
        synced = self.add_connection("google_ads", last_synced_at=utc_now())
        data = self.add_connection("meta_ads")
        credential = self.add_connection("xero")
        with self.sessions() as db:
            db.add(Dataset(user_id="owner", workspace_id="workspace", source_type="meta_ads",
                           source_config=json.dumps({"connection_id": data}),
                           file_name="meta.parquet", file_path="meta.parquet", row_count=1, column_count=1))
            db.add(OAuthCredential(connection_id=credential, source_type="xero", workspace_id="workspace"))
            db.commit()
        self.assertEqual(await self.list_ids(), {configured, authorized, synced, data, credential})

    async def test_legacy_personal_connection_does_not_appear_or_get_reused_in_a_client_workspace(self):
        personal = self.add_connection(workspace=None, status="connected")
        self.add_connection(workspace=None, user="another", status="connected")
        legacy_snapshot = self.add_connection("meta_ads", workspace=None)
        with self.sessions() as db:
            db.add(Dataset(user_id="owner", source_type="meta_ads",
                           source_config=json.dumps({"connection_id": legacy_snapshot}), file_name="old.parquet",
                           file_path="old.parquet", row_count=1, column_count=1))
            db.commit()
        self.assertEqual(await self.list_ids(self.workspace_request("owner")), {personal, legacy_snapshot})
        self.assertEqual(await self.list_ids(), set())
        auth = self.request.state._decisionate_auth_context
        with self.sessions() as db, self.assertRaises(HTTPException) as error:
            get_workspace_connection(db, personal, auth)
        self.assertEqual(error.exception.status_code, 404)
        selected = await router.create_source_connection(self.request, DataSourceConnectionCreate(source_type="shopify"))
        self.assertNotEqual(selected["id"], personal)
        self.assertEqual(await self.list_ids(), {selected["id"]})

    async def test_scheduler_ignores_placeholder_even_with_platform_credentials(self):
        placeholder = self.add_connection("stripe", config={"sync_enabled": True})
        with self.sessions() as db, patch.object(
            router, "has_source_connection_credentials", return_value=True
        ), patch.object(router, "enqueue_connector_ingestion_job") as enqueue:
            result = router.queue_due_source_connection(db, db.get(DataSourceConnection, placeholder), BackgroundTasks(), utc_now())
            self.assertIsNone(result)
            enqueue.assert_not_called()
