from dataclasses import dataclass

import jwt
from fastapi import HTTPException, Request
from jwt import PyJWKClient

from app.db.database import SessionLocal
from app.configuration import get_runtime_configuration
from app.db.models import (
    Organization,
    OrganizationMember,
)
from app.modules.identity.service import (
    DEFAULT_AUTH_PROVIDER,
    resolve_external_identity,
    resolve_workspace_reference,
    sync_external_identity_email,
)


@dataclass
class AuthContext:
    user_id: str
    workspace_id: str
    workspace_role: str = "owner"
    email: str | None = None
    external_user_id: str | None = None
    auth_provider: str = DEFAULT_AUTH_PROVIDER


_jwks_client: PyJWKClient | None = None
clerk_jwks_timeout_seconds = 3


def clean_auth_value(
    value,
) -> str:
    return str(value or "").strip()


def clean_optional_auth_env_value(
    name: str,
) -> str | None:
    runtime = get_runtime_configuration()
    configured_values = {
        "AUTH_JWKS_URL": runtime.auth_jwks_url,
        "CLERK_JWKS_URL": runtime.auth_jwks_url,
        "AUTH_JWT_AUDIENCE": runtime.auth_jwt_audience,
        "CLERK_JWT_AUDIENCE": runtime.auth_jwt_audience,
        "AUTH_JWT_ISSUER": runtime.auth_jwt_issuer,
        "CLERK_JWT_ISSUER": runtime.auth_jwt_issuer,
    }
    clean_value = clean_auth_value(configured_values.get(name))

    return clean_value or None


def get_auth_jwks_url() -> str | None:
    return get_runtime_configuration().auth_jwks_url or None


def get_auth_audience() -> str | None:
    return get_runtime_configuration().auth_jwt_audience or None


def get_auth_issuer() -> str | None:
    return get_runtime_configuration().auth_jwt_issuer or None


# =========================
# Clerk Token Verification And Development Header Fallback
# =========================

def get_auth_context(
    request: Request,
    allow_managed_client_workspace: bool = False,
) -> AuthContext:
    (
        external_user_id,
        user_email,
        email_is_verified,
    ) = get_verified_user_identity(request)
    user_id = resolve_external_identity(
        external_user_id,
        email=user_email,
        provider=DEFAULT_AUTH_PROVIDER,
    )
    if user_email and not email_is_verified:
        sync_external_identity_email(
            external_user_id,
            user_id,
            user_email,
            provider=DEFAULT_AUTH_PROVIDER,
        )
    clerk_jwks_url = get_auth_jwks_url()
    requested_user_id = request.headers.get(
        "X-User-Id",
    )
    clean_requested_user_id = clean_auth_value(
        requested_user_id
    )

    if (
        clerk_jwks_url
        and clean_requested_user_id
        and clean_requested_user_id != external_user_id
    ):
        raise HTTPException(
            status_code=403,
            detail="User header does not match authorization token",
        )

    workspace_id, workspace_role = get_verified_workspace_access(
        request,
        user_id,
        external_user_id=external_user_id,
        allow_managed_client_workspace=allow_managed_client_workspace,
    )

    return AuthContext(
        user_id=user_id,
        workspace_id=workspace_id,
        workspace_role=workspace_role,
        email=user_email,
        external_user_id=external_user_id,
        auth_provider=DEFAULT_AUTH_PROVIDER,
    )


def get_verified_user_id(
    request: Request,
) -> str:
    return get_auth_context(request).user_id


def get_verified_user_identity(
    request: Request,
) -> tuple[str, str | None, bool]:
    clerk_jwks_url = get_auth_jwks_url()
    authorization = request.headers.get(
        "Authorization",
    )

    if authorization and clerk_jwks_url:
        user_id, user_email = verify_clerk_bearer_token_identity(
            authorization,
        )
        header_email = clean_auth_value(
            request.headers.get("X-User-Email")
        ) or None

        # Some Clerk session tokens omit email claims. The client obtains the
        # email from the authenticated Clerk session and sends it separately;
        # keep the provider identity authoritative while allowing pending
        # workspace invites to be claimed by that email.
        return (
            user_id,
            user_email or header_email,
            bool(user_email),
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

    return (
        clean_user_id,
        clean_auth_value(
            request.headers.get("X-User-Email")
        ) or None,
        False,
    )


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
    external_user_id: str | None = None,
    allow_managed_client_workspace: bool = False,
) -> tuple[str, str]:
    workspace_id = resolve_workspace_reference(
        request.headers.get("X-Workspace-Id"),
        user_id,
        external_subject=external_user_id,
    )

    clean_user_id = clean_auth_value(
        user_id
    )

    if is_agency_managed_client_workspace(
        clean_user_id,
        workspace_id,
    ):
        if allow_managed_client_workspace:
            # Organization-management routes use this explicit escape hatch
            # so an agency owner can manage client members without receiving
            # access to the client's datasets or connections.
            workspace_role = "owner"
        elif is_agency_owner_access_enabled(workspace_id):
            workspace_role = "managed_client"
        else:
            raise HTTPException(
                status_code=403,
                detail=(
                    "The client has not granted agency owner access to this "
                    "workspace"
                ),
            )
    elif workspace_id != clean_user_id:
        workspace_role = verify_workspace_membership(
            clean_user_id,
            workspace_id,
        )
        if (
            ":client:" in workspace_id and
            workspace_role == "owner"
        ):
            # Client workspaces inherit agency settings and billing. Even
            # legacy owner memberships must remain client-scoped here.
            workspace_role = "client"
    else:
        workspace_role = "owner"

    return workspace_id, workspace_role


def is_agency_managed_client_workspace(
    user_id: str,
    workspace_id: str,
) -> bool:
    return workspace_id.startswith(
        f"{user_id}:client:"
    )


def is_agency_owner_access_enabled(
    workspace_id: str,
) -> bool:
    db = SessionLocal()

    try:
        organization = (
            db.query(Organization)
            .filter(
                Organization.owner_user_id == workspace_id,
            )
            .first()
        )
        return bool(
            organization and
            organization.agency_owner_access_enabled
        )
    finally:
        db.close()


# =========================
# Workspace Membership Validation For Shared Workspace Access
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

        if (
            membership.role == "client"
            and ":client:" not in organization.owner_user_id
        ):
            return "member"

        return membership.role

    finally:
        db.close()


def verify_clerk_bearer_token(
    authorization: str,
) -> str:
    return verify_clerk_bearer_token_identity(authorization)[0]


def verify_clerk_bearer_token_identity(
    authorization: str,
) -> tuple[str, str | None]:
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

    jwt_audience = get_auth_audience()
    jwt_issuer = get_auth_issuer()
    jwks_url = get_auth_jwks_url()

    if not jwks_url:
        raise HTTPException(
            status_code=500,
            detail="JWT verification is not configured",
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

    user_email = clean_auth_value(
        claims.get("email")
        or claims.get("email_address")
        or claims.get("primary_email_address")
    ) or None

    return user_id, user_email


def get_jwks_client() -> PyJWKClient:
    global _jwks_client

    jwks_url = get_auth_jwks_url()

    if not jwks_url:
        raise HTTPException(
            status_code=500,
            detail="JWT verification is not configured",
        )

    if _jwks_client is None:
        _jwks_client = PyJWKClient(
            jwks_url,
            timeout=clerk_jwks_timeout_seconds,
        )

    return _jwks_client
