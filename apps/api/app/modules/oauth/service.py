from __future__ import annotations

import json
import os
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from app.configuration import get_provider_setting, get_runtime_configuration

try:
    from cryptography.fernet import Fernet, InvalidToken
except ModuleNotFoundError:  # Optional until OAuth token storage is enabled.
    Fernet = None

    class InvalidToken(Exception):
        pass


class OAuthProviderUnavailable(RuntimeError):
    pass


class OAuthTokenExchangeError(RuntimeError):
    pass


@dataclass(frozen=True)
class OAuthProvider:
    source_type: str
    authorization_url_env: str
    token_url_env: str
    client_id_env: str
    client_secret_env: str
    scopes_env: str
    use_basic_token_auth: bool = False
    required_scopes: tuple[str, ...] = ()


OAUTH_PROVIDERS = {
    "shopify": OAuthProvider(
        source_type="shopify",
        authorization_url_env="SHOPIFY_OAUTH_AUTHORIZATION_URL_TEMPLATE",
        token_url_env="SHOPIFY_OAUTH_TOKEN_URL_TEMPLATE",
        client_id_env="SHOPIFY_CLIENT_ID",
        client_secret_env="SHOPIFY_CLIENT_SECRET",
        scopes_env="SHOPIFY_OAUTH_SCOPES",
        required_scopes=("read_orders",),
    ),
    "hubspot": OAuthProvider(
        source_type="hubspot",
        authorization_url_env="HUBSPOT_OAUTH_AUTHORIZATION_URL",
        token_url_env="HUBSPOT_OAUTH_TOKEN_URL",
        client_id_env="HUBSPOT_CLIENT_ID",
        client_secret_env="HUBSPOT_CLIENT_SECRET",
        scopes_env="HUBSPOT_OAUTH_SCOPES",
        required_scopes=(
            "crm.objects.contacts.read",
            "crm.objects.companies.read",
            "crm.objects.deals.read",
            "crm.objects.tickets.read",
        ),
    ),
    "meta_ads": OAuthProvider(
        source_type="meta_ads",
        authorization_url_env="META_ADS_OAUTH_AUTHORIZATION_URL",
        token_url_env="META_ADS_OAUTH_TOKEN_URL",
        client_id_env="META_ADS_APP_ID",
        client_secret_env="META_ADS_APP_SECRET",
        scopes_env="META_ADS_OAUTH_SCOPES",
        required_scopes=("ads_read",),
    ),
    "quickbooks": OAuthProvider(
        source_type="quickbooks",
        authorization_url_env="QUICKBOOKS_OAUTH_AUTHORIZATION_URL",
        token_url_env="QUICKBOOKS_OAUTH_TOKEN_URL",
        client_id_env="QUICKBOOKS_CLIENT_ID",
        client_secret_env="QUICKBOOKS_CLIENT_SECRET",
        scopes_env="QUICKBOOKS_OAUTH_SCOPES",
        use_basic_token_auth=True,
        required_scopes=("com.intuit.quickbooks.accounting",),
    ),
    "freshbooks": OAuthProvider(
        source_type="freshbooks",
        authorization_url_env="FRESHBOOKS_OAUTH_AUTHORIZATION_URL",
        token_url_env="FRESHBOOKS_OAUTH_TOKEN_URL",
        client_id_env="FRESHBOOKS_CLIENT_ID",
        client_secret_env="FRESHBOOKS_CLIENT_SECRET",
        scopes_env="FRESHBOOKS_OAUTH_SCOPES",
        required_scopes=("invoices:read",),
    ),
    "sage": OAuthProvider(
        source_type="sage",
        authorization_url_env="SAGE_OAUTH_AUTHORIZATION_URL",
        token_url_env="SAGE_OAUTH_TOKEN_URL",
        client_id_env="SAGE_CLIENT_ID",
        client_secret_env="SAGE_CLIENT_SECRET",
        scopes_env="SAGE_OAUTH_SCOPES",
        required_scopes=("readonly",),
    ),
    "xero": OAuthProvider(
        source_type="xero",
        authorization_url_env="XERO_OAUTH_AUTHORIZATION_URL",
        token_url_env="XERO_OAUTH_TOKEN_URL",
        client_id_env="XERO_CLIENT_ID",
        client_secret_env="XERO_CLIENT_SECRET",
        scopes_env="XERO_OAUTH_SCOPES",
        use_basic_token_auth=True,
        required_scopes=("accounting.transactions",),
    ),
}


def clean_env(name: str, default: str = "") -> str:
    return str(os.getenv(name, default) or "").strip()


def get_provider(source_type: str) -> OAuthProvider:
    provider = OAUTH_PROVIDERS.get(str(source_type or "").strip().lower())
    if not provider:
        raise OAuthProviderUnavailable(
            "OAuth is not supported for this connector"
        )
    return provider


def get_sage_token_url(country: str | None = None) -> str:
    configured = clean_env("SAGE_OAUTH_TOKEN_URL")
    if configured:
        return configured
    raise OAuthProviderUnavailable(
        "SAGE_OAUTH_TOKEN_URL is required for Sage OAuth"
    )


