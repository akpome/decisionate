from __future__ import annotations

import json
import logging
from datetime import UTC, datetime, timedelta
from urllib.parse import urlencode, urlparse

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse

from app.db.database import SessionLocal
from app.db.models import DataSourceConnection
from app.db.models import OAuthConnectionState
from app.db.models import OAuthCredential
from app.modules.auth_context import get_auth_context
from app.modules.datasets.router import (
    get_dataset_source,
    get_source_connection_config_status,
    mark_connection_authorization_failed,
    parse_source_connection_config,
)
from app.modules.datasets.services.authorization_notifications import (
    notify_workspace_owner_of_authorization_failure,
)
from app.modules.datasets.services.connectors import (
    connector_requires_reauthorization,
)
from app.modules.oauth.service import (
    OAuthProviderUnavailable,
    OAuthTokenExchangeError,
    build_authorization_url,
    create_pkce_challenge,
    create_pkce_verifier,
    create_state_token,
    decrypt_token,
    encrypt_token,
    exchange_code,
    get_freshbooks_businesses,
    get_provider,
    get_zoho_books_organizations,
    get_xero_connections,
    get_web_app_url,
    normalize_zoho_books_accounts_server,
    normalize_zoho_books_api_domain,
    revoke_oauth_token,
    token_expiry,
)


router = APIRouter()
logger = logging.getLogger(__name__)
STATE_TTL_MINUTES = 10


def clear_stale_oauth_authorization(
    db,
    connection,
) -> None:
    """Remove a failed OAuth grant before starting a new authorization flow."""
    source_type = str(getattr(connection, "source_type", "") or "").strip().lower()
    if not getattr(connection, "authorization_error", None):
        return

    try:
        provider = get_provider(source_type)
    except OAuthProviderUnavailable:
        return

    credential = (
        db.query(OAuthCredential)
        .filter(
            OAuthCredential.connection_id == connection.id,
            OAuthCredential.source_type == provider.source_type,
        )
        .first()
    )
    if not credential:
        return

    encrypted_token = (
        credential.refresh_token_encrypted
        or credential.access_token_encrypted
    )
    if encrypted_token and provider.source_type == "quickbooks":
        try:
            revoke_oauth_token(
                provider.source_type,
                decrypt_token(encrypted_token),
            )
        except Exception:
            # The grant may already be revoked or expired. Local credentials
            # are removed either way so the next flow cannot reuse them.
            logger.warning(
                "Could not revoke stale OAuth authorization before reconnect",
                extra={
                    "connection_id": connection.id,
                    "source_type": provider.source_type,
                },
                exc_info=True,
            )

    db.delete(credential)
    db.commit()


