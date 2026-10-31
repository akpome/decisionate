"""Observed repeat purchases, matched sales steps and scheduled cash scenarios."""

from types import SimpleNamespace

import numpy as np
import pandas as pd
from fastapi import HTTPException

from app.modules.correlation.catalog import metric_catalog, normalize_dates, reporting_timezone
from app.modules.correlation.schemas import DateRange
from app.modules.datasets.services.dimension_filters import apply_dimension_filter, dimension_columns, dimension_value, DimensionFilterError
from app.modules.datasets.services.joins import _parse_dates
from app.modules.forecasting.services import forecast_dates_need_year
from .growth_schemas import CashFlowDefinition, ConversionDefinition, RetentionDefinition, references
from .service import amount


def source_records(frames, source, metrics=()):
    dataset, frame = frames[source.dataset_id]
    try:
        frame = apply_dimension_filter(dataset, frame, source.dimension_filter.model_dump() if source.dimension_filter else None, metrics=metrics)
    except DimensionFilterError as error:
        raise HTTPException(422, str(error)) from error
    if source.date_column not in frame:
        raise HTTPException(422, "Choose a date column from this dataset.")
    if frame.empty:
        raise HTTPException(422, "No records match this selection.")
    dates = _parse_dates(normalize_dates(frame[source.date_column], reporting_timezone()))
    if dates.isna().any() or forecast_dates_need_year(frame[source.date_column]):
        raise HTTPException(422, "The records need valid dates, including a year. Missing dates are not ignored.")
    return dataset, frame, dates.dt.normalize()


def column(key, label, format="count"):
    return {"key": key, "label": label, "format": format}


def highlight(label, value, format="count"):
    return {"label": label, "value": value, "format": format}


def calculate_growth(frames, definition):
    title = {"retention": "Customer retention", "conversion": "Sales conversion", "cashflow": "Cash flow planning"}[definition.kind]
    start = definition.start_date if isinstance(definition, CashFlowDefinition) else definition.date_range.start
    end = start + pd.Timedelta(weeks=definition.weeks) - pd.Timedelta(days=1) if isinstance(definition, CashFlowDefinition) else definition.date_range.end
    result = {"name": f"{title}: {start} to {end}", "definition": definition.model_dump(mode="json"),
              "generated_at": pd.Timestamp.now(tz="UTC").isoformat(), "status": "needs_data", "rows": [], "columns": [],
              "headline": "Check the selected records before comparing.", "next_action": "", "highlights": [], "chart": None,
              "limitations": [], "period": {"start": str(start), "end": str(end)}}
    if not definition.amounts_confirmed:
        result["next_action"] = "Confirm the records and coverage before comparing."
        return result
    try:
        if isinstance(definition, RetentionDefinition):
            retention(frames, definition, result)
        elif isinstance(definition, ConversionDefinition):
            conversion(frames, definition, result)
        else:
            cash_flow(frames, definition, result)
    except HTTPException as error:
        if error.status_code != 422:
            raise
        result.update(status="needs_data", rows=[], highlights=[], chart=None)
        result["next_action"] = str(error.detail)
    return result


