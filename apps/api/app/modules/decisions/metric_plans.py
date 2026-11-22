"""Two independent targets, measured over fixed complete calendar windows."""

from datetime import date, datetime, time, timedelta, timezone
import json
import logging
from types import SimpleNamespace
from zoneinfo import ZoneInfo

from fastapi import HTTPException

from app.modules.applications import workspace_application_scope
from app.modules.correlation.catalog import metric_catalog, reporting_timezone
from app.modules.correlation.service import authorize_datasets, digest, encode
from app.modules.datasets.services.dataset_loader import load_dataframe_from_dataset
from app.modules.datasets.services.dimension_filters import apply_dimension_filter
from app.modules.datasets.services.numeric import coerce_numeric_series
from app.modules.reports.catalog import prepare_report_source, require_report_sources
from app.modules.reports.impact_timing import decision_timing, response_date
from app.modules.reports.service import metric_value, scoped_frame
from .models import Decision

OPEN = ("planned", "in_progress")
ROLES = ("input", "output")
logger = logging.getLogger(__name__)


def window(start, end):
    return {"start": start.isoformat(), "end": end.isoformat()}


def windows(start, review, lag):
    first = start + timedelta(days=lag)
    days = (review - first).days
    if not 1 <= days <= 366:
        raise ValueError("Choose a review date after the first expected result, with at most one year to measure.")
    return {"before": window(start - timedelta(days=days), start - timedelta(days=1)),
            "after": window(first, review - timedelta(days=1))}


def comparable_key(plan):
    scopes = []
    for role in ROLES:
        t = plan[role]
        selection = t["filter"]
        scopes.append([t[key] for key in ("dataset_id", "metric_key", "aggregation", "date_column", "currency", "metric_unit", "direction")] +
                      [None if not selection else [selection["column"], sorted(map(encode, selection["values"]))]])
    return digest([scopes, plan["timezone"], plan["lag_days"],
                   (date.fromisoformat(plan["review"]) - date.fromisoformat(plan["start"])).days])


def sources(db, user, workspace, ids):
    datasets = authorize_datasets(db, user, workspace, ids)
    require_report_sources(datasets.values())
    # The interactive preview and on-open review run in the API, not a report subprocess.
    if sum((ds.row_count or 0) * (ds.column_count or 0) for ds in datasets.values()) > 2_000_000:
        raise ValueError("These datasets are too large for automatic review. Use daily summaries or review manually.")
    frames = {}
    for identity, ds in datasets.items():
        if (ds.workspace_id or ds.user_id) != workspace:
            raise HTTPException(404, "A selected dataset is unavailable in this workspace.")
        dataset, frame = prepare_report_source(ds, load_dataframe_from_dataset(ds))
        frames[identity] = (dataset, frame, metric_catalog(dataset, frame))
    return frames


