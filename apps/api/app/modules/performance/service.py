"""Historical amounts and returns, never attribution inferred from correlation."""

import math

import numpy as np
import pandas as pd
from fastapi import HTTPException

from app.modules.correlation.catalog import metric_catalog, normalize_dates, prepare_series, reporting_timezone
from app.modules.correlation.service import authorize_datasets
from app.modules.datasets.services.curated_metric_analytics import frame_policy
from app.modules.datasets.services.dataset_loader import load_dataframe_from_dataset
from app.modules.datasets.services.dimension_filters import apply_dimension_filter, dimension_columns, dimension_value, DimensionFilterError
from app.modules.datasets.services.joins import _parse_dates
from app.modules.forecasting.services import forecast_dates_need_year
from app.modules.reports.catalog import prepare_report_source
from .schemas import PerformanceDefinition
from .growth_schemas import references


def generate(db, definition, user, workspace, progress=None):
    datasets = authorize_datasets(db, user, workspace, [item.dataset_id for item in references(definition)])
    frames = {key: prepare_report_source(dataset, load_dataframe_from_dataset(dataset, apply_metric_selection=False))
              for key, dataset in datasets.items()}
    if progress:
        progress("computing")
    if not isinstance(definition, PerformanceDefinition):
        from .growth_service import calculate_growth
        return calculate_growth(frames, definition)
    return calculate(frames, definition)


def amount(frames, selection, definition, catalog, *, group_filter=None, count=False):
    dataset, original = frames[selection.dataset_id]
    filters = [selection.dimension_filter.model_dump() if selection.dimension_filter else None, group_filter]
    frame = original
    try:
        for selection_filter in filters:
            frame = apply_dimension_filter(dataset, frame, selection_filter, metrics=[selection.metric_key])
    except DimensionFilterError as error:
        return None, str(error)
    # Catalog eligibility is checked on the source, not a possibly one-row group.
    metric = next((item for item in catalog["metrics"] if item["metric_key"] == selection.metric_key), None)
    if not metric or selection.date_column not in catalog["date_columns"]:
        return None, f"Choose an approved amount and date column in {dataset.file_name}."
    descriptor = (frame_policy(original) or {}).get("descriptors", {}).get(selection.metric_key, {})
    if descriptor.get("aggregation", metric["aggregation"]).lower() != "sum" or metric["unit"] not in ({"count", "number"} if count else {"currency", "number"}):
        return None, f"{metric['label']} must be a count total, not a rate or money amount." if count else f"{metric['label']} must be a money total, not a rate, count or balance."
    if not count and metric.get("currency") and metric["currency"] != definition.currency:
        return None, f"{metric['label']} uses {metric['currency']}, not {definition.currency}. No currency conversion is applied."
    if metric["native_grain"] == "monthly" and selection.records != "monthly":
        return None, f"{dataset.file_name} contains monthly summaries. Choose monthly totals."
    if frame.empty:
        return None, f"No matching records in {dataset.file_name}."
    if forecast_dates_need_year(frame[selection.date_column]):
        return None, f"Dates in {dataset.file_name} need a year."
    dates = _parse_dates(normalize_dates(frame[selection.date_column], reporting_timezone()))
    if dates.isna().any():
        return None, f"{dataset.file_name} has missing or invalid dates. Correct them before comparing."
    start, end = pd.Timestamp(definition.date_range.start), pd.Timestamp(definition.date_range.end)
    mask = dates.between(start, end + pd.Timedelta(days=1), inclusive="left")
    if not mask.any():
        return None, f"{dataset.file_name} has no matching records in these dates."
    numeric = pd.to_numeric(frame.loc[mask, selection.metric_key], errors="coerce")
    if not np.isfinite(numeric).all():
        return None, f"{metric['label']} has missing or invalid amounts. Missing amounts are not zero."
    if count and ((numeric < 0).any() or (numeric % 1 != 0).any()):
        return None, f"{metric['label']} needs non-negative whole-number counts."
    observed = dates.loc[mask].dt.normalize()
    if selection.records == "daily":
        missing = len(pd.date_range(start, end).difference(observed))
        if missing:
            return None, f"{metric['label']} is missing {missing} daily record(s). Complete the dates, including zero-activity days, or select transaction records if these are individual sales."
    elif selection.records == "monthly":
        if start.day != 1 or end != end + pd.offsets.MonthEnd(0):
            return None, "Monthly totals need a period starting on the first day and ending on the last day of a month."
        if len(pd.period_range(start, end, freq="M").difference(observed.dt.to_period("M"))):
            return None, f"{metric['label']} is missing monthly totals within these dates."
    series, _ = prepare_series({selection.dataset_id: (dataset, frame)}, [{"dataset_id": selection.dataset_id,
        "metric_key": selection.metric_key, "date_column": selection.date_column, "aggregation": metric["aggregation"]}],
        {"grain": "monthly", "date_range": definition.date_range.model_dump(mode="json"), "reporting_timezone": reporting_timezone()})
    values = series[f"{selection.dataset_id}:{selection.metric_key}"]["value"]
    if values.empty or not np.isfinite(values).all():
        return None, f"The total for {metric['label']} could not be established."
    total = float(values.sum())
    if not math.isfinite(total) or abs(total) > 1e15:
        return None, f"The total for {metric['label']} is outside the supported range."
    return total, None


