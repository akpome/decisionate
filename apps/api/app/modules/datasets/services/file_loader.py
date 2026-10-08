import importlib.util
import ntpath
import os
import zipfile
from pathlib import Path

import pandas as pd
from fastapi import HTTPException

from app.infrastructure.object_storage import get_object_storage


DATASET_FILE_SOURCE_DEPENDENCIES = {
    "csv": [],
    "json": [],
    "parquet": [
        "pyarrow",
        "fastparquet",
    ],
    "excel": [
        "openpyxl",
        "xlrd",
    ],
}


DATASET_FILE_TYPES = {
    ".csv": {
        "source_type": "csv",
        "label": "CSV",
        "reader": lambda path: pd.read_csv(path, nrows=1_000_001),
    },
    ".json": {
        "source_type": "json",
        "label": "JSON",
        "reader": pd.read_json,
    },
    ".jsonl": {
        "source_type": "json",
        "label": "JSON",
        "reader": lambda path: pd.read_json(
            path,
            lines=True,
        ),
    },
    ".parquet": {
        "source_type": "parquet",
        "label": "Parquet",
        "reader": pd.read_parquet,
    },
    ".pq": {
        "source_type": "parquet",
        "label": "Parquet",
        "reader": pd.read_parquet,
    },
    ".xls": {
        "source_type": "excel",
        "label": "Excel",
        "reader": lambda path: pd.read_excel(path, nrows=1_000_001),
    },
    ".xlsx": {
        "source_type": "excel",
        "label": "Excel",
        "reader": lambda path: pd.read_excel(path, nrows=1_000_001),
    },
}


def sanitize_upload_filename(
    filename: str | None,
):
    clean_filename = ntpath.basename(
        os.path.basename(
            filename or ""
        )
    ).strip()

    if clean_filename in (
        "",
        ".",
        "..",
    ):
        return "dataset.csv"

    return clean_filename


def get_filename_extension(
    filename: str | None,
):
    clean_filename = ntpath.basename(
        os.path.basename(
            filename or ""
        )
    ).strip()

    if clean_filename in (
        "",
        ".",
        "..",
    ):
        return ""

    return os.path.splitext(
        clean_filename
    )[1].lower()


def is_optional_module_available(
    module_name: str,
):
    return (
        importlib.util.find_spec(
            module_name
        )
        is not None
    )


def is_dataset_file_source_available(
    source_type: str,
):
    dependencies = (
        DATASET_FILE_SOURCE_DEPENDENCIES
        .get(source_type)
    )

    if dependencies is None:
        return False

    if not dependencies:
        return True

    return any(
        is_optional_module_available(
            dependency
        )
        for dependency in dependencies
    )


def get_dataset_file_source_dependencies(
    source_type: str,
):
    return [
        *DATASET_FILE_SOURCE_DEPENDENCIES.get(
            source_type,
            [],
        )
    ]


def get_dataset_file_source_setup_note(
    source_type: str,
):
    dependencies = (
        get_dataset_file_source_dependencies(
            source_type
        )
    )

    if not dependencies:
        return None

    return (
        "Install one of: "
        + ", ".join(dependencies)
    )


def get_dataset_file_type(
    filename: str | None,
):
    extension = get_filename_extension(
        filename
    )

    return DATASET_FILE_TYPES.get(
        extension
    )


def infer_dataset_source_type(
    filename: str | None,
):
    file_type = get_dataset_file_type(
        filename
    )

    if not file_type:
        return None

    return file_type["source_type"]


def build_upload_source_config(
    filename: str | None,
):
    safe_filename = sanitize_upload_filename(
        filename
    )
    extension = os.path.splitext(
        safe_filename
    )[1].lower()
    file_type = get_dataset_file_type(
        safe_filename
    )

    return {
        "ingestion_mode": "upload",
        "original_file_name": safe_filename,
        "file_extension": extension,
        "file_format": (
            file_type["source_type"]
            if file_type
            else None
        ),
        "stored_file_format": "parquet",
    }


