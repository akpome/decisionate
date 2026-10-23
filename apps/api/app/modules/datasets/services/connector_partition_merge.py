"""Merge connector history one monthly partition at a time."""

import os
import shutil
import uuid
from collections import defaultdict
from pathlib import Path

import pandas as pd
import pyarrow.parquet as pq

from .retention import connector_retention_cutoff_month, filter_connector_dataframe_by_retention, filter_connector_summary_by_retention


def merge_connector_partitions(connection, incoming, report_config, reference, storage, *, heartbeat=None):
    # Reuse the adapter-specific merge contracts (including complete line items
    # and Search Console fallback rows), rather than a second deduplication policy.
    from app.modules.datasets import router as routes

    resource = report_config.get("resource") or report_config.get("resource_type") or report_config.get("object_type")
    incoming = routes.normalize_connector_dataframe_for_parquet(routes.normalize_connector_row_schema(incoming, connection.source_type, resource))
    date_column = routes.find_connector_partition_date_column(incoming, report_config)
    cutoff = connector_retention_cutoff_month()
    fallback = routes.date.today().strftime("%Y-%m")
    output = f"{routes.build_connector_partition_dir(connection)}.revision-{uuid.uuid4().hex}"
    mapping, schema, rows, previous_rows, partition_count = {}, pd.DataFrame(), 0, 0, 0
    schema = pd.DataFrame(columns=report_config.get("source_columns") or [])
    raw_months = set()
    try:
        os.makedirs(routes.build_connector_hot_dir(output), exist_ok=True)
        with storage.materialize(reference) as directory:
            paths = defaultdict(list)
            for path in routes.list_connector_raw_partition_paths(directory):
                month = Path(path).name.removeprefix("month=").removesuffix(".parquet")
                previous_rows += pq.ParquetFile(path).metadata.num_rows
                if month >= cutoff:
                    paths[month].append(path)
            if date_column:
                incoming_months = pd.to_datetime(incoming[date_column], errors="coerce", utc=True, format="mixed").dt.strftime("%Y-%m").fillna(fallback)
            else:
                incoming_months = pd.Series(fallback, index=incoming.index)
            for month in incoming_months.unique():
                if month >= cutoff:
                    paths.setdefault(month, [])
            for month, month_paths in sorted(paths.items()):
                if heartbeat:
                    heartbeat()
                existing = pd.concat([pd.read_parquet(path) for path in month_paths], ignore_index=True, sort=False) if month_paths else pd.DataFrame()
                existing = routes.normalize_connector_row_schema(existing, connection.source_type, resource)
                mapping.update(existing.attrs.get(routes.COLUMN_MAPPING_ATTR, {}))
                existing = routes.normalize_connector_dataframe_for_parquet(existing)
                existing[routes.CONNECTOR_PARTITION_MONTH_COLUMN] = month
                incoming[routes.CONNECTOR_PARTITION_MONTH_COLUMN] = incoming_months
                merged = routes.merge_connector_dataframes(existing, incoming, connection.source_type, report_config)
                if connection.source_type == "sage":
                    merged = routes.deduplicate_sage_dataframe(merged, report_config)
                column = date_column or routes.find_connector_partition_date_column(merged, report_config)
                date_column = date_column or column
                if column:
                    months = pd.to_datetime(merged[column], errors="coerce", utc=True, format="mixed").dt.strftime("%Y-%m").fillna(merged[routes.CONNECTOR_PARTITION_MONTH_COLUMN])
                    merged = merged.loc[months == month]
                else:
                    merged = merged.loc[merged[routes.CONNECTOR_PARTITION_MONTH_COLUMN] == month]
                merged = filter_connector_dataframe_by_retention(merged, column)
                merged = merged.drop(columns=[routes.CONNECTOR_PARTITION_MONTH_COLUMN], errors="ignore")
                schema = pd.concat([schema, merged.head(0)], ignore_index=True, sort=False)
                if not merged.empty:
                    merged.to_parquet(os.path.join(routes.build_connector_hot_dir(output), f"month={month}.parquet"), index=False, compression=routes.CONNECTOR_PARQUET_COMPRESSION)
                    rows += len(merged)
                    partition_count += 1
                    raw_months.add(month)
            summary = routes.load_connector_summary_dataframe(directory)
            if connection.source_type == "sage":
                summary = routes.strip_sage_metadata_columns(summary).drop_duplicates(keep="last")
            summary = filter_connector_summary_by_retention(summary, routes.SUMMARY_MONTH_COLUMN)
            if not summary.empty:
                summary = summary.loc[~summary[routes.SUMMARY_MONTH_COLUMN].astype(str).isin(raw_months)]
            historical_paths = []
            if not summary.empty:
                os.makedirs(routes.build_connector_historical_dir(output), exist_ok=True)
                for year, group in summary.groupby(summary[routes.SUMMARY_MONTH_COLUMN].astype(str).str.slice(0, 4)):
                    path = routes.build_connector_historical_year_path(output, year)
                    group.to_parquet(path, index=False, compression=routes.CONNECTOR_PARQUET_COMPRESSION)
                    historical_paths.append(path)
            return schema, {"partition_dir": output, "date_column": date_column or report_config.get("date_column") or report_config.get("partition_date_column"),
                            "hot_partition_count": partition_count, "hot_row_count": rows,
                            "historical_summary_row_count": len(summary), "historical_partition_count": len(historical_paths),
                            "historical_partition_paths": historical_paths, "column_count": len(schema.columns)}, mapping, previous_rows
    except Exception:
        shutil.rmtree(output, ignore_errors=True)
        raise
