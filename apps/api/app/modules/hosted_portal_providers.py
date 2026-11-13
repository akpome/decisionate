"""Fixed-origin provisioning adapters. No customer-supplied API URLs or credentials."""

import json
import os
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener


class ProvisioningError(RuntimeError):
    def __init__(self, provider, status=0):
        self.provider, self.status = provider, status
        super().__init__(f"{provider} setup could not be completed. Please retry or contact support.")


class NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def setting(name):
    return os.getenv("HOSTED_PORTALS_" + name, "").strip()


def request(provider, origin, path, token, *, method="GET", body=None, form=False, headers=None):
    if not token:
        raise ProvisioningError(provider)
    payload = None if body is None else (
        urlencode(body).encode() if form else json.dumps(body).encode()
    )
    req = Request(origin + path, data=payload, method=method, headers={
        "Authorization": "Bearer " + token, "Accept": "application/json",
        "Content-Type": "application/x-www-form-urlencoded" if form else "application/json",
        **(headers or {}),
    })
    try:
        with build_opener(NoRedirects()).open(req, timeout=10) as response:
            data = response.read(2_000_001)
            if len(data) > 2_000_000:
                raise ProvisioningError(provider)
            if response.status == 204:
                return {}
            result = json.loads(data)
            if not isinstance(result, (dict, list)):
                raise ProvisioningError(provider)
            return result
    except HTTPError as exc:
        # Provider bodies can contain secrets, account details or authorization codes.
        raise ProvisioningError(provider, exc.code) from None
    except (URLError, TimeoutError, OSError, ValueError):
        raise ProvisioningError(provider) from None


def clerk(path, **kwargs):
    return request("Sign-in", "https://api.clerk.com/v1", path,
                   setting("CLERK_PLATFORM_TOKEN"), **kwargs)


def vercel(path, **kwargs):
    separator = "&" if "?" in path else "?"
    return request("Hosting", "https://api.vercel.com", path + separator + urlencode({
        "teamId": setting("VERCEL_TEAM_ID"),
    }), setting("VERCEL_TOKEN"), **kwargs)


def resend(path, **kwargs):
    return request("Email", "https://api.resend.com", path, setting("RESEND_API_KEY"), **kwargs)


def stripe(path, account="", *, body=None, key="", method="GET"):
    headers = {"Stripe-Account": account} if account else {}
    if key:
        headers["Idempotency-Key"] = key
    return request("Billing", "https://api.stripe.com", "/v1" + path,
                   setting("STRIPE_SECRET_KEY"), body=body, form=True, method=method, headers=headers)


def exchange_stripe_code(code):
    return request("Billing", "https://connect.stripe.com", "/oauth/token",
                   setting("STRIPE_SECRET_KEY"), method="POST", form=True,
                   body={"grant_type": "authorization_code", "code": code})


def ensure_clerk_application(portal_id, domain, existing_id=None):
    if existing_id:
        return clerk(f"/platform/applications/{quote(existing_id, safe='')}?include_secret_keys=true")
    # Reconcile an ambiguous create before issuing another POST. Names are generated,
    # never customer-controlled. Refuse to create if pagination cannot be completed.
    cursor = ""
    for _ in range(10):
        page = clerk("/platform/applications?" + urlencode({
            "paginated": "true", "limit": 100, **({"starting_after": cursor} if cursor else {}),
        }))
        for app in page.get("data", []):
            if app.get("name") == portal_id:
                return ensure_clerk_application(portal_id, domain, app["application_id"])
        pagination = page.get("cursor") or {}
        if not pagination.get("has_next_page"):
            break
        cursor = pagination.get("starting_after") or ""
        if not cursor:
            raise ProvisioningError("Sign-in")
    else:
        raise ProvisioningError("Sign-in")
    return clerk("/platform/applications", method="POST", body={
        "name": portal_id, "domain": domain, "environment_types": ["production"],
        "template": "b2b-saas",
    })


def ensure_project(portal_id):
    path = "/v9/projects/" + quote(portal_id, safe="")
    try:
        return vercel(path)
    except ProvisioningError as exc:
        if exc.status != 404:
            raise
    return vercel("/v11/projects", method="POST", body={
        "name": portal_id, "framework": "nextjs", "rootDirectory": "apps/web",
        "gitRepository": {"type": "github", "repo": setting("GITHUB_REPOSITORY")},
        "buildCommand": "npm run build", "installCommand": "npm ci",
    })


def ensure_project_domain(project, domain):
    path = f"/v9/projects/{quote(project, safe='')}/domains/{quote(domain, safe='')}"
    try:
        return vercel(path)
    except ProvisioningError as exc:
        if exc.status != 404:
            raise
    return vercel(f"/v10/projects/{quote(project, safe='')}/domains", method="POST", body={"name": domain})


def ensure_email_domain(domain):
    cursor = ""
    for _ in range(10):
        page = resend("/domains?" + urlencode({"limit": 100, **({"after": cursor} if cursor else {})}))
        for item in page.get("data", []):
            if item.get("name") == domain:
                return resend("/domains/" + quote(item["id"], safe=""))
        if not page.get("has_more"):
            return resend("/domains", method="POST", body={"name": domain})
        cursor = (page.get("data") or [{}])[-1].get("id")
        if not cursor:
            break
    raise ProvisioningError("Email")


def portal_https_ready(domain, portal_id):
    # Reuse the import path's public-IP-pinned TLS connection. Redirects and
    # proxies stay disabled, and this probe never sends credentials.
    from fastapi import HTTPException
    from app.modules.datasets.router import SignedFileHTTPSHandler

    try:
        opener = build_opener(NoRedirects(), ProxyHandler({}), SignedFileHTTPSHandler())
        with opener.open("https://" + domain + "/api/portal-health", timeout=10) as response:
            payload = json.loads(response.read(1024))
            return isinstance(payload, dict) and payload.get("portal_id") == portal_id
    except (HTTPException, HTTPError, URLError, OSError, ValueError):
        return False
