from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import re
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from urllib.error import HTTPError, URLError
from urllib.parse import (
    parse_qsl,
    urlencode,
    urlparse,
    urlsplit,
    urlunsplit,
)
from urllib.request import Request, urlopen

from app.configuration import get_provider_setting, get_runtime_configuration


logger = logging.getLogger(__name__)

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
    use_pkce: bool = False
    include_redirect_uri: bool = True
    allow_empty_scopes: bool = False
    required_scopes: tuple[str, ...] = ()
    required_scope_groups: tuple[tuple[str, ...], ...] = ()


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
            "tickets",
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
        required_scopes=(
            "user:profile:read",
            "user:invoices:read",
            "user:expenses:read",
            "user:payments:read",
            "user:clients:read",
            "user:account:read",
            "user:credit_notes:read",
            "user:projects:read",
        ),
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
        required_scope_groups=(
            (
                "accounting.invoices.read",
                "accounting.invoices",
                "accounting.transactions.read",
                "accounting.transactions",
            ),
            (
                "accounting.payments.read",
                "accounting.payments",
                "accounting.transactions.read",
                "accounting.transactions",
            ),
            (
                "accounting.contacts.read",
                "accounting.contacts",
            ),
            (
                "accounting.settings.read",
                "accounting.settings",
            ),
        ),
    ),
    "zoho_books": OAuthProvider(
        source_type="zoho_books",
        authorization_url_env="ZOHO_BOOKS_OAUTH_AUTHORIZATION_URL",
        token_url_env="ZOHO_BOOKS_OAUTH_TOKEN_URL",
        client_id_env="ZOHO_BOOKS_CLIENT_ID",
        client_secret_env="ZOHO_BOOKS_CLIENT_SECRET",
        scopes_env="ZOHO_BOOKS_OAUTH_SCOPES",
        required_scopes=(
            "ZohoBooks.settings.READ",
            "ZohoBooks.invoices.READ",
            "ZohoBooks.contacts.READ",
            "ZohoBooks.expenses.READ",
            "ZohoBooks.customerpayments.READ",
            "ZohoBooks.creditnotes.READ",
            "ZohoBooks.estimates.READ",
            "ZohoBooks.salesorders.READ",
            "ZohoBooks.projects.READ",
        ),
    ),
    "salesforce": OAuthProvider(
        source_type="salesforce",
        authorization_url_env="SALESFORCE_OAUTH_AUTHORIZATION_URL",
        token_url_env="SALESFORCE_OAUTH_TOKEN_URL",
        client_id_env="SALESFORCE_CLIENT_ID",
        client_secret_env="SALESFORCE_CLIENT_SECRET",
        scopes_env="SALESFORCE_OAUTH_SCOPES",
        use_pkce=True,
        required_scopes=("api", "refresh_token"),
    ),
    "google_analytics": OAuthProvider(
        source_type="google_analytics",
        authorization_url_env="GOOGLE_ANALYTICS_OAUTH_AUTHORIZATION_URL",
        token_url_env="GOOGLE_ANALYTICS_OAUTH_TOKEN_URL",
        client_id_env="GOOGLE_ANALYTICS_CLIENT_ID",
        client_secret_env="GOOGLE_ANALYTICS_CLIENT_SECRET",
        scopes_env="GOOGLE_ANALYTICS_OAUTH_SCOPES",
        required_scopes=(
            "https://www.googleapis.com/auth/analytics.readonly",
        ),
    ),
    "google_search_console": OAuthProvider(
        source_type="google_search_console",
        authorization_url_env="GOOGLE_SEARCH_CONSOLE_OAUTH_AUTHORIZATION_URL",
        token_url_env="GOOGLE_SEARCH_CONSOLE_OAUTH_TOKEN_URL",
        client_id_env="GOOGLE_SEARCH_CONSOLE_CLIENT_ID",
        client_secret_env="GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET",
        scopes_env="GOOGLE_SEARCH_CONSOLE_OAUTH_SCOPES",
        required_scopes=(
            "https://www.googleapis.com/auth/webmasters.readonly",
        ),
    ),
    "google_ads": OAuthProvider(
        source_type="google_ads",
        authorization_url_env="GOOGLE_ADS_OAUTH_AUTHORIZATION_URL",
        token_url_env="GOOGLE_ADS_OAUTH_TOKEN_URL",
        client_id_env="GOOGLE_ADS_CLIENT_ID",
        client_secret_env="GOOGLE_ADS_CLIENT_SECRET",
        scopes_env="GOOGLE_ADS_OAUTH_SCOPES",
        required_scopes=(
            "https://www.googleapis.com/auth/adwords",
        ),
    ),
    "google_business_profile": OAuthProvider(
        source_type="google_business_profile",
        authorization_url_env=(
            "GOOGLE_BUSINESS_PROFILE_OAUTH_AUTHORIZATION_URL"
        ),
        token_url_env="GOOGLE_BUSINESS_PROFILE_OAUTH_TOKEN_URL",
        client_id_env="GOOGLE_BUSINESS_PROFILE_CLIENT_ID",
        client_secret_env="GOOGLE_BUSINESS_PROFILE_CLIENT_SECRET",
        scopes_env="GOOGLE_BUSINESS_PROFILE_OAUTH_SCOPES",
        required_scopes=(
            "https://www.googleapis.com/auth/business.manage",
        ),
    ),
    "square": OAuthProvider(
        source_type="square",
        authorization_url_env="SQUARE_OAUTH_AUTHORIZATION_URL",
        token_url_env="SQUARE_OAUTH_TOKEN_URL",
        client_id_env="SQUARE_CLIENT_ID",
        client_secret_env="SQUARE_CLIENT_SECRET",
        scopes_env="SQUARE_OAUTH_SCOPES",
        required_scopes=("ORDERS_READ",),
    ),
    "lightspeed": OAuthProvider(
        source_type="lightspeed",
        authorization_url_env="LIGHTSPEED_OAUTH_AUTHORIZATION_URL",
        token_url_env="LIGHTSPEED_OAUTH_TOKEN_URL",
        client_id_env="LIGHTSPEED_CLIENT_ID",
        client_secret_env="LIGHTSPEED_CLIENT_SECRET",
        scopes_env="LIGHTSPEED_OAUTH_SCOPES",
        use_pkce=True,
        include_redirect_uri=False,
        required_scopes=("employee:register_read",),
    ),
    "lightspeed_x": OAuthProvider(
        source_type="lightspeed_x",
        authorization_url_env="LIGHTSPEED_X_OAUTH_AUTHORIZATION_URL",
        token_url_env="LIGHTSPEED_X_OAUTH_TOKEN_URL_TEMPLATE",
        client_id_env="LIGHTSPEED_X_CLIENT_ID",
        client_secret_env="LIGHTSPEED_X_CLIENT_SECRET",
        scopes_env="LIGHTSPEED_X_OAUTH_SCOPES",
        required_scopes=(
            "sales:read",
            "customers:read",
            "products:read",
        ),
    ),
    "lightspeed_k": OAuthProvider(
        source_type="lightspeed_k",
        authorization_url_env="LIGHTSPEED_K_OAUTH_AUTHORIZATION_URL",
        token_url_env="LIGHTSPEED_K_OAUTH_TOKEN_URL",
        client_id_env="LIGHTSPEED_K_CLIENT_ID",
        client_secret_env="LIGHTSPEED_K_CLIENT_SECRET",
        scopes_env="LIGHTSPEED_K_OAUTH_SCOPES",
        required_scopes=("orders-api", "items"),
    ),
    "lightspeed_o": OAuthProvider(
        source_type="lightspeed_o",
        authorization_url_env="LIGHTSPEED_O_OAUTH_AUTHORIZATION_URL",
        token_url_env="LIGHTSPEED_O_OAUTH_TOKEN_URL",
        client_id_env="LIGHTSPEED_O_CLIENT_ID",
        client_secret_env="LIGHTSPEED_O_CLIENT_SECRET",
        scopes_env="LIGHTSPEED_O_OAUTH_SCOPES",
        allow_empty_scopes=True,
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


def normalize_lightspeed_x_domain_prefix(value: str | None) -> str:
    """Validate the tenant prefix returned by Lightspeed X-Series OAuth."""
    domain_prefix = str(value or "").strip().lower()
    if not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", domain_prefix):
        raise OAuthProviderUnavailable(
            "Lightspeed X-Series did not return a valid domain prefix"
        )
    return domain_prefix


ZOHO_BOOKS_DATA_CENTER_SUFFIXES = (
    "com",
    "eu",
    "in",
    "com.au",
    "jp",
    "com.cn",
    "sa",
    "ca",
)
ZOHO_BOOKS_ACCOUNTS_SERVER_HOSTS = {
    *(f"accounts.zoho.{suffix}" for suffix in ZOHO_BOOKS_DATA_CENTER_SUFFIXES),
    # Zoho uses this host for the Canadian Accounts data center.
    "accounts.zohocloud.ca",
}


def normalize_zoho_books_accounts_server(value: str) -> str:
    candidate = str(value or "").strip().rstrip("/")
    parsed = urlparse(candidate)
    hostname = (parsed.hostname or "").lower().rstrip(".")
    if (
        parsed.scheme != "https"
        or not parsed.netloc
        or parsed.path not in ("", "/", "/oauth/v2/auth", "/oauth/v2/token")
        or parsed.query
        or parsed.fragment
        or parsed.username
        or parsed.password
        or hostname not in ZOHO_BOOKS_ACCOUNTS_SERVER_HOSTS
    ):
        raise OAuthProviderUnavailable(
            "Zoho Books returned an invalid accounts server"
        )
    return f"https://{hostname}"


def normalize_zoho_books_api_domain(value: str) -> str:
    candidate = str(value or "").strip().rstrip("/")
    parsed = urlparse(candidate)
    hostname = (parsed.hostname or "").lower().rstrip(".")
    allowed_hosts = {
        f"zohoapis.{suffix}"
        for suffix in ZOHO_BOOKS_DATA_CENTER_SUFFIXES
    } | {
        f"www.zohoapis.{suffix}"
        for suffix in ZOHO_BOOKS_DATA_CENTER_SUFFIXES
    }
    if (
        parsed.scheme != "https"
        or not parsed.netloc
        or hostname not in allowed_hosts
        or parsed.username
        or parsed.password
    ):
        raise OAuthProviderUnavailable(
            "Zoho Books returned an invalid API domain"
        )
    return f"https://{hostname}"


def get_zoho_books_organizations(
    access_token: str,
    api_domain: str,
) -> list[dict]:
    url = (
        f"{normalize_zoho_books_api_domain(api_domain)}"
        "/books/v3/organizations"
    )
    request = Request(
        url,
        headers={
            "Accept": "application/json",
            "Authorization": f"Zoho-oauthtoken {access_token}",
        },
        method="GET",
    )
    try:
        with urlopen(request, timeout=20) as response:
            body = response.read().decode("utf-8")
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise OAuthTokenExchangeError(
            "Zoho Books organization lookup failed with "
            f"HTTP {error.code}: {detail[:240]}"
        ) from error
    except (URLError, TimeoutError, OSError) as error:
        raise OAuthTokenExchangeError(
            "Zoho Books organization lookup is unavailable"
        ) from error

    try:
        payload = json.loads(body)
    except json.JSONDecodeError as error:
        raise OAuthTokenExchangeError(
            "Zoho Books returned an invalid organization response"
        ) from error

    organizations = payload.get("organizations")
    if not isinstance(organizations, list):
        raise OAuthTokenExchangeError(
            "Zoho Books returned no organizations"
        )
    return [
        organization
        for organization in organizations
        if isinstance(organization, dict)
    ]


SAGE_COUNTRY_ALIASES = {
    "CA": "CA",
    "CAN": "CA",
    "CANADA": "CA",
    "US": "US",
    "USA": "US",
    "UNITEDSTATES": "US",
    "DE": "DE",
    "DEU": "DE",
    "GERMANY": "DE",
    "ES": "ES",
    "ESP": "ES",
    "SPAIN": "ES",
    "FR": "FR",
    "FRA": "FR",
    "FRANCE": "FR",
    "GB": "GB",
    "GBR": "GB",
    "UK": "GB",
    "UNITEDKINGDOM": "GB",
    "IE": "IE",
    "IRL": "IE",
    "IRELAND": "IE",
}


def normalize_sage_country(country: str | None) -> str:
    normalized = re.sub(r"[^A-Z]", "", str(country or "").upper())
    return SAGE_COUNTRY_ALIASES.get(normalized, "")


def get_sage_token_url(country: str | None = None) -> str:
    configured = clean_env("SAGE_OAUTH_TOKEN_URL")
    normalized_country = normalize_sage_country(country)
    regional_urls = {
        "CA": "https://oauth.na.sageone.com/token",
        "US": "https://oauth.na.sageone.com/token",
        "DE": "https://oauth.eu.sageone.com/token",
        "ES": "https://oauth.eu.sageone.com/token",
        "FR": "https://oauth.eu.sageone.com/token",
        "GB": "https://app.sageone.com/oauth2/token",
        "IE": "https://app.sageone.com/oauth2/token",
    }
    generic_url = "https://oauth.accounting.sage.com/token"
    legacy_regional_urls = set(regional_urls.values())

    # Sage's central authorization flow returns a country, but the token
    # exchange still uses the country's regional endpoint. Keep an explicitly
    # configured non-generic endpoint usable for alternate Sage environments.
    configured_url = configured.rstrip("/")
    if configured and configured_url not in {
        generic_url,
        *legacy_regional_urls,
    }:
        return configured
    if normalized_country in regional_urls:
        return regional_urls[normalized_country]
    if configured and configured_url in legacy_regional_urls:
        return configured_url
    raise OAuthProviderUnavailable(
        "Sage OAuth region is required before exchanging the authorization code"
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


def get_provider_scopes(
    provider: OAuthProvider,
    connection_config: dict | None = None,
) -> tuple[str, ...]:
    configured_scopes = get_provider_setting(provider.scopes_env)
    scopes = tuple(
        scope.strip()
        for scope in configured_scopes.replace(",", " ").split()
        if scope.strip()
    )
    if not scopes and not provider.allow_empty_scopes:
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
    for scope_group in provider.required_scope_groups:
        if not any(scope in scopes for scope in scope_group):
            raise OAuthProviderUnavailable(
                f"{provider.scopes_env} is missing one of the required scopes: "
                f"{', '.join(scope_group)}"
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


def create_pkce_verifier() -> str:
    """Create an RFC 7636 verifier suitable for the S256 method."""
    return secrets.token_urlsafe(64)


def create_pkce_challenge(code_verifier: str) -> str:
    if not code_verifier:
        raise ValueError("A PKCE code verifier is required")
    digest = hashlib.sha256(code_verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def build_authorization_url(
    source_type: str,
    state_token: str,
    connection_config: dict | None = None,
    code_challenge: str | None = None,
) -> str:
    provider = get_provider(source_type)
    client_id, _client_secret = get_provider_credentials(provider)
    config = connection_config or {}
    authorization_url = get_provider_endpoint(provider, "authorization")
    scopes = get_provider_scopes(provider, config)

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
    if provider.source_type == "sage":
        # Sage Accounting selects its API generation with this query value.
        # Normalize an older/mistyped deployment value before adding OAuth
        # parameters below.
        parsed_authorization_url = urlsplit(authorization_url)
        authorization_query = dict(
            parse_qsl(
                parsed_authorization_url.query,
                keep_blank_values=True,
            )
        )
        authorization_query["filter"] = "apiv3.1"
        normalized_country = normalize_sage_country(config.get("country"))
        if normalized_country:
            authorization_query["country"] = normalized_country.lower()
        authorization_url = urlunsplit(
            (
                parsed_authorization_url.scheme,
                parsed_authorization_url.netloc,
                parsed_authorization_url.path,
                urlencode(authorization_query),
                parsed_authorization_url.fragment,
            )
        )
    params = {
        "client_id": client_id,
        "response_type": "code",
        "state": state_token,
    }
    if scopes:
        params["scope"] = " ".join(scopes)
    if provider.include_redirect_uri:
        params["redirect_uri"] = get_callback_url()
    if provider.use_pkce:
        if not code_challenge:
            raise OAuthProviderUnavailable(
                f"{source_type} OAuth requires a PKCE code challenge"
            )
        params.update(
            {
                "code_challenge": code_challenge,
                "code_challenge_method": "S256",
            }
        )
    if provider.source_type == "zoho_books":
        params.update(
            {
                "scope": ",".join(scopes),
                "access_type": "offline",
                "prompt": "consent",
            }
        )
    elif provider.source_type == "square":
        # Ensure production sellers can choose the intended Square account
        # when their identity has access to more than one account.
        params["session"] = "false"
    elif provider.source_type in {
        "google_analytics",
        "google_search_console",
        "google_ads",
        "google_business_profile",
    }:
        params.update(
            {
                "access_type": "offline",
                "include_granted_scopes": "true",
                "prompt": "consent",
            }
        )
    parsed_authorization_url = urlsplit(authorization_url)
    authorization_query = dict(
        parse_qsl(
            parsed_authorization_url.query,
            keep_blank_values=True,
        )
    )
    authorization_query.update(params)
    return urlunsplit(
        (
            parsed_authorization_url.scheme,
            parsed_authorization_url.netloc,
            parsed_authorization_url.path,
            urlencode(authorization_query),
            parsed_authorization_url.fragment,
        )
    )


def build_woocommerce_authorization_url(
    store_url: str,
    state_token: str,
) -> str:
    """Build WooCommerce's store-owner API-key authorization URL."""
    candidate = str(store_url or "").strip().rstrip("/")
    parsed = urlparse(candidate)
    if (
        parsed.scheme != "https"
        or not parsed.netloc
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
    ):
        raise OAuthProviderUnavailable(
            "WooCommerce store_url must be an HTTPS store URL without credentials"
        )

    callback_url = get_callback_url()
    callback = urlparse(callback_url)
    callback_hostname = (callback.hostname or "").lower()
    if callback.scheme != "https" and callback_hostname not in {
        "localhost",
        "127.0.0.1",
        "::1",
    }:
        raise OAuthProviderUnavailable(
            "WooCommerce authorization requires an HTTPS OAuth callback URL"
        )

    store_base_url = candidate
    if parsed.path.rstrip("/").endswith("/wc-auth/v1/authorize"):
        authorization_url = store_base_url
    else:
        authorization_url = f"{store_base_url}/wc-auth/v1/authorize"

    params = {
        "app_name": "Decisionate",
        "scope": "read",
        "user_id": state_token,
        "return_url": f"{get_web_app_url()}/dashboard/connections",
        "callback_url": callback_url,
    }
    return f"{authorization_url}?{urlencode(params)}"


def build_token_request(
    source_type: str,
    token_url: str,
    params: dict[str, str],
    headers: dict[str, str],
) -> Request:
    content_type = (
        "application/data"
        if source_type == "zoho_books"
        else "application/x-www-form-urlencoded"
    )
    request_headers = {
        **headers,
        "Content-Type": content_type,
        "User-Agent": (
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
            if source_type == "sage"
            else "Decisionate/1.0 (+https://decisionate.ca)"
        ),
    }
    if source_type == "zoho_books":
        separator = "&" if "?" in token_url else "?"
        return Request(
            f"{token_url}{separator}{urlencode(params)}",
            headers=request_headers,
            method="POST",
        )
    return Request(
        token_url,
        data=urlencode(params).encode("utf-8"),
        headers=request_headers,
        method="POST",
    )


def read_token_response(
    source_type: str,
    request: Request,
    operation: str,
) -> str:
    """POST an OAuth token request, using Sage's browser-compatible path."""
    if source_type == "sage":
        try:
            from curl_cffi import requests as curl_requests
        except ModuleNotFoundError:
            # Keep local and older deployments functional until the optional
            # transport is installed; the normal path remains standards-based.
            pass
        else:
            request_headers = {
                key: value
                for key, value in request.header_items()
                if key.lower() != "user-agent"
            }
            token_urls = [request.full_url]
            regional_hosts = {
                "oauth.na.sageone.com",
                "oauth.eu.sageone.com",
                "app.sageone.com",
            }
            if urlsplit(request.full_url).netloc.lower() in regional_hosts:
                # Sage's regional token hosts are protected by a browser
                # signature rule that can reject a cloud-hosted callback even
                # when the same request is accepted from a normal browser.
                # The central v3.1 endpoint accepts the same form payload and
                # provides a server-side fallback for that specific response.
                token_urls.append("https://oauth.accounting.sage.com/token")

            last_status = None
            last_body = ""
            for token_url in token_urls:
                try:
                    response = curl_requests.post(
                        token_url,
                        data=request.data or b"",
                        headers=request_headers,
                        timeout=20,
                        impersonate="chrome",
                    )
                except Exception as error:
                    raise OAuthTokenExchangeError(
                        f"Sage OAuth provider is unavailable during {operation}"
                    ) from error
                body = response.text
                if response.status_code < 400:
                    return body
                last_status = response.status_code
                last_body = body
                is_regional_forbidden = (
                    response.status_code == 403
                    and token_url != token_urls[-1]
                )
                logger.warning(
                    "Sage OAuth token endpoint rejected request",
                    extra={
                        "operation": operation,
                        "host": urlsplit(token_url).netloc,
                        "status_code": response.status_code,
                        "retrying_central_endpoint": is_regional_forbidden,
                    },
                )
                if not is_regional_forbidden:
                    break

            raise OAuthTokenExchangeError(
                f"OAuth {operation} failed with HTTP "
                f"{last_status}: {last_body[:240]}"
            )

    try:
        with urlopen(request, timeout=20) as response:
            return response.read().decode("utf-8")
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise OAuthTokenExchangeError(
            f"OAuth {operation} failed with HTTP {error.code}: {detail[:240]}"
        ) from error
    except (URLError, TimeoutError, OSError) as error:
        raise OAuthTokenExchangeError(
            "OAuth provider is unavailable"
            if operation == "token exchange"
            else "OAuth provider is unavailable while refreshing the token"
        ) from error


def exchange_code(
    source_type: str,
    code: str,
    connection_config: dict | None = None,
    code_verifier: str | None = None,
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
    elif provider.source_type == "lightspeed_x":
        domain_prefix = normalize_lightspeed_x_domain_prefix(
            config.get("domain_prefix")
        )
        try:
            token_url = token_url.format(domain_prefix=domain_prefix)
        except KeyError as error:
            raise OAuthProviderUnavailable(
                "LIGHTSPEED_X_OAUTH_TOKEN_URL_TEMPLATE must include "
                "{domain_prefix}"
            ) from error
    elif provider.source_type == "sage":
        token_url = get_sage_token_url(config.get("country"))
    elif provider.source_type == "zoho_books":
        accounts_server = str(
            config.get("accounts_server") or ""
        ).strip()
        if accounts_server:
            try:
                normalized_accounts_server = (
                    normalize_zoho_books_accounts_server(accounts_server)
                )
            except OAuthProviderUnavailable:
                normalized_accounts_server = ""
            if normalized_accounts_server:
                token_url = (
                    f"{normalized_accounts_server}/oauth/v2/token"
                )

    params = {
        "grant_type": "authorization_code",
        "code": code,
    }
    if provider.include_redirect_uri:
        params["redirect_uri"] = get_callback_url()
    if provider.use_pkce:
        if not code_verifier:
            raise OAuthTokenExchangeError(
                f"{source_type} OAuth requires a PKCE code verifier"
            )
        params["code_verifier"] = code_verifier
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

    request = build_token_request(
        source_type,
        token_url,
        params,
        headers,
    )
    body = read_token_response(
        source_type,
        request,
        "token exchange",
    )

    try:
        payload = json.loads(body)
    except json.JSONDecodeError as error:
        raise OAuthTokenExchangeError(
            "OAuth provider returned an invalid token response"
        ) from error
    if not isinstance(payload, dict):
        raise OAuthTokenExchangeError(
            "OAuth provider returned an invalid token response"
        )
    if not payload.get("access_token"):
        provider_detail = str(
            payload.get("error_description")
            or payload.get("error")
            or payload.get("message")
            or ""
        ).strip()
        if provider_detail:
            if (
                source_type == "zoho_books"
                and provider_detail.lower() == "invalid_code"
            ):
                provider_detail = (
                    "authorization code expired or was already used; "
                    "start a new authorization and complete it once"
                )
            raise OAuthTokenExchangeError(
                f"{source_type.replace('_', ' ').title()} token exchange rejected: "
                f"{provider_detail[:160]}"
            )
        raise OAuthTokenExchangeError(
            "OAuth provider returned no access token"
        )
    return payload


def get_freshbooks_businesses(access_token: str) -> list[dict]:
    """Return FreshBooks businesses available to the authorized identity."""
    identity_url = get_provider_setting("FRESHBOOKS_IDENTITY_API_URL")
    if not identity_url:
        raise OAuthProviderUnavailable(
            "FRESHBOOKS_IDENTITY_API_URL is required for FreshBooks account discovery"
        )

    request = Request(
        identity_url,
        headers={
            "Accept": "application/json",
            "Api-Version": "alpha",
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
            f"FreshBooks account discovery failed with HTTP {error.code}: {detail[:240]}"
        ) from error
    except (URLError, TimeoutError, OSError) as error:
        raise OAuthTokenExchangeError(
            "FreshBooks account discovery is unavailable"
        ) from error

    try:
        payload = json.loads(body)
    except json.JSONDecodeError as error:
        raise OAuthTokenExchangeError(
            "FreshBooks returned an invalid account discovery response"
        ) from error

    response_payload = payload.get("response")
    memberships = (
        response_payload.get("business_memberships")
        if isinstance(response_payload, dict)
        else None
    )
    if not isinstance(memberships, list):
        raise OAuthTokenExchangeError(
            "FreshBooks returned no business memberships"
        )

    businesses = []
    for membership in memberships:
        if not isinstance(membership, dict):
            continue
        business = membership.get("business")
        if not isinstance(business, dict):
            continue
        account_id = str(business.get("account_id") or "").strip()
        if not account_id:
            continue
        businesses.append(
            {
                "account_id": account_id,
                "business_id": str(business.get("id") or "").strip(),
                "business_uuid": str(
                    business.get("business_uuid") or ""
                ).strip(),
                "name": str(business.get("name") or "").strip(),
                "role": str(membership.get("role") or "").strip(),
                "active": business.get("active") is not False,
            }
        )
    return businesses


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
    elif provider.source_type == "zoho_books":
        accounts_server = str(
            config.get("accounts_server") or ""
        ).strip()
        if accounts_server:
            try:
                normalized_accounts_server = (
                    normalize_zoho_books_accounts_server(accounts_server)
                )
            except OAuthProviderUnavailable:
                normalized_accounts_server = ""
            if normalized_accounts_server:
                token_url = (
                    f"{normalized_accounts_server}/oauth/v2/token"
                )
    elif provider.source_type == "lightspeed_x":
        domain_prefix = normalize_lightspeed_x_domain_prefix(
            config.get("domain_prefix")
        )
        try:
            token_url = token_url.format(domain_prefix=domain_prefix)
        except KeyError as error:
            raise OAuthProviderUnavailable(
                "LIGHTSPEED_X_OAUTH_TOKEN_URL_TEMPLATE must include "
                "{domain_prefix}"
            ) from error

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

    request = build_token_request(
        source_type,
        token_url,
        params,
        headers,
    )
    body = read_token_response(
        source_type,
        request,
        "token refresh",
    )

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


def revoke_oauth_token(
    source_type: str,
    token: str,
) -> None:
    """Revoke a provider token before a forced reauthorization."""
    provider = get_provider(source_type)
    if provider.source_type != "quickbooks":
        raise OAuthProviderUnavailable(
            f"OAuth token revocation is not configured for {source_type}"
        )

    client_id, client_secret = get_provider_credentials(provider)
    revocation_url = (
        get_provider_setting("QUICKBOOKS_OAUTH_REVOCATION_URL")
        or "https://developer.api.intuit.com/v2/oauth2/tokens/revoke"
    )
    encoded = base64.b64encode(
        f"{client_id}:{client_secret}".encode("utf-8")
    ).decode("ascii")
    request = Request(
        revocation_url,
        data=json.dumps({"token": str(token).strip()}).encode("utf-8"),
        headers={
            "Accept": "application/json",
            "Authorization": f"Basic {encoded}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=20):
            return
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise OAuthTokenExchangeError(
            f"OAuth token revocation failed with HTTP {error.code}: "
            f"{detail[:240]}"
        ) from error
    except (URLError, TimeoutError, OSError) as error:
        raise OAuthTokenExchangeError(
            "OAuth provider is unavailable while revoking the token"
        ) from error


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
