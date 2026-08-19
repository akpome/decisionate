import unittest
from pathlib import Path
from types import SimpleNamespace
from tempfile import TemporaryDirectory
from unittest.mock import MagicMock, patch

import pandas as pd
from fastapi import HTTPException

from app.modules.datasets.services.analytics_adapters import (
    AnalyticsAdapterUnavailable,
    BigQueryAnalyticsAdapter,
    DuckDBAnalyticsAdapter,
    get_analytics_adapter,
    load_dataset_dataframe,
)
from app.modules.datasets.services.analytics_engine import (
    AnalyticsEngineConfig,
    build_analytics_engine_status,
    get_analytics_engine_config,
    get_analytics_engine_name,
    get_analytics_storage_format,
    should_use_portable_analytics_storage,
)
from app.modules.datasets.services.analytics_storage import (
    build_dataset_analytics_manifest,
    build_bigquery_table_id,
    build_dataset_parquet_path,
    build_dataset_table_name,
    build_workspace_namespace,
    normalize_analytics_identifier,
    normalize_analytics_storage_dir,
)
from app.modules.datasets.services.dataset_loader import (
    load_dataframe_from_dataset,
)


class AnalyticsEngineTests(unittest.TestCase):
    def test_defaults_to_duckdb_with_parquet_storage(self):
        with patch.dict(
            "os.environ",
            {},
            clear=True,
        ):
            config = get_analytics_engine_config()

        self.assertEqual(
            config.engine,
            "duckdb",
        )
        self.assertEqual(
            config.storage_format,
            "parquet",
        )
        self.assertEqual(
            config.duckdb_path,
            "analytics/decisionate.duckdb",
        )
        self.assertEqual(
            config.analytics_storage_dir,
            "analytics/datasets",
        )

    def test_bigquery_config_uses_environment(self):
        with patch.dict(
            "os.environ",
            {
                "ANALYTICS_ENGINE": "bigquery",
                "BIGQUERY_PROJECT_ID": "decisionate-prod",
                "BIGQUERY_ANALYTICS_DATASET": "analytics",
                "BIGQUERY_LOCATION": "EU",
            },
            clear=True,
        ):
            config = get_analytics_engine_config()

        self.assertEqual(
            config.engine,
            "bigquery",
        )
        self.assertEqual(
            config.bigquery_project_id,
            "decisionate-prod",
        )
        self.assertEqual(
            config.bigquery_dataset,
            "analytics",
        )
        self.assertEqual(
            config.bigquery_location,
            "EU",
        )

    def test_analytics_engine_status_hides_credentials(self):
        config = AnalyticsEngineConfig(
            engine="bigquery",
            duckdb_path="analytics.duckdb",
            analytics_storage_dir="analytics/datasets",
            storage_format="parquet",
            bigquery_project_id="project",
            bigquery_dataset="dataset",
            bigquery_location="US",
        )

        self.assertEqual(
            build_analytics_engine_status(
                config,
            ),
            {
                "engine": "bigquery",
                "storage_format": "parquet",
                "portable_storage": True,
                "duckdb_configured": True,
                "bigquery_configured": True,
                "bigquery_location": "US",
            },
        )

    def test_unknown_engine_is_rejected(self):
        with patch.dict(
            "os.environ",
            {
                "ANALYTICS_ENGINE": "sqlite",
            },
            clear=True,
        ):
            with self.assertRaises(
                ValueError,
            ):
                get_analytics_engine_name()

    def test_supported_storage_format_is_normalized(self):
        with patch.dict(
            "os.environ",
            {
                "ANALYTICS_STORAGE_FORMAT": " PARQUET ",
            },
            clear=True,
        ):
            self.assertEqual(
                get_analytics_storage_format(),
                "parquet",
            )

    def test_unknown_storage_format_is_rejected(self):
        with patch.dict(
            "os.environ",
            {
                "ANALYTICS_STORAGE_FORMAT": "orc",
            },
            clear=True,
        ):
            with self.assertRaises(
                ValueError,
            ):
                get_analytics_storage_format()

    def test_portable_storage_prefers_parquet(self):
        with patch.dict(
            "os.environ",
            {
                "ANALYTICS_STORAGE_FORMAT": "parquet",
            },
            clear=True,
        ):
            self.assertTrue(
                should_use_portable_analytics_storage()
            )

        with patch.dict(
            "os.environ",
            {
                "ANALYTICS_STORAGE_FORMAT": "csv",
            },
            clear=True,
        ):
            self.assertFalse(
                should_use_portable_analytics_storage()
            )

    def test_adapter_selection_uses_engine_config(self):
        duckdb_config = AnalyticsEngineConfig(
            engine="duckdb",
            duckdb_path="analytics.duckdb",
            analytics_storage_dir="analytics/datasets",
            storage_format="parquet",
            bigquery_project_id=None,
            bigquery_dataset=None,
            bigquery_location="US",
        )
        bigquery_config = AnalyticsEngineConfig(
            engine="bigquery",
            duckdb_path="analytics.duckdb",
            analytics_storage_dir="analytics/datasets",
            storage_format="parquet",
            bigquery_project_id="project",
            bigquery_dataset="dataset",
            bigquery_location="US",
        )

        self.assertIsInstance(
            get_analytics_adapter(
                duckdb_config,
            ),
            DuckDBAnalyticsAdapter,
        )
        self.assertIsInstance(
            get_analytics_adapter(
                bigquery_config,
            ),
            BigQueryAnalyticsAdapter,
        )

    def test_duckdb_adapter_loads_current_csv_uploads(self):
        dataset = SimpleNamespace(
            file_path="sales.csv",
            file_name="sales.csv",
        )
        dataframe = pd.DataFrame({
            "revenue": [
                10,
            ],
        })

        with patch(
            "app.modules.datasets.services.analytics_adapters.load_dataset_file",
            return_value=(
                "csv",
                dataframe,
            ),
        ) as load_dataset_file:
            result = load_dataset_dataframe(
                dataset,
            )

        load_dataset_file.assert_called_once_with(
            "sales.csv",
            "sales.csv",
        )
        self.assertIs(
            result,
            dataframe,
        )

    def test_duckdb_adapter_queries_parquet_files_directly(self):
        config = AnalyticsEngineConfig(
            engine="duckdb",
            duckdb_path="analytics/decisionate.duckdb",
            analytics_storage_dir="analytics/datasets",
            storage_format="parquet",
            bigquery_project_id=None,
            bigquery_dataset=None,
            bigquery_location="US",
        )
        dataframe = pd.DataFrame({"revenue": [100]})
        connection = MagicMock()
        connection.execute.return_value.fetchdf.return_value = dataframe
        duckdb = SimpleNamespace(
            connect=MagicMock(return_value=connection),
        )

        with TemporaryDirectory() as directory:
            parquet_path = Path(directory) / "sales.parquet"
            parquet_path.touch()
            dataset = SimpleNamespace(
                file_path=str(parquet_path),
                file_name="sales.parquet",
            )

            with patch(
                "app.modules.datasets.services.analytics_adapters.importlib.import_module",
                return_value=duckdb,
            ):
                result = DuckDBAnalyticsAdapter(config).load_dataframe(dataset)

        duckdb.connect.assert_called_once_with(
            database="analytics/decisionate.duckdb",
        )
        connection.execute.assert_called_once_with(
            "SELECT * FROM read_parquet([?], union_by_name = true)",
            [str(parquet_path)],
        )
        connection.close.assert_called_once_with()
        self.assertIs(result, dataframe)

    def test_bigquery_adapter_requires_optional_dependency(self):
        config = AnalyticsEngineConfig(
            engine="bigquery",
            duckdb_path="analytics.duckdb",
            analytics_storage_dir="analytics/datasets",
            storage_format="parquet",
            bigquery_project_id="project",
            bigquery_dataset="dataset",
            bigquery_location="US",
        )

        with self.assertRaises(
            AnalyticsAdapterUnavailable,
        ) as context:
            with patch(
                "importlib.import_module",
                side_effect=ModuleNotFoundError(
                    "google.cloud.bigquery"
                ),
            ):
                get_analytics_adapter(
                    config,
                ).load_dataframe(
                    SimpleNamespace(
                        id=1,
                    )
                )

        self.assertIn(
            "google-cloud-bigquery",
            str(context.exception),
        )

    def test_bigquery_adapter_loads_configured_table(self):
        config = AnalyticsEngineConfig(
            engine="bigquery",
            duckdb_path="analytics.duckdb",
            analytics_storage_dir="analytics/datasets",
            storage_format="parquet",
            bigquery_project_id="project",
            bigquery_dataset="dataset",
            bigquery_location="US",
        )
        dataset = SimpleNamespace(
            id=1,
            workspace_id="workspace-1",
            user_id="user-1",
        )
        dataframe = pd.DataFrame({
            "revenue": [
                100,
            ],
        })
        row_iterator = MagicMock()
        row_iterator.to_dataframe.return_value = (
            dataframe
        )
        query_job = MagicMock()
        query_job.result.return_value = (
            row_iterator
        )
        client = MagicMock()
        client.query.return_value = query_job
        bigquery = SimpleNamespace(
            Client=MagicMock(
                return_value=client
            )
        )

        with patch(
            "importlib.import_module",
            return_value=bigquery,
        ):
            result = (
                get_analytics_adapter(
                    config,
                )
                .load_dataframe(dataset)
            )

        self.assertIs(
            result,
            dataframe,
        )
        bigquery.Client.assert_called_once_with(
            project="project",
        )
        client.query.assert_called_once_with(
            "SELECT * FROM `project.dataset.workspace_1_dataset_1`",
            location="US",
        )
        query_job.result.assert_called_once_with()
        row_iterator.to_dataframe.assert_called_once_with()

    def test_bigquery_adapter_requires_project_and_dataset(self):
        config = AnalyticsEngineConfig(
            engine="bigquery",
            duckdb_path="analytics.duckdb",
            analytics_storage_dir="analytics/datasets",
            storage_format="parquet",
            bigquery_project_id=None,
            bigquery_dataset=None,
            bigquery_location="US",
        )

        with self.assertRaises(
            AnalyticsAdapterUnavailable,
        ) as context:
            get_analytics_adapter(
                config,
            ).load_dataframe(
                SimpleNamespace(
                    id=1,
                )
            )

        self.assertIn(
            "BIGQUERY_PROJECT_ID",
            str(context.exception),
        )

    def test_dataset_loader_maps_unavailable_adapter_to_service_error(self):
        dataset = SimpleNamespace(
            id=1,
        )

        with patch(
            "app.modules.datasets.services.dataset_loader.load_dataset_dataframe",
            side_effect=AnalyticsAdapterUnavailable(
                "BigQuery analytics adapter unavailable"
            ),
        ):
            with self.assertRaises(
                HTTPException,
            ) as context:
                load_dataframe_from_dataset(
                    dataset,
                )

        self.assertEqual(
            context.exception.status_code,
            503,
        )
        self.assertEqual(
            context.exception.detail,
            "BigQuery analytics adapter unavailable",
        )

    def test_analytics_identifier_is_bigquery_safe(self):
        self.assertEqual(
            normalize_analytics_identifier(
                "Client A / Revenue",
                "fallback",
            ),
            "client_a_revenue",
        )
        self.assertEqual(
            normalize_analytics_identifier(
                "123",
                "fallback",
            ),
            "_123",
        )
        self.assertEqual(
            normalize_analytics_identifier(
                "",
                "fallback",
            ),
            "fallback",
        )
        self.assertEqual(
            normalize_analytics_identifier(
                None,
                "Fallback Value!",
            ),
            "fallback_value",
        )
        self.assertEqual(
            normalize_analytics_identifier(
                None,
                "",
            ),
            "identifier",
        )

    def test_analytics_storage_dir_is_stable(self):
        self.assertEqual(
            normalize_analytics_storage_dir(
                " analytics/datasets/// ",
            ),
            "analytics/datasets",
        )
        self.assertEqual(
            normalize_analytics_storage_dir(
                "",
            ),
            "analytics/datasets",
        )

    def test_dataset_storage_names_are_stable_and_portable(self):
        dataset = SimpleNamespace(
            id=42,
            user_id="user-1",
            workspace_id="Client A",
        )
        config = AnalyticsEngineConfig(
            engine="duckdb",
            duckdb_path="analytics.duckdb",
            analytics_storage_dir="analytics/datasets",
            storage_format="parquet",
            bigquery_project_id=None,
            bigquery_dataset=None,
            bigquery_location="US",
        )

        self.assertEqual(
            build_workspace_namespace(
                dataset,
            ),
            "client_a",
        )
        self.assertEqual(
            build_dataset_table_name(
                dataset,
            ),
            "dataset_42",
        )
        self.assertEqual(
            build_dataset_parquet_path(
                dataset,
                config,
            ),
            "analytics/datasets/workspace=client_a/dataset_42.parquet",
        )

    def test_dataset_storage_path_handles_blank_workspace_and_storage_root(self):
        dataset = SimpleNamespace(
            id=42,
            user_id=" User 1 ",
            workspace_id="",
        )
        config = AnalyticsEngineConfig(
            engine="duckdb",
            duckdb_path="analytics.duckdb",
            analytics_storage_dir=" analytics/datasets/// ",
            storage_format="parquet",
            bigquery_project_id=None,
            bigquery_dataset=None,
            bigquery_location="US",
        )

        self.assertEqual(
            build_workspace_namespace(
                dataset,
            ),
            "user_1",
        )
        self.assertEqual(
            build_dataset_parquet_path(
                dataset,
                config,
            ),
            "analytics/datasets/workspace=user_1/dataset_42.parquet",
        )

    def test_bigquery_table_id_uses_same_dataset_identity(self):
        dataset = SimpleNamespace(
            id=42,
            user_id="user-1",
            workspace_id="Client A",
        )
        config = AnalyticsEngineConfig(
            engine="bigquery",
            duckdb_path="analytics.duckdb",
            analytics_storage_dir="analytics/datasets",
            storage_format="parquet",
            bigquery_project_id="decisionate",
            bigquery_dataset="analytics",
            bigquery_location="US",
        )

        self.assertEqual(
            build_bigquery_table_id(
                dataset,
                config,
            ),
            "decisionate.analytics.client_a_dataset_42",
        )

    def test_dataset_analytics_manifest_includes_portable_locations(self):
        dataset = SimpleNamespace(
            id=42,
            user_id="user-1",
            workspace_id="Client A",
        )
        config = AnalyticsEngineConfig(
            engine="bigquery",
            duckdb_path="analytics.duckdb",
            analytics_storage_dir="analytics/datasets",
            storage_format="parquet",
            bigquery_project_id="decisionate",
            bigquery_dataset="analytics",
            bigquery_location="US",
        )

        self.assertEqual(
            build_dataset_analytics_manifest(
                dataset,
                config,
            ),
            {
                "engine": "bigquery",
                "storage_format": "parquet",
                "workspace_namespace": "client_a",
                "table_name": "dataset_42",
                "parquet_path": (
                    "analytics/datasets/"
                    "workspace=client_a/"
                    "dataset_42.parquet"
                ),
                "bigquery_table_id": (
                    "decisionate.analytics."
                    "client_a_dataset_42"
                ),
            },
        )


if __name__ == "__main__":
    unittest.main()