def calculate(frames, definition: PerformanceDefinition):
    title = "Return on spend" if definition.kind == "return" else "Profitability"
    result = {"status": "needs_data", "definition": definition.model_dump(mode="json"), "rows": [],
        "name": f"{title}: {definition.date_range.start} to {definition.date_range.end}",
        "generated_at": pd.Timestamp.now(tz="UTC").isoformat(), "headline": "Complete the records to compare results.",
        "next_action": "Check the notes beside each result.", "winner": None,
        "basis": "Each sale is credited to one channel in your sales records." if definition.revenue_basis == "assigned_sales" else "Sales come from each ad platform's own report. The same sale may appear in more than one report.",
        "limitations": ["Historical recorded amounts, not a forecast or proof of what caused sales.",
            "Spending and sales use the same dates. Delayed sales outside these dates are not included.",
            "Use revenue after refunds and discounts, with tax removed.",
            "All amounts use the selected currency. No currency conversion is applied."]}
    if definition.kind == "profit":
        result["limitations"].append("Money left is revenue minus selected costs, not net profit unless all relevant costs are included.")
    if not definition.amounts_confirmed:
        result["headline"] = "Confirm the money amounts and coverage before comparing."
        result["next_action"] = "Confirm that records cover these dates, use the same currency, and do not double-count sales or costs."
        return result
    tasks = [(item.name, item, None) for item in definition.items]
    if definition.group_column:
        item = definition.items[0]
        dataset, frame = frames[item.revenue.dataset_id]
        if definition.group_column not in {entry["column"] for entry in dimension_columns(dataset, frame)}:
            raise HTTPException(422, "Choose an available column to compare groups.")
        if item.revenue.dimension_filter:
            try:
                frame = apply_dimension_filter(dataset, frame, item.revenue.dimension_filter.model_dump(), metrics=[s.metric_key for s in references(definition)])
            except DimensionFilterError as error:
                raise HTTPException(422, str(error)) from error
        if item.revenue.date_column not in frame:
            raise HTTPException(422, "Choose an available date column.")
        dates = _parse_dates(normalize_dates(frame[item.revenue.date_column], reporting_timezone()))
        if dates.isna().any() or forecast_dates_need_year(frame[item.revenue.date_column]):
            raise HTTPException(422, "The date column needs complete dates, including a year.")
        mask = dates.between(pd.Timestamp(definition.date_range.start), pd.Timestamp(definition.date_range.end) + pd.Timedelta(days=1), inclusive="left")
        values = list(dict.fromkeys(frame.loc[mask, definition.group_column].map(dimension_value)))
        if len(values) > 100:
            raise HTTPException(422, "This comparison has more than 100 groups. Apply a filter or choose a broader grouping.")
        tasks = [("Missing value" if value is None else "Empty value" if value == "" else value, item,
                  {"column": definition.group_column, "values": [value]}) for value in values]
    cache = {}
    catalogs = {identity: metric_catalog(dataset, frame) for identity, (dataset, frame) in frames.items()}
    for name, item, group_filter in tasks:
        totals, issues = [], []
        for selection in [item.revenue, *item.costs]:
            key = (selection.model_dump_json(), str(group_filter))
            if key not in cache:
                cache[key] = amount(frames, selection, definition, catalogs[selection.dataset_id], group_filter=group_filter)
            total, issue = cache[key]
            totals.append(total)
            if issue:
                issues.append(issue)
        revenue = totals[0]
        costs = sum(totals[1:]) if all(value is not None for value in totals[1:]) else None
        if costs is not None and (costs < 0 or not math.isfinite(costs)):
            issues.append("Costs must have a non-negative, finite total. Check credits and duplicated adjustments.")
            costs = None
        complete = revenue is not None and costs is not None and not issues
        ratio = revenue / costs if complete and costs > 0 else None
        if complete and definition.kind == "return" and costs == 0:
            issues.append("No spending recorded. Revenue per dollar cannot be calculated.")
        margin = 100 * (revenue - costs) / revenue if complete and revenue > 0 else None
        if (ratio is not None and not math.isfinite(ratio)) or (margin is not None and not math.isfinite(margin)):
            issues.append("These amounts cannot produce a usable return or margin. Check the selected columns and units.")
        result["rows"].append({"name": name, "revenue": revenue, "costs": costs,
            "return_per_dollar": round(ratio, 4) if ratio is not None and math.isfinite(ratio) else None,
            "money_left": round(revenue - costs, 2) if complete else None,
            "margin_percent": round(margin, 2) if margin is not None and math.isfinite(margin) else None,
            "issues": list(dict.fromkeys(issues)), "ready": complete and not issues})
    ready = [row for row in result["rows"] if row["ready"]]
    if ready:
        result["status"] = "ready" if len(ready) == len(result["rows"]) else "partial"
        result["headline"] = "Your recorded results are ready." if result["status"] == "ready" else "Some results are incomplete. No overall winner is shown."
        result["next_action"] = "Review the included costs before deciding what to change." if definition.kind == "profit" else "Compare revenue per dollar alongside the amount spent. This is not a profit measure."
    rankable = result["status"] == "ready" and (definition.kind == "profit" or definition.revenue_basis == "assigned_sales")
    sort_key = "return_per_dollar" if definition.kind == "return" else "money_left"
    result["rows"].sort(key=lambda row: (row["ready"], row.get(sort_key) if row.get(sort_key) is not None else -math.inf), reverse=True)
    if rankable and len(ready) > 1:
        highest = max(round(row[sort_key], 2) for row in ready)
        winners = [row for row in ready if round(row[sort_key], 2) == highest]
        if len(winners) == 1:
            winner = winners[0]
            result["winner"] = winner["name"]
            result["headline"] = (f"{winner['name']} returned the most recorded revenue per dollar spent."
                if definition.kind == "return" else f"{winner['name']} left the most money after selected costs." if highest >= 0
                else f"All groups lost money after selected costs. {winner['name']} had the smallest loss.")
        else:
            result["headline"] = "The leading results are tied at the displayed precision."
    if result["status"] == "ready" and definition.kind == "return" and definition.revenue_basis == "platform_reported":
        result["headline"] = "Each ad platform's sales figures are shown separately, without an overall winner."
        result["next_action"] = "To compare channels fairly, use sales records that credit each sale to one channel, with the same tracking method across channels."
    return result