def get_callback_url() -> str:
    configured = clean_env("OAUTH_CALLBACK_URL")
    if configured:
        return configured.rstrip("/")
    api_url = get_runtime_configuration().api_url
    return f"{api_url.rstrip('/')}/oauth/callback"


def get_web_app_url() -> str:
    return get_runtime_configuration().web_url.rstrip("/")


def get_provider_credentials(provider: OAuthProvider) -> tuple[str, str]:
    client_id = clean_env(provider.client_id_env)
    client_secret = clean_env(provider.client_secret_env)
    if not client_id or not client_secret:
        raise OAuthProviderUnavailable(
            f"{provider.source_type} OAuth credentials are not configured"
        )
    return client_id, client_secret


def get_provider_endpoint(provider: OAuthProvider, endpoint: str) -> str:
    env_name = (
        provider.authorization_url_env
        if endpoint == "authorization"
        else provider.token_url_env
    )
    value = get_provider_setting(env_name)
    if not value:
        raise OAuthProviderUnavailable(
            f"{env_name} is required for {provider.source_type} OAuth"
        )
    return value


def get_provider_scopes(provider: OAuthProvider) -> tuple[str, ...]:
    scopes = tuple(
        scope.strip()
        for scope in get_provider_setting(provider.scopes_env).split()
        if scope.strip()
    )
    if not scopes:
        raise OAuthProviderUnavailable(
            f"{provider.scopes_env} is required for {provider.source_type} OAuth"
        )
    missing_scopes = [
        scope
        for scope in provider.required_scopes
        if scope not in scopes
    ]
    if missing_scopes:
        raise OAuthProviderUnavailable(
            f"{provider.scopes_env} is missing required scope(s): "
            f"{', '.join(missing_scopes)}"
        )
    return scopes


def is_oauth_provider_configured(source_type: str) -> bool:
    try:
        provider = get_provider(source_type)
        get_provider_credentials(provider)
        get_provider_endpoint(provider, "authorization")
        get_provider_endpoint(provider, "token")
        get_provider_scopes(provider)
        get_fernet()
    except (OAuthProviderUnavailable, ValueError):
        return False
    return True


def create_state_token() -> str:
    return secrets.token_urlsafe(32)


def build_authorization_url(
    source_type: str,
    state_token: str,
    connection_config: dict | None = None,
) -> str:
    provider = get_provider(source_type)
    client_id, _client_secret = get_provider_credentials(provider)
    config = connection_config or {}
    authorization_url = get_provider_endpoint(provider, "authorization")
    scopes = get_provider_scopes(provider)

    if provider.source_type == "shopify":
        shop_domain = str(config.get("shop_domain") or "").strip()
        if not shop_domain or "." not in shop_domain:
            raise OAuthProviderUnavailable(
                "Configure a Shopify shop domain before connecting"
            )
        shop_domain = shop_domain.removeprefix("https://").removeprefix("http://")
        try:
            authorization_url = authorization_url.format(
                shop_domain=shop_domain,
            )
        except KeyError as error:
            raise OAuthProviderUnavailable(
                "SHOPIFY_OAUTH_AUTHORIZATION_URL_TEMPLATE must include {shop_domain}"
            ) from error

    params = {
        "client_id": client_id,
        "redirect_uri": get_callback_url(),
        "response_type": "code",
        "state": state_token,
        "scope": " ".join(scopes),
    }
    return f"{authorization_url}?{urlencode(params)}"


