from fastapi import HTTPException
from fastapi import Request


def get_user_id(
    request: Request,
) -> str:
    user_id = request.headers.get(
        "X-User-Id"
    )

    if not user_id:
        raise HTTPException(
            status_code=401,
            detail="Missing user id",
        )

    return user_id