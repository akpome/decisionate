import os
from dataclasses import dataclass

import jwt
from fastapi import HTTPException, Request
from jwt import PyJWKClient

from app.db.database import SessionLocal
from app.db.models import (
    Organization,
    OrganizationMember,
)


@dataclass
class AuthContext:
    user_id: str
    workspace_id: str
    workspace_role: str = "owner"


_jwks_client: PyJWKClient | None = None
clerk_jwks_timeout_seconds = 3


def clean_auth_value(
    value,
) -> str:
    return str(value or "").strip()


def clean_optional_auth_env_value(
    name: str,
) -> str | None:
    clean_value = clean_auth_value(
        os.getenv(name)
    )

    return clean_value or None


# =========================
# Clerk Token Verification And Development Header Fallback
# =========================

def get_auth_context(
    request: Request,
) -> AuthContext:
    user_id = get_verified_user_id(request)
    clerk_jwks_url = clean_optional_auth_env_value(
        "CLERK_JWKS_URL"
    )
    requested_user_id = request.headers.get(
        "X-User-Id",
    )
    clean_requested_user_id = clean_auth_value(
        requested_user_id
    )

    if (
        clerk_jwks_url
        and clean_requested_user_id
        and clean_requested_user_id != user_id
    ):
        raise HTTPException(
            status_code=403,
            detail="User header does not match authorization token",
        )

    workspace_id, workspace_role = get_verified_workspace_access(
        request,
        user_id,
    )

    return AuthContext(
        user_id=user_id,
        workspace_id=workspace_id,
        workspace_role=workspace_role,
    )


def get_verified_user_id(
    request: Request,
) -> str:
    clerk_jwks_url = clean_optional_auth_env_value(
        "CLERK_JWKS_URL"
    )
    authorization = request.headers.get(
        "Authorization",
    )

    if authorization and clerk_jwks_url:
        return verify_clerk_bearer_token(
            authorization,
        )

    if clerk_jwks_url:
        raise HTTPException(
            status_code=401,
            detail="Missing authorization token",
        )

    user_id = request.headers.get(
        "X-User-Id",
    )

    if not user_id:
        raise HTTPException(
            status_code=401,
            detail="Missing user id",
        )

    clean_user_id = clean_auth_value(
        user_id
    )

    if not clean_user_id:
        raise HTTPException(
            status_code=401,
            detail="Missing user id",
        )

    return clean_user_id


def get_verified_workspace_id(
    request: Request,
    user_id: str,
) -> str:
    workspace_id, _workspace_role = get_verified_workspace_access(
        request,
        user_id,
    )

    return workspace_id


def get_verified_workspace_access(
    request: Request,
    user_id: str,
) -> tuple[str, str]:
    workspace_id = (
        clean_auth_value(
            request.headers.get("X-Workspace-Id")
        )
    )

    if not workspace_id:
        workspace_id = user_id

    clean_user_id = clean_auth_value(
        user_id
    )

    if workspace_id != clean_user_id:
        workspace_role = verify_workspace_membership(
            clean_user_id,
            workspace_id,
        )
    else:
        workspace_role = "owner"

    return workspace_id, workspace_role


# =========================
# Workspace Membership Validation For Agency And Client Access
# =========================

def verify_workspace_membership(
    user_id: str,
    workspace_id: str,
) -> str:
    db = SessionLocal()

    try:
        organization = (
            db.query(Organization)
            .filter(
                Organization.owner_user_id == workspace_id,
            )
            .first()
        )

        if not organization:
            raise HTTPException(
                status_code=403,
                detail="Workspace not available",
            )

        membership = (
            db.query(OrganizationMember)
            .filter(
                OrganizationMember.organization_id == organization.id,
                OrganizationMember.clerk_user_id == user_id,
            )
            .first()
        )

        if not membership:
            raise HTTPException(
                status_code=403,
                detail="Workspace access denied",
            )

        return membership.role

    finally:
        db.close()


def verify_clerk_bearer_token(
    authorization: str,
) -> str:
    authorization = clean_auth_value(
        authorization
    )
    token_prefix = "Bearer "

    if not authorization.startswith(token_prefix):
        raise HTTPException(
            status_code=401,
            detail="Invalid authorization header",
        )

    token = authorization.removeprefix(
        token_prefix,
    ).strip()

    if not token:
        raise HTTPException(
            status_code=401,
            detail="Missing authorization token",
        )

    jwt_audience = clean_optional_auth_env_value(
        "CLERK_JWT_AUDIENCE"
    )
    jwt_issuer = clean_optional_auth_env_value(
        "CLERK_JWT_ISSUER"
    )
    jwks_url = clean_optional_auth_env_value(
        "CLERK_JWKS_URL"
    )

    if not jwks_url:
        raise HTTPException(
            status_code=500,
            detail="Clerk JWT verification is not configured",
        )

    try:
        signing_key = get_jwks_client().get_signing_key_from_jwt(
            token,
        )
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            audience=jwt_audience,
            issuer=jwt_issuer,
            options={
                "verify_aud": jwt_audience is not None,
                "verify_iss": jwt_issuer is not None,
            },
        )
    except jwt.PyJWTError as error:
        raise HTTPException(
            status_code=401,
            detail="Invalid authorization token",
        ) from error

    user_id = clean_auth_value(
        claims.get("sub")
    )

    if not user_id:
        raise HTTPException(
            status_code=401,
            detail="Authorization token missing subject",
        )

    return user_id


def get_jwks_client() -> PyJWKClient:
    global _jwks_client

    jwks_url = clean_optional_auth_env_value(
        "CLERK_JWKS_URL"
    )

    if not jwks_url:
        raise HTTPException(
            status_code=500,
            detail="Clerk JWT verification is not configured",
        )

    if _jwks_client is None:
        _jwks_client = PyJWKClient(
            jwks_url,
            timeout=clerk_jwks_timeout_seconds,
        )

    return _jwks_client
