from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from urllib.parse import urlencode, urlparse

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse

from app.db.database import SessionLocal
from app.db.models import DataSourceConnection
from app.db.models import OAuthConnectionState
from app.db.models import OAuthCredential
from app.modules.auth_context import get_auth_context
from app.modules.datasets.router import parse_source_connection_config
from app.modules.oauth.service import (
    OAuthProviderUnavailable,
    OAuthTokenExchangeError,
    build_authorization_url,
    create_state_token,
    encrypt_token,
    exchange_code,
    get_freshbooks_businesses,
    get_xero_connections,
    get_web_app_url,
    token_expiry,
)


router = APIRouter()
STATE_TTL_MINUTES = 10


def get_salesforce_instance_url(payload: dict) -> str:
    instance_url = str(payload.get("instance_url") or "").strip().rstrip("/")
    parsed = urlparse(instance_url)
    hostname = (parsed.hostname or "").lower()
    if (
        parsed.scheme != "https"
        or not parsed.netloc
        or parsed.path not in ("", "/")
        or not (
            hostname == "salesforce.com"
            or hostname.endswith(".salesforce.com")
        )
    ):
        raise OAuthTokenExchangeError(
            "Salesforce did not return a valid HTTPS instance URL"
        )
    return instance_url


def get_workspace_connection(db, connection_id: int, auth_context):
    connection = (
        db.query(DataSourceConnection)
        .filter(
            DataSourceConnection.id == connection_id,
            (
                (DataSourceConnection.workspace_id == auth_context.workspace_id)
                | (
                    DataSourceConnection.workspace_id.is_(None)
                    & (DataSourceConnection.user_id == auth_context.user_id)
                )
            ),
        )
        .first()
    )
    if not connection:
        raise HTTPException(
            status_code=404,
            detail="Data source connection not found",
        )
    return connection


@router.get("/connections/{connection_id}/start")
async def start_oauth_connection(
    request: Request,
    connection_id: int,
):
    auth_context = get_auth_context(request)
    if auth_context.workspace_role != "owner":
        raise HTTPException(
            status_code=403,
            detail="Only workspace owners can authorize connectors",
        )

    db = SessionLocal()
    try:
        connection = get_workspace_connection(db, connection_id, auth_context)
        config = parse_source_connection_config(connection.connection_config)
        state_token = create_state_token()
        authorization_url = build_authorization_url(
            connection.source_type,
            state_token,
            config,
        )
        db.add(
            OAuthConnectionState(
                state_token=state_token,
                connection_id=connection.id,
                workspace_id=auth_context.workspace_id,
                user_id=auth_context.user_id,
                source_type=connection.source_type,
                expires_at=datetime.now(UTC).replace(tzinfo=None)
                + timedelta(minutes=STATE_TTL_MINUTES),
            )
        )
        db.commit()
        return {
            "authorization_url": authorization_url,
            "source_type": connection.source_type,
            "expires_in_seconds": STATE_TTL_MINUTES * 60,
        }
    except OAuthProviderUnavailable as error:
        db.rollback()
        raise HTTPException(status_code=503, detail=str(error)) from error
    finally:
        db.close()


@router.delete("/connections/{connection_id}/authorization")
async def cancel_oauth_authorization(
    request: Request,
    connection_id: int,
):
    auth_context = get_auth_context(request)
    if auth_context.workspace_role != "owner":
        raise HTTPException(
            status_code=403,
            detail="Only workspace owners can cancel connector authorization",
        )

    db = SessionLocal()
    try:
        connection = get_workspace_connection(
            db,
            connection_id,
            auth_context,
        )
        credential = (
            db.query(OAuthCredential)
            .filter(OAuthCredential.connection_id == connection.id)
            .first()
        )
        if credential:
            db.delete(credential)

        db.query(OAuthConnectionState).filter(
            OAuthConnectionState.connection_id == connection.id
        ).delete(synchronize_session=False)
        connection.status = "draft"
        db.commit()
        return {
            "message": "Connector authorization cancelled",
            "connection_id": connection.id,
        }
    finally:
        db.close()


