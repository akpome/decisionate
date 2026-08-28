import unittest
import asyncio
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pandas as pd
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.sql.elements import BooleanClauseList

from app.db.models import DataSourceConnection
from app.modules.datasets.router import (
    build_dataset_upload_path,
    build_dataset_share_result,
    build_dataset_share_status,
    build_dataset_details_response,
    build_dataset_summary_response,
    build_source_connection_response,
    build_source_connection_status,
    cleanup_deleted_dataset_preferences,
    create_source_connection,
    delete_source_connection,
    ensure_dataset_share_token,
    filter_source_connections_for_workspace,
    generate_share_token,
    get_dataset_upload_dir,
    has_source_connection_config,
    remove_dataset_preference_entry,
    remove_dataset_file,
    sanitize_source_connection_config,
    sanitize_source_connection_display_name,
    update_source_connection,
    upload_dataset,
)
from app.modules.datasets.schemas import (
    DataSourceConnectionCreate,
    DataSourceConnectionUpdate,
)
from app.modules.datasets.services.sources import (
    DATASET_SOURCE_ENV_KEYS,
    get_dataset_source,
    is_dataset_source_available,
    list_dataset_sources,
    normalize_dataset_source_type,
)
from app.modules.datasets.services.file_loader import (
    build_upload_source_config,
    get_dataset_file_type,
    get_filename_extension,
    infer_dataset_source_type,
    load_dataset_file,
    sanitize_upload_filename,
    validate_dataset_dataframe,
)
from app.modules.datasets.services.analytics_engine import (
    AnalyticsEngineConfig,
)
from app.modules.datasets.services.analytics_storage import (
    build_bigquery_table_id,
    build_dataset_analytics_manifest,
    build_dataset_parquet_path,
    build_dataset_table_name,
    build_workspace_namespace,
)
from app.modules.datasets.services.source_metadata import (
    build_dataset_source_metadata,
)


class FakeShareDb:
    def __init__(
        self,
        failures_before_success=0,
    ):
        self.failures_before_success = failures_before_success
        self.commit_count = 0
        self.refresh_count = 0
        self.rollback_count = 0

    def commit(self):
        self.commit_count += 1

        if self.commit_count <= self.failures_before_success:
            raise IntegrityError(
                "INSERT",
                {},
                Exception("duplicate token"),
            )

    def refresh(self, dataset):
        self.refresh_count += 1

    def rollback(self):
        self.rollback_count += 1


class FakePreferenceQuery:
    def __init__(
        self,
        preferences,
    ):
        self.preferences = preferences

    def filter(
        self,
        *args,
    ):
        return self

    def all(self):
        return self.preferences


class FakePreferenceDb:
    def __init__(
        self,
        preferences,
    ):
        self.preferences = preferences

    def query(
        self,
        model,
    ):
        return FakePreferenceQuery(
            self.preferences,
        )


class FakeFailingUploadDb:
    def __init__(self):
        self.closed = False
        self.added = []

    def add(self, item):
        self.added.append(
            item,
        )

    def commit(self):
        raise RuntimeError(
            "database unavailable"
        )

    def refresh(self, item):
        return None

    def close(self):
        self.closed = True


