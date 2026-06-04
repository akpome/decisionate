from fastapi import APIRouter
from fastapi import HTTPException
from fastapi import Request

from app.db.database import SessionLocal
from app.db.models import Organization

from app.modules.organizations.schemas import (
    OrganizationCreate,
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
