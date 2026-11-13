from datetime import timedelta
import json
import io
import os
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlsplit

from cryptography.fernet import Fernet
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.application_context import application_scope, applications, scoped_setting, validate_applications
from app.db.database import Base
from app.db.models import HostedPortal, WorkspaceSubscription, utc_now
from app.modules import hosted_portals as portals, hosted_portal_registry as registry
from app.modules import hosted_portal_providers as providers
from app.modules.applications import ApplicationContextMiddleware, ApplicationCORSMiddleware
from app.modules.billing.service import stripe_request


class HostedPortalTests(unittest.TestCase):
    def setUp(self):
        env = {
            "APP_ENV": "test", "DATABASE_URL": "sqlite://", "OBJECT_STORAGE_PROVIDER": "local",
            "DECISIONATE_WEB_APP_URL": "https://www.decisionate.ca", "DECISIONATE_API_URL": "https://api.decisionate.ca",
            "OAUTH_TOKEN_ENCRYPTION_KEY": Fernet.generate_key().decode(), "HOSTED_PORTALS_ENABLED": "true",
            "STRIPE_SECRET_KEY": "ca-only-secret", "HOSTED_PORTALS_STRIPE_SECRET_KEY": "sk_live_platform",
            "STRIPE_API_URL": "https://api.stripe.com/v1",
            "HOSTED_PORTALS_STRIPE_CLIENT_ID": "ca_connect", "HOSTED_PORTALS_CLERK_PLATFORM_TOKEN": "clerk-platform-private",
            "HOSTED_PORTALS_VERCEL_TOKEN": "vercel-private", "HOSTED_PORTALS_VERCEL_TEAM_ID": "team_one",
            "HOSTED_PORTALS_GITHUB_REPOSITORY": "example/app", "HOSTED_PORTALS_GITHUB_REPO_ID": "123",
            "HOSTED_PORTALS_RESEND_API_KEY": "resend-platform-private",
        }
        self.patch(patch.dict(os.environ, env, clear=True))
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.addCleanup(self.engine.dispose)
        self.Session = sessionmaker(bind=self.engine, expire_on_commit=False)
        self.patch(patch.object(portals, "SessionLocal", self.Session))
        self.patch(patch("app.db.database.SessionLocal", self.Session))
        self.auth = self.patch(patch.object(portals, "get_auth_context", return_value=SimpleNamespace(
            user_id="owner", workspace_id="owner", workspace_role="owner")))
        self.patch(patch.object(portals, "build_subscription_access_state", return_value=SimpleNamespace(access_allowed=True)))
        with self.Session() as db:
            db.add(WorkspaceSubscription(workspace_id="owner", plan="agency", status="active"))
            db.commit()
        registry.invalidate_registry()
        self.addCleanup(registry.invalidate_registry)
        app = FastAPI()
        app.include_router(portals.router)
        self.client = TestClient(ApplicationCORSMiddleware(ApplicationContextMiddleware(app),
            allow_origins=["https://www.decisionate.ca"], allow_methods=["*"], allow_headers=["*"], allow_credentials=True))
        self.addCleanup(self.client.close)
        self.config = {
            "name": "North Star", "domain": "portal.northstar.example", "support_email": "support@northstar.example",
            "privacy_url": "https://northstar.example/privacy", "terms_url": "https://northstar.example/terms",
            "prices": {key: 4900 for key, _, _ in portals.PRICES},
        }
        self.ready = True
        self.calls = []
        self.created_prices = []

    def patch(self, patcher):
        value = patcher.start()
        self.addCleanup(patcher.stop)
        return value

    def save(self, **kwargs):
        return self.client.put("/api/v2/hosted-portals", json={"configuration": self.config, **kwargs})

    def saved_connected(self):
        result = self.save()
        self.assertEqual(result.status_code, 200, result.text)
        self.portal_id = result.json()["id"]
        with self.Session() as db:
            db.get(HostedPortal, self.portal_id).stripe_account_id = "acct_customer"
            db.commit()

    def provider_mocks(self):
        self.patch(patch.object(providers, "portal_https_ready", side_effect=lambda *_: self.ready))
        self.patch(patch.object(providers, "ensure_project", return_value={"id": "prj_one"}))
        self.patch(patch.object(providers, "ensure_project_domain", return_value={"verified": False,
            "verification": [{"type": "TXT", "domain": "_vercel.portal.northstar.example", "value": "proof"}]}))
        self.patch(patch.object(providers, "ensure_clerk_application", return_value={"application_id": "app_one", "instances": [{
            "environment_type": "production", "secret_key": "sk_live_isolated", "publishable_key": "pk_live_isolated",
        }]}))
        self.patch(patch.object(providers, "ensure_email_domain", return_value={"id": "email_one", "records": [
            {"type": "TXT", "name": "resend._domainkey.mail.portal.northstar.example", "value": "public-dkim"},
        ]}))
        self.patch(patch.object(providers, "clerk", side_effect=self.clerk))
        self.patch(patch.object(providers, "vercel", side_effect=self.vercel))
        self.patch(patch.object(providers, "stripe", side_effect=self.stripe))
        self.patch(patch.object(providers, "resend", side_effect=self.resend))

    def clerk(self, path, **kwargs):
        self.calls.append(("clerk", path, kwargs))
        if kwargs.get("method") == "PATCH":
            return {}
        if path.endswith("/domains"):
            return {"data": [{"name": self.config["domain"], "frontend_api_url": "https://clerk.portal.northstar.example", "dns_targets": [
                {"record_type": "CNAME", "host": "clerk.portal.northstar.example", "value": "clerk.example", "required": True},
            ]}]}
        if path.endswith(("/status", "/dns_check")):
            return {"status": "complete" if self.ready else "incomplete"}
        self.fail("Unexpected Clerk request: " + path)

    def vercel(self, path, **kwargs):
        self.calls.append(("vercel", path, kwargs))
        if "/env?" in path:
            return {}
        if path.startswith("/v6/deployments?"):
            return {"deployments": []}
        if path == "/v13/deployments":
            return {"id": "dpl_one"}
        if path.endswith("/verify"):
            return {"verified": self.ready}
        if path.endswith("/config"):
            return {"misconfigured": not self.ready}
        if path == "/v13/deployments/dpl_one":
            return {"readyState": "READY", "target": "production"}
        self.fail("Unexpected hosting request: " + path)

    def stripe(self, path, account="", **kwargs):
        self.calls.append(("stripe", path, account, kwargs))
        self.assertEqual(account, "acct_customer")
        if path == "/products":
            return {"id": "prod_one"}
        if path.startswith("/prices?"):
            return {"data": self.created_prices if "active=true" in path else []}
        if path.startswith("/webhook_endpoints?"):
            return {"data": []}
        if path == "/prices":
            result = {"id": "price_" + kwargs["key"], "unit_amount": kwargs["body"]["unit_amount"], "currency": "usd",
                      "metadata": {"portal_id": self.portal_id}, "recurring": {"interval": kwargs["body"].get("recurring[interval]"), "interval_count": 1}}
            self.created_prices.append(result)
            return result
        if path == "/webhook_endpoints":
            return {"id": "we_one", "secret": "whsec_private"}
        if path == "/webhook_endpoints/we_one":
            return {"status": "enabled", "url": "https://api.decisionate.ca/billing/webhook/" + self.portal_id}
        if path == "/account":
            return {"id": "acct_customer", "charges_enabled": self.ready, "payouts_enabled": self.ready}
        self.fail("Unexpected billing request: " + path)

    def resend(self, path, **kwargs):
        self.calls.append(("email", path, kwargs))
        if path == "/api-keys":
            if not kwargs:
                return {"data": []}
            self.assertEqual(kwargs["body"]["permission"], "sending_access")
            self.assertEqual(kwargs["body"]["domain_id"], "email_one")
            return {"token": "re_send_only"}
        return {"status": "verified" if self.ready else "pending"}

    def prepare(self):
        for _ in range(20):
            result = self.client.post("/api/v2/hosted-portals/prepare")
            self.assertEqual(result.status_code, 200, result.text)
            if result.json()["status"] in {"waiting", "ready", "live"}:
                return result.json()
        self.fail("Provisioning did not reach a waiting or ready state")

    def test_complete_onboarding_launches_only_after_live_verification(self):
        self.saved_connected(); self.provider_mocks()
        self.ready = False
        result = self.prepare()
        self.assertEqual(result["status"], "waiting")
        self.assertNotIn(self.portal_id, applications())
        self.assertEqual(self.client.post("/api/v2/hosted-portals/launch").status_code, 409)
        self.ready = True
        self.assertEqual(self.prepare()["status"], "ready")
        self.assertNotIn(self.portal_id, applications())
        result = self.client.post("/api/v2/hosted-portals/launch")
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json()["url"], "https://" + self.config["domain"])
        with application_scope(self.portal_id):
            self.assertEqual(scoped_setting("CLERK_SECRET_KEY"), "sk_live_isolated")
            self.assertEqual(scoped_setting("STRIPE_CONNECTED_ACCOUNT_ID"), "acct_customer")
            self.assertEqual(scoped_setting("STRIPE_SECRET_KEY"), "sk_live_platform")
            self.assertEqual(scoped_setting("MISSING_SECRET"), "")
        self.assertEqual(scoped_setting("STRIPE_SECRET_KEY"), "ca-only-secret")
        listing = self.client.get("/api/v2/hosted-portals")
        self.assertEqual(listing.headers["cache-control"], "no-store")
        for secret in ("sk_live_isolated", "whsec_private", "clerk-platform-private", "re_send_only"):
            self.assertNotIn(secret, listing.text)
        with self.Session() as db:
            self.assertTrue(db.get(HostedPortal, self.portal_id).protected_settings.startswith("enc:v1:"))

    def test_launch_rechecks_readiness_and_does_not_trust_saved_green_checks(self):
        self.saved_connected(); self.provider_mocks(); self.prepare()
        self.ready = False
        result = self.client.post("/api/v2/hosted-portals/launch")
        self.assertEqual(result.status_code, 409)
        self.assertNotIn(self.portal_id, applications())

    def test_preparation_resume_does_not_create_completed_resources_again(self):
        self.saved_connected(); self.provider_mocks()
        self.client.post("/api/v2/hosted-portals/prepare")
        with patch.object(providers, "ensure_project", side_effect=AssertionError("Duplicate hosting")):
            self.prepare()
        self.assertEqual(len([call for call in self.calls if call[0] == "stripe" and call[1] == "/prices"]), len(portals.PRICES))

    def test_provider_failure_is_redacted_and_releases_operation(self):
        self.saved_connected()
        with patch.object(providers, "ensure_project", side_effect=providers.ProvisioningError("Hosting", 429)):
            response = self.client.post("/api/v2/hosted-portals/prepare")
        self.assertEqual(response.status_code, 502)
        with self.Session() as db:
            self.assertIsNone(db.get(HostedPortal, self.portal_id).operation_token)

    def test_owner_and_agency_plan_required(self):
        for identity in (
            SimpleNamespace(user_id="owner", workspace_id="client", workspace_role="owner"),
            SimpleNamespace(user_id="owner", workspace_id="owner", workspace_role="member"),
            SimpleNamespace(user_id="stranger", workspace_id="stranger", workspace_role="owner"),
        ):
            self.auth.return_value = identity
            self.assertEqual(self.client.get("/api/v2/hosted-portals").status_code, 403)
            self.assertEqual(self.save().status_code, 403)

    def test_revision_and_provisioned_configuration_cannot_be_overwritten(self):
        self.assertEqual(self.save().status_code, 200)
        self.assertEqual(self.save().status_code, 409)
        self.assertEqual(self.save(revision=1).status_code, 200)
        with self.Session() as db:
            db.query(HostedPortal).one().stripe_account_id = "acct_customer"
            db.commit()
        self.assertEqual(self.save(revision=2).status_code, 409)

    def test_missing_platform_setup_fails_without_provisioning(self):
        self.saved_connected()
        with patch.dict(os.environ, {"HOSTED_PORTALS_CLERK_PLATFORM_TOKEN": ""}), patch.object(providers, "ensure_project") as create:
            self.assertEqual(self.client.post("/api/v2/hosted-portals/prepare").status_code, 503)
            create.assert_not_called()

    def test_concurrent_provision_is_rejected_and_expired_lease_can_resume(self):
        self.saved_connected(); self.provider_mocks()
        with self.Session() as db:
            row = db.get(HostedPortal, self.portal_id)
            row.operation_token = "running"; row.operation_started_at = utc_now()
            db.commit()
        self.assertEqual(self.client.post("/api/v2/hosted-portals/prepare").status_code, 409)
        with self.Session() as db:
            db.get(HostedPortal, self.portal_id).operation_started_at = utc_now() - timedelta(minutes=11)
            db.commit()
        self.assertEqual(self.client.post("/api/v2/hosted-portals/prepare").status_code, 200)

    def test_invalid_configuration_and_existing_domain_rejected(self):
        for domain in ("localhost", "127.0.0.1", "https://foo.example", "foo.vercel.app", "x.local", "../test"):
            self.config["domain"] = domain
            self.assertEqual(self.save().status_code, 422)
        self.config["domain"] = "www.decisionate.ca"
        self.assertEqual(self.save().status_code, 409)

    def test_oauth_state_is_one_use_and_account_must_be_live_separate(self):
        self.save()
        result = self.client.post("/api/v2/hosted-portals/stripe")
        state = parse_qs(urlsplit(result.json()["url"]).query)["state"][0]
        with patch.object(providers, "exchange_stripe_code", return_value={"stripe_user_id": "acct_customer", "scope": "read_write", "livemode": True}), patch.object(providers, "stripe", return_value={"id": "acct_platform"}):
            result = self.client.get("/api/v2/hosted-portals/stripe/callback", params={"state": state, "code": "secret-code"}, follow_redirects=False)
            self.assertEqual(result.status_code, 303)
            self.assertTrue(result.headers["location"].endswith("?stripe=connected"))
            self.assertEqual(self.client.get("/api/v2/hosted-portals/stripe/callback", params={"state": state, "code": "again"}).status_code, 400)

    def test_dynamic_cors_allows_only_launched_portal(self):
        self.saved_connected(); self.provider_mocks()
        origin = "https://" + self.config["domain"]
        headers = {"Origin": origin, "Access-Control-Request-Method": "GET"}
        self.assertEqual(self.client.options("/api/v2/application", headers=headers).status_code, 400)
        self.prepare(); self.client.post("/api/v2/hosted-portals/launch")
        self.assertEqual(self.client.options("/api/v2/application", headers=headers).headers["access-control-allow-origin"], origin)
        self.assertNotIn("access-control-allow-origin", self.client.options("/api/v2/application", headers={**headers, "Origin": "https://evil.example"}).headers)

    def test_default_bootstrap_does_not_query_hosted_registry(self):
        with patch.object(registry, "hosted_applications", side_effect=AssertionError("DB not ready")):
            self.assertEqual(scoped_setting("STRIPE_SECRET_KEY"), "ca-only-secret")
            validate_applications()

    def test_prices_are_integer_cents_and_legal_urls_cannot_loop_to_portal(self):
        for amount in (True, 50.5, "4900", 49):
            self.config["prices"]["PROFESSIONAL"] = amount
            self.assertEqual(self.save().status_code, 422)
        self.config["prices"]["PROFESSIONAL"] = 4900
        self.config["privacy_url"] = "https://" + self.config["domain"] + "/privacy"
        self.assertEqual(self.save().status_code, 422)

    def test_expired_oauth_state_and_invalid_connected_accounts_are_rejected(self):
        self.save()
        result = self.client.post("/api/v2/hosted-portals/stripe")
        state = parse_qs(urlsplit(result.json()["url"]).query)["state"][0]
        with self.Session() as db:
            db.query(HostedPortal).one().oauth_expires_at = utc_now() - timedelta(seconds=1)
            db.commit()
        with patch.object(providers, "exchange_stripe_code") as exchange:
            self.assertEqual(self.client.get("/api/v2/hosted-portals/stripe/callback", params={"state": state, "code": "code"}).status_code, 400)
            exchange.assert_not_called()
        for fields in ({"livemode": False}, {"scope": "read_only"}, {"stripe_user_id": "acct_platform"}):
            result = self.client.post("/api/v2/hosted-portals/stripe")
            state = parse_qs(urlsplit(result.json()["url"]).query)["state"][0]
            token = {"stripe_user_id": "acct_customer", "scope": "read_write", "livemode": True, **fields}
            with patch.object(providers, "exchange_stripe_code", return_value=token), patch.object(providers, "stripe", return_value={"id": "acct_platform"}):
                response = self.client.get("/api/v2/hosted-portals/stripe/callback", params={"state": state, "code": "code"}, follow_redirects=False)
                self.assertTrue(response.headers["location"].endswith("?stripe=failed"))
            with self.Session() as db:
                self.assertIsNone(db.query(HostedPortal).one().stripe_account_id)

    def test_late_oauth_callback_cannot_replace_account_connected_while_exchange_runs(self):
        self.save()
        result = self.client.post("/api/v2/hosted-portals/stripe")
        state = parse_qs(urlsplit(result.json()["url"]).query)["state"][0]
        def exchange(_):
            with self.Session() as db:
                db.query(HostedPortal).one().stripe_account_id = "acct_kept"
                db.commit()
            return {"stripe_user_id": "acct_replacement", "scope": "read_write", "livemode": True}
        with patch.object(providers, "exchange_stripe_code", side_effect=exchange), patch.object(providers, "stripe", return_value={"id": "acct_platform"}):
            response = self.client.get("/api/v2/hosted-portals/stripe/callback", params={"state": state, "code": "code"}, follow_redirects=False)
        self.assertTrue(response.headers["location"].endswith("?stripe=failed"))
        with self.Session() as db:
            self.assertEqual(db.query(HostedPortal).one().stripe_account_id, "acct_kept")

    def test_expired_worker_cannot_overwrite_new_operation(self):
        self.saved_connected(); self.provider_mocks()
        def project(_):
            with self.Session() as db:
                row = db.get(HostedPortal, self.portal_id)
                row.operation_token = "new-operation"
                row.provider_state = '{"kept":true}'
                db.commit()
            return {"id": "prj_one"}
        with patch.object(providers, "ensure_project", side_effect=project):
            self.assertEqual(self.client.post("/api/v2/hosted-portals/prepare").status_code, 409)
        with self.Session() as db:
            row = db.get(HostedPortal, self.portal_id)
            self.assertEqual(row.operation_token, "new-operation")
            self.assertEqual(json.loads(row.provider_state), {"kept": True})

    def test_https_and_price_checks_cannot_be_bypassed(self):
        self.saved_connected(); self.provider_mocks()
        with patch.object(providers, "portal_https_ready", return_value=False):
            self.assertEqual(self.prepare()["status"], "waiting")
        self.created_prices[0]["unit_amount"] = 1
        result = self.prepare()
        self.assertEqual(result["status"], "waiting")
        self.assertFalse(result["checks"]["billing"])
        self.assertNotIn(self.portal_id, applications())

    def test_invalid_encrypted_registration_never_borrows_default_secrets(self):
        self.saved_connected()
        with self.Session() as db:
            row = db.get(HostedPortal, self.portal_id)
            row.status = "live"
            row.protected_settings = "enc:v1:invalid"
            db.commit()
        self.assertNotIn(self.portal_id, applications())
        self.assertEqual(scoped_setting("STRIPE_SECRET_KEY"), "ca-only-secret")

    def test_connected_billing_requests_use_correct_account_and_default_is_unchanged(self):
        self.saved_connected(); self.provider_mocks(); self.prepare()
        self.client.post("/api/v2/hosted-portals/launch")
        response = MagicMock()
        response.__enter__.return_value.read.return_value = b'{"id":"cs_test"}'
        with patch("app.modules.billing.service.urlopen", return_value=response) as send:
            with application_scope(self.portal_id):
                stripe_request("/checkout/sessions", {}, scoped_setting("STRIPE_SECRET_KEY"))
            request = send.call_args.args[0]
            self.assertEqual(request.full_url, "https://api.stripe.com/v1/checkout/sessions")
            self.assertEqual(request.get_header("Stripe-account"), "acct_customer")
            stripe_request("/checkout/sessions", {}, "ca-only-secret")
            self.assertIsNone(send.call_args.args[0].get_header("Stripe-account"))

    def test_provider_transport_redacts_error_body_and_blocks_redirects(self):
        error = HTTPError("https://api.stripe.com/v1/account", 403, "private", {}, io.BytesIO(b"secret-provider-payload"))
        with patch.object(providers, "build_opener") as opener:
            opener.return_value.open.side_effect = error
            with self.assertRaises(providers.ProvisioningError) as caught:
                providers.stripe("/account", "acct_customer")
            self.assertNotIn("secret-provider-payload", str(caught.exception))
            self.assertEqual(caught.exception.status, 403)
            request = opener.return_value.open.call_args.args[0]
            self.assertEqual(request.get_header("Stripe-account"), "acct_customer")
        self.assertIsNone(providers.NoRedirects().redirect_request(None, None, 302, "", {}, "https://evil.example"))

    def test_https_probe_rejects_private_addresses_without_connecting(self):
        with patch("app.modules.datasets.router.socket.getaddrinfo", return_value=[(2, 1, 6, "", ("127.0.0.1", 443))]), patch("app.modules.datasets.router.socket.socket") as connect:
            self.assertFalse(providers.portal_https_ready("portal.example", "portal-one"))
            connect.assert_not_called()


if __name__ == "__main__":
    unittest.main()
