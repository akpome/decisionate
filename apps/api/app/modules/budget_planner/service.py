from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd
from fastapi import HTTPException

from app.modules.correlation.catalog import metric_catalog, normalize_dates, prepare_series, reporting_timezone
from app.modules.correlation.service import authorize_datasets
from app.modules.datasets.services.curated_metric_analytics import frame_policy
from app.modules.datasets.services.dataset_loader import load_dataframe_from_dataset
from app.modules.datasets.services.dimension_filters import apply_dimension_filter, DimensionFilterError
from app.modules.datasets.services.joins import _parse_dates
from app.modules.forecasting.services import forecast_dates_need_year
from app.modules.reports.catalog import prepare_report_source
from .engine import VERSION, plan_matrix
from .schemas import BudgetDefinition, selections

LIMITATIONS = [
    "These are observational, model-based estimates, not proof that spending caused the result. Start with a measured test.",
    "The comparison keeps the total budget fixed and changes only its mix. Spending is spread evenly across the planning weeks.",
    "The range reflects resampled historical errors, not every future risk or missing business influence. It is not a guarantee.",
    "Normal annual seasons and trends are modeled. Supplied business influences are held at their recent average; unexpected events are not predicted.",
    "Suggestions stay within 20% of each option's recent eight-week spending level. No money is moved automatically.",
]


def validate_dates(definition, today=None):
    today = today or datetime.now(ZoneInfo(reporting_timezone())).date()
    if definition.start_date < today or definition.start_date > today + timedelta(days=28) or definition.start_date.weekday() != 0:
        raise HTTPException(422, "Start the plan on a Monday within the next four weeks.")


def generate(db, definition: BudgetDefinition, user, workspace, progress=None, *, today=None):
    today = today or datetime.now(ZoneInfo(reporting_timezone())).date()
    validate_dates(definition, today)
    datasets = authorize_datasets(db, user, workspace, [item.dataset_id for item in selections(definition)])
    frames = {key: prepare_report_source(dataset, load_dataframe_from_dataset(dataset, apply_metric_selection=False))
              for key, dataset in datasets.items()}
    if progress:
        progress("computing")
    return build_plan(frames, definition, today=today)


def build_plan(frames, definition, *, today=None):
    today = today or datetime.now(ZoneInfo(reporting_timezone())).date()
    end = pd.Timestamp(today - timedelta(days=today.weekday() + 1))
    start = end - pd.DateOffset(years=3) + pd.Timedelta(days=1)
    result = {"status": "needs_evidence", "checks": [], "allocations": [], "estimate": None,
              "engine_version": VERSION, "definition": definition.model_dump(mode="json"),
              "generated_at": pd.Timestamp.now(tz="UTC").isoformat(), "limitations": LIMITATIONS,
              "history": None, "outcome": None}
    def stop(message):
        result["checks"].append(message)
        return result
    series = []
    for index, selection in enumerate(selections(definition)):
        dataset, original = frames[selection.dataset_id]
        try:
            frame = apply_dimension_filter(dataset, original, selection.dimension_filter.model_dump() if selection.dimension_filter else None, metrics=[selection.metric_key])
        except DimensionFilterError as error:
            raise HTTPException(422, str(error)) from error
        catalog = metric_catalog(dataset, frame)
        metric = next((item for item in catalog["metrics"] if item["metric_key"] == selection.metric_key), None)
        if not metric or selection.date_column not in catalog["date_columns"]:
            return stop(f"Choose an available, approved metric and date column in {dataset.file_name}.")
        policy = frame_policy(frame)
        descriptor = policy["descriptors"].get(selection.metric_key, {}) if policy else {}
        aggregation = descriptor.get("aggregation", metric["aggregation"]).lower()
        if aggregation != "sum" or metric["unit"] not in {"currency", "number", "count"}:
            return stop(f"{metric['label']} must be an additive total, such as spending, sales or orders. Rates and balances are not supported.")
        if 1 <= index <= len(definition.options):
            if metric["unit"] != "currency":
                return stop(f"{metric['label']} is not a recognized monetary spending metric. Select a spending amount.")
            if metric.get("currency") and metric["currency"] != definition.currency:
                return stop(f"{metric['label']} uses {metric['currency']}, not {definition.currency}. Convert sources consistently before planning.")
        if index == 0:
            result["outcome"] = {**metric, "dataset_label": dataset.file_name}
        if forecast_dates_need_year(frame[selection.date_column]):
            return stop(f"{dataset.file_name} needs dates containing a year. Month names alone cannot establish historical evidence.")
        parsed = _parse_dates(normalize_dates(frame[selection.date_column], reporting_timezone()))
        if parsed.isna().any():
            return stop(f"{dataset.file_name} has missing or invalid dates. Correct them so amounts are not silently omitted.")
        numeric = pd.to_numeric(frame[selection.metric_key], errors="coerce")
        in_window = parsed.between(start, end + pd.Timedelta(days=1), inclusive="left")
        if (~np.isfinite(numeric.loc[in_window])).any() or (numeric.loc[in_window] < 0).any():
            return stop(f"{metric['label']} has missing, negative or invalid amounts. Correct them before planning.")
        dates = parsed.loc[in_window].dt.normalize().dropna()
        if selection.data_grain == "weekly" and (dates.dt.weekday != 0).any():
            return stop(f"Weekly records in {dataset.file_name} must be labeled with their Monday start date.")
        reference = {"dataset_id": selection.dataset_id, "metric_key": selection.metric_key,
                     "date_column": selection.date_column, "aggregation": metric["aggregation"]}
        prepared, _ = prepare_series({selection.dataset_id: (dataset, frame)}, [reference],
                                    {"grain": "weekly", "date_range": {"start": str(start.date()), "end": str(end.date())},
                                     "reporting_timezone": reporting_timezone()})
        grouped = prepared[f"{selection.dataset_id}:{selection.metric_key}"]
        values = grouped.set_index("period")["value"]
        # A missing daily record is not silently replaced by a zero. Weekly
        # inputs are explicitly declared as already-complete weekly totals.
        coverage = dates.groupby(dates.dt.to_period("W-SUN").dt.start_time).nunique()
        complete = coverage[coverage == (7 if selection.data_grain == "daily" else 1)].index
        series.append(values.loc[values.index.isin(complete)].rename(index))
    joined = pd.concat(series, axis=1).sort_index().dropna()
    if joined.empty:
        return stop("There are no complete matching weeks. Use daily totals with explicit zero-activity days, or complete weekly totals labeled by Monday.")
    expected = pd.date_range(joined.index.min(), joined.index.max(), freq="W-MON")
    if len(expected) != len(joined):
        return stop("Matching history has missing weeks. Complete those records; missing amounts are not assumed to be zero.")
    if (end - (joined.index[-1] + pd.Timedelta(days=6))).days > 14:
        return stop("The latest complete shared week is more than two weeks old. Refresh the selected datasets before planning future spending.")
    result["history"] = {"start": str(joined.index[0].date()), "end": str((joined.index[-1] + pd.Timedelta(days=6)).date()), "weeks": len(joined)}
    gap = (pd.Timestamp(definition.start_date) - joined.index[-1]).days // 7 - 1
    result.update(plan_matrix(joined.iloc[:, 1:1 + len(definition.options)].to_numpy(dtype=float),
                              joined.iloc[:, 0].to_numpy(dtype=float), joined.iloc[:, 1 + len(definition.options):].to_numpy(dtype=float),
                              np.arange(len(joined)), definition, gap_weeks=gap))
    return result