def retention(frames, definition, result):
    _, frame, dates = source_records(frames, definition.source)
    for name in (definition.customer_column, definition.order_column):
        if name not in frame:
            raise HTTPException(422, "Choose an available customer ID and purchase ID column.")
    through = min(pd.Timestamp(definition.date_range.end), pd.Timestamp.now(tz=reporting_timezone()).tz_localize(None).normalize(), dates.max())
    observed = dates <= through
    purchases = pd.DataFrame({"customer": frame.loc[observed, definition.customer_column].astype("string").str.strip(),
                              "purchase": frame.loc[observed, definition.order_column].astype("string").str.strip(), "date": dates.loc[observed]})
    if purchases.empty:
        raise HTTPException(422, "No completed purchases are available in these dates.")
    if purchases[["customer", "purchase"]].isna().any().any() or purchases[["customer", "purchase"]].eq("").any().any():
        raise HTTPException(422, "Some purchases have no customer ID or purchase ID. Complete these records before comparing.")
    if (purchases.groupby("purchase")[["customer", "date"]].nunique() > 1).any().any():
        raise HTTPException(422, "A purchase ID refers to different customers or dates. Use a unique purchase identifier.")
    purchases = purchases.drop_duplicates("purchase").sort_values("date", kind="stable")
    first = purchases.groupby("customer").date.min()
    first = first.loc[first >= pd.Timestamp(definition.date_range.start)]
    cutoff = through - pd.Timedelta(days=definition.return_days)
    eligible = first.loc[first <= cutoff]
    later = purchases.loc[purchases.duplicated("customer")].copy()
    later["first"] = later.customer.map(first)
    returned = set(later.loc[(later.date - later["first"]).dt.days.between(0, definition.return_days), "customer"])
    result["columns"] = [column("name", "First recorded purchase", "text"), column("eligible", "Enough follow-up"),
                         column("returned", "Bought again"), column("rate", f"Returned in {definition.return_days} days", "percent"), column("waiting", "Too early to tell")]
    for month in sorted(first.dt.to_period("M").unique()):
        customers = first.loc[first.dt.to_period("M") == month]
        mature = customers.loc[customers.index.isin(eligible.index)]
        repeat = sum(identity in returned for identity in mature.index)
        result["rows"].append({"name": str(month), "eligible": len(mature), "returned": repeat,
                               "rate": round(100 * repeat / len(mature), 2) if len(mature) else None,
                               "waiting": len(customers) - len(mature), "ready": len(mature) > 0, "issues": []})
    repeats = sum(identity in returned for identity in eligible.index)
    rate = round(100 * repeats / len(eligible), 2) if len(eligible) else None
    result["highlights"] = [highlight("Customers with enough follow-up", len(eligible)), highlight("Bought again", repeats),
                            highlight(f"Returned within {definition.return_days} days", rate, "percent"), highlight("Too early to tell", len(first) - len(eligible))]
    result["limitations"] = [f"Follow-up ends on {through.date()}. Each included customer has {definition.return_days} days to buy again.",
        "First recorded purchase means first in the available, filtered history, not necessarily the customer's first-ever purchase.",
        "Only completed purchases should be included. Duplicate lines with the same purchase ID count once. Customer identifiers are not included in results.",
        "A customer who has not bought again within this window is not automatically lost. This is repeat-purchase retention, not subscription cancellation."]
    result["chart"] = {"label": f"Customers who bought again within {definition.return_days} days", "format": "percent",
                        "points": [{"name": row["name"], "value": row["rate"]} for row in result["rows"] if row["ready"]]}
    if len(eligible):
        result["status"] = "ready"
        result["headline"] = f"{repeats:,} of {len(eligible):,} customers bought again within {definition.return_days} days."
        result["next_action"] = "Compare purchase months with the same follow-up window before changing your repeat-customer offers."
    else:
        result["headline"] = "It is too early to judge repeat purchases for these customers."
        result["next_action"] = "Choose earlier purchase dates or a shorter return window. Customers still waiting are not counted as lost."