def get_oauth_config_requirement_error(
    source_type: str,
    connection_config: dict,
):
    source = get_dataset_source(source_type)
    _, _, missing_config_keys = get_source_connection_config_status(
        source,
        connection_config,
    )
    if not missing_config_keys:
        return None

    field_labels = {
        "property_id": "the GA4 property ID",
        "shop_domain": "the Shopify shop domain",
        "ad_account_id": "the Meta Ads account ID",
        "customer_id": "the Google Ads customer ID",
    }
    missing_labels = [
        field_labels.get(key, key)
        for key in missing_config_keys
    ]
    return (
        "Enter and save "
        + ", ".join(missing_labels)
        + " before connecting with OAuth"
    )


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
        config_requirement_error = get_oauth_config_requirement_error(
            connection.source_type,
            config,
        )
        if config_requirement_error:
            raise HTTPException(
                status_code=422,
                detail=config_requirement_error,
            )
        clear_stale_oauth_authorization(
            db,
            connection,
        )
        state_token = create_state_token()
        provider = get_provider(connection.source_type)
        code_verifier = (
            create_pkce_verifier()
            if provider.use_pkce
            else None
        )
        authorization_url = build_authorization_url(
            connection.source_type,
            state_token,
            config,
            create_pkce_challenge(code_verifier)
            if code_verifier
            else None,
        )
        db.add(
            OAuthConnectionState(
                state_token=state_token,
                connection_id=connection.id,
                workspace_id=auth_context.workspace_id,
                user_id=auth_context.user_id,
                source_type=connection.source_type,
                code_verifier=encrypt_token(code_verifier),
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
        connection.authorization_error = None
        connection.authorization_error_at = None
        connection.authorization_notification_error = None
        connection.authorization_notification_sent_at = None
        db.commit()
        return {
            "message": "Connector authorization cancelled",
            "connection_id": connection.id,
        }
    finally:
        db.close()


def process_oauth_callback(request: Request):
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
    state_source_type = None
    state_connection_id = None
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

        connection = (
            db.query(DataSourceConnection)
            .filter(DataSourceConnection.id == state.connection_id)
            .first()
        )
        if not connection:
            db.delete(state)
            db.commit()
            return oauth_redirect("missing_connection")

        state_source_type = state.source_type
        state_connection_id = state.connection_id

        connection_config = parse_source_connection_config(
            connection.connection_config
        )
        if state_source_type == "sage":
            callback_country = str(
                query.get("country")
                or query.get("country_code")
                or ""
            ).strip().upper()
            if callback_country:
                connection_config["country"] = callback_country
        if state_source_type == "zoho_books":
            callback_accounts_server = str(
                query.get("accounts-server")
                or query.get("accounts_server")
                or ""
            ).strip()
            if callback_accounts_server:
                try:
                    connection_config["accounts_server"] = (
                        normalize_zoho_books_accounts_server(
                            callback_accounts_server
                        )
                    )
                except OAuthProviderUnavailable:
                    # Keep the configured token endpoint when Zoho's optional
                    # callback hint is not in a recognized URL form.
                    connection_config.pop("accounts_server", None)
        code_verifier = decrypt_token(state.code_verifier)
        payload = exchange_code(
            state_source_type,
            code,
            connection_config,
            code_verifier=code_verifier,
        )
        if state_source_type == "freshbooks":
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
                selected_business = matching_businesses[0]
                connection_config["account_id"] = selected_business[
                    "account_id"
                ]
                if selected_business.get("business_id"):
                    connection_config["business_id"] = selected_business[
                        "business_id"
                    ]
                if selected_business.get("business_uuid"):
                    connection_config["business_uuid"] = selected_business[
                        "business_uuid"
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
        if state_source_type == "quickbooks":
            realm_id = str(query.get("realmId") or "").strip()
            if not realm_id:
                raise OAuthTokenExchangeError(
                    "QuickBooks authorization did not return a company identifier"
                )
            connection_config = parse_source_connection_config(
                connection.connection_config
            )
            connection_config["company_id"] = realm_id
            connection.connection_config = json.dumps(
                connection_config,
                sort_keys=True,
            )
        if state_source_type == "xero":
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
        if state_source_type == "sage":
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
        if state_source_type == "salesforce":
            connection_config["instance_url"] = get_salesforce_instance_url(
                payload
            )
            connection.connection_config = json.dumps(
                connection_config,
                sort_keys=True,
            )
        if state_source_type == "zoho_books":
            access_token = str(payload.get("access_token") or "").strip()
            api_domain = normalize_zoho_books_api_domain(
                payload.get("api_domain")
                or connection_config.get("api_domain")
            )
            organizations = [
                organization
                for organization in get_zoho_books_organizations(
                    access_token,
                    api_domain,
                )
                if organization.get("is_org_active") is not False
            ]
            configured_organization_id = str(
                connection_config.get("organization_id") or ""
            ).strip()
            if configured_organization_id:
                matching_organizations = [
                    organization
                    for organization in organizations
                    if str(
                        organization.get("organization_id") or ""
                    ).strip()
                    == configured_organization_id
                ]
            else:
                default_organizations = [
                    organization
                    for organization in organizations
                    if organization.get("is_default_org") is True
                ]
                matching_organizations = (
                    default_organizations
                    if len(default_organizations) == 1
                    else organizations
                )
            if len(matching_organizations) != 1:
                raise OAuthTokenExchangeError(
                    "Zoho Books returned multiple active organizations; "
                    "organization selection is required"
                    if len(matching_organizations) > 1
                    else "Zoho Books did not return an active organization"
                )
            selected_organization = matching_organizations[0]
            organization_id = str(
                selected_organization.get("organization_id") or ""
            ).strip()
            if not organization_id:
                raise OAuthTokenExchangeError(
                    "Zoho Books returned an organization without an identifier"
                )
            connection_config["organization_id"] = organization_id
            connection_config["organization_name"] = str(
                selected_organization.get("name") or ""
            ).strip()
            connection_config["api_domain"] = api_domain
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
                source_type=state_source_type,
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
        connection.authorization_error = None
        connection.authorization_error_at = None
        connection.authorization_notification_error = None
        connection.authorization_notification_sent_at = None
        db.delete(state)
        db.commit()
        return oauth_redirect("connected", state_source_type)
    except (OAuthProviderUnavailable, OAuthTokenExchangeError) as error:
        db.rollback()
        if (
            state_source_type == "zoho_books"
            and "Zoho Books token exchange rejected" in str(error)
            and "authorization code expired or was already used" in str(error)
        ):
            # An OAuth callback can be delivered twice. Zoho permits a grant
            # code only once, so the second callback may report invalid_code
            # after the first callback has already stored the credential.
            credential = (
                db.query(OAuthCredential)
                .filter(
                    OAuthCredential.connection_id == state_connection_id,
                    OAuthCredential.source_type == state_source_type,
                )
                .first()
            )
            refreshed_connection = (
                db.query(DataSourceConnection)
                .filter(DataSourceConnection.id == state_connection_id)
                .first()
            )
            if (
                refreshed_connection
                and refreshed_connection.status == "connected"
                and credential
                and (
                    credential.access_token_encrypted
                    or credential.refresh_token_encrypted
                )
            ):
                return oauth_redirect("connected", state_source_type)
        if (
            state_connection_id
            and connector_requires_reauthorization(
                state_source_type,
                error,
            )
        ):
            failed_connection = (
                db.query(DataSourceConnection)
                .filter(DataSourceConnection.id == state_connection_id)
                .first()
            )
            if failed_connection:
                mark_connection_authorization_failed(
                    failed_connection,
                    error,
                )
                db.commit()
                notify_workspace_owner_of_authorization_failure(
                    db,
                    failed_connection,
                )
        return oauth_redirect(str(error)[:120])
    finally:
        db.close()


@router.get("/callback")
async def oauth_callback(
    request: Request,
):
    return process_oauth_callback(request)


def oauth_redirect(status: str, source_type: str | None = None):
    params = {"oauth": status}
    if source_type:
        params["source"] = str(source_type)
    return RedirectResponse(
        url=f"{get_web_app_url()}/dashboard/connections?{urlencode(params)}",
        status_code=303,
    )
