import re
from time import perf_counter

from fastapi import Request

from app.db.database import SessionLocal
from app.db.models import UsageActivityEvent
from app.modules.auth_context import get_auth_context


IGNORED_ROUTE_PREFIXES = (
    "/docs",
    "/public",
    "/redoc",
    "/static",
)
IGNORED_ROUTES = {
    "/",
    "/favicon.ico",
    "/health",
    "/openapi.json",
}

USAGE_ROUTE = "/admin/usage-activity"
UUID_PATTERN = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)


def is_tracked_route(path: str) -> bool:
    clean_path = str(path or "").rstrip("/") or "/"
    if clean_path == USAGE_ROUTE:
        return False

    if clean_path in IGNORED_ROUTES:
        return False

    return not any(
        clean_path == prefix
        or clean_path.startswith(f"{prefix}/")
        for prefix in IGNORED_ROUTE_PREFIXES
    )


def normalize_usage_route(path: str) -> str:
    segments = str(path or "").split("/")
    normalized_segments = []

    for segment in segments:
        if segment.isdigit() or UUID_PATTERN.fullmatch(segment):
            normalized_segments.append(":id")
        else:
            normalized_segments.append(segment)

    normalized_path = "/".join(normalized_segments).rstrip("/")
    return normalized_path or "/"


def get_request_auth_context(request: Request):
    auth_context = getattr(
        request.state,
        "auth_context",
        None,
    )
    if auth_context is not None:
        return auth_context

    try:
        return get_auth_context(request)
    except Exception:
        return None


def record_usage_activity(
    request: Request,
    status_code: int,
    duration_ms: int,
) -> None:
    if not is_tracked_route(request.url.path):
        return

    auth_context = get_request_auth_context(request)
    if auth_context is None:
        return

    db = SessionLocal()
    try:
        db.add(
            UsageActivityEvent(
                actor_user_id=auth_context.user_id,
                workspace_id=auth_context.workspace_id,
                route=normalize_usage_route(request.url.path),
                method=request.method,
                status_code=int(status_code),
                duration_ms=max(int(duration_ms), 0),
            )
        )
        db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()


async def collect_usage_activity(request: Request, call_next):
    started_at = perf_counter()
    response = None

    try:
        response = await call_next(request)
        return response
    finally:
        duration_ms = round(
            (perf_counter() - started_at) * 1000
        )
        record_usage_activity(
            request,
            response.status_code if response is not None else 500,
            duration_ms,
        )
