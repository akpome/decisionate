from fastapi import APIRouter, Header

from app.db.database import SessionLocal
from app.modules.decisions.models import (
    Decision,
)
from app.modules.decisions.schemas import (
    DecisionCategoryUpdate,
    DecisionCreate,
    DecisionResponse,
    DecisionReviewUpdate,
    DecisionUpdate,
    DecisionNotesUpdate,
    DecisionOutcomeUpdate,
    DecisionLearningUpdate,
    DecisionPriorityUpdate,
)

from fastapi import (
    APIRouter,
    Header,
    HTTPException,
)

router = APIRouter(
    prefix="/decisions",
    tags=["decisions"],
)


@router.post(
    "/",
    response_model=DecisionResponse,
)
async def create_decision(
    payload: DecisionCreate,
    x_user_id: str = Header(alias="X-User-Id"),
):
    db = SessionLocal()

    try:
        decision = Decision(
            clerk_user_id=x_user_id,
            dataset_id=payload.dataset_id,
            title=payload.title,
            description=payload.description,
        )

        db.add(decision)

        db.commit()

        db.refresh(decision)

        return decision

    finally:
        db.close()


@router.get(
    "/",
    response_model=list[DecisionResponse],
)
async def get_decisions(
    x_user_id: str = Header(alias="X-User-Id"),
):
    db = SessionLocal()

    try:
        return (
            db.query(Decision)
            .filter(Decision.clerk_user_id == x_user_id)
            .order_by(Decision.created_at.desc())
            .all()
        )

    finally:
        db.close()


@router.patch(
    "/{decision_id}",
    response_model=DecisionResponse,
)
async def update_decision(
    decision_id: int,
    payload: DecisionUpdate,
    x_user_id: str = Header(alias="X-User-Id"),
):
    db = SessionLocal()

    try:
        decision = (
            db.query(Decision)
            .filter(
                Decision.id == decision_id,
                Decision.clerk_user_id == x_user_id,
            )
            .first()
        )

        if not decision:
            raise HTTPException(
                status_code=404,
                detail="Decision not found",
            )

        decision.status = payload.status

        db.commit()

        db.refresh(decision)

        return decision

    finally:
        db.close()


from fastapi import (
    APIRouter,
    Header,
    HTTPException,
)


@router.get(
    "/{decision_id}",
    response_model=DecisionResponse,
)
async def get_decision(
    decision_id: int,
    x_user_id: str = Header(alias="X-User-Id"),
):
    db = SessionLocal()

    try:
        decision = (
            db.query(Decision)
            .filter(
                Decision.id == decision_id,
                Decision.clerk_user_id == x_user_id,
            )
            .first()
        )

        if not decision:
            raise HTTPException(
                status_code=404,
                detail="Decision not found",
            )

        return decision

    finally:
        db.close()


@router.patch(
    "/{decision_id}/notes",
    response_model=DecisionResponse,
)
async def update_decision_notes(
    decision_id: int,
    payload: DecisionNotesUpdate,
    x_user_id: str = Header(alias="X-User-Id"),
):
    db = SessionLocal()

    try:
        decision = (
            db.query(Decision)
            .filter(
                Decision.id == decision_id,
                Decision.clerk_user_id == x_user_id,
            )
            .first()
        )

        if not decision:
            raise HTTPException(
                status_code=404,
                detail="Decision not found",
            )

        decision.notes = payload.notes

        db.commit()

        db.refresh(decision)

        return decision

    finally:
        db.close()


@router.patch(
    "/{decision_id}/outcome",
    response_model=DecisionResponse,
)
async def update_decision_outcome(
    decision_id: int,
    payload: DecisionOutcomeUpdate,
    x_user_id: str = Header(alias="X-User-Id"),
):
    db = SessionLocal()

    try:
        decision = (
            db.query(Decision)
            .filter(
                Decision.id == decision_id,
                Decision.clerk_user_id == x_user_id,
            )
            .first()
        )

        if not decision:
            raise HTTPException(
                status_code=404,
                detail="Decision not found",
            )

        decision.expected_outcome = payload.expected_outcome

        decision.actual_outcome = payload.actual_outcome

        decision.outcome_status = payload.outcome_status

        db.commit()

        db.refresh(decision)

        return decision

    finally:
        db.close()


@router.patch(
    "/{decision_id}/learning",
    response_model=DecisionResponse,
)
async def update_decision_learning(
    decision_id: int,
    payload: DecisionLearningUpdate,
    x_user_id: str = Header(alias="X-User-Id"),
):
    db = SessionLocal()

    try:
        decision = (
            db.query(Decision)
            .filter(
                Decision.id == decision_id,
                Decision.clerk_user_id == x_user_id,
            )
            .first()
        )

        if not decision:
            raise HTTPException(
                status_code=404,
                detail="Decision not found",
            )

        decision.lessons_learned = payload.lessons_learned

        db.commit()

        db.refresh(decision)

        return decision

    finally:
        db.close()


@router.patch(
    "/{decision_id}/review-date",
    response_model=DecisionResponse,
)
async def update_review_date(
    decision_id: int,
    payload: DecisionReviewUpdate,
    x_user_id: str = Header(alias="X-User-Id"),
):
    db = SessionLocal()

    try:
        decision = (
            db.query(Decision)
            .filter(
                Decision.id == decision_id,
                Decision.clerk_user_id == x_user_id,
            )
            .first()
        )

        if not decision:
            raise HTTPException(
                status_code=404,
                detail="Decision not found",
            )

        decision.review_date = payload.review_date

        db.commit()

        db.refresh(decision)

        return decision

    finally:
        db.close()


@router.patch(
    "/{decision_id}/priority",
    response_model=DecisionResponse,
)
async def update_decision_priority(
    decision_id: int,
    payload: DecisionPriorityUpdate,
    x_user_id: str = Header(alias="X-User-Id"),
):
    db = SessionLocal()

    try:
        decision = (
            db.query(Decision)
            .filter(
                Decision.id == decision_id,
                Decision.clerk_user_id == x_user_id,
            )
            .first()
        )

        if not decision:
            raise HTTPException(
                status_code=404,
                detail="Decision not found",
            )

        decision.priority = payload.priority

        db.commit()

        db.refresh(decision)

        return decision

    finally:
        db.close()


@router.patch(
    "/{decision_id}/category",
    response_model=DecisionResponse,
)
async def update_decision_category(
    decision_id: int,
    payload: DecisionCategoryUpdate,
    x_user_id: str = Header(alias="X-User-Id"),
):
    db = SessionLocal()

    try:
        decision = (
            db.query(Decision)
            .filter(
                Decision.id == decision_id,
                Decision.clerk_user_id == x_user_id,
            )
            .first()
        )

        if not decision:
            raise HTTPException(
                status_code=404,
                detail="Decision not found",
            )

        decision.category = payload.category

        db.commit()

        db.refresh(decision)

        return decision

    finally:
        db.close()
