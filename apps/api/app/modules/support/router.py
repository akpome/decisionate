import re

from fastapi import APIRouter
from fastapi import HTTPException
from fastapi import Request

from app.db.database import SessionLocal
from app.db.models import Organization
from app.modules.auth_context import get_auth_context
from app.modules.alerts.email_delivery import (
    send_support_request_email,
)
from app.modules.support.schemas import (
    SupportRequestCreate,
    SupportRequestResponse,
)


router = APIRouter()


def get_workspace_name(workspace_id: str) -> str:
    try:
        organization_id = int(str(workspace_id or "").strip())
    except (TypeError, ValueError):
        return ""

    db = SessionLocal()
    try:
        organization = (
            db.query(Organization)
            .filter(Organization.id == organization_id)
            .first()
        )
        return str(getattr(organization, "name", "") or "").strip()
    except Exception:
        return ""
    finally:
        db.close()


def clean_support_text(
    value: str,
    field_name: str,
    maximum: int,
) -> str:
    clean_value = str(value or "").strip()

    if not clean_value:
        raise HTTPException(
            status_code=400,
            detail=f"{field_name} is required",
        )

    if len(clean_value) > maximum:
        raise HTTPException(
            status_code=400,
            detail=f"{field_name} must be {maximum} characters or fewer",
        )

    return clean_value


def clean_support_email(value: str) -> str:
    email = clean_support_text(
        value,
        "Requester email",
        254,
    ).lower()

    if not re.fullmatch(
        r"[^@\s]+@[^@\s]+\.[^@\s]+",
        email,
    ):
        raise HTTPException(
            status_code=400,
            detail="Requester email must be valid",
        )

    return email


@router.post(
    "/requests",
    response_model=SupportRequestResponse,
    status_code=202,
)
async def create_support_request(
    payload: SupportRequestCreate,
    request: Request,
):
    auth_context = get_auth_context(request)
    request_type = payload.request_type
    requester_email = clean_support_email(
        payload.requester_email,
    )
    subject = clean_support_text(
        payload.subject,
        "Subject",
        160,
    )
    message = clean_support_text(
        payload.message,
        "Message",
        10000,
    )
    page_url = str(payload.page_url or "").strip()[:500]
    workspace_name = get_workspace_name(
        auth_context.workspace_id,
    )
    user_agent = str(
        request.headers.get("user-agent", "")
        or ""
    ).strip()[:500]
    referer = str(
        request.headers.get("referer", "")
        or ""
    ).strip()[:500]

    try:
        send_support_request_email(
            request_type=request_type,
            requester_email=requester_email,
            subject=subject,
            message=message,
            page_url=page_url,
            user_id=auth_context.user_id,
            authenticated_email=auth_context.email or "",
            workspace_id=auth_context.workspace_id,
            workspace_name=workspace_name,
            workspace_role=auth_context.workspace_role,
            user_agent=user_agent,
            referer=referer,
        )
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(
            status_code=502,
            detail="Support message could not be delivered",
        ) from error

    return SupportRequestResponse(
        accepted=True,
        message="Your message has been sent to Decisionate support.",
    )