def process_oauth_callback(
    request: Request,
    expected_source_type: str | None = None,
):
    query = request.query_params
    state_token = str(query.get("state") or "").strip()
    code = str(query.get("code") or "").strip()
    if not state_token:
        return oauth_redirect("missing_state")
    if query.get("error"):
        return oauth_redirect(str(query.get("error"))[:80])
    if not code:
        return oauth_redirect("missing_code")

    db = SessionLocal()
    try:
        state = (
            db.query(OAuthConnectionState)
            .filter(OAuthConnectionState.state_token == state_token)
            .first()
        )
        now = datetime.now(UTC).replace(tzinfo=None)
        if not state or state.expires_at < now:
            if state:
                db.delete(state)
                db.commit()
            return oauth_redirect("expired_state")

        if (
            expected_source_type
            and state.source_type != expected_source_type
        ):
            db.delete(state)
            db.commit()
            return oauth_redirect(
                "invalid_state",
                expected_source_type,
            )

        connection = (
            db.query(DataSourceConnection)
            .filter(DataSourceConnection.id == state.connection_id)
            .first()
        )
        if not connection:
            db.delete(state)
            db.commit()
            return oauth_redirect("missing_connection")

        connection_config = parse_source_connection_config(
            connection.connection_config
        )
        if state.source_type == "sage":
            callback_country = str(
                query.get("country")
                or query.get("country_code")
                or ""
            ).strip().upper()
            if callback_country:
                connection_config["country"] = callback_country
        payload = exchange_code(
            state.source_type,
            code,
            connection_config,
        )
        if state.source_type == "freshbooks":
            access_token = str(payload.get("access_token") or "").strip()
            businesses = get_freshbooks_businesses(access_token)
            configured_account_id = str(
                connection_config.get("account_id") or ""
            ).strip()
            matching_businesses = [
                business
                for business in businesses
                if business["active"]
            ]
            if configured_account_id:
                matching_businesses = [
                    business
                    for business in matching_businesses
                    if business["account_id"] == configured_account_id
                ]
            if len(matching_businesses) == 1:
                connection_config["account_id"] = matching_businesses[0][
                    "account_id"
                ]
                connection.connection_config = json.dumps(
                    connection_config,
                    sort_keys=True,
                )
            elif not matching_businesses:
                raise OAuthTokenExchangeError(
                    "FreshBooks did not return an active business account"
                )
            else:
                raise OAuthTokenExchangeError(
                    "FreshBooks returned multiple business accounts; account selection is required"
                )
        if state.source_type == "quickbooks":
            realm_id = str(query.get("realmId") or "").strip()
            if realm_id:
                connection_config = parse_source_connection_config(
                    connection.connection_config
                )
                connection_config["company_id"] = realm_id
                connection.connection_config = json.dumps(
                    connection_config,
                    sort_keys=True,
                )
        if state.source_type == "xero":
            access_token = str(payload.get("access_token") or "").strip()
            xero_connections = get_xero_connections(access_token)
            selected_connection = next(
                (
                    item
                    for item in xero_connections
                    if str(item.get("tenantId") or "").strip()
                ),
                None,
            )
            tenant_id = str(
                selected_connection.get("tenantId")
                if selected_connection
                else ""
            ).strip()
            if not tenant_id:
                raise OAuthTokenExchangeError(
                    "No Xero organisation was available for this account"
                )
            connection_config = parse_source_connection_config(
                connection.connection_config
            )
            connection_config["tenant_id"] = tenant_id
            connection.connection_config = json.dumps(
                connection_config,
                sort_keys=True,
            )
        if state.source_type == "sage":
            business_id = str(
                payload.get("resource_owner_id")
                or payload.get("business_id")
                or query.get("resource_owner_id")
                or query.get("business_id")
                or ""
            ).strip()
            if not business_id:
                raise OAuthTokenExchangeError(
                    "Sage did not return a business identifier"
                )
            connection_config["business_id"] = business_id
            connection.connection_config = json.dumps(
                connection_config,
                sort_keys=True,
            )
        if state.source_type == "salesforce":
            connection_config["instance_url"] = get_salesforce_instance_url(
                payload
            )
            connection.connection_config = json.dumps(
                connection_config,
                sort_keys=True,
            )
        credential = (
            db.query(OAuthCredential)
            .filter(OAuthCredential.connection_id == connection.id)
            .first()
        )
        if not credential:
            credential = OAuthCredential(
                connection_id=connection.id,
                workspace_id=state.workspace_id,
                source_type=state.source_type,
            )
            db.add(credential)

        credential.access_token_encrypted = encrypt_token(
            str(payload.get("access_token") or "")
        )
        credential.refresh_token_encrypted = encrypt_token(
            str(payload.get("refresh_token") or "")
        ) or credential.refresh_token_encrypted
        credential.token_type = str(payload.get("token_type") or "") or None
        credential.scope = str(payload.get("scope") or "") or None
        credential.provider_account_id = str(
            payload.get("user_id")
            or payload.get("tenant_id")
            or payload.get("id")
            or ""
        ) or None
        credential.expires_at = token_expiry(payload)
        connection.status = "connected"
        db.delete(state)
        db.commit()
        return oauth_redirect("connected", state.source_type)
    except (OAuthProviderUnavailable, OAuthTokenExchangeError) as error:
        db.rollback()
        return oauth_redirect(str(error)[:120])
    finally:
        db.close()


@router.get("/callback")
async def oauth_callback(
    request: Request,
):
    return process_oauth_callback(request)


@router.get("/google-analytics/callback")
async def google_analytics_oauth_callback(
    request: Request,
):
    return process_oauth_callback(
        request,
        expected_source_type="google_analytics",
    )


def oauth_redirect(status: str, source_type: str | None = None):
    params = {"oauth": status}
    if source_type:
        params["source"] = str(source_type)
    return RedirectResponse(
        url=f"{get_web_app_url()}/dashboard/connections?{urlencode(params)}",
        status_code=303,
    )
