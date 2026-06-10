from fastapi import APIRouter, HTTPException, Request

from app.db.database import SessionLocal
from app.db.models import (
    Organization,
    UserPreference,
)

from app.modules.organizations.schemas import (
    OrganizationCreate,
    DatasetPreferenceUpdate,
    DatasetPreferenceResponse,
)

router = APIRouter()


@router.post("/")
async def create_organization(
    request: Request,
    organization: OrganizationCreate,
):
    user_id = request.headers.get("X-User-Id")

    if not user_id:
        raise HTTPException(
            status_code=401,
            detail="Missing user id",
        )

    db = SessionLocal()

    try:
        existing = (
            db.query(Organization).filter(Organization.owner_user_id == user_id).first()
        )

        if existing:
            raise HTTPException(
                status_code=400,
                detail="Organization already exists",
            )

        organization_record = Organization(
            name=organization.name, owner_user_id=user_id
        )

        db.add(organization_record)

        db.commit()

        db.refresh(organization_record)

        return {
            "id": organization_record.id,
            "name": organization_record.name,
        }

    finally:
        db.close()


@router.get("/me")
async def get_my_organization(
    request: Request,
):
    user_id = request.headers.get("X-User-Id")

    if not user_id:
        raise HTTPException(
            status_code=401,
            detail="Missing user id",
        )

    db = SessionLocal()

    try:
        organization = (
            db.query(Organization).filter(Organization.owner_user_id == user_id).first()
        )

        if not organization:
            return None

        return {
            "id": organization.id,
            "name": organization.name,
        }

    finally:
        db.close()


@router.get(
    "/preferences/dataset",
    response_model=DatasetPreferenceResponse,
)
async def get_dataset_preference(
    request: Request,
):
    user_id = request.headers.get("X-User-Id")

    if not user_id:
        raise HTTPException(
            status_code=401,
            detail="Missing user id",
        )

    db = SessionLocal()

    try:
        preference = (
            db.query(UserPreference)
            .filter(UserPreference.clerk_user_id == user_id)
            .first()
        )

        return {
            "selected_dataset_id": (
                preference.selected_dataset_id if preference else None
            ),
            "selected_metric": preference.selected_metric if preference else None,
        }

    finally:
        db.close()


@router.post(
    "/preferences/dataset",
    response_model=DatasetPreferenceResponse,
)
async def update_dataset_preference(
    request: Request,
    payload: DatasetPreferenceUpdate,
):
    user_id = request.headers.get("X-User-Id")

    if not user_id:
        raise HTTPException(
            status_code=401,
            detail="Missing user id",
        )

    db = SessionLocal()

    try:
        preference = (
            db.query(UserPreference)
            .filter(UserPreference.clerk_user_id == user_id)
            .first()
        )

        if not preference:
            preference = UserPreference(
                clerk_user_id=user_id,
                selected_dataset_id=payload.dataset_id,
                selected_metric=payload.selected_metric,
            )

            db.add(preference)

        else:
            preference.selected_dataset_id = payload.dataset_id

            preference.selected_metric = payload.selected_metric

        db.commit()

        return {
            "selected_dataset_id": preference.selected_dataset_id,
            "selected_metric": preference.selected_metric,
        }

    finally:
        db.close()
