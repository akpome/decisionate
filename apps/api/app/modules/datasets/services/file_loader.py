import csv
import importlib.util
import json
import ntpath
import os
import zipfile
from pathlib import Path

import pandas as pd
from fastapi import HTTPException

from app.infrastructure.ingestion_limits import (
    IngestionLimitExceeded, MAX_DATAFRAME_BYTES, MAX_DATASET_ROWS,
    MAX_JSON_DOCUMENT_BYTES, MAX_WORKBOOK_ENTRIES, MAX_WORKBOOK_EXPANDED_BYTES,
    check_dataframe_size, check_table_shape,
)
from app.infrastructure.object_storage import get_object_storage


def _bounded_text_lines(source, file_type):
    limit = 2 * 1024 * 1024
    while line := source.readline(limit + 1):
        if len(line) > limit or (not line.isascii() and len(line.encode("utf-8")) > limit):
            raise IngestionLimitExceeded(f"A {file_type} line exceeds the 2 MB limit. Use fewer columns or shorten long values.")
        yield line


def _read_csv(path):
    # Check the shape before pandas allocates the table, including sparse rows.
    with open(path, encoding="utf-8-sig", newline="") as source:
        columns = rows = 0
        try:
            for row in csv.reader(_bounded_text_lines(source, "CSV")):
                if not row:
                    continue
                columns = max(columns, len(row))
                rows += 1
                check_table_shape(rows - 1, columns)
        except csv.Error as error:
            if str(error).startswith("field larger than field limit"):
                raise IngestionLimitExceeded("A CSV value is too long. Shorten long text fields and try again.") from error
            raise
    return pd.read_csv(path, nrows=MAX_DATASET_ROWS + 1)


def collect_table_chunks(chunks):
    frames = []
    rows = memory_bytes = 0
    columns = set()
    for chunk in chunks:
        rows += len(chunk)
        columns.update(chunk.columns)
        check_table_shape(*chunk.shape)
        check_table_shape(rows, len(columns))
        memory_bytes += chunk.memory_usage(index=True, deep=True).sum()
        if memory_bytes > MAX_DATAFRAME_BYTES:
            raise IngestionLimitExceeded("Dataset exceeds the 512 MB in-memory limit. Reduce the data and try again.")
        frames.append(chunk)
    return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()


def _read_json(path):
    if os.path.getsize(path) > MAX_JSON_DOCUMENT_BYTES:
        raise IngestionLimitExceeded("JSON documents are limited to 20 MB. For larger files, use CSV, JSON Lines, or Parquet.")
    with open(path, encoding="utf-8") as source:
        document = json.load(source)
    if isinstance(document, list):
        _check_json_rows(document)
    elif isinstance(document, dict):
        check_table_shape(0, len(document))
        row_keys = set()
        array_rows = 0
        for column in document.values():
            if isinstance(column, dict):
                row_keys.update(column)
            elif isinstance(column, list):
                array_rows = max(array_rows, len(column))
            check_table_shape(max(array_rows, len(row_keys)), len(document))
    del document
    return pd.read_json(path)


def _check_json_rows(records):
    columns = set()
    width = 0
    for count, record in enumerate(records, start=1):
        if isinstance(record, dict):
            columns.update(record)
        elif isinstance(record, list):
            width = max(width, len(record))
        check_table_shape(count, max(width, len(columns)))


def _read_json_lines(path):
    with open(path, encoding="utf-8") as source:
        _check_json_rows(json.loads(line) for line in _bounded_text_lines(source, "JSON Lines") if line.strip())
    with pd.read_json(path, lines=True, chunksize=2_000) as chunks:
        return collect_table_chunks(chunks)


def _check_xlsx_archive(path, *, existing=False):
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        expanded_limit = MAX_DATAFRAME_BYTES if existing else MAX_WORKBOOK_EXPANDED_BYTES
        if (not existing and len(entries) > MAX_WORKBOOK_ENTRIES) or sum(item.file_size for item in entries) > expanded_limit:
            raise IngestionLimitExceeded("Expanded spreadsheet exceeds the import limit. Remove unused sheets or export to CSV.")


def _read_excel(path):
    with pd.ExcelFile(path) as workbook:
        if workbook.engine == "openpyxl":
            sheet = workbook.book.worksheets[0]
            check_table_shape(max(0, (sheet.max_row or 0) - 1), sheet.max_column or 0)
        elif workbook.engine == "xlrd":
            sheet = workbook.book.sheet_by_index(0)
            check_table_shape(max(0, sheet.nrows - 1), sheet.ncols)
        return workbook.parse(nrows=MAX_DATASET_ROWS + 1)


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
        "reader": _read_csv,
    },
    ".json": {
        "source_type": "json",
        "label": "JSON",
        "reader": _read_json,
    },
    ".jsonl": {
        "source_type": "json",
        "label": "JSON",
        "reader": _read_json_lines,
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
        "reader": _read_excel,
    },
    ".xlsx": {
        "source_type": "excel",
        "label": "Excel",
        "reader": _read_excel,
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
    *,
    limit_cells=True,
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

    try:
        check_dataframe_size(dataframe, limit_cells=limit_cells)
    except IngestionLimitExceeded as error:
        raise HTTPException(413, str(error)) from error


def load_dataset_file(
    file_path: str,
    filename: str | None = None,
    *,
    existing=False,
):
    extension = get_filename_extension(filename or file_path)
    file_type = DATASET_FILE_TYPES.get(extension)

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
            if extension == ".xlsx":
                # Storage may materialize a temporary file without the original extension.
                _check_xlsx_archive(materialized_path, existing=existing)
            if file_type["source_type"] == "parquet" and not os.path.isdir(materialized_path):
                import pyarrow.parquet as parquet
                metadata = parquet.read_metadata(materialized_path)
                expanded_size = sum(metadata.row_group(index).total_byte_size for index in range(metadata.num_row_groups))
                check_table_shape(metadata.num_rows, metadata.num_columns, limit_cells=not existing)
                if expanded_size > MAX_DATAFRAME_BYTES:
                    raise IngestionLimitExceeded("Expanded Parquet data exceeds the import limit. Use fewer rows or columns.")
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
                    check_table_shape(row_count, max(len(columns), metadata.num_columns), limit_cells=not existing)
                    if expanded_size > MAX_DATAFRAME_BYTES:
                        raise IngestionLimitExceeded("Partitioned dataset exceeds the import limit.")

                dataframes = [
                    pd.read_parquet(path)
                    for path in parquet_files
                ]
                dataframe = pd.concat(
                    dataframes,
                    ignore_index=True,
                    sort=False,
                )
            elif existing and extension == ".csv":
                dataframe = pd.read_csv(materialized_path, nrows=MAX_DATASET_ROWS + 1)
            elif existing and extension in {".json", ".jsonl"}:
                dataframe = pd.read_json(materialized_path, lines=extension == ".jsonl")
            elif existing and file_type["source_type"] == "excel":
                dataframe = pd.read_excel(materialized_path, nrows=MAX_DATASET_ROWS + 1)
            else:
                dataframe = file_type["reader"](materialized_path)
    except HTTPException:
        raise
    except IngestionLimitExceeded as error:
        raise HTTPException(413, str(error)) from error
    except MemoryError as error:
        raise HTTPException(413, "Import exceeded its memory limit. Try a smaller file.") from error
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
        dataframe, limit_cells=not existing,
    )

    return (
        file_type["source_type"],
        dataframe,
    )