class DatasetSharingTests(unittest.TestCase):
    def build_memory_source_connection_session_factory(self):
        engine = create_engine(
            "sqlite:///:memory:",
        )
        DataSourceConnection.__table__.create(
            engine,
        )

        return sessionmaker(
            bind=engine,
        )

    def test_get_dataset_upload_dir_uses_default(self):
        with patch.dict(
            "os.environ",
            {},
            clear=True,
        ):
            self.assertEqual(
                get_dataset_upload_dir(),
                "uploads",
            )

    def test_get_dataset_upload_dir_uses_environment_value(self):
        with patch.dict(
            "os.environ",
            {
                "DATASET_UPLOAD_DIR": "custom-uploads",
            },
        ):
            self.assertEqual(
                get_dataset_upload_dir(),
                "custom-uploads",
            )

    def test_get_dataset_upload_dir_uses_default_for_blank_environment_value(self):
        with patch.dict(
            "os.environ",
            {
                "DATASET_UPLOAD_DIR": "   ",
            },
            clear=True,
        ):
            self.assertEqual(
                get_dataset_upload_dir(),
                "uploads",
            )

    def test_build_dataset_upload_path_strips_directory_components(self):
        with patch.dict(
            "os.environ",
            {
                "DATASET_UPLOAD_DIR": "uploads",
            },
        ):
            with patch(
                "app.modules.datasets.router.uuid.uuid4",
                return_value="fixed-id",
            ):
                upload_path = build_dataset_upload_path(
                    "../../danger.csv",
                )

        self.assertEqual(
            upload_path,
            "uploads/fixed-id-danger.csv",
        )

    def test_build_dataset_upload_path_strips_windows_directory_components(self):
        with patch.dict(
            "os.environ",
            {
                "DATASET_UPLOAD_DIR": "uploads",
            },
        ):
            with patch(
                "app.modules.datasets.router.uuid.uuid4",
                return_value="fixed-id",
            ):
                upload_path = build_dataset_upload_path(
                    r"..\danger.csv",
                )

        self.assertEqual(
            upload_path,
            "uploads/fixed-id-danger.csv",
        )

    def test_build_dataset_upload_path_uses_default_filename(self):
        with patch.dict(
            "os.environ",
            {
                "DATASET_UPLOAD_DIR": "uploads",
            },
        ):
            with patch(
                "app.modules.datasets.router.uuid.uuid4",
                return_value="fixed-id",
            ):
                upload_path = build_dataset_upload_path(
                    None,
                )

        self.assertEqual(
            upload_path,
            "uploads/fixed-id-dataset.csv",
        )

    def test_sanitize_upload_filename_handles_empty_and_windows_paths(self):
        self.assertEqual(
            sanitize_upload_filename(
                None,
            ),
            "dataset.csv",
        )
        self.assertEqual(
            sanitize_upload_filename(
                r"C:\exports\sales.csv",
            ),
            "sales.csv",
        )
        self.assertEqual(
            sanitize_upload_filename(
                "  sales.csv  ",
            ),
            "sales.csv",
        )

    def test_sanitize_upload_filename_rejects_path_sentinel_names(self):
        for filename in (
            "",
            ".",
            "..",
            "  ..  ",
        ):
            with self.subTest(
                filename=filename,
            ):
                self.assertEqual(
                    sanitize_upload_filename(
                        filename,
                    ),
                    "dataset.csv",
                )

    def test_filename_extension_uses_basename_without_defaulting(self):
        self.assertEqual(
            get_filename_extension(
                r"..\sales.JSONL",
            ),
            ".jsonl",
        )
        self.assertEqual(
            get_filename_extension(
                None,
            ),
            "",
        )
        self.assertEqual(
            get_filename_extension(
                "..",
            ),
            "",
        )
        self.assertIsNone(
            get_dataset_file_type(
                None,
            )
        )

    def test_remove_dataset_file_ignores_empty_path(self):
        with patch(
            "app.modules.datasets.router.os.remove",
        ) as remove_file:
            remove_dataset_file(
                None,
            )

        remove_file.assert_not_called()

    def test_remove_dataset_file_ignores_missing_file(self):
        with patch(
            "app.modules.datasets.router.os.remove",
            side_effect=FileNotFoundError(),
        ) as remove_file:
            remove_dataset_file(
                "missing.csv",
            )

        remove_file.assert_called_once_with(
            "missing.csv",
        )

    def test_remove_dataset_file_removes_existing_file(self):
        with patch(
            "app.modules.datasets.router.os.remove",
        ) as remove_file:
            remove_dataset_file(
                "uploads/data.csv",
            )

        remove_file.assert_called_once_with(
            "uploads/data.csv",
        )

    def test_build_dataset_summary_response_defaults_source_type(self):
        dataset = SimpleNamespace(
            id=7,
            user_id="user-1",
            workspace_id="workspace-1",
            source_type=None,
            source_config=None,
            file_name="sales.csv",
            row_count=10,
            column_count=3,
            created_at="today",
        )

        self.assertEqual(
            build_dataset_summary_response(
                dataset,
            ),
            {
                "id": 7,
                "user_id": "user-1",
                "workspace_id": "workspace-1",
                "source_type": "csv",
                "source_label": "CSV",
                "source_config": None,
                "file_name": "sales.csv",
                "row_count": 10,
                "column_count": 3,
                "analytics": {
                    "engine": "duckdb",
                    "storage_format": "parquet",
                    "workspace_namespace": "workspace_1",
                    "table_name": "dataset_7",
                    "parquet_path": (
                        "analytics/datasets/"
                        "workspace=workspace_1/"
                        "dataset_7.parquet"
                    ),
                    "bigquery_table_id": None,
                },
                "created_at": "today",
            },
        )

    def test_build_dataset_summary_response_preserves_external_source(self):
        dataset = SimpleNamespace(
            id=8,
            user_id="user-1",
            workspace_id="workspace-1",
            source_type="shopify",
            source_config='{"shop": "demo.myshopify.com"}',
            file_name="Shopify Orders",
            row_count=20,
            column_count=5,
            created_at="today",
        )

        self.assertEqual(
            build_dataset_summary_response(
                dataset,
            )["source_type"],
            "shopify",
        )
        self.assertEqual(
            build_dataset_summary_response(
                dataset,
            )["source_label"],
            "Shopify",
        )

    def test_build_dataset_source_metadata_uses_registry_label(self):
        dataset = SimpleNamespace(
            source_type="json",
            source_config='{"ingestion_mode": "upload"}',
        )

        self.assertEqual(
            build_dataset_source_metadata(
                dataset,
            ),
            {
                "source_type": "json",
                "source_label": "JSON",
                "source_config": '{"ingestion_mode": "upload"}',
            },
        )

    def test_build_dataset_source_metadata_falls_back_for_unknown_source(self):
        dataset = SimpleNamespace(
            source_type="unknown_source",
            source_config=None,
        )

        self.assertEqual(
            build_dataset_source_metadata(
                dataset,
            ),
            {
                "source_type": "unknown_source",
                "source_label": "unknown_source",
                "source_config": None,
            },
        )

    def test_build_dataset_source_metadata_normalizes_source_type(self):
        dataset = SimpleNamespace(
            source_type=" CSV ",
            source_config=None,
        )

        self.assertEqual(
            build_dataset_source_metadata(
                dataset,
            ),
            {
                "source_type": "csv",
                "source_label": "CSV",
                "source_config": None,
            },
        )

    def test_build_dataset_source_metadata_defaults_missing_fields(self):
        self.assertEqual(
            build_dataset_source_metadata(
                SimpleNamespace()
            ),
            {
                "source_type": "csv",
                "source_label": "CSV",
                "source_config": None,
            },
        )

    def test_analytics_identifiers_are_portable(self):
        dataset = SimpleNamespace(
            id=42,
            user_id="user-1",
            workspace_id="  2026 Revenue Team! ",
        )

        self.assertEqual(
            build_workspace_namespace(
                dataset,
            ),
            "_2026_revenue_team",
        )
        self.assertEqual(
            build_dataset_table_name(
                dataset,
            ),
            "dataset_42",
        )

    def test_dataset_analytics_manifest_uses_portable_storage_paths(self):
        dataset = SimpleNamespace(
            id=42,
            user_id="user-1",
            workspace_id="Workspace A",
        )
        config = AnalyticsEngineConfig(
            engine="duckdb",
            duckdb_path="analytics/local.duckdb",
            analytics_storage_dir="analytics/datasets",
            storage_format="parquet",
            bigquery_project_id=None,
            bigquery_dataset=None,
            bigquery_location="US",
        )

        self.assertEqual(
            build_dataset_parquet_path(
                dataset,
                config,
            ),
            (
                "analytics/datasets/"
                "workspace=workspace_a/"
                "dataset_42.parquet"
            ),
        )
        self.assertEqual(
            build_dataset_analytics_manifest(
                dataset,
                config,
            ),
            {
                "engine": "duckdb",
                "storage_format": "parquet",
                "workspace_namespace": "workspace_a",
                "table_name": "dataset_42",
                "parquet_path": (
                    "analytics/datasets/"
                    "workspace=workspace_a/"
                    "dataset_42.parquet"
                ),
                "bigquery_table_id": None,
            },
        )

    def test_bigquery_table_id_uses_same_dataset_identity(self):
        dataset = SimpleNamespace(
            id=42,
            user_id="user-1",
            workspace_id="Workspace A",
        )
        config = AnalyticsEngineConfig(
            engine="bigquery",
            duckdb_path="analytics/local.duckdb",
            analytics_storage_dir="analytics/datasets",
            storage_format="parquet",
            bigquery_project_id="decisionate-prod",
            bigquery_dataset="analytics",
            bigquery_location="US",
        )

        self.assertEqual(
            build_bigquery_table_id(
                dataset,
                config,
            ),
            (
                "decisionate-prod.analytics."
                "workspace_a_dataset_42"
            ),
        )

    def test_build_dataset_details_response_includes_analytics_manifest(self):
        dataset = SimpleNamespace(
            id=7,
            user_id="user-1",
            workspace_id="workspace-1",
            source_type="csv",
            source_config=None,
            file_name="sales.csv",
            row_count=1,
            column_count=2,
            created_at="today",
        )
        dataframe = pd.DataFrame({
            "month": [
                "Jan",
            ],
            "revenue": [
                10,
            ],
        })

        response = build_dataset_details_response(
            dataset,
            dataframe,
        )

        self.assertEqual(
            response["analytics"]["table_name"],
            "dataset_7",
        )
        self.assertEqual(
            response["preview"][0]["revenue"],
            10,
        )
        self.assertEqual(
            response["metrics"][0]["column"],
            "revenue",
        )
        self.assertEqual(
            response["chart"]["y_key"],
            "revenue",
        )

    def test_list_dataset_sources_includes_mvp_sources(self):
        sources = list_dataset_sources()
        source_types = {
            source["type"]
            for source in sources
        }

        self.assertEqual(
            sources[0]["type"],
            "csv",
        )
        self.assertEqual(
            sources[0]["status"],
            "available",
        )

        for source_type in [
            "excel",
            "json",
            "parquet",
            "google_analytics",
            "postgresql",
            "mysql",
            "sql_server",
            "stripe",
            "shopify",
            "quickbooks",
            "freshbooks",
            "hubspot",
            "google_drive",
            "onedrive",
            "meta_ads",
        ]:
            self.assertIn(source_type, source_types)

    def test_get_dataset_source_returns_metadata_copy(self):
        source = get_dataset_source(
            "google_analytics",
        )

        self.assertEqual(
            source["connection_type"],
            "oauth",
        )
        self.assertIn("scheduled", source["sync_modes"])

        source["sync_modes"].append(
            "changed",
        )
        source["config_keys"].append(
            "changed",
        )

        self.assertNotIn(
            "changed",
            get_dataset_source(
                "google_analytics",
            )["sync_modes"],
        )
        self.assertNotIn(
            "changed",
            get_dataset_source(
                "google_analytics",
            )["config_keys"],
            )

    def test_quickbooks_company_id_is_discovered_by_oauth(self):
        source = get_dataset_source("quickbooks")

        self.assertEqual(source["connection_type"], "oauth")
        self.assertEqual(source["config_keys"], ["resource_types"])

    def test_sage_business_id_is_discovered_by_oauth(self):
        source = get_dataset_source("sage")

        self.assertEqual(source["connection_type"], "oauth")
        self.assertEqual(source["config_keys"], [])

    def test_freshbooks_exposes_resource_selector(self):
        source = get_dataset_source("freshbooks")

        self.assertEqual(source["connection_type"], "oauth")
        self.assertEqual(source["config_keys"], ["resource_types"])

    def test_dataset_source_registry_excludes_deferred_connectors(self):
        sources = {
            source["type"]: source
            for source in list_dataset_sources()
        }

        for source_type in [
            "snowflake",
            "bigquery",
            "gcs",
            "azure_blob_storage",
            "s3",
            "pipedrive",
            "mailchimp",
            "marketing_platform",
            "rest_api",
            "webhook",
        ]:
            self.assertNotIn(source_type, sources)

    def test_dataset_source_availability_tracks_status(self):
        self.assertTrue(
            is_dataset_source_available(
                "csv",
            )
        )
        self.assertTrue(
            is_dataset_source_available(
                "json",
            )
        )
        self.assertFalse(
            is_dataset_source_available(
                "shopify",
            )
        )
        self.assertIsNone(
            get_dataset_source(
                "unknown",
            )
        )

    def test_dataset_source_type_normalization_handles_case_and_blanks(self):
        self.assertEqual(
            normalize_dataset_source_type(
                " Shopify ",
            ),
            "shopify",
        )
        self.assertEqual(
            normalize_dataset_source_type(
                "",
            ),
            "csv",
        )
        self.assertEqual(
            get_dataset_source(
                " PARQUET ",
            )["type"],
            "parquet",
        )
        self.assertTrue(
            is_dataset_source_available(
                " CSV ",
            )
        )

    def test_dataset_source_type_normalization_handles_non_strings(self):
        for value in (
            None,
            123,
            object(),
        ):
            with self.subTest(
                value=value,
            ):
                self.assertEqual(
                    normalize_dataset_source_type(
                        value,
                    ),
                    "csv",
                )

    def test_dataset_source_reports_missing_connector_environment(self):
        with patch.dict(
            "os.environ",
            {},
            clear=True,
        ):
            source = get_dataset_source(
                "shopify",
            )

        self.assertFalse(
            source["environment_configured"],
        )
        self.assertEqual(
            source["configured_environment_keys"],
            [],
        )
        self.assertIn(
            "SHOPIFY_CLIENT_ID",
            source["environment_keys"],
        )

    def test_dataset_source_ignores_blank_connector_environment_values(self):
        with patch.dict(
            "os.environ",
            {
                "SHOPIFY_CLIENT_ID": "client-id",
                "SHOPIFY_CLIENT_SECRET": "   ",
            },
            clear=True,
        ):
            source = get_dataset_source(
                "shopify",
            )

        self.assertFalse(
            source["environment_configured"],
        )
        self.assertEqual(
            source["configured_environment_keys"],
            [
                "SHOPIFY_CLIENT_ID",
            ],
        )

    def test_dataset_source_reports_configured_connector_environment(self):
        with patch.dict(
            "os.environ",
            {
                "SHOPIFY_CLIENT_ID": "client-id",
                "SHOPIFY_CLIENT_SECRET": "client-secret",
            },
            clear=True,
        ):
            source = get_dataset_source(
                "shopify",
            )

        self.assertTrue(
            source["environment_configured"],
        )
        self.assertEqual(
            source["configured_environment_keys"],
            [
                "SHOPIFY_CLIENT_ID",
                "SHOPIFY_CLIENT_SECRET",
            ],
        )

    def test_connector_environment_keys_are_documented_in_env_example(self):
        env_example_path = (
            Path(__file__).resolve().parents[1]
            / ".env.example"
        )
        env_example = env_example_path.read_text()

        for env_keys in DATASET_SOURCE_ENV_KEYS.values():
            for env_key in env_keys:
                self.assertIn(
                    f"{env_key}=",
                    env_example,
                )

    def test_file_source_status_tracks_optional_dependencies(self):
        with patch(
            "app.modules.datasets.services.file_loader.is_optional_module_available",
            return_value=False,
        ):
            source = get_dataset_source(
                "parquet",
            )

        self.assertEqual(
            source["status"],
            "needs_setup",
        )
        self.assertIn(
            "pyarrow",
            source["optional_dependencies"],
        )
        self.assertIn(
            "Install one of",
            source["availability_note"],
        )

        with patch(
            "app.modules.datasets.services.file_loader.is_optional_module_available",
            return_value=True,
        ):
            source = get_dataset_source(
                "parquet",
            )

        self.assertEqual(
            source["status"],
            "available",
        )

    def test_build_source_connection_status_rejects_unknown_source(self):
        with self.assertRaises(
            HTTPException,
        ) as context:
            build_source_connection_status(
                "unknown",
            )

        self.assertEqual(
            context.exception.status_code,
            400,
        )

    def test_build_source_connection_status_marks_unconfigured_sources(self):
        self.assertEqual(
            build_source_connection_status(
                "csv",
            ),
            "draft",
        )
        self.assertEqual(
            build_source_connection_status(
                "shopify",
            ),
            "needs_setup",
        )

    def test_build_source_connection_status_normalizes_source_type(self):
        self.assertEqual(
            build_source_connection_status(
                " CSV ",
            ),
            "draft",
        )
        self.assertEqual(
            build_source_connection_status(
                " Shopify ",
            ),
            "needs_setup",
        )

    def test_create_source_connection_route_stores_normalized_source_type(self):
        Session = self.build_memory_source_connection_session_factory()

        with patch(
            "app.modules.datasets.router.SessionLocal",
            Session,
        ), patch(
            "app.modules.datasets.router.get_user_id",
            return_value="user-1",
        ), patch(
            "app.modules.datasets.router.get_workspace_id",
            return_value="workspace-1",
        ):
            first_response = asyncio.run(
                create_source_connection(
                    SimpleNamespace(),
                    DataSourceConnectionCreate(
                        source_type=" Shopify ",
                        display_name=" Demo store ",
                        connection_config={
                            "shop_domain": "demo.myshopify.com",
                        },
                    ),
                )
            )
            second_response = asyncio.run(
                create_source_connection(
                    SimpleNamespace(),
                    DataSourceConnectionCreate(
                        source_type="shopify",
                        display_name="Duplicate store",
                    ),
                )
            )

        db = Session()

        try:
            connections = db.query(DataSourceConnection).all()

            self.assertEqual(
                len(connections),
                1,
            )
            self.assertEqual(
                connections[0].source_type,
                "shopify",
            )
            self.assertEqual(
                connections[0].display_name,
                "Demo store",
            )
            self.assertEqual(
                first_response["id"],
                second_response["id"],
            )
            self.assertEqual(
                first_response["source_type"],
                "shopify",
            )
            self.assertTrue(
                first_response["has_config"],
            )

        finally:
            db.close()

    def test_update_source_connection_route_trims_and_clears_config(self):
        Session = self.build_memory_source_connection_session_factory()
        db = Session()

        try:
            connection = DataSourceConnection(
                id=1,
                user_id="user-1",
                workspace_id="workspace-1",
                source_type="shopify",
                display_name="Demo store",
                status="planned",
                connection_config='{"shop_domain": "old.myshopify.com"}',
            )
            db.add(
                connection,
            )
            db.commit()

        finally:
            db.close()

        with patch(
            "app.modules.datasets.router.SessionLocal",
            Session,
        ), patch(
            "app.modules.datasets.router.get_user_id",
            return_value="user-1",
        ), patch(
            "app.modules.datasets.router.get_workspace_id",
            return_value="workspace-1",
        ):
            response = asyncio.run(
                update_source_connection(
                    SimpleNamespace(),
                    1,
                    DataSourceConnectionUpdate(
                        display_name=" Updated store ",
                        connection_config={
                            "shop_domain": "  new.myshopify.com  ",
                        },
                    ),
                )
            )

        db = Session()

        try:
            connection = db.query(DataSourceConnection).one()

            self.assertEqual(
                connection.display_name,
                "Updated store",
            )
            self.assertEqual(
                connection.connection_config,
                '{"shop_domain": "new.myshopify.com"}',
            )
            self.assertTrue(
                response["has_config"],
            )

        finally:
            db.close()

        with patch(
            "app.modules.datasets.router.SessionLocal",
            Session,
        ), patch(
            "app.modules.datasets.router.get_user_id",
            return_value="user-1",
        ), patch(
            "app.modules.datasets.router.get_workspace_id",
            return_value="workspace-1",
        ):
            response = asyncio.run(
                update_source_connection(
                    SimpleNamespace(),
                    1,
                    DataSourceConnectionUpdate(
                        connection_config={},
                    ),
                )
            )

        db = Session()

        try:
            connection = db.query(DataSourceConnection).one()

            self.assertIsNone(
                connection.connection_config,
            )
            self.assertFalse(
                response["has_config"],
            )

        finally:
            db.close()

    def test_delete_source_connection_route_rejects_inaccessible_connection(self):
        Session = self.build_memory_source_connection_session_factory()
        db = Session()

        try:
            db.add(
                DataSourceConnection(
                    id=1,
                    user_id="user-2",
                    workspace_id=None,
                    source_type="shopify",
                    display_name="Other store",
                    status="planned",
                )
            )
            db.commit()

        finally:
            db.close()

        with patch(
            "app.modules.datasets.router.SessionLocal",
            Session,
        ), patch(
            "app.modules.datasets.router.get_user_id",
            return_value="user-1",
        ), patch(
            "app.modules.datasets.router.get_workspace_id",
            return_value="workspace-1",
        ):
            with self.assertRaises(HTTPException) as context:
                asyncio.run(
                    delete_source_connection(
                        SimpleNamespace(),
                        1,
                    )
                )

        self.assertEqual(
            context.exception.status_code,
            404,
        )

    def test_build_source_connection_status_marks_sources_needing_setup(self):
        with patch(
            "app.modules.datasets.services.file_loader.is_optional_module_available",
            return_value=False,
        ):
            self.assertEqual(
                build_source_connection_status(
                    "parquet",
                ),
                "needs_setup",
            )

    def test_sanitize_source_connection_display_name_uses_fallback(self):
        self.assertEqual(
            sanitize_source_connection_display_name(
                None,
                "Shopify",
            ),
            "Shopify",
        )

    def test_sanitize_source_connection_display_name_trims_value(self):
        self.assertEqual(
            sanitize_source_connection_display_name(
                "  Demo store  ",
            ),
            "Demo store",
        )

    def test_sanitize_source_connection_display_name_rejects_blank_value(self):
        with self.assertRaises(
            HTTPException,
        ) as context:
            sanitize_source_connection_display_name(
                "   ",
            )

        self.assertEqual(
            context.exception.status_code,
            400,
        )

    def test_sanitize_source_connection_display_name_rejects_non_string_value(self):
        with self.assertRaises(
            HTTPException,
        ) as context:
            sanitize_source_connection_display_name(
                123,
            )

        self.assertEqual(
            context.exception.status_code,
            400,
        )
        self.assertEqual(
            context.exception.detail,
            "Connection name must be text",
        )

    def test_infer_dataset_source_type_handles_supported_uploads(self):
        self.assertEqual(
            infer_dataset_source_type(
                "sales.CSV",
            ),
            "csv",
        )
        self.assertEqual(
            infer_dataset_source_type(
                "events.jsonl",
            ),
            "json",
        )
        self.assertEqual(
            infer_dataset_source_type(
                "warehouse.pq",
            ),
            "parquet",
        )
        self.assertEqual(
            infer_dataset_source_type(
                "forecast.xlsx",
            ),
            "excel",
        )
        self.assertIsNone(
            infer_dataset_source_type(
                "notes.txt",
            )
        )

    def test_build_upload_source_config_records_file_metadata(self):
        self.assertEqual(
            build_upload_source_config(
                r"..\sales.JSONL",
            ),
            {
                "ingestion_mode": "upload",
                "original_file_name": "sales.JSONL",
                "file_extension": ".jsonl",
                "file_format": "json",
            },
        )
        self.assertEqual(
            build_upload_source_config(
                None,
            ),
            {
                "ingestion_mode": "upload",
                "original_file_name": "dataset.csv",
                "file_extension": ".csv",
                "file_format": "csv",
            },
        )

    def test_upload_dataset_removes_uploaded_file_when_database_write_fails(self):
        upload_path = Path(
            "/tmp/decisionate-upload-cleanup.csv"
        )
        upload_path.unlink(
            missing_ok=True,
        )
        fake_db = FakeFailingUploadDb()

        try:
            with patch(
                "app.modules.datasets.router.get_user_id",
                return_value="user-1",
            ), patch(
                "app.modules.datasets.router.get_workspace_id",
                return_value="workspace-1",
            ), patch(
                "app.modules.datasets.router.build_dataset_upload_path",
                return_value=str(upload_path),
            ), patch(
                "app.modules.datasets.router.load_dataset_file",
                return_value=(
                    "csv",
                    pd.DataFrame({
                        "revenue": [
                            10,
                        ],
                    }),
                ),
            ), patch(
                "app.modules.datasets.router.SessionLocal",
                return_value=fake_db,
            ):
                with self.assertRaises(
                    RuntimeError,
                ):
                    asyncio.run(
                        upload_dataset(
                            SimpleNamespace(),
                            SimpleNamespace(
                                filename=r"..\sales.csv",
                                file=BytesIO(
                                    b"revenue\n10\n"
                                ),
                            ),
                        )
                    )

            self.assertFalse(
                upload_path.exists(),
            )
            self.assertTrue(
                fake_db.closed,
            )
            self.assertEqual(
                len(fake_db.added),
                1,
            )
            self.assertEqual(
                fake_db.added[0].file_name,
                "sales.csv",
            )

        finally:
            upload_path.unlink(
                missing_ok=True,
            )

    def test_load_dataset_file_uses_matching_reader(self):
        dataframe = pd.DataFrame({
            "revenue": [
                10,
            ],
        })
        file_type = get_dataset_file_type(
            "sales.csv"
        )
        original_reader = file_type["reader"]
        file_type["reader"] = lambda path: dataframe

        try:
            source_type, result = load_dataset_file(
                "uploads/sales.csv",
                "sales.csv",
            )
        finally:
            file_type["reader"] = original_reader

        self.assertEqual(
            source_type,
            "csv",
        )
        self.assertIs(
            result,
            dataframe,
        )

    def test_load_dataset_file_rejects_unknown_extension(self):
        with self.assertRaises(
            HTTPException,
        ) as context:
            load_dataset_file(
                "uploads/notes.txt",
                "notes.txt",
            )

        self.assertEqual(
            context.exception.status_code,
            400,
        )

    def test_load_dataset_file_wraps_reader_errors(self):
        file_type = get_dataset_file_type(
            "sales.csv"
        )
        original_reader = file_type["reader"]

        def fail_reader(path):
            raise ValueError(
                "raw parser failure"
            )

        file_type["reader"] = fail_reader

        try:
            with self.assertRaises(
                HTTPException,
            ) as context:
                load_dataset_file(
                    "uploads/sales.csv",
                    "sales.csv",
                )
        finally:
            file_type["reader"] = original_reader

        self.assertEqual(
            context.exception.status_code,
            400,
        )
        self.assertEqual(
            context.exception.detail,
            "Uploaded file could not be read as CSV",
        )

    def test_load_dataset_file_returns_not_found_for_missing_file(self):
        file_type = get_dataset_file_type(
            "sales.csv"
        )
        original_reader = file_type["reader"]

        def fail_reader(path):
            raise FileNotFoundError(
                path
            )

        file_type["reader"] = fail_reader

        try:
            with self.assertRaises(
                HTTPException,
            ) as context:
                load_dataset_file(
                    "uploads/missing.csv",
                    "sales.csv",
                )
        finally:
            file_type["reader"] = original_reader

        self.assertEqual(
            context.exception.status_code,
            404,
        )
        self.assertEqual(
            context.exception.detail,
            "Dataset file not found",
        )

    def test_validate_dataset_dataframe_rejects_empty_rows(self):
        with self.assertRaises(
            HTTPException,
        ) as context:
            validate_dataset_dataframe(
                pd.DataFrame(
                    columns=["revenue"]
                )
            )

        self.assertEqual(
            context.exception.status_code,
            400,
        )
        self.assertEqual(
            context.exception.detail,
            "Uploaded file did not contain any rows",
        )

    def test_validate_dataset_dataframe_rejects_empty_columns(self):
        with self.assertRaises(
            HTTPException,
        ) as context:
            validate_dataset_dataframe(
                pd.DataFrame()
            )

        self.assertEqual(
            context.exception.status_code,
            400,
        )
        self.assertEqual(
            context.exception.detail,
            "Uploaded file did not contain any columns",
        )

    def test_validate_dataset_dataframe_rejects_non_dataframe(self):
        with self.assertRaises(
            HTTPException,
        ) as context:
            validate_dataset_dataframe(
                [
                    {
                        "revenue": 10,
                    },
                ]
            )

        self.assertEqual(
            context.exception.status_code,
            400,
        )
        self.assertEqual(
            context.exception.detail,
            "Uploaded file did not produce a tabular dataset",
        )

    def test_build_source_connection_response_redacts_config(self):
        connection = SimpleNamespace(
            id=3,
            user_id="user-1",
            workspace_id="workspace-1",
            source_type="shopify",
            display_name="Demo store",
            status="planned",
            connection_config='{"token": "secret"}',
            last_synced_at=None,
            created_at="today",
            updated_at="today",
        )

        response = build_source_connection_response(
            connection,
        )

        self.assertEqual(
            response["source_label"],
            "Shopify",
        )
        self.assertEqual(
            response["source_status"],
            "planned",
        )
        self.assertFalse(
            response["environment_configured"],
        )
        self.assertTrue(
            response["has_config"],
        )
        self.assertNotIn(
            "environment_keys",
            response,
        )
        self.assertNotIn(
            "configured_environment_keys",
            response,
        )
        self.assertNotIn(
            "connection_config",
            response,
        )

    def test_build_source_connection_response_uses_saved_provider_credentials(self):
        connection = SimpleNamespace(
            id=3,
            user_id="user-1",
            workspace_id="workspace-1",
            source_type="shopify",
            display_name="Demo store",
            status="planned",
            connection_config=(
                '{"SHOPIFY_CLIENT_ID": "client-id", '
                '"SHOPIFY_CLIENT_SECRET": "client-secret", '
                '"SHOPIFY_WEBHOOK_SECRET": "webhook-secret", '
                '"shop_domain": "demo.myshopify.com"}'
            ),
            last_synced_at=None,
            created_at="today",
            updated_at="today",
        )

        response = build_source_connection_response(
            connection,
        )

        self.assertTrue(
            response["environment_configured"],
        )
        self.assertTrue(
            response["has_config"],
        )
        self.assertNotIn(
            "connection_config",
            response,
        )

    def test_has_source_connection_config_ignores_blank_values(self):
        self.assertFalse(
            has_source_connection_config(
                None,
            )
        )
        self.assertFalse(
            has_source_connection_config(
                "   ",
            )
        )
        self.assertFalse(
            has_source_connection_config(
                {},
            )
        )
        self.assertFalse(
            has_source_connection_config(
                "{}",
            )
        )
        self.assertFalse(
            has_source_connection_config(
                '{"token": "   "}',
            )
        )
        self.assertFalse(
            has_source_connection_config(
                {
                    "token": "   ",
                },
            )
        )
        self.assertTrue(
            has_source_connection_config(
                '{"token": "secret"}',
            )
        )
        self.assertTrue(
            has_source_connection_config(
                {
                    "token": "secret",
                },
            )
        )
        self.assertTrue(
            has_source_connection_config(
                "{bad-json",
            )
        )
        self.assertTrue(
            has_source_connection_config(
                {
                    "enabled": False,
                },
            )
        )

    def test_build_source_connection_response_ignores_blank_config(self):
        connection = SimpleNamespace(
            id=3,
            user_id="user-1",
            workspace_id="workspace-1",
            source_type="shopify",
            display_name="Demo store",
            status="planned",
            connection_config="   ",
            last_synced_at=None,
            created_at="today",
            updated_at="today",
        )

        response = build_source_connection_response(
            connection,
        )

        self.assertFalse(
            response["has_config"],
        )

    def test_build_source_connection_response_normalizes_source_type(self):
        connection = SimpleNamespace(
            id=3,
            user_id="user-1",
            workspace_id="workspace-1",
            source_type=" Shopify ",
            display_name="Demo store",
            status="planned",
            connection_config=None,
            last_synced_at=None,
            created_at="today",
            updated_at="today",
        )

        response = build_source_connection_response(
            connection,
        )

        self.assertEqual(
            response["source_type"],
            "shopify",
        )
        self.assertEqual(
            response["source_label"],
            "Shopify",
        )

    def test_build_source_connection_response_falls_back_for_unknown_source(self):
        connection = SimpleNamespace(
            id=3,
            user_id="user-1",
            workspace_id="workspace-1",
            source_type=" Unknown_Source ",
            display_name="Unknown source",
            status="planned",
            connection_config=None,
            last_synced_at=None,
            created_at="today",
            updated_at="today",
        )

        response = build_source_connection_response(
            connection,
        )

        self.assertEqual(
            response["source_type"],
            "unknown_source",
        )
        self.assertEqual(
            response["source_label"],
            "unknown_source",
        )
        self.assertIsNone(
            response["source_status"],
        )

    def test_sanitize_source_connection_config_keeps_allowed_fields(self):
        source = get_dataset_source(
            "shopify",
        )

        self.assertEqual(
            sanitize_source_connection_config(
                source,
                {
                    "shop_domain": "demo.myshopify.com",
                },
            ),
            '{"shop_domain": "demo.myshopify.com"}',
        )

    def test_sanitize_source_connection_config_keeps_provider_credential_fields(self):
        source = get_dataset_source(
            "shopify",
        )

        self.assertEqual(
            sanitize_source_connection_config(
                source,
                {
                    "shop_domain": "demo.myshopify.com",
                    "SHOPIFY_CLIENT_ID": "client-id",
                    "SHOPIFY_CLIENT_SECRET": "client-secret",
                },
            ),
            (
                '{"SHOPIFY_CLIENT_ID": "client-id", '
                '"SHOPIFY_CLIENT_SECRET": "client-secret", '
                '"shop_domain": "demo.myshopify.com"}'
            ),
        )

    def test_sanitize_source_connection_config_keeps_scalar_values(self):
        source = {
            "config_keys": [
                "enabled",
            ],
        }

        self.assertEqual(
            sanitize_source_connection_config(
                source,
                {
                    "enabled": False,
                },
            ),
            '{"enabled": false}',
        )

    def test_sanitize_source_connection_config_trims_and_drops_blank_values(self):
        source = get_dataset_source(
            "shopify",
        )

        self.assertEqual(
            sanitize_source_connection_config(
                source,
                {
                    "shop_domain": "  demo.myshopify.com  ",
                },
            ),
            '{"shop_domain": "demo.myshopify.com"}',
        )
        self.assertIsNone(
            sanitize_source_connection_config(
                source,
                {
                    "shop_domain": "   ",
                },
            )
        )

    def test_sanitize_source_connection_config_trims_keys(self):
        source = get_dataset_source(
            "shopify",
        )

        self.assertEqual(
            sanitize_source_connection_config(
                source,
                {
                    " shop_domain ": "demo.myshopify.com",
                    "  ": "ignored",
                },
            ),
            '{"shop_domain": "demo.myshopify.com"}',
        )

    def test_sanitize_source_connection_config_rejects_non_object_config(self):
        source = get_dataset_source(
            "shopify",
        )

        with self.assertRaises(
            HTTPException,
        ) as context:
            sanitize_source_connection_config(
                source,
                [
                    "shop_domain",
                ],
            )

        self.assertEqual(
            context.exception.status_code,
            400,
        )
        self.assertEqual(
            context.exception.detail,
            "Connection config must be an object",
        )

    def test_sanitize_source_connection_config_rejects_unknown_fields(self):
        source = get_dataset_source(
            "shopify",
        )

        with self.assertRaises(
            HTTPException,
        ) as context:
            sanitize_source_connection_config(
                source,
                {
                    "access_token": "secret",
                },
            )

        self.assertEqual(
            context.exception.status_code,
            400,
        )

    def test_sanitize_source_connection_config_rejects_nested_values(self):
        source = get_dataset_source(
            "shopify",
        )

        with self.assertRaises(
            HTTPException,
        ) as context:
            sanitize_source_connection_config(
                source,
                {
                    "shop_domain": [
                        "demo.myshopify.com",
                    ],
                },
            )

        self.assertEqual(
            context.exception.status_code,
            400,
        )

    def test_sanitize_source_connection_config_rejects_non_finite_values(self):
        source = {
            "config_keys": [
                "limit",
            ],
        }

        with self.assertRaises(
            HTTPException,
        ) as context:
            sanitize_source_connection_config(
                source,
                {
                    "limit": float("nan"),
                },
            )

        self.assertEqual(
            context.exception.status_code,
            400,
        )

    def test_sanitize_source_connection_config_returns_none_for_empty_config(self):
        source = get_dataset_source(
            "csv",
        )

        self.assertIsNone(
            sanitize_source_connection_config(
                source,
                {},
            )
        )

    def test_data_source_connection_update_defaults_to_no_changes(self):
        payload = DataSourceConnectionUpdate()

        self.assertIsNone(
            payload.display_name,
        )
        self.assertIsNone(
            payload.connection_config,
        )

    def test_filter_source_connections_for_workspace_returns_clause(self):
        clause = filter_source_connections_for_workspace(
            "user-1",
            "workspace-1",
        )

        self.assertIsInstance(
            clause,
            BooleanClauseList,
        )

    def test_remove_dataset_preference_entry_removes_matching_dataset(self):
        self.assertEqual(
            remove_dataset_preference_entry(
                '{"7": {"revenue": 100}, "8": {"sales": 50}}',
                7,
            ),
            '{"8": {"sales": 50}}',
        )

    def test_remove_dataset_preference_entry_returns_none_when_empty(self):
        self.assertIsNone(
            remove_dataset_preference_entry(
                '{"7": {"revenue": 100}}',
                7,
            )
        )

    def test_remove_dataset_preference_entry_clears_invalid_json(self):
        self.assertIsNone(
            remove_dataset_preference_entry(
                "{invalid",
                7,
            )
        )

    def test_remove_dataset_preference_entry_clears_non_object_json(self):
        self.assertIsNone(
            remove_dataset_preference_entry(
                "[1, 2, 3]",
                7,
            )
        )

    def test_cleanup_deleted_dataset_preferences_clears_selected_dataset(self):
        preference = SimpleNamespace(
            selected_dataset_id=7,
            selected_metric="revenue",
            metric_targets='{"7": {"revenue": 100}}',
            dashboard_preferences='{"7": {"chartType": "line"}}',
        )
        dataset = SimpleNamespace(
            id=7,
            user_id="user-1",
            workspace_id="workspace-1",
        )

        cleanup_deleted_dataset_preferences(
            FakePreferenceDb(
                [
                    preference,
                ]
            ),
            dataset,
        )

        self.assertIsNone(
            preference.selected_dataset_id,
        )
        self.assertIsNone(
            preference.selected_metric,
        )
        self.assertIsNone(
            preference.metric_targets,
        )
        self.assertIsNone(
            preference.dashboard_preferences,
        )

    def test_generate_share_token_is_url_safe_and_long_enough(self):
        token = generate_share_token()

        self.assertGreaterEqual(
            len(token),
            32,
        )
        self.assertNotIn(
            "/",
            token,
        )
        self.assertNotIn(
            "+",
            token,
        )

    def test_share_result_includes_token_when_enabled(self):
        dataset = SimpleNamespace(
            id=7,
            share_token="token-123",
        )

        self.assertEqual(
            build_dataset_share_result(dataset),
            {
                "dataset_id": 7,
                "share_token": "token-123",
                "share_enabled": True,
            },
        )

    def test_share_status_omits_token(self):
        dataset = SimpleNamespace(
            id=7,
            share_token="token-123",
        )

        self.assertEqual(
            build_dataset_share_status(dataset),
            {
                "dataset_id": 7,
                "share_enabled": True,
            },
        )

    def test_ensure_share_token_reuses_existing_token(self):
        dataset = SimpleNamespace(
            share_token="existing-token",
        )
        db = FakeShareDb()

        ensure_dataset_share_token(
            db,
            dataset,
        )

        self.assertEqual(
            dataset.share_token,
            "existing-token",
        )
        self.assertEqual(
            db.commit_count,
            0,
        )

    def test_ensure_share_token_retries_after_collision(self):
        dataset = SimpleNamespace(
            share_token=None,
        )
        db = FakeShareDb(
            failures_before_success=1,
        )

        with patch(
            "app.modules.datasets.router.generate_share_token",
            side_effect=[
                "duplicate-token",
                "fresh-token",
            ],
        ):
            ensure_dataset_share_token(
                db,
                dataset,
            )

        self.assertEqual(
            dataset.share_token,
            "fresh-token",
        )
        self.assertEqual(
            db.commit_count,
            2,
        )
        self.assertEqual(
            db.rollback_count,
            1,
        )
        self.assertEqual(
            db.refresh_count,
            1,
        )

    def test_ensure_share_token_raises_after_repeated_collisions(self):
        dataset = SimpleNamespace(
            share_token=None,
        )
        db = FakeShareDb(
            failures_before_success=3,
        )

        with patch(
            "app.modules.datasets.router.generate_share_token",
            side_effect=[
                "duplicate-1",
                "duplicate-2",
                "duplicate-3",
            ],
        ):
            with self.assertRaises(HTTPException) as context:
                ensure_dataset_share_token(
                    db,
                    dataset,
                )

        self.assertEqual(
            context.exception.status_code,
            500,
        )
        self.assertEqual(
            db.rollback_count,
            3,
        )


if __name__ == "__main__":
    unittest.main()
