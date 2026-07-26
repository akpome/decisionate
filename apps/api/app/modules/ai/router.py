from fastapi import APIRouter
from fastapi import Request
from pydantic import BaseModel

from app.modules.ai.service import build_ai_status
from app.modules.auth_context import get_auth_context


router = APIRouter()


class AIStatusResponse(BaseModel):
    configured: bool
    provider: str
    model: str | None = None


@router.get(
    "/status",
    response_model=AIStatusResponse,
)
async def get_ai_status(
    request: Request,
):
    get_auth_context(request)
    return build_ai_status()