def exchange_code(
    source_type: str,
    code: str,
    connection_config: dict | None = None,
) -> dict:
    provider = get_provider(source_type)
    client_id, client_secret = get_provider_credentials(provider)
    config = connection_config or {}
    token_url = get_provider_endpoint(provider, "token")
    if provider.source_type == "shopify":
        shop_domain = str(config.get("shop_domain") or "").strip()
        shop_domain = shop_domain.removeprefix("https://").removeprefix("http://")
        try:
            token_url = token_url.format(shop_domain=shop_domain)
        except KeyError as error:
            raise OAuthProviderUnavailable(
                "SHOPIFY_OAUTH_TOKEN_URL_TEMPLATE must include {shop_domain}"
            ) from error
    elif provider.source_type == "sage":
        token_url = get_sage_token_url(config.get("country"))

    params = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": get_callback_url(),
    }
    headers = {"Accept": "application/json"}
    if provider.use_basic_token_auth:
        import base64

        encoded = base64.b64encode(
            f"{client_id}:{client_secret}".encode("utf-8")
        ).decode("ascii")
        headers["Authorization"] = f"Basic {encoded}"
    else:
        params["client_id"] = client_id
        params["client_secret"] = client_secret

    request = Request(
        token_url,
        data=urlencode(params).encode("utf-8"),
        headers={
            **headers,
            "Content-Type": "application/x-www-form-urlencoded",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=20) as response:
            body = response.read().decode("utf-8")
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise OAuthTokenExchangeError(
            f"OAuth token exchange failed with HTTP {error.code}: {detail[:240]}"
        ) from error
    except (URLError, TimeoutError, OSError) as error:
        raise OAuthTokenExchangeError(
            "OAuth provider is unavailable"
        ) from error

    try:
        payload = json.loads(body)
    except json.JSONDecodeError as error:
        raise OAuthTokenExchangeError(
            "OAuth provider returned an invalid token response"
        ) from error
    if not isinstance(payload, dict) or not payload.get("access_token"):
        raise OAuthTokenExchangeError(
            "OAuth provider returned no access token"
        )
    return payload


def refresh_oauth_token(
    source_type: str,
    refresh_token: str,
    connection_config: dict | None = None,
) -> dict:
    provider = get_provider(source_type)
    client_id, client_secret = get_provider_credentials(provider)
    config = connection_config or {}
    token_url = get_provider_endpoint(provider, "token")
    if provider.source_type == "sage":
        token_url = get_sage_token_url(config.get("country"))

    params = {
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
    }
    headers = {"Accept": "application/json"}
    if provider.use_basic_token_auth:
        import base64

        encoded = base64.b64encode(
            f"{client_id}:{client_secret}".encode("utf-8")
        ).decode("ascii")
        headers["Authorization"] = f"Basic {encoded}"
    else:
        params["client_id"] = client_id
        params["client_secret"] = client_secret

    request = Request(
        token_url,
        data=urlencode(params).encode("utf-8"),
        headers={
            **headers,
            "Content-Type": "application/x-www-form-urlencoded",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=20) as response:
            body = response.read().decode("utf-8")
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise OAuthTokenExchangeError(
            f"OAuth token refresh failed with HTTP {error.code}: {detail[:240]}"
        ) from error
    except (URLError, TimeoutError, OSError) as error:
        raise OAuthTokenExchangeError(
            "OAuth provider is unavailable while refreshing the token"
        ) from error

    try:
        payload = json.loads(body)
    except json.JSONDecodeError as error:
        raise OAuthTokenExchangeError(
            "OAuth provider returned an invalid refreshed token response"
        ) from error
    if not isinstance(payload, dict) or not payload.get("access_token"):
        raise OAuthTokenExchangeError(
            "OAuth provider returned no refreshed access token"
        )
    return payload


def get_xero_connections(access_token: str) -> list[dict]:
    connections_url = get_provider_setting("XERO_CONNECTIONS_API_URL")
    if not connections_url:
        raise OAuthProviderUnavailable(
            "XERO_CONNECTIONS_API_URL is required for Xero organisation lookup"
        )
    request = Request(
        connections_url,
        headers={
            "Accept": "application/json",
            "Authorization": f"Bearer {access_token}",
        },
        method="GET",
    )
    try:
        with urlopen(request, timeout=20) as response:
            body = response.read().decode("utf-8")
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise OAuthTokenExchangeError(
            f"Xero organisation lookup failed with HTTP {error.code}: {detail[:240]}"
        ) from error
    except (URLError, TimeoutError, OSError) as error:
        raise OAuthTokenExchangeError(
            "Xero organisation lookup is unavailable"
        ) from error

    try:
        payload = json.loads(body)
    except json.JSONDecodeError as error:
        raise OAuthTokenExchangeError(
            "Xero returned an invalid organisation response"
        ) from error

    if not isinstance(payload, list):
        raise OAuthTokenExchangeError(
            "Xero returned an invalid organisation response"
        )
    return [item for item in payload if isinstance(item, dict)]


def get_fernet() -> Fernet:
    if Fernet is None:
        raise OAuthProviderUnavailable(
            "Install cryptography to enable OAuth token storage"
        )

    key = clean_env("OAUTH_TOKEN_ENCRYPTION_KEY")
    if not key:
        raise OAuthProviderUnavailable(
            "OAUTH_TOKEN_ENCRYPTION_KEY is not configured"
        )
    try:
        return Fernet(key.encode("ascii"))
    except (ValueError, TypeError) as error:
        raise OAuthProviderUnavailable(
            "OAUTH_TOKEN_ENCRYPTION_KEY is invalid"
        ) from error


def encrypt_token(token: str | None) -> str | None:
    if not token:
        return None
    return get_fernet().encrypt(token.encode("utf-8")).decode("ascii")


def decrypt_token(value: str | None) -> str | None:
    if not value:
        return None
    try:
        return get_fernet().decrypt(value.encode("ascii")).decode("utf-8")
    except (InvalidToken, UnicodeDecodeError, ValueError) as error:
        raise OAuthProviderUnavailable(
            "Stored OAuth credential cannot be decrypted"
        ) from error


def token_expiry(payload: dict) -> datetime | None:
    try:
        expires_in = int(payload.get("expires_in"))
    except (TypeError, ValueError):
        return None
    return datetime.now(UTC).replace(tzinfo=None) + timedelta(
        seconds=max(0, expires_in)
    )