def resolve(db, user, workspace, request):
    if (request.input.dataset_id, request.input.metric_key) == (request.output.dataset_id, request.output.metric_key):
        raise ValueError("Choose different metrics for your action and result.")
    frames = sources(db, user, workspace, [request.input.dataset_id, request.output.dataset_id])
    definition = {}
    snapshot = None
    if request.report_id:
        from app.modules.reports.router import allowed_report
        snapshot = json.loads(allowed_report(db, request.report_id, user, workspace).snapshot)
        if snapshot["status"] != "ready":
            raise ValueError("Choose a ready report.")
        definition = snapshot["definition"]
    zone = definition.get("reporting_timezone") or reporting_timezone()
    plan = {"start": str(request.start), "review": str(request.review), "timezone": zone,
            "report_id": request.report_id, "lag_days": 0}
    for role in ROLES:
        target = getattr(request, role).model_dump()
        identity, key = target["dataset_id"], target["metric_key"]
        dataset, _, catalog = frames[identity]
        descriptor = next((m for m in catalog["metrics"] if m["metric_key"] == key), None)
        ref = next((m for m in definition.get("metrics", []) if (m["dataset_id"], m["metric_key"]) == (identity, key)), None)
        if not descriptor or not catalog["date_columns"] or (snapshot and not ref):
            raise ValueError("Choose available, dated metrics from the selected evidence.")
        if descriptor.get("native_grain") == "monthly":
            raise ValueError("Automatic review needs daily records. Use manual review for monthly summaries.")
        column = ref["date_column"] if ref else catalog["date_columns"][0]
        if column not in catalog["date_columns"] or (ref and ref["aggregation"] != descriptor["aggregation"]):
            raise ValueError("The saved report's date column or calculation has changed.")
        plan[role] = {**target, "dataset_label": dataset.file_name, "label": descriptor["label"],
                      "aggregation": descriptor["aggregation"], "date_column": column,
                      "metric_unit": descriptor["unit"], "currency": descriptor.get("currency"),
                      "filter": next((f for f in definition.get("dimension_filters", []) if f["dataset_id"] == identity), None)}
    if snapshot:
        context = SimpleNamespace(recommendation_context=encode({"evidence_kind": "business_report", "report_id": request.report_id}))
        driver = {k: plan["input"][k] for k in ("dataset_id", "metric_key")}
        outcome = {k: plan["output"][k] for k in driver}
        timing = decision_timing(db, context, outcome, user, workspace)
        if timing["status"] == "choose_relationship":
            choice = next((c for c in timing["choices"] if c["driver"] == driver), None)
            if choice:
                timing = decision_timing(db, context, outcome, user, workspace, choice["finding_id"])
        if (timing["status"] == "supported" and timing["driver"] == driver
                and timing["history_window"]["end"] < plan["start"]):
            first = date.fromisoformat(response_date(request.start, timing["lag"], timing["grain"]))
            plan["lag_days"] = (first - request.start).days
            plan["suggested_review"] = str(first + timedelta(days=14))
            if first >= request.review:
                raise ValueError(f"The report suggests the result may start changing on {first}. Try reviewing on {plan['suggested_review']}.")
    for role in ROLES:
        plan[role].update(windows(request.start, request.review, plan["lag_days"] if role == "output" else 0))
    return plan, frames


def observed(frame, target, period, zone):
    scoped, dates = scoped_frame(frame, target["date_column"], period, zone)
    if scoped.empty:
        return None
    valid = coerce_numeric_series(scoped[target["metric_key"]]).replace([float("inf"), -float("inf")], float("nan")).notna()
    days = (date.fromisoformat(period["end"]) - date.fromisoformat(period["start"])).days + 1
    if dates[valid].dt.normalize().nunique() != days:
        return None
    return metric_value(scoped, dates, target)


def evaluate(plan, frames, today):
    due = today.isoformat() >= plan["review"]
    result = {}
    for role in ROLES:
        target = plan[role]
        before = actual = goal = None
        if target["dataset_id"] in frames:
            dataset, frame, catalog = frames[target["dataset_id"]]
            desc = next((m for m in catalog["metrics"] if m["metric_key"] == target["metric_key"]), None)
            if (desc and target["date_column"] in catalog["date_columns"] and desc["aggregation"] == target["aggregation"]
                    and desc.get("currency") == target["currency"] and desc["unit"] == target["metric_unit"]):
                filtered = apply_dimension_filter(dataset, frame, target["filter"], metrics=[target["metric_key"]])
                before = observed(filtered, target, target["before"], plan["timezone"])
                actual = observed(filtered, target, target["after"], plan["timezone"]) if due else None
        if before is not None and (target["unit"] == "amount" or before != 0):
            difference = target["change"] * (1 if target["direction"] == "increase" else -1)
            goal = before + (difference if target["unit"] == "amount" else abs(before) * difference / 100)
        status = "scheduled" if not due else "waiting"
        if due and actual is not None and goal is not None:
            met = round(actual - goal, 10) * (1 if target["direction"] == "increase" else -1) >= 0
            status = "met" if met else "missed"
        result[role] = {"baseline": before, "target": goal, "actual": actual, "status": status}
    status = "scheduled" if not due else "waiting" if any(r["status"] == "waiting" for r in result.values()) else "ready"
    return {"plan": plan, "checks": result, "status": status, "summary": summarize(plan, result, status)}


