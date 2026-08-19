import importlib.util
import ntpath
import os
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
        "reader": pd.read_csv,
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
        "reader": pd.read_excel,
    },
    ".xlsx": {
        "source_type": "excel",
        "label": "Excel",
        "reader": pd.read_excel,
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
            if (
                file_type["source_type"] == "parquet"
                and os.path.isdir(materialized_path)
            ):
                parquet_files = sorted(
                    Path(materialized_path).rglob("*.parquet")
                )
                if not parquet_files:
                    raise FileNotFoundError(file_path)

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
