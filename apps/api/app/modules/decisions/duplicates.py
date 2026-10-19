"""Non-destructive reconciliation of duplicate decisions and legacy evidence drafts."""

from collections import defaultdict
from datetime import datetime
import json

from sqlalchemy import exists, func, insert, or_, select, update

from .activity_models import DecisionActivity
from .models import Decision, DecisionCreationRequest, DecisionDuplicate
from .titles import is_legacy_evidence_placeholder


def canonical_decisions():
    return ~exists().where(DecisionDuplicate.duplicate_id == Decision.id)


def legacy_join_draft_key(record):
    if not is_legacy_evidence_placeholder(record["title"], record["action"]):
        return None
    # Do not combine drafts with recorded work or deliberately assigned review responsibilities.
    if any(record[name] not in (None, "") for name in (
        "notes", "actual_outcome", "lessons_learned", "outcome_status", "review_date",
        "assigned_user_id", "confidence_score", "outcome_baseline_value", "outcome_measured_value",
        "outcome_delta_percent", "outcome_measured_at",
    )) or (not record["metric_column"] and record["outcome_dataset_id"] is not None):
        return None
    try:
        sources = json.loads(record["evidence_dataset_ids"] or "[]")
        metrics = json.loads(record["evidence_metrics"] or "[]")
        if not isinstance(sources, list) or not isinstance(metrics, list):
            return None
        if any(isinstance(value, bool) or not str(value).isdigit() or int(value) <= 0 for value in sources):
            return None
        sources = sorted({record["dataset_id"], *(int(value) for value in sources)})
        if len(sources) < 2 or not record["recommendation_context"]:
            return None
    except (TypeError, ValueError):
        return None
    ignored = {"id", "created_at", "updated_at", "creation_request_key", "creation_payload_hash",
               "title", "action", "metric_column", "outcome_dataset_id"}
    state = {name: value for name, value in record.items() if name not in ignored}
    state["evidence_dataset_ids"] = sources
    state["evidence_metrics"] = sorted(json.dumps(item, sort_keys=True) for item in metrics)
    try:
        state["recommendation_context"] = json.loads(record["recommendation_context"])
    except ValueError:
        state["recommendation_context"] = record["recommendation_context"].strip()
    return json.dumps(state, sort_keys=True)


def reconcile_legacy_join_drafts(connection):
    decisions = Decision.__table__
    rows = connection.execute(select(decisions).where(
        decisions.c.status == "planned", canonical_decisions(),
        or_(decisions.c.title == "Review joined dataset evidence", decisions.c.title.startswith("Review joined evidence:")),
    )).mappings()
    groups = defaultdict(list)
    for record in rows:
        key = legacy_join_draft_key(record)
        if key is not None:
            groups[key].append(record)
    for records in groups.values():
        choices = {(item["outcome_dataset_id"] or item["dataset_id"], item["metric_column"])
                   for item in records if item["metric_column"]}
        # A blank draft cannot choose between two deliberately different outcome metrics.
        if len(choices) > 1:
            continue
        canonical = max(records, key=lambda item: (
            bool(item["metric_column"]), item["outcome_dataset_id"] is not None,
            item["updated_at"] or item["created_at"] or datetime.min, item["id"],
        ))
        aliases = [{"duplicate_id": item["id"], "canonical_id": canonical["id"]}
                   for item in records if item["id"] != canonical["id"]]
        if aliases:
            connection.execute(insert(DecisionDuplicate), aliases)


def reconcile_duplicate_decisions(connection):
    decisions, duplicates = Decision.__table__, DecisionDuplicate.__table__
    ignored = {"id", "created_at", "updated_at", "creation_request_key", "creation_payload_hash"}
    # Every saved action, evidence and workflow field must match, not just a title or dataset.
    state = [column for column in decisions.c if column.name not in ignored]
    connection.execute(select(decisions.c.id).where(
        decisions.c.status.in_(("planned", "in_progress")), canonical_decisions(),
    ).order_by(decisions.c.id).with_for_update()).all()
    ranked = select(
        decisions.c.id.label("duplicate_id"),
        func.min(decisions.c.id).over(partition_by=state).label("canonical_id"),
    ).where(decisions.c.status.in_(("planned", "in_progress")), canonical_decisions()).subquery()
    pairs = select(ranked.c.duplicate_id, ranked.c.canonical_id).where(ranked.c.duplicate_id != ranked.c.canonical_id)
    connection.execute(insert(duplicates).from_select(["duplicate_id", "canonical_id"], pairs))
    reconcile_legacy_join_drafts(connection)

    # Flatten older aliases if their canonical record has since become an exact duplicate.
    target = duplicates.alias("target")
    connection.execute(update(duplicates).where(
        duplicates.c.canonical_id.in_(select(target.c.duplicate_id)),
    ).values(canonical_id=select(target.c.canonical_id).where(
        target.c.duplicate_id == duplicates.c.canonical_id,
    ).scalar_subquery()))

    for model, field in ((DecisionActivity, "decision_id"), (DecisionCreationRequest, "decision_id")):
        table = model.__table__
        connection.execute(update(table).where(table.c[field].in_(select(duplicates.c.duplicate_id))).values({
            field: select(duplicates.c.canonical_id).where(duplicates.c.duplicate_id == table.c[field]).scalar_subquery(),
        }))