def summarize(plan, checks, status):
    if status == "scheduled":
        return "Review scheduled for " + plan["review"] + "."
    lines = []
    for role in ROLES:
        item, check = plan[role], checks[role]
        if check["status"] == "waiting":
            lines.append(f"{item['label']}: no percentage comparison from zero." if check["baseline"] == 0 and item["unit"] == "percent"
                         else f"Waiting for complete {item['label']} data from {item['dataset_label']}.")
        else:
            verdict = "target met" if check["status"] == "met" else "target not met"
            lines.append(f"{item['label']}: {check['baseline']:,.4g} to {check['actual']:,.4g} (target {check['target']:,.4g}; {verdict}).")
    return " ".join(lines)


def preview(db, user, workspace, request):
    plan, frames = resolve(db, user, workspace, request)
    review = evaluate(plan, frames, datetime.now(ZoneInfo(plan["timezone"])).date())
    if any(plan[k]["unit"] == "percent" and review["checks"][k]["baseline"] == 0 for k in ROLES):
        raise ValueError("A percentage change cannot be measured from zero. Choose an amount instead.")
    prior = db.query(Decision).filter(Decision.workspace_id == workspace, Decision.metric_scope_hash == comparable_key(plan),
                                      Decision.outcome_measured_at.isnot(None),
                                      Decision.review_date <= datetime.combine(request.start, time.min)).order_by(Decision.review_date.desc(), Decision.id.desc())
    last = prior.first()
    previous = {"id": last.id, "title": last.title, "summary": last.metric_review["summary"]} if last else None
    return review, previous


def schedule(review):
    day = date.fromisoformat(review["plan"]["review"])
    start = datetime.combine(day, time.min, ZoneInfo(review["plan"]["timezone"])).astimezone(timezone.utc).replace(tzinfo=None)
    return max(start, datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(minutes=15))


def store_review(decision, review):
    decision.metric_review_json = encode(review)
    decision.metric_scope_hash = comparable_key(review["plan"])
    decision.next_metric_check = schedule(review)
    outcome = review["checks"].get("output", {})
    ready = review["status"] == "ready"
    decision.outcome_measured_at = datetime.now(timezone.utc).replace(tzinfo=None) if ready else None
    decision.outcome_measured_value = outcome.get("actual") if ready else None
    decision.outcome_baseline_value = outcome.get("baseline") if ready else None
    decision.outcome_delta_percent = ((outcome["actual"] - outcome["baseline"]) / abs(outcome["baseline"]) * 100
                                      if ready and outcome.get("baseline") else None)


def refresh(db, decision, *, on_open=False):
    if not decision.metric_review_json or decision.status not in OPEN:
        return
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    if not on_open and decision.next_metric_check and decision.next_metric_check > now:
        return
    old = decision.metric_review
    plan = old["plan"]
    today = datetime.now(ZoneInfo(plan["timezone"])).date()
    if str(today) < plan["review"]:
        return
    frames = {}
    for identity in {plan[k]["dataset_id"] for k in ROLES}:
        try:
            frames.update(sources(db, decision.clerk_user_id, decision.workspace_id, [identity]))
        except HTTPException as exc:
            if exc.status_code in (401, 402, 403) or exc.status_code >= 500:
                decision.next_metric_check = now + timedelta(minutes=15)
                return
        except (ValueError, KeyError, OSError):
            continue
    try:
        review = evaluate(plan, frames, today)
    except (HTTPException, ValueError, KeyError):
        review = {**old, "status": "waiting", "checks": {},
                  "summary": "Waiting for the original metric columns and filters to be available."}
    if review != old:
        store_review(decision, review)
    decision.next_metric_check = now + (timedelta(hours=24) if review["status"] == "ready" else timedelta(minutes=15))


def run_next_review(db):
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    decision = db.query(Decision).filter(Decision.status.in_(OPEN), Decision.next_metric_check <= now
        ).order_by(Decision.next_metric_check, Decision.id).with_for_update(skip_locked=True).first()
    if decision is not None:
        try:
            with db.begin_nested(), workspace_application_scope(decision.workspace_id, db):
                refresh(db, decision)
        except Exception:
            logger.exception("Automatic decision review deferred: decision_id=%s", decision.id)
            decision.next_metric_check = now + timedelta(minutes=15)
        db.commit()
