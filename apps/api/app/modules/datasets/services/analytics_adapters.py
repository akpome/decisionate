import importlib
from pathlib import Path

from app.modules.datasets.services.analytics_engine import (
    AnalyticsEngineConfig,
    get_analytics_engine_config,
)
from app.modules.datasets.services.analytics_storage import (
    build_bigquery_table_id,
)
from app.modules.datasets.services.file_loader import (
    load_dataset_file,
)
from app.infrastructure.object_storage import get_dataset_storage_reference
from app.infrastructure.object_storage import get_object_storage


class AnalyticsAdapterUnavailable(
    RuntimeError
):
    pass


class AnalyticsAdapter:
    engine_name = "base"

    def __init__(
        self,
        config: AnalyticsEngineConfig,
    ):
        self.config = config

    def load_dataframe(
        self,
        dataset,
    ):
        raise NotImplementedError


class DuckDBAnalyticsAdapter(
    AnalyticsAdapter
):
    engine_name = "duckdb"

    def _parquet_paths(
        self,
        file_path: str,
    ) -> list[str]:
        path = Path(file_path)
        if path.is_dir():
            return sorted(
                str(candidate)
                for candidate in path.rglob("*.parquet")
                if candidate.is_file()
            )

        if path.suffix.lower() in (".parquet", ".pq"):
            return [str(path)]

        return []

    def _open_connection(self):
        try:
            duckdb = importlib.import_module("duckdb")
        except ModuleNotFoundError as error:
            raise AnalyticsAdapterUnavailable(
                "DuckDB analytics requires the duckdb package on the API server"
            ) from error

        database_path = str(
            self.config.duckdb_path or ":memory:"
        ).strip() or ":memory:"
        if database_path != ":memory:":
            Path(database_path).parent.mkdir(
                parents=True,
                exist_ok=True,
            )

        return duckdb.connect(database=database_path)

    def load_dataframe(
        self,
        dataset,
    ):
        file_path = get_dataset_storage_reference(dataset)
        with get_object_storage().materialize(file_path) as materialized_path:
            parquet_paths = self._parquet_paths(materialized_path)

            if not parquet_paths:
                # Keep older CSV/JSON/Excel records readable while all new
                # uploads and connector syncs use the direct Parquet path.
                return load_dataset_file(
                    materialized_path,
                    dataset.file_name,
                )[1]

            connection = self._open_connection()
            try:
                placeholders = ", ".join("?" for _ in parquet_paths)
                query = (
                    "SELECT * FROM read_parquet("
                    f"[{placeholders}], union_by_name = true)"
                )
                return connection.execute(
                    query,
                    parquet_paths,
                ).fetchdf()
            except FileNotFoundError:
                raise
            except Exception as error:
                raise AnalyticsAdapterUnavailable(
                    "DuckDB could not query the Parquet dataset"
                ) from error
            finally:
                connection.close()


class BigQueryAnalyticsAdapter(
    AnalyticsAdapter
):
    engine_name = "bigquery"

    def load_dataframe(
        self,
        dataset,
    ):
        if not self.config.bigquery_project_id:
            raise AnalyticsAdapterUnavailable(
                "BIGQUERY_PROJECT_ID is required for the BigQuery analytics adapter"
            )

        if not self.config.bigquery_dataset:
            raise AnalyticsAdapterUnavailable(
                "BIGQUERY_ANALYTICS_DATASET is required for the BigQuery analytics adapter"
            )

        try:
            bigquery = importlib.import_module(
                "google.cloud.bigquery"
            )
        except ModuleNotFoundError as error:
            raise AnalyticsAdapterUnavailable(
                "BigQuery analytics adapter requires the optional google-cloud-bigquery package"
            ) from error

        table_id = build_bigquery_table_id(
            dataset,
            self.config,
        )
        client = bigquery.Client(
            project=self.config.bigquery_project_id
        )
        query_job = client.query(
            f"SELECT * FROM `{table_id}`",
            location=self.config.bigquery_location,
        )

        return (
            query_job
            .result()
            .to_dataframe()
        )


def get_analytics_adapter(
    config: AnalyticsEngineConfig | None = None,
):
    analytics_config = (
        config
        or get_analytics_engine_config()
    )

    if analytics_config.engine == "duckdb":
        return DuckDBAnalyticsAdapter(
            analytics_config
        )

    if analytics_config.engine == "bigquery":
        return BigQueryAnalyticsAdapter(
            analytics_config
        )

    raise AnalyticsAdapterUnavailable(
        "Unsupported analytics engine"
    )


def load_dataset_dataframe(
    dataset,
):
    return (
        get_analytics_adapter()
        .load_dataframe(dataset)
    )
