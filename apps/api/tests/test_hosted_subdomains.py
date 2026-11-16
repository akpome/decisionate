from datetime import UTC, datetime, timedelta
import base64
import json
import os
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
import jwt
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.application_context import get_application
from app.configuration import get_runtime_configuration
from app.db.database import Base
from app.db.models import (AppUser, AuthIdentity, HostedSubdomainPortal, HostedSubdomainEntitlement, HostedSubdomainEvent,
    Organization, OrganizationMember, WorkspaceSubscription, WhiteLabelAvailability, OAuthConnectionState, utc_now)
from app.modules import applications, auth_context, workspace_lifecycle
from app.modules.identity import service as identity
from app.modules.organizations import router as organizations
from app.modules.hosted_subdomains import router as portals, service, context, admin


class HostedSubdomainTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    def patched(self, patcher):
        result = patcher.start()
        self.addCleanup(patcher.stop)
        return result

    def setUp(self):
        self.patched(patch.dict(os.environ, {
            "APP_ENV": "test", "DATABASE_URL": "sqlite://", "OBJECT_STORAGE_PROVIDER": "local",
            "DECISIONATE_WEB_APP_URL": "https://app.decisionate.ca", "DECISIONATE_API_URL": "https://api.decisionate.ca",
            "AUTH_JWKS_URL": "https://shared.clerk.test/jwks", "AUTH_JWT_ISSUER": "https://shared.clerk.test",
            "AUTH_JWT_AUDIENCE": "decisionate", "BILLING_ENFORCEMENT_ENABLED": "true",
            "BILLING_PROVIDER": "stripe",
            "STRIPE_SECRET_KEY": "sk_test_shared", "STRIPE_AGENCY_PRICE_ID": "price_agency",
            "CLERK_SECRET_KEY": "sk_test_shared", "HOSTED_SUBDOMAINS_HOSTING_VERIFIED": "true",
            "HOSTED_SUBDOMAINS_AUTH_VERIFIED": "true", "HOSTED_SUBDOMAINS_DELIVERY_VERIFIED": "true",
        }, clear=True))
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.addCleanup(self.engine.dispose)
        self.Session = sessionmaker(bind=self.engine, expire_on_commit=False)
        for module in (portals, admin, applications, auth_context, identity, workspace_lifecycle, organizations):
            self.patched(patch.object(module, "SessionLocal", self.Session))
        self.patched(patch("app.db.database.SessionLocal", self.Session))
        self.patched(patch.object(auth_context, "get_jwks_client", return_value=SimpleNamespace(
            get_signing_key_from_jwt=lambda _: SimpleNamespace(key=self.key.public_key()))))
        with self.Session() as db:
            for user in ("agency", "another", "client", "staff"):
                db.add(AppUser(id=user))
                db.add(AuthIdentity(user_id=user, provider="clerk", subject=user))
            db.add_all([Organization(id=1, owner_user_id="agency", name="Original agency"),
                        Organization(id=2, owner_user_id="another", name="Other agency"),
                        Organization(id=3, owner_user_id="agency:client:1", name="Client", managing_agency_workspace_id="agency")])
            db.add_all([OrganizationMember(organization_id=3, clerk_user_id="client", role="owner"),
                        OrganizationMember(organization_id=1, clerk_user_id="staff", role="member")])
            for index, workspace in enumerate(("agency", "another"), start=1):
                db.add(WorkspaceSubscription(id=index, workspace_id=workspace, provider="stripe", status="active", plan="agency",
                    provider_subscription_id="sub_" + workspace, provider_customer_id="cus_" + workspace,
                    billing_interval="month", current_period_end=utc_now() + timedelta(days=30)))
            db.add(WhiteLabelAvailability(id=1, hosted_subdomain_enabled=True, custom_domain_enabled=False, updated_by_user_id="operator"))
            db.commit()
        app = FastAPI()
        app.include_router(portals.router)
        app.include_router(admin.router)
        app.include_router(applications.router)
        app.include_router(organizations.router, prefix="/organizations")

        @app.get("/identity")
        def whoami(request: Request):
            auth = auth_context.get_auth_context(request)
            return {"user": auth.user_id, "workspace": auth.workspace_id, "application": get_application().id,
                    "issuer": get_runtime_configuration().auth_jwt_issuer}

        self.client = TestClient(applications.ApplicationCORSMiddleware(applications.ApplicationContextMiddleware(app),
            allow_origins=["https://app.decisionate.ca"], allow_headers=["*"], allow_methods=["*"], allow_credentials=True))
        self.addCleanup(self.client.close)
        self.brand = service.Branding(name="North Star", support_email="help@northstar.test").model_dump()
        self.base = "/api/v2/hosted-subdomains"

    def headers(self, user="agency", workspace=None, origin="https://app.decisionate.ca", issuer="https://shared.clerk.test"):
        token = jwt.encode({"sub": user, "iss": issuer, "aud": "decisionate",
            "exp": datetime.now(UTC) + timedelta(minutes=10)}, self.key, algorithm="RS256")
        result = {"Authorization": "Bearer " + token, "Origin": origin, "X-User-Id": user}
        if workspace:
            result["X-Workspace-Id"] = workspace
        return result

    def save(self, slug="north-star", revision=0, **headers):
        return self.client.put(self.base, headers=self.headers(**headers), json={"slug": slug, "configuration": self.brand, "revision": revision})

    def publish(self):
        result = self.save()
        self.assertEqual(result.status_code, 200, result.text)
        self.portal_id = result.json()["id"]
        with patch.object(portals, "ensure_satellite", return_value="domain_north"):
            result = self.client.post(self.base + "/activate", headers=self.headers(),
                json={"revision": 1, "confirmation": "PUBLISH PORTAL"})
        self.assertEqual(result.status_code, 200, result.text)
        return result.json()

    def test_atomic_reservation_draft_preview_and_publish_do_not_modify_standard_brand(self):
        result = self.save(" North-Star ")
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json()["slug"], "north-star")
        response = self.client.get(self.base + "/resolve?hostname=north-star.decisionate.app")
        self.assertFalse(response.json()["active"])
        self.assertIsNone(response.json()["branding"])
        self.assertEqual(self.save(user="another").status_code, 409)
        self.assertEqual(self.save(revision=0).status_code, 409)
        self.assertEqual(self.save("changed", revision=1).status_code, 409)
        self.assertEqual(self.save(revision=1).json()["revision"], 2)
        with self.Session() as db:
            self.assertEqual(db.query(HostedSubdomainPortal).count(), 1)
            self.assertEqual(db.get(Organization, 1).name, "Original agency")
            self.assertEqual(db.query(HostedSubdomainEvent).count(), 2)

    def test_same_verified_identity_and_membership_required_on_hosted_origins(self):
        self.publish()
        origin = "https://north-star.decisionate.app"
        result = self.client.get("/identity", headers=self.headers(origin=origin))
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json(), {"user": "agency", "workspace": "agency", "application": "decisionate-ca", "issuer": "https://shared.clerk.test"})
        for headers in [self.headers(user="another", origin=origin), self.headers(user="another", workspace="agency", origin=origin),
                        self.headers(user="client", workspace="agency", origin=origin)]:
            self.assertEqual(self.client.get("/identity", headers=headers).status_code, 403)
        self.assertEqual(self.client.get("/identity", headers={"Origin": origin, "X-User-Id": "agency"}).status_code, 401)
        self.assertEqual(self.client.get("/identity", headers=self.headers(origin=origin, issuer="https://evil.test")).status_code, 401)
        client = self.client.get("/identity", headers=self.headers(user="client", workspace="agency:client:1", origin=origin))
        self.assertEqual(client.status_code, 200, client.text)

    def test_portal_discovery_filters_workspaces_and_never_creates_a_portal_membership(self):
        self.publish()
        for user, expected in [("client", ["agency:client:1"]), ("another", [])]:
            result = self.client.get("/organizations/workspaces", headers=self.headers(user=user, origin="https://north-star.decisionate.app"))
            self.assertEqual(result.status_code, 200, result.text)
            self.assertEqual([item["owner_user_id"] for item in result.json()], expected)

    def test_client_pause_unlink_and_agency_pause_take_effect_without_cached_access(self):
        self.publish()
        headers = self.headers(user="client", workspace="agency:client:1", origin="https://north-star.decisionate.app")
        with self.Session() as db:
            db.get(Organization, 3).is_paused = True
            db.commit()
        self.assertEqual(self.client.get("/identity", headers=headers).status_code, 403)
        with self.Session() as db:
            client = db.get(Organization, 3)
            client.is_paused = False
            client.managing_agency_workspace_id = None
            client.agency_detached_at = utc_now()
            db.commit()
        self.assertEqual(self.client.get("/identity", headers=headers).status_code, 403)
        with self.Session() as db:
            db.get(Organization, 1).is_paused = True
            db.commit()
        self.assertFalse(self.client.get(self.base + "/resolve?hostname=north-star.decisionate.app").json()["active"])

    def test_commercial_off_blocks_new_setup_but_not_live_access_or_brand_edits(self):
        row = self.publish()
        with self.Session() as db:
            db.get(WhiteLabelAvailability, 1).hosted_subdomain_enabled = False
            db.commit()
        self.assertEqual(self.save("new-portal", user="another").status_code, 403)
        self.assertEqual(self.save(revision=row["revision"]).status_code, 200)
        self.assertTrue(self.client.get(self.base + "/resolve?hostname=north-star.decisionate.app").json()["active"])
        with self.Session() as db:
            self.assertFalse(db.get(WhiteLabelAvailability, 1).custom_domain_enabled)

    def test_publish_rechecks_subscription_after_external_clerk_call(self):
        self.assertEqual(self.save().status_code, 200)
        def cancel(_):
            with self.Session() as db:
                db.get(WorkspaceSubscription, 1).status = "canceled"
                db.commit()
            return "domain_north"
        with patch.object(portals, "ensure_satellite", side_effect=cancel):
            response = self.client.post(self.base + "/activate", headers=self.headers(), json={"revision": 1, "confirmation": "PUBLISH PORTAL"})
        self.assertEqual(response.status_code, 403, response.text)
        with self.Session() as db:
            self.assertEqual(db.query(HostedSubdomainPortal).one().status, "reserved")

    def test_configuration_validation_rejects_scripts_html_reserved_names_and_unapproved_images(self):
        for slug in ["app", "billing", "www", "a", "ab--cd", "-hello", "hello-", "a.b", "a" * 41]:
            self.assertEqual(self.save(slug).status_code, 422, slug)
        for field, value in [("name", "<script>"), ("primary_color", "red;display:none"),
                             ("logo_url", "javascript:alert(1)"), ("background_url", "https://evil.test/a.png"),
                             ("favicon_url", "https://app.decisionate.ca/a.svg"), ("support_email", "one@test.com\nBcc:bad@test.com")]:
            with self.subTest(field=field):
                brand = {**self.brand, field: value}
                result = self.client.put(self.base, headers=self.headers(), json={"slug": "north-star", "configuration": brand})
                self.assertEqual(result.status_code, 422, result.text)

    def test_client_and_staff_cannot_provision(self):
        for user, workspace in [("client", "agency:client:1"), ("staff", "agency")]:
            self.assertEqual(self.save(user=user, workspace=workspace).status_code, 403)

    def test_agency_plan_includes_portal_without_a_separate_purchase(self):
        with patch("app.modules.billing.service.stripe_request", side_effect=AssertionError("Portal setup must not charge Stripe")) as stripe:
            setup = self.client.get(self.base, headers=self.headers())
            self.assertTrue(setup.json()["entitled"])
            self.publish()
        stripe.assert_not_called()
        with self.Session() as db:
            self.assertEqual(db.query(HostedSubdomainEntitlement).count(), 0)
            subscription = db.get(WorkspaceSubscription, 1)
            self.assertEqual(subscription.plan, "agency")
            self.assertEqual(subscription.provider_subscription_id, "sub_agency")
            self.assertEqual(subscription.status, "active")

    def test_other_plans_cannot_enable_hosted_access_even_with_billing_bypass(self):
        with patch.dict(os.environ, {"BILLING_ENFORCEMENT_ENABLED": "false"}):
            for plan in ("professional", "free"):
                with self.Session() as db:
                    db.get(WorkspaceSubscription, 1).plan = plan
                    db.commit()
                self.assertEqual(self.save().status_code, 403)

    def test_cors_requires_exact_active_portal_and_blocks_admin_even_for_valid_user(self):
        self.publish()
        for origin, expected in [("https://north-star.decisionate.app", 200),
                                  ("https://unregistered.decisionate.app", 400),
                                  ("https://north-star.decisionate.app.evil.test", 400),
                                  ("http://north-star.decisionate.app", 400)]:
            result = self.client.options("/identity", headers={"Origin": origin, "Access-Control-Request-Method": "GET"})
            self.assertEqual(result.status_code, expected, result.text)
        headers = self.headers(origin="https://north-star.decisionate.app")
        self.assertEqual(self.client.get("/admin/anything", headers=headers).status_code, 404)
        self.assertEqual(self.client.get("/marketing/activity", headers=headers).status_code, 404)
        self.assertEqual(self.client.put(self.base, headers=headers, json={"slug": "north-star", "configuration": self.brand}).status_code, 403)

    def test_operator_suspend_resume_retire_is_audited_and_entitlement_required(self):
        row = self.publish()
        with patch.object(admin, "require_platform_admin_full_access", return_value=SimpleNamespace(user_id="operator")):
            for action, active in [("suspend", False), ("resume", True), ("retire", False)]:
                response = self.client.post(f"/admin/hosted-subdomains/{row['id']}/status", json={"action": action,
                    "revision": row["revision"], "confirmation": "CHANGE PORTAL STATUS", "reason": "Operator test"})
                self.assertEqual(response.status_code, 200, response.text)
                row = response.json()
                resolved = self.client.get(self.base + "/resolve?hostname=north-star.decisionate.app")
                self.assertEqual(bool(resolved.status_code == 200 and resolved.json()["active"]), active)
            response = self.client.get(f"/admin/hosted-subdomains/{row['id']}/events")
            self.assertEqual([item["action"] for item in response.json()][:3], ["retire", "resume", "suspend"])

    def test_expired_or_canceled_subscription_revokes_access_without_deleting_data(self):
        self.publish()
        for status, days in [("canceled", 30), ("active", -1), ("unpaid", 30)]:
            with self.Session() as db:
                subscription = db.get(WorkspaceSubscription, 1)
                subscription.status = status
                subscription.current_period_end = utc_now() + timedelta(days=days)
                db.commit()
            self.assertFalse(self.client.get(self.base + "/resolve?hostname=north-star.decisionate.app").json()["active"])
        with self.Session() as db:
            self.assertIsNotNone(db.get(Organization, 3))
            self.assertEqual(db.get(HostedSubdomainPortal, self.portal_id).status, "active")

    def test_oauth_only_returns_to_portal_that_initiated_it(self):
        self.publish()
        with self.Session() as db:
            state = OAuthConnectionState(workspace_id="agency:client:1", user_id="client", source_type="meta_ads",
                state_token="test-state", connection_id=1, expires_at=utc_now() + timedelta(minutes=10))
            db.add(state)
            db.flush()
            with context.oauth_application_scope(state, db):
                self.assertIsNone(context.current_portal())
            with context.portal_scope(context.resolve_portal(db, "north-star.decisionate.app")):
                context.save_oauth_return(db, state)
            db.flush()
            with context.oauth_application_scope(state, db):
                self.assertEqual(get_runtime_configuration().web_url, "https://north-star.decisionate.app")
            client = db.get(Organization, 3)
            client.managing_agency_workspace_id = None
            client.agency_detached_at = utc_now()
            db.flush()
            with context.oauth_application_scope(state, db):
                self.assertIsNone(context.current_portal())

    def test_worker_context_restores_brand_and_primary_sender_without_changing_identity(self):
        self.publish()
        from app.infrastructure.email_branding import build_decisionate_email_header
        from app.modules.alerts.email_delivery import get_platform_sender_details
        with applications.workspace_application_scope("agency:client:1"):
            self.assertEqual(get_application().id, "decisionate-ca")
            self.assertEqual(get_runtime_configuration().web_url, "https://north-star.decisionate.app")
            self.assertIn("North Star", build_decisionate_email_header())
            with patch.dict(os.environ, {"EMAIL_PROVIDER": "resend", "RESEND_FROM_EMAIL": "no-reply@decisionate.ca"}):
                sender, name = get_platform_sender_details({"provider": "resend", "resend_from_email": "no-reply@decisionate.ca"})
                self.assertEqual(sender, "no-reply@decisionate.ca")
                self.assertIn("North Star", name)
        self.assertIsNone(context.current_portal())

    def test_clerk_registration_reconciles_exact_domain_and_rejects_conflicting_configuration(self):
        domain = {"id": "dom_one", "name": "north-star.decisionate.app", "is_satellite": True,
                  "proxy_url": "https://north-star.decisionate.app/__clerk"}
        with patch.object(service, "clerk_request", return_value={"data": [domain], "total_count": 1}) as request:
            self.assertEqual(service.ensure_satellite(domain["name"]), "dom_one")
            request.assert_called_once_with("/domains")
        with patch.object(service, "clerk_request", side_effect=[{"data": []}, domain]) as request:
            self.assertEqual(service.ensure_satellite(domain["name"]), "dom_one")
            self.assertTrue(request.call_args.kwargs["body"]["is_satellite"])
        with patch.object(service, "clerk_request", return_value={"data": [{**domain, "is_satellite": False}]}):
            with self.assertRaises(Exception) as caught:
                service.ensure_satellite(domain["name"])
            self.assertEqual(caught.exception.status_code, 409)
        with patch.object(service, "clerk_request", side_effect=[{"data": []}, {**domain, "name": "other.decisionate.app"}]):
            with self.assertRaises(Exception) as caught:
                service.ensure_satellite(domain["name"])
            self.assertEqual(caught.exception.status_code, 409)

    def test_portal_uses_existing_agency_trial_renewal_and_grace_rules(self):
        from app.modules.billing.lifecycle import build_subscription_access_state
        now = utc_now()
        with self.Session() as db:
            subscription = db.get(WorkspaceSubscription, 1)
            for interval in ("month", "year"):
                subscription.billing_interval = interval
                for status, elapsed, expected in [("active", None, True), ("trialing", None, True),
                                                   ("past_due", 1, True), ("past_due", 8, False),
                                                   ("canceled", None, False), ("incomplete", None, False)]:
                    with self.subTest(interval=interval, status=status, elapsed=elapsed):
                        subscription.status = status
                        subscription.current_period_end = now + timedelta(days=30)
                        subscription.payment_due_at = now - timedelta(days=elapsed) if elapsed else None
                        self.assertEqual(build_subscription_access_state(subscription).access_allowed, expected)
                        self.assertEqual(context.entitled(db, db.get(Organization, 1)), expected)
            subscription.status = "active"
            subscription.cancel_at_period_end = 1
            self.assertTrue(context.entitled(db, db.get(Organization, 1)))
            subscription.current_period_end = now - timedelta(days=1)
            self.assertFalse(context.entitled(db, db.get(Organization, 1)))
            subscription.current_period_end = None
            self.assertFalse(context.entitled(db, db.get(Organization, 1)))

    def test_readiness_needs_provider_verification_but_no_extra_stripe_price(self):
        self.assertEqual(service.launch_blockers(), [])
        self.assertEqual(self.save().status_code, 200)
        for setting in ("HOSTED_SUBDOMAINS_HOSTING_VERIFIED", "HOSTED_SUBDOMAINS_AUTH_VERIFIED", "HOSTED_SUBDOMAINS_DELIVERY_VERIFIED"):
            with patch.dict(os.environ, {setting: "false"}), patch.object(portals, "ensure_satellite") as clerk:
                self.assertEqual(len(service.launch_blockers()), 1)
                result = self.client.post(self.base + "/activate", headers=self.headers(), json={"revision": 1, "confirmation": "PUBLISH PORTAL"})
                self.assertEqual(result.status_code, 503, result.text)
                clerk.assert_not_called()

    def test_removed_purchase_and_cancellation_routes_cannot_modify_billing(self):
        self.publish()
        with patch("app.modules.billing.service.stripe_request") as stripe:
            for method, path in [("GET", "/subscription-offer"), ("POST", "/subscription"), ("DELETE", "/subscription")]:
                result = self.client.request(method, self.base + path, headers=self.headers(), json={"confirmation": "old-client"})
                self.assertEqual(result.status_code, 404, result.text)
            stripe.assert_not_called()
        with self.Session() as db:
            self.assertEqual(db.get(WorkspaceSubscription, 1).plan, "agency")
            self.assertEqual(db.get(WorkspaceSubscription, 1).status, "active")
            self.assertEqual(db.get(HostedSubdomainPortal, self.portal_id).status, "active")
        self.assertTrue(self.client.get(self.base + "/resolve?hostname=north-star.decisionate.app").json()["active"])

    def test_uploaded_images_are_published_as_bounded_raster_assets_and_hidden_when_suspended(self):
        png = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6jXAAAAAASUVORK5CYII=")
        self.brand["logo_url"] = "data:image/png;base64," + base64.b64encode(png).decode()
        self.publish()
        config = self.client.get(self.base + "/resolve?hostname=north-star.decisionate.app").json()
        self.assertEqual(config["branding"]["logo_url"], "https://api.decisionate.ca" + self.base + "/assets/north-star.decisionate.app/logo_url")
        result = self.client.get(self.base + "/assets/north-star.decisionate.app/logo_url")
        self.assertEqual(result.content, png)
        self.assertEqual(result.headers["content-type"], "image/png")
        self.assertEqual(result.headers["x-content-type-options"], "nosniff")
        with self.Session() as db:
            db.get(HostedSubdomainPortal, self.portal_id).status = "suspended"
            db.commit()
        self.assertEqual(self.client.get(self.base + "/assets/north-star.decisionate.app/logo_url").status_code, 404)

    def test_inline_images_reject_html_svg_invalid_base64_and_excessive_sizes(self):
        for value in ["data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=", "data:image/png;base64,PHNjcmlwdD4=",
                      "data:image/png;base64,!!!!", "data:image/png;base64," + base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"0" * (128 * 1024)).decode()]:
            with self.assertRaises(ValueError):
                service.Branding(**{**self.brand, "logo_url": value})

    def test_workspace_cleanup_removes_only_its_hosted_references(self):
        from app.modules.hosted_subdomains.cleanup import delete_hosted_workspace
        self.publish()
        with self.Session() as db:
            db.add_all([HostedSubdomainEntitlement(subscription_id=index, stripe_item_id=f"si_legacy_{index}", price_id="price_legacy")
                        for index in (1, 2)])
            db.flush()
            self.assertGreater(db.query(HostedSubdomainEvent).count(), 0)
            delete_hosted_workspace(db, "agency", 1)
            db.commit()
            self.assertIsNone(db.get(HostedSubdomainPortal, self.portal_id))
            self.assertEqual(db.query(HostedSubdomainEvent).count(), 0)
            self.assertIsNone(db.get(HostedSubdomainEntitlement, 1))
            self.assertIsNotNone(db.get(HostedSubdomainEntitlement, 2))
            self.assertIsNotNone(db.get(Organization, 3))