def conversion(frames, definition, result):
    refs = references(definition)
    dataset, frame, dates = source_records(frames, definition.source, [ref.metric_key for ref in refs])
    mask = dates.between(pd.Timestamp(definition.date_range.start), pd.Timestamp(definition.date_range.end))
    if not mask.any():
        raise HTTPException(422, "No matching sales-step records are available in these dates.")
    groups = [("All selected records", None)]
    if definition.group_column:
        if definition.group_column not in {item["column"] for item in dimension_columns(dataset, frame)}:
            raise HTTPException(422, "Choose an available column to compare groups.")
        values = list(dict.fromkeys(frame.loc[mask, definition.group_column].map(dimension_value)))
        if len(values) > 100:
            raise HTTPException(422, "Choose a filter with no more than 100 groups.")
        groups = [("Missing value" if value is None else "Empty value" if value == "" else value,
                   {"column": definition.group_column, "values": [value]}) for value in values]
    catalog = metric_catalog(*frames[definition.source.dataset_id])
    result["columns"] = [column("name", "Comparison", "text"), *[column(f"step_{index}", step.name) for index, step in enumerate(definition.steps)],
                         column("rate", "Reached the final step", "percent"), column("lost", "Did not reach the final step")]
    for name, group_filter in groups:
        counts, issues = [], []
        for ref in refs:
            total, issue = amount(frames, ref, definition, catalog, group_filter=group_filter, count=True)
            counts.append(int(total) if total is not None else None)
            if issue:
                issues.append(issue)
        if not issues and any(after > before for before, after in zip(counts, counts[1:])):
            issues.append("A later step has more people or opportunities than an earlier step. Use matching groups and count each once at each step.")
        if not issues and counts[0] == 0:
            issues.append("No people or opportunities entered the first step, so a conversion rate is unavailable.")
        ready = not issues
        result["rows"].append({"name": name, **{f"step_{index}": value for index, value in enumerate(counts)},
                               "rate": round(100 * counts[-1] / counts[0], 2) if ready else None,
                               "lost": counts[0] - counts[-1] if ready else None, "ready": ready, "issues": issues})
    complete = [row for row in result["rows"] if row["ready"]]
    result["limitations"] = ["Steps must refer to the same people or sales opportunities, in order, with each counted once per step and the same follow-up window.",
        "These totals do not match individuals across systems. Repeated sessions, orders and unique customers are not interchangeable counts.",
        "The largest loss shows where to investigate. It does not prove the cause or predict how many sales a change will recover."]
    result["chart"] = {"label": "Reached the final step", "format": "percent",
                        "points": [{"name": row["name"], "value": row["rate"]} for row in complete]}
    if len(complete) != len(result["rows"]):
        result["status"] = "partial" if complete else "needs_data"
        result["headline"] = "Some sales steps cannot be fairly compared yet."
        result["next_action"] = "Check the record notes before drawing an overall conclusion."
        return
    totals = [sum(row[f"step_{index}"] for row in complete) for index in range(len(refs))]
    losses = [before - after for before, after in zip(totals, totals[1:])]
    biggest = int(np.argmax(losses))
    rate = 100 * totals[-1] / totals[0]
    result["status"] = "ready"
    result["headline"] = f"{totals[-1]:,} of {totals[0]:,} reached {definition.steps[-1].name} ({rate:.1f}%)."
    tied = sum(value == losses[biggest] for value in losses) > 1
    result["next_action"] = ("Every recorded entrant reached the final step." if max(losses) == 0 else
        "Several steps share the largest loss. Review their counts before choosing where to improve." if tied else
        f"The largest loss is between {definition.steps[biggest].name} and {definition.steps[biggest + 1].name}: {losses[biggest]:,} did not continue.")
    result["highlights"] = [highlight("Entered the first step", totals[0]), highlight("Reached the final step", totals[-1]),
                            highlight("Overall conversion", round(rate, 2), "percent")]
    if len(groups) == 1:
        result["chart"] = {"label": "People or opportunities at each step", "format": "count",
                            "points": [{"name": step.name, "value": total} for step, total in zip(definition.steps, totals)]}


