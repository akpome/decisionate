import importlib

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

    def load_dataframe(
        self,
        dataset,
    ):
        return load_dataset_file(
            dataset.file_path,
            dataset.file_name,
        )[1]


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
