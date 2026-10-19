"""Non-destructive reconciliation of exact duplicate active decision records."""

from sqlalchemy import exists, func, insert, select, update

from .activity_models import DecisionActivity
from .models import Decision, DecisionCreationRequest, DecisionDuplicate


def canonical_decisions():
    return ~exists().where(DecisionDuplicate.duplicate_id == Decision.id)


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