def cash_flow(frames, definition, result):
    refs = references(definition)
    dataset, frame, dates = source_records(frames, definition.source, [ref.metric_key for ref in refs])
    start = pd.Timestamp(definition.start_date)
    end = start + pd.Timedelta(weeks=definition.weeks) - pd.Timedelta(days=1)
    relevant = dates.between(start, end)
    if not relevant.any():
        raise HTTPException(422, "No scheduled receipts or payments fall within this plan. Choose the payment schedule and its due-date column.")
    catalog = metric_catalog(*frames[definition.source.dataset_id])
    # Validate the whole selected schedule before calculating any weekly balances.
    scope = SimpleNamespace(date_range=DateRange(start=start.date(), end=end.date()), currency=definition.currency)
    for ref in refs:
        _, issue = amount(frames, ref, scope, catalog)
        if issue:
            raise HTTPException(422, issue)
        if (pd.to_numeric(frame.loc[relevant, ref.metric_key], errors="coerce") < 0).any():
            raise HTTPException(422, "Scheduled money in and money out must be non-negative amounts in separate columns.")
    base_balance = plan_balance = definition.opening_balance
    lowest, first_shortfall = plan_balance, None
    # The opening balance is before the first plan date; later collections move only receipts within this schedule.
    scheduled = frame.loc[relevant].copy()
    scheduled[definition.source.date_column] = dates.loc[relevant]
    adjusted = scheduled.copy()
    adjusted[definition.source.date_column] += pd.Timedelta(days=definition.collection_delay_days)
    clean_refs = [ref.model_copy(update={"dimension_filter": None}) for ref in refs]
    for index in range(definition.weeks):
        week_start = start + pd.Timedelta(weeks=index)
        week_end = week_start + pd.Timedelta(days=6)
        period = SimpleNamespace(date_range=DateRange(start=week_start.date(), end=week_end.date()), currency=definition.currency)
        def total(ref, records):
            if not records[definition.source.date_column].between(week_start, week_end).any():
                return 0.0
            value, issue = amount({definition.source.dataset_id: (dataset, records)}, ref, period, catalog)
            if issue:
                raise HTTPException(422, issue)
            return value
        incoming = total(clean_refs[0], scheduled)
        outgoing = total(clean_refs[1], scheduled)
        planned_in = total(clean_refs[0], adjusted) * (1 + definition.income_change_percent / 100)
        planned_out = outgoing * (1 + definition.cost_change_percent / 100)
        base_balance += incoming - outgoing
        plan_balance += planned_in - planned_out
        lowest = min(lowest, plan_balance)
        if first_shortfall is None and plan_balance < definition.reserve:
            first_shortfall = str(week_start.date())
        result["rows"].append({"name": str(week_start.date()), "incoming": round(planned_in, 2), "outgoing": round(planned_out, 2),
                               "balance": round(plan_balance, 2), "baseline": round(base_balance, 2), "ready": True, "issues": []})
    result["status"] = "ready"
    result["columns"] = [column("name", "Week starting", "text"), column("incoming", "Expected money in", "money"),
                         column("outgoing", "Expected money out", "money"), column("balance", "Planned closing cash", "money"), column("baseline", "Without adjustments", "money")]
    result["headline"] = ("Starting cash is already below your chosen minimum." if definition.opening_balance < definition.reserve else
                          f"Planned cash falls below your minimum in the week of {first_shortfall}." if first_shortfall else
                          "Planned cash stays at or above your minimum at each week-end.")
    result["next_action"] = ("Review collection dates, payment commitments and the size of the shortfall before committing more cash."
                             if lowest < definition.reserve else "Keep the payment schedule current. Week-end balances can still hide a shortfall within the week.")
    result["highlights"] = [highlight("Cash at the end", round(plan_balance, 2), "money"), highlight("Lowest planned cash", round(lowest, 2), "money"),
                            highlight("Below your minimum by", round(max(0, definition.reserve - lowest), 2), "money")]
    result["chart"] = {"label": "Planned cash at each week-end", "format": "money",
                        "points": [{"name": row["name"], "value": row["balance"], "baseline": row["baseline"]} for row in result["rows"]]}
    result["limitations"] = ["This is a payment-schedule scenario, not a statistical forecast or a guarantee. Revenue and accounting profit are not the same as cash received.",
        "The starting balance is cash available before the first plan date. Zero weeks mean no payments in the confirmed schedule, not proof that no other obligations exist.",
        "Taxes, payroll, financing, inventory and other obligations appear only when included in the selected schedule. No currency conversion is applied.",
        "Weekly balances do not detect every shortfall within a week. Delayed receipts beyond the plan's last date are excluded, not treated as collected.",
        f"Assumptions: receipts {definition.income_change_percent:+g}%, payments {definition.cost_change_percent:+g}%, receipts delayed {definition.collection_delay_days} days."]
