from __future__ import annotations

import json
import logging
from datetime import UTC, datetime, timedelta
from urllib.parse import urlencode, urlparse

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from fastapi.responses import JSONResponse, RedirectResponse

from app.db.database import SessionLocal
from app.db.models import DataSourceConnection
from app.db.models import OAuthConnectionState
from app.db.models import OAuthCredential
from app.modules.auth_context import get_auth_context
from app.modules.datasets.router import (
    build_source_connection_response,
    get_dataset_source,
    get_source_connection_config_status,
    mark_connection_authorization_failed,
    parse_source_connection_config,
    queue_connector_initial_import,
)
from app.modules.datasets.services.sources import (
    OAUTH_ACCOUNT_IDENTIFIER_KEYS,
    OAUTH_ACCOUNT_OPTIONS_CONFIG_KEY,
)
from app.modules.datasets.services.authorization_notifications import (
    notify_workspace_owner_of_authorization_failure,
)
from app.modules.datasets.services.connectors import (
    ConnectorUnavailable,
    WOOCOMMERCE_ENCRYPTED_CONSUMER_KEY_CONFIG,
    WOOCOMMERCE_ENCRYPTED_CONSUMER_SECRET_CONFIG,
    connector_requires_reauthorization,
    get_oauth_access_token,
)
from app.modules.oauth.service import (
    OAuthProviderUnavailable,
    OAuthTokenExchangeError,
    build_authorization_url,
    build_woocommerce_authorization_url,
    create_pkce_challenge,
    create_pkce_verifier,
    create_state_token,
    decrypt_token,
    encrypt_token,
    exchange_code,
    get_freshbooks_businesses,
    get_provider,
    get_sage_businesses,
    normalize_lightspeed_x_domain_prefix,
    normalize_sage_country,
    validate_shopify_token_scopes,
    verify_shopify_oauth_callback,
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


def build_oauth_account_options(
    records: list[dict],
    identifier_key: str,
    label_keys: tuple[str, ...] = (),
) -> list[dict[str, str]]:
    options = []
    seen_ids = set()
    for record in records:
        identifier = str(record.get(identifier_key) or "").strip()
        if not identifier or identifier in seen_ids:
            continue
        label = next(
            (
                str(record.get(key) or "").strip()
                for key in label_keys
                if str(record.get(key) or "").strip()
            ),
            identifier,
        )
        options.append({"id": identifier, "label": label})
        seen_ids.add(identifier)
    return options


def apply_oauth_account_selection(
    connection_config: dict,
    records: list[dict],
    identifier_key: str,
    label_keys: tuple[str, ...],
    *,
    missing_accounts_error: str,
    config_key: str | None = None,
    additional_config_keys: tuple[tuple[str, str], ...] = (),
) -> dict:
    """Persist one account or expose a required choice for multiple accounts."""
    config_key = config_key or identifier_key
    account_options = build_oauth_account_options(
        records,
        identifier_key,
        label_keys,
    )
    if not account_options:
        raise OAuthTokenExchangeError(missing_accounts_error)

    configured_account_id = str(
        connection_config.get(config_key) or ""
    ).strip()
    selected_record = None
    if len(account_options) == 1:
        selected_record = next(
            (
                record
                for record in records
                if str(record.get(identifier_key) or "").strip()
                == account_options[0]["id"]
            ),
            None,
        )
    elif configured_account_id:
        selected_record = next(
            (
                record
                for record in records
                if str(record.get(identifier_key) or "").strip()
                == configured_account_id
            ),
            None,
        )

    if selected_record is None:
        connection_config.pop(config_key, None)
        for extra_config_key, _ in additional_config_keys:
            connection_config.pop(extra_config_key, None)
    else:
        selected_account_id = str(
            selected_record.get(identifier_key) or ""
        ).strip()
        connection_config[config_key] = selected_account_id
        for extra_config_key, record_key in additional_config_keys:
            value = str(selected_record.get(record_key) or "").strip()
            if value:
                connection_config[extra_config_key] = value
            else:
                connection_config.pop(extra_config_key, None)

    if len(account_options) == 1:
        connection_config.pop(OAUTH_ACCOUNT_OPTIONS_CONFIG_KEY, None)
    else:
        connection_config[OAUTH_ACCOUNT_OPTIONS_CONFIG_KEY] = account_options

    return connection_config


def apply_sage_business_selection(
    connection_config: dict,
    businesses: list[dict],
    payload: dict,
    query,
    *,
    allow_legacy_fallback: bool = True,
) -> dict:
    """Persist Sage businesses and auto-select when exactly one is available."""
    account_options = build_oauth_account_options(
        businesses,
        "business_id",
        ("name",),
    )
    if account_options:
        if len(account_options) == 1:
            connection_config["business_id"] = account_options[0]["id"]
            connection_config.pop(OAUTH_ACCOUNT_OPTIONS_CONFIG_KEY, None)
            return connection_config

        # A new Sage authorization must ask again when more than one
        # business is available. A previously saved business may be stale or
        # may have been entered before OAuth discovery, and retaining it would
        # make the UI hide the selector while Sage has multiple choices.
        connection_config.pop("business_id", None)
        connection_config[OAUTH_ACCOUNT_OPTIONS_CONFIG_KEY] = account_options
        return connection_config

    if not allow_legacy_fallback:
        raise OAuthTokenExchangeError(
            "Sage returned no accessible businesses"
        )

    # Legacy regional v3 OAuth returns one resource owner but has no business
    # discovery endpoint. Preserve that valid single business without showing
    # a selector for an account that is already known.
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
    connection_config.pop(OAUTH_ACCOUNT_OPTIONS_CONFIG_KEY, None)
    return connection_config


def clear_stale_oauth_authorization(
    db,
    connection,
) -> None:
    """Remove a failed OAuth grant before starting a new authorization flow."""
    source_type = str(getattr(connection, "source_type", "") or "").strip().lower()
    if not getattr(connection, "authorization_error", None):
        return

    if source_type == "woocommerce":
        credential = (
            db.query(OAuthCredential)
            .filter(
                OAuthCredential.connection_id == connection.id,
                OAuthCredential.source_type == source_type,
            )
            .first()
        )
        if credential:
            db.delete(credential)

        connection_config = parse_source_connection_config(
            connection.connection_config
        )
        for key in (
            "consumer_key",
            "consumer_secret",
            WOOCOMMERCE_ENCRYPTED_CONSUMER_KEY_CONFIG,
            WOOCOMMERCE_ENCRYPTED_CONSUMER_SECRET_CONFIG,
        ):
            connection_config.pop(key, None)
        connection.connection_config = (
            json.dumps(connection_config, sort_keys=True)
            if connection_config
            else None
        )
        db.commit()
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


def reset_sage_oauth_authorization(
    db,
    connection,
) -> None:
    """Force Sage to issue a fresh grant for the selected region."""
    db.query(OAuthCredential).filter(
        OAuthCredential.connection_id == connection.id,
        OAuthCredential.source_type == "sage",
    ).delete(synchronize_session=False)
    db.query(OAuthConnectionState).filter(
        OAuthConnectionState.connection_id == connection.id,
    ).delete(synchronize_session=False)

    connection_config = parse_source_connection_config(
        connection.connection_config
    )
    for key in (
        "business_id",
        "resource_owner_id",
        "site_id",
        OAUTH_ACCOUNT_OPTIONS_CONFIG_KEY,
    ):
        connection_config.pop(key, None)
    connection.connection_config = (
        json.dumps(connection_config, sort_keys=True)
        if connection_config
        else None
    )
    connection.status = "draft"
    connection.authorization_error = None
    connection.authorization_error_at = None
    connection.authorization_notification_error = None
    connection.authorization_notification_sent_at = None


def get_oauth_config_requirement_error(
    source_type: str,
    connection_config: dict,
):
    source = get_dataset_source(source_type)
    _, _, missing_config_keys = get_source_connection_config_status(
        source,
        connection_config,
    )
    missing_connection_settings = [
        key
        for key in missing_config_keys
        if key != "resource_types"
    ]
    if not missing_connection_settings:
        return None

    field_labels = {
        "property_id": "the GA4 property ID",
        "site_url": "the Google Search Console property URL",
        "shop_domain": "the Shopify shop domain",
        "location_id": "the Square location ID",
        "store_url": "the client WooCommerce store URL",
        "account_id": "the Lightspeed account ID",
        "domain_prefix": "the Lightspeed X-Series domain prefix",
        "resource_types": "at least one resource to ingest",
        "ad_account_id": "the Meta Ads account ID",
        "customer_id": "the Google Ads customer ID",
        "country": "the Sage region",
    }
    missing_labels = [
        field_labels.get(key, key)
        for key in missing_connection_settings
    ]
    return (
        "Enter and save "
        + ", ".join(missing_labels)
        + " before connecting with OAuth"
    )


DEFAULT_OAUTH_RESOURCE_TYPES = {
    "hubspot": "deals",
    "salesforce": "opportunities",
    "lightspeed_x": "sales",
    "lightspeed_k": "sales,products",
    "lightspeed_o": "sales,customers,products",
    "freshbooks": "invoices",
    "quickbooks": "invoices",
    "xero": "invoices",
    "zoho_books": "invoices",
    "sage": "sales_invoices",
}


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
        if (
            connection.source_type == "sage"
            and connection.status == "connected"
        ):
            reset_sage_oauth_authorization(db, connection)
        clear_stale_oauth_authorization(
            db,
            connection,
        )
        state_token = create_state_token()
        if connection.source_type == "woocommerce":
            code_verifier = None
            authorization_url = build_woocommerce_authorization_url(
                config.get("store_url"),
                state_token,
            )
        else:
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


@router.post("/connections/{connection_id}/sage-businesses")
async def refresh_sage_businesses(
    request: Request,
    connection_id: int,
):
    auth_context = get_auth_context(request)
    if auth_context.workspace_role != "owner":
        raise HTTPException(
            status_code=403,
            detail="Only workspace owners can refresh Sage businesses",
        )

    db = SessionLocal()
    try:
        connection = get_workspace_connection(
            db,
            connection_id,
            auth_context,
        )
        if connection.source_type != "sage":
            raise HTTPException(
                status_code=400,
                detail="Business refresh is only available for Sage",
            )

        connection_config = parse_source_connection_config(
            connection.connection_config
        )
        try:
            access_token = get_oauth_access_token(
                db,
                connection,
                "sage",
            )
            businesses = get_sage_businesses(
                access_token,
                allow_legacy_fallback=False,
            )
            connection_config = apply_sage_business_selection(
                connection_config,
                businesses,
                {},
                {},
                allow_legacy_fallback=False,
            )
        except (ConnectorUnavailable, OAuthTokenExchangeError) as error:
            db.rollback()
            normalized_error = str(error).lower()
            requires_reauthorization = isinstance(
                error,
                ConnectorUnavailable,
            ) or any(
                marker in normalized_error
                for marker in (
                    "reconnect",
                    "rejected the stored authorization",
                    "http 401",
                    "http 403",
                    "no accessible businesses",
                    "no business list",
                )
            )
            logger.warning(
                "Sage business refresh failed connection_id=%s "
                "requires_reauthorization=%s error=%s",
                connection.id,
                requires_reauthorization,
                error,
            )
            if requires_reauthorization:
                mark_connection_authorization_failed(
                    connection,
                    error,
                )
                db.commit()
            raise HTTPException(
                status_code=409 if requires_reauthorization else 502,
                detail=str(error),
            ) from error

        connection.connection_config = json.dumps(
            connection_config,
            sort_keys=True,
        )
        db.commit()
        db.refresh(connection)
        return build_source_connection_response(connection)
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

        if connection.source_type == "woocommerce":
            connection_config = parse_source_connection_config(
                connection.connection_config
            )
            for key in (
                "consumer_key",
                "consumer_secret",
                WOOCOMMERCE_ENCRYPTED_CONSUMER_KEY_CONFIG,
                WOOCOMMERCE_ENCRYPTED_CONSUMER_SECRET_CONFIG,
            ):
                connection_config.pop(key, None)
            connection.connection_config = (
                json.dumps(connection_config, sort_keys=True)
                if connection_config
                else None
            )
        else:
            connection_config = parse_source_connection_config(
                connection.connection_config
            )
            managed_identifier = OAUTH_ACCOUNT_IDENTIFIER_KEYS.get(
                connection.source_type
            )
            if managed_identifier:
                connection_config.pop(managed_identifier, None)
            connection_config.pop(
                OAUTH_ACCOUNT_OPTIONS_CONFIG_KEY,
                None,
            )
            for key in (
                "organization_name",
                "business_id",
                "business_uuid",
            ):
                connection_config.pop(key, None)
            connection.connection_config = (
                json.dumps(connection_config, sort_keys=True)
                if connection_config
                else None
            )

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


def process_oauth_callback(
    request: Request,
    background_tasks: BackgroundTasks | None = None,
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
        if state_source_type == "shopify":
            verify_shopify_oauth_callback(
                query,
                connection_config.get("shop_domain"),
            )
        if state_source_type == "sage":
            callback_country = normalize_sage_country(
                query.get("country")
                or query.get("country_code")
                or query.get("countryCode")
            )
            configured_country = normalize_sage_country(
                connection_config.get("country")
            )
            if configured_country:
                connection_config["country"] = configured_country
            elif callback_country:
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
        if state_source_type == "lightspeed_x":
            callback_domain_prefix = str(
                query.get("domain_prefix")
                or connection_config.get("domain_prefix")
                or ""
            ).strip()
            connection_config["domain_prefix"] = (
                normalize_lightspeed_x_domain_prefix(
                    callback_domain_prefix
                )
            )
        default_resource_types = DEFAULT_OAUTH_RESOURCE_TYPES.get(
            state_source_type
        )
        if (
            default_resource_types
            and not connection_config.get("resource_types")
        ):
            connection_config["resource_types"] = (
                default_resource_types
            )
            connection.connection_config = json.dumps(
                connection_config,
                sort_keys=True,
            )
        code_verifier = decrypt_token(state.code_verifier)
        payload = exchange_code(
            state_source_type,
            code,
            connection_config,
            code_verifier=code_verifier,
        )
        if state_source_type == "shopify":
            validate_shopify_token_scopes(payload)
        if state_source_type == "freshbooks":
            access_token = str(payload.get("access_token") or "").strip()
            businesses = get_freshbooks_businesses(access_token)
            active_businesses = [
                business
                for business in businesses
                if business["active"]
            ]
            connection_config = apply_oauth_account_selection(
                connection_config,
                active_businesses,
                "account_id",
                ("name",),
                missing_accounts_error=(
                    "FreshBooks did not return an active business account"
                ),
                additional_config_keys=(
                    ("business_id", "business_id"),
                    ("business_uuid", "business_uuid"),
                ),
            )
            connection.connection_config = json.dumps(
                connection_config,
                sort_keys=True,
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
            connection_config.pop("_quickbooks_api_base_url", None)
            connection.connection_config = json.dumps(
                connection_config,
                sort_keys=True,
            )
        if state_source_type == "xero":
            access_token = str(payload.get("access_token") or "").strip()
            xero_connections = get_xero_connections(access_token)
            connection_config = apply_oauth_account_selection(
                connection_config,
                xero_connections,
                "tenantId",
                ("tenantName", "tenant_name"),
                missing_accounts_error=(
                    "No Xero organisation was available for this account"
                ),
                config_key="tenant_id",
            )
            connection.connection_config = json.dumps(
                connection_config,
                sort_keys=True,
            )
        if state_source_type == "sage":
            access_token = str(payload.get("access_token") or "").strip()
            businesses = get_sage_businesses(
                access_token,
                allow_legacy_fallback=False,
            )
            connection_config = apply_sage_business_selection(
                connection_config,
                businesses,
                payload,
                query,
                allow_legacy_fallback=False,
            )
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
        if state_source_type == "hubspot":
            portal_id = str(payload.get("hub_id") or "").strip()
            if portal_id:
                connection_config["portal_id"] = portal_id
                connection.connection_config = json.dumps(
                    connection_config,
                    sort_keys=True,
                )
        if state_source_type == "lightspeed_x":
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
            connection_config = apply_oauth_account_selection(
                connection_config,
                organizations,
                "organization_id",
                ("name",),
                missing_accounts_error=(
                    "Zoho Books did not return an active organization"
                ),
                additional_config_keys=(
                    ("organization_name", "name"),
                ),
            )
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
        queue_connector_initial_import(
            background_tasks,
            connection.id,
        )
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


async def process_woocommerce_callback(
    request: Request,
    background_tasks: BackgroundTasks | None = None,
):
    """Persist the read-only API keys posted by a WooCommerce store."""
    try:
        payload = await request.json()
    except Exception:
        return JSONResponse(
            {"error": "WooCommerce authorization callback must be JSON"},
            status_code=400,
        )

    if not isinstance(payload, dict):
        return JSONResponse(
            {"error": "WooCommerce authorization callback is invalid"},
            status_code=400,
        )

    state_token = str(payload.get("user_id") or "").strip()
    consumer_key = str(payload.get("consumer_key") or "").strip()
    consumer_secret = str(payload.get("consumer_secret") or "").strip()
    key_permissions = str(payload.get("key_permissions") or "").strip().lower()
    if not state_token or not consumer_key or not consumer_secret:
        return JSONResponse(
            {"error": "WooCommerce did not return the required API keys"},
            status_code=400,
        )
    if key_permissions and key_permissions != "read":
        return JSONResponse(
            {"error": "Decisionate only accepts read-only WooCommerce access"},
            status_code=400,
        )

    db = SessionLocal()
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
            return JSONResponse(
                {"error": "WooCommerce authorization state expired"},
                status_code=400,
            )

        state_connection_id = state.connection_id
        if state.source_type != "woocommerce":
            raise OAuthTokenExchangeError(
                "WooCommerce authorization state does not match the connector"
            )

        connection = (
            db.query(DataSourceConnection)
            .filter(DataSourceConnection.id == state.connection_id)
            .first()
        )
        if not connection:
            raise OAuthTokenExchangeError(
                "WooCommerce authorization connection was not found"
            )

        connection_config = parse_source_connection_config(
            connection.connection_config
        )
        connection_config[
            WOOCOMMERCE_ENCRYPTED_CONSUMER_KEY_CONFIG
        ] = encrypt_token(consumer_key)
        connection_config[
            WOOCOMMERCE_ENCRYPTED_CONSUMER_SECRET_CONFIG
        ] = encrypt_token(consumer_secret)
        connection.connection_config = json.dumps(
            connection_config,
            sort_keys=True,
        )
        connection.status = "connected"
        connection.authorization_error = None
        connection.authorization_error_at = None
        connection.authorization_notification_error = None
        connection.authorization_notification_sent_at = None
        db.delete(state)
        db.commit()
        queue_connector_initial_import(
            background_tasks,
            connection.id,
        )
        return JSONResponse(
            {"connected": True, "source_type": "woocommerce"},
            status_code=200,
        )
    except (OAuthProviderUnavailable, OAuthTokenExchangeError) as error:
        db.rollback()
        if state_connection_id:
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
        return JSONResponse(
            {"error": str(error)[:240]},
            status_code=400,
        )
    finally:
        db.close()


@router.get("/callback")
async def oauth_callback(
    request: Request,
    background_tasks: BackgroundTasks = None,
):
    return process_oauth_callback(request, background_tasks)


@router.post("/callback")
async def woocommerce_oauth_callback(
    request: Request,
    background_tasks: BackgroundTasks = None,
):
    return await process_woocommerce_callback(request, background_tasks)


def oauth_redirect(status: str, source_type: str | None = None):
    params = {"oauth": status}
    if source_type:
        params["source"] = str(source_type)
    return RedirectResponse(
        url=f"{get_web_app_url()}/dashboard/connections?{urlencode(params)}",
        status_code=303,
    )
