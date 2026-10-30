"""Dataset-local categorical filters shared by reports and forecasting."""

import math
from numbers import Real

import pandas as pd
from pandas.api.types import is_scalar
from pydantic import BaseModel, ConfigDict, Field, StrictStr, field_validator

from .curated_metric_analytics import frame_policy
from .metric_selection import build_metric_selection_profile, parse_dataset_source_config
from .receipt_metrics import receipt_document_columns


class DimensionFilter(BaseModel):
    model_config = ConfigDict(extra="forbid")
    column: StrictStr = Field(min_length=1, max_length=200)
    values: list[StrictStr | None] = Field(min_length=1, max_length=50)

    @field_validator("values")
    @classmethod
    def check_values(cls, values):
        if any(value is not None and len(value) > 1000 for value in values):
            raise ValueError("Dimension values must not exceed 1,000 characters")
        return list(dict.fromkeys(values))


class DatasetDimensionFilter(DimensionFilter):
    dataset_id: int = Field(ge=1)


class DimensionFilterError(ValueError):
    pass


def dimension_value(value):
    if not is_scalar(value):
        raise DimensionFilterError("This dimension contains unsupported structured values")
    if pd.isna(value):
        return None
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, Real):
        if not math.isfinite(value):
            return None
        return str(int(value)) if value == int(value) else str(value)
    return str(value)


def dimension_columns(dataset, frame):
    profile = build_metric_selection_profile(dataset, frame)
    return [{"column": field["column"], "label": field["column"].replace("_", " ")}
            for field in profile["fields"]
            if field["role"] in {"dimension", "identifier"} and field["column"] in frame
            and not field["column"].startswith("__")
            and frame[field["column"]].head(100).map(is_scalar).all()]


def dimension_options(dataset, frame, column=None, search="", offset=0, limit=100):
    columns = dimension_columns(dataset, frame)
    if column is None:
        return {"columns": columns, "values": [], "next_offset": None}
    if column not in {item["column"] for item in columns}:
        raise DimensionFilterError("The selected dimension column is unavailable")
    # Keep missing tokens as None instead of allowing pandas to coerce them to NaN.
    values = list(dict.fromkeys(map(dimension_value, frame[column])))
    if search:
        values = [value for value in values if search.casefold() in
                  ("Missing" if value is None else "Empty string" if value == "" else value).casefold()]
    values.sort(key=lambda value: (value is not None, (value or "").casefold(), value or ""))
    return {"columns": columns, "values": values[offset:offset + limit],
            "next_offset": offset + limit if len(values) > offset + limit else None}


def apply_dimension_filter(dataset, frame, selection, *, metrics=()):
    if selection is None:
        return frame
    selection = DimensionFilter.model_validate({key: selection[key] for key in ("column", "values")})
    if selection.column not in {item["column"] for item in dimension_columns(dataset, frame)}:
        raise DimensionFilterError("The selected dimension column is unavailable")
    normalized = frame[selection.column].map(dimension_value)
    mask = normalized.isin(selection.values)
    if None in selection.values:
        mask |= normalized.isna()
        summary_marker = "__decisionate_summary__"
        if summary_marker in frame and (frame[summary_marker].fillna(False).astype(bool) & normalized.isna()).any():
            raise DimensionFilterError("Historical summaries do not retain missing dimension values. Select a known value or resync detailed history.")

    # An invoice header amount cannot be allocated to individual product rows.
    headers = set(receipt_document_columns(dataset.source_type, parse_dataset_source_config(dataset)))
    required = set(metrics) if metrics else set(frame.columns)
    policy = frame_policy(frame)
    for key in metrics:
        required.update((policy or {}).get("descriptors", {}).get(key, {}).get("components", []))
    parent = next((key for key in ("record_id", "invoice_id", "order_id", "sale_id") if key in frame), None)
    if headers & required and parent and mask.any():
        groups = mask.groupby(frame[parent], dropna=False)
        if (groups.any() & ~groups.all()).any():
            raise DimensionFilterError("This dimension splits transaction totals. Select a line-item metric or a transaction-level dimension.")
    result = frame.loc[mask].copy()
    result.attrs["dimension_filter"] = selection.model_dump()
    return result