def convert_dataframe_to_parquet(
    dataframe,
    source_path: str,
):
    parquet_path = os.path.splitext(
        source_path
    )[0] + ".parquet"

    try:
        dataframe.to_parquet(
            parquet_path,
            index=False,
        )
    except ImportError as error:
        raise HTTPException(
            status_code=503,
            detail=(
                "Parquet conversion requires the pyarrow package "
                "on the API server."
            ),
        ) from error
    except Exception as error:
        raise HTTPException(
            status_code=400,
            detail=(
                "Uploaded data could not be converted to Parquet."
            ),
        ) from error

    return parquet_path


def validate_dataset_dataframe(
    dataframe,
):
    if not isinstance(
        dataframe,
        pd.DataFrame,
    ):
        raise HTTPException(
            status_code=400,
            detail=(
                "Uploaded file did not produce a tabular dataset"
            ),
        )

    if len(dataframe.columns) == 0:
        raise HTTPException(
            status_code=400,
            detail=(
                "Uploaded file did not contain any columns"
            ),
        )

    if dataframe.empty:
        raise HTTPException(
            status_code=400,
            detail=(
                "Uploaded file did not contain any rows"
            ),
        )

    if len(dataframe) > 1_000_000 or len(dataframe.columns) > 500:
        raise HTTPException(413, "Dataset exceeds the 1,000,000 row or 500 column limit.")
    if dataframe.memory_usage(index=True, deep=True).sum() > 512 * 1024 * 1024:
        raise HTTPException(413, "Dataset exceeds the 512 MB in-memory limit.")


def load_dataset_file(
    file_path: str,
    filename: str | None = None,
):
    file_type = get_dataset_file_type(
        filename or file_path
    )

    if not file_type:
        raise HTTPException(
            status_code=400,
            detail=(
                "Unsupported dataset file type. "
                "Upload CSV, JSON, Parquet, XLS, or XLSX files."
            ),
        )

    try:
        with get_object_storage().materialize(file_path) as materialized_path:
            if str(filename or file_path).lower().endswith(".xlsx"):
                with zipfile.ZipFile(materialized_path) as archive:
                    if sum(item.file_size for item in archive.infolist()) > 512 * 1024 * 1024:
                        raise HTTPException(413, "Expanded spreadsheet exceeds the import limit.")
            if file_type["source_type"] == "parquet" and not os.path.isdir(materialized_path):
                import pyarrow.parquet as parquet
                metadata = parquet.read_metadata(materialized_path)
                expanded_size = sum(metadata.row_group(index).total_byte_size for index in range(metadata.num_row_groups))
                if metadata.num_rows > 1_000_000 or metadata.num_columns > 500 or expanded_size > 512 * 1024 * 1024:
                    raise HTTPException(413, "Parquet dataset exceeds the row or column limit.")
            if (
                file_type["source_type"] == "parquet"
                and os.path.isdir(materialized_path)
            ):
                parquet_files = sorted(
                    Path(materialized_path).rglob("*.parquet")
                )
                if not parquet_files:
                    raise FileNotFoundError(file_path)

                import pyarrow.parquet as parquet
                row_count = 0
                expanded_size = 0
                columns = set()
                for path in parquet_files:
                    metadata = parquet.read_metadata(path)
                    row_count += metadata.num_rows
                    columns.update(metadata.schema.names)
                    expanded_size += sum(
                        metadata.row_group(index).total_byte_size
                        for index in range(metadata.num_row_groups)
                    )
                    if row_count > 1_000_000 or len(columns) > 500 or expanded_size > 512 * 1024 * 1024:
                        raise HTTPException(413, "Partitioned dataset exceeds the import limit.")

                dataframes = [
                    pd.read_parquet(path)
                    for path in parquet_files
                ]
                dataframe = pd.concat(
                    dataframes,
                    ignore_index=True,
                    sort=False,
                )
            else:
                dataframe = file_type["reader"](
                    materialized_path
                )
    except HTTPException:
        raise
    except FileNotFoundError as error:
        raise HTTPException(
            status_code=404,
            detail="Dataset file not found",
        ) from error
    except ImportError as error:
        raise HTTPException(
            status_code=400,
            detail=(
                f"{file_type['label']} uploads require an optional "
                "file reader dependency on the API server."
            ),
        ) from error
    except Exception as error:
        raise HTTPException(
            status_code=400,
            detail=(
                "Uploaded file could not be read as "
                f"{file_type['label']}"
            ),
        ) from error

    validate_dataset_dataframe(
        dataframe
    )

    return (
        file_type["source_type"],
        dataframe,
    )
