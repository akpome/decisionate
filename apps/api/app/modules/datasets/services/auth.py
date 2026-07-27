from fastapi import Request

from app.modules.auth_context import (
    get_auth_context,
)

auth_context_cache_key = "_decisionate_auth_context"


def get_request_auth_context(
    request: Request,
):
    request_state = getattr(
        request,
        "state",
        None,
    )

    if request_state is not None and hasattr(
        request_state,
        auth_context_cache_key,
    ):
        return getattr(
            request_state,
            auth_context_cache_key,
        )

    auth_context = get_auth_context(
        request,
    )

    if request_state is not None:
        setattr(
            request_state,
            auth_context_cache_key,
            auth_context,
        )

    return auth_context


def get_user_id(
    request: Request,
) -> str:
    return get_request_auth_context(
        request,
    ).user_id


def get_workspace_id(
    request: Request,
    user_id: str,
) -> str:
    auth_context = get_request_auth_context(
        request,
    )

    if auth_context.user_id != user_id:
        return auth_context.user_id

    return auth_context.workspace_id


def get_workspace_role(
    request: Request,
) -> str:
    return get_request_auth_context(
        request,
    ).workspace_role


def require_workspace_data_manager(
    request: Request,
):
    request_state = getattr(
        request,
        "state",
        None,
    )

    if (
        not hasattr(
            request,
            "headers",
        )
        and not (
            request_state is not None
            and hasattr(
                request_state,
                auth_context_cache_key,
            )
        )
    ):
        return

    workspace_role = get_workspace_role(
        request,
    )

    if workspace_role != "owner":
        from fastapi import HTTPException

        raise HTTPException(
            status_code=403,
            detail="Only workspace owners can modify workspace data setup",
        )
