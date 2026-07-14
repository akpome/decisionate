from app.modules.datasets.services.analytics_engine import (
    AnalyticsEngineConfig,
    get_analytics_engine_config,
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
        raise AnalyticsAdapterUnavailable(
            "BigQuery analytics adapter is not implemented yet"
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
