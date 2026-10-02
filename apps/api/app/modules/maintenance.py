from datetime import UTC, datetime

from fastapi import APIRouter
from pydantic import BaseModel

from app.db.database import SessionLocal
from app.db.models import PlatformMaintenanceNotice
router = APIRouter()


class MaintenanceNoticeResponse(BaseModel):
    id: int
    message: str
    scheduled_at: datetime
    status: str


class PlatformAdminMaintenanceResponse(MaintenanceNoticeResponse):
    email_sent_count: int = 0
    email_failed_count: int = 0
    email_failure_message: str | None = None


def as_utc_datetime(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def serialize_maintenance_notice(
    notice: PlatformMaintenanceNotice,
) -> MaintenanceNoticeResponse:
    return MaintenanceNoticeResponse(
        id=notice.id,
        message=notice.message,
        scheduled_at=as_utc_datetime(notice.scheduled_at),
        status=notice.status,
    )


@router.get(
    "/active",
    response_model=MaintenanceNoticeResponse | None,
)
async def get_active_maintenance_notice():
    # This is intentionally public: it only contains a platform-wide
    # availability notice and must work before a Clerk session is ready.
    db = SessionLocal()
    try:
        notice = (
            db.query(PlatformMaintenanceNotice)
            .filter(PlatformMaintenanceNotice.status == "active")
            .order_by(PlatformMaintenanceNotice.id.desc())
            .first()
        )
        return (
            serialize_maintenance_notice(notice)
            if notice
            else None
        )
    finally:
        db.close()
