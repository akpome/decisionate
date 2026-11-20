from datetime import UTC, datetime, timedelta
import base64
import hashlib
from io import BytesIO
import json
import os
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError

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
    Organization, OrganizationInvite, OrganizationMember, WorkspaceSubscription, WhiteLabelAvailability, OAuthConnectionState, utc_now)
from app.modules import applications, auth_context, workspace_lifecycle
from app.modules.identity import service as identity
from app.modules.organizations import invitations, router as organizations
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
            "CLERK_SECRET_KEY": "sk_test_shared",
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
        self.patched(patch("app.modules.identity.clerk.cached_verified_clerk_email", side_effect=AssertionError("Mock the Clerk profile lookup explicitly")))
        with self.Session() as db:
            for user in ("agency", "another", "client", "staff"):
                db.add(AppUser(id=user, email=user + "@example.test"))
                db.add(AuthIdentity(user_id=user, provider="clerk", subject=user))
            db.add_all([Organization(id=1, owner_user_id="agency", name="Original agency"),
                        Organization(id=2, owner_user_id="another", name="Other agency"),
                        Organization(id=3, owner_user_id="agency:client:1", name="Client", managing_agency_workspace_id="agency")])
            db.add_all([OrganizationMember(organization_id=3, clerk_user_id="client", role="owner"),
                        OrganizationMember(organization_id=1, clerk_user_id="staff", role="member")])
            for index, workspace in enumerate(("agency", "another"), start=1):
                db.add(WorkspaceSubscription(id=index, workspace_id=workspace, provider="stripe", status="active", plan="agency_subdomain",
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

    def headers(self, user="agency", workspace=None, origin="https://app.decisionate.ca", issuer="https://shared.clerk.test", include_email=True):
        claims = {"sub": user, "iss": issuer, "aud": "decisionate", "exp": datetime.now(UTC) + timedelta(minutes=10)}
        if include_email:
            claims.update(email=user + "@example.test", email_verified=True)
        token = jwt.encode(claims, self.key, algorithm="RS256")
        result = {"Authorization": "Bearer " + token, "Origin": origin, "X-User-Id": user}
        if workspace:
            result["X-Workspace-Id"] = workspace
        return result

    def save(self, slug="north-star", revision=0, **headers):
        return self.client.put(self.base, headers=self.headers(**headers), json={"slug": slug, "configuration": self.brand, "revision": revision})

    def test_missing_token_email_requires_a_verified_provider_profile(self):
        with patch("app.modules.identity.clerk.cached_verified_clerk_email", return_value="agency@example.test") as lookup:
            result = self.client.get("/identity", headers=self.headers(include_email=False))
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json()["user"], "agency")
        lookup.assert_called_once_with("agency")

    def test_missing_verified_email_cannot_bypass_identity_checks(self):
        with patch("app.modules.identity.clerk.cached_verified_clerk_email", return_value=None):
            result = self.client.get("/identity", headers=self.headers(include_email=False))
        self.assertEqual(result.status_code, 403, result.text)
        with self.Session() as db:
            self.assertEqual(db.query(AppUser).count(), 4)
            self.assertEqual(db.get(AppUser, "agency").email, "agency@example.test")

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

    def test_agency_profile_exposes_published_logo_without_replacing_standard_brand(self):
        with self.Session() as db:
            agency = db.get(Organization, 1)
            agency.logo_url = "https://agency.test/standard.png"
            db.commit()
        self.brand["logo_url"] = "https://agency.test/published.png"
        published = self.publish()
        response = self.client.get("/organizations/me", headers=self.headers())
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["hosted_portal_logo_url"], self.brand["logo_url"])
        self.assertEqual(response.json()["logo_url"], "https://agency.test/standard.png")
        self.assertEqual(response.json()["name"], "Original agency")
        self.brand["logo_url"] = "https://agency.test/draft.png"
        self.assertEqual(self.save(revision=published["revision"]).status_code, 200)
        profile = self.client.get("/organizations/me", headers=self.headers()).json()
        self.assertEqual(profile["hosted_portal_logo_url"], "https://agency.test/published.png")
        updated = self.client.patch("/organizations/me", headers=self.headers(),
            json={"name": "Agency renamed", "logo_url": "https://agency.test/changed-standard.png"})
        self.assertEqual(updated.status_code, 200, updated.text)
        self.assertEqual(updated.json()["hosted_portal_logo_url"], "https://agency.test/published.png")
        with self.Session() as db:
            self.assertEqual(db.get(Organization, 1).logo_url, "https://agency.test/changed-standard.png")

    def test_draft_and_other_workspaces_cannot_supply_the_agency_logo(self):
        self.brand["logo_url"] = "https://agency.test/draft.png"
        self.assertEqual(self.save().status_code, 200)
        response = self.client.get("/organizations/me", headers=self.headers())
        self.assertEqual(response.status_code, 200, response.text)
        self.assertNotIn("hosted_portal_logo_url", response.json())
        with patch.object(portals, "ensure_satellite", return_value="domain_north"):
            self.assertEqual(self.client.post(self.base + "/activate", headers=self.headers(),
                json={"revision": 1, "confirmation": "PUBLISH PORTAL"}).status_code, 200)
        for headers in (self.headers(user="another"), self.headers(user="client", workspace="agency:client:1")):
            response = self.client.get("/organizations/me", headers=headers)
            self.assertEqual(response.status_code, 200, response.text)
            self.assertNotIn("hosted_portal_logo_url", response.json())
        with patch.object(organizations, "get_application", return_value=SimpleNamespace(is_default=False)):
            response = self.client.get("/organizations/me", headers=self.headers())
            self.assertNotIn("hosted_portal_logo_url", response.json())

    def test_inactive_portals_do_not_supply_an_agency_logo(self):
        self.brand["logo_url"] = "https://agency.test/published.png"
        self.publish()
        for status in ("reserved", "suspended", "retired"):
            with self.subTest(status=status):
                with self.Session() as db:
                    db.query(HostedSubdomainPortal).one().status = status
                    db.commit()
                response = self.client.get("/organizations/me", headers=self.headers())
                self.assertEqual(response.status_code, 200, response.text)
                self.assertNotIn("hosted_portal_logo_url", response.json())
        with self.Session() as db:
            db.query(HostedSubdomainPortal).one().status = "active"
            db.query(WorkspaceSubscription).filter_by(workspace_id="agency").one().plan = "professional"
            db.commit()
        response = self.client.get("/organizations/me", headers=self.headers())
        self.assertEqual(response.status_code, 200, response.text)
        self.assertNotIn("hosted_portal_logo_url", response.json())

    def test_uploaded_and_removed_published_logos_are_reflected_in_agency_profile(self):
        self.brand["logo_url"] = "data:image/png;base64," + base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"0" * 16).decode()
        published = self.publish()
        response = self.client.get("/organizations/me", headers=self.headers())
        self.assertEqual(response.json()["hosted_portal_logo_url"],
            "https://api.decisionate.ca" + self.base + "/assets/north-star.decisionate.app/logo_url?v="
            + hashlib.sha256(self.brand["logo_url"].encode()).hexdigest()[:16])
        self.brand["logo_url"] = ""
        saved = self.save(revision=published["revision"])
        with patch.object(portals, "ensure_satellite", return_value="domain_north"):
            response = self.client.post(self.base + "/activate", headers=self.headers(),
                json={"revision": saved.json()["revision"], "confirmation": "PUBLISH PORTAL"})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.client.get("/organizations/me", headers=self.headers()).json()["hosted_portal_logo_url"], "")

    def test_address_checks_normalize_names_and_do_not_reserve_or_contact_providers(self):
        with patch.object(service, "clerk_request", side_effect=AssertionError("Availability is a local check")):
            for slug in ("north-star", " North-Star ", "NORTH-STAR"):
                response = self.client.get(self.base + "/availability", headers=self.headers(), params={"slug": slug})
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.headers["cache-control"], "no-store")
                self.assertEqual(response.json(), {"available": True, "status": "available",
                    "message": "This address is available. Save your draft to reserve it."})
        with self.Session() as db:
            self.assertEqual(db.query(HostedSubdomainPortal).count(), 0)
            self.assertEqual(db.query(HostedSubdomainEvent).count(), 0)

    def test_reserved_addresses_are_unique_across_agencies_case_and_portal_statuses(self):
        self.assertEqual(self.save(" North-Star ").status_code, 200)
        for status in ("reserved", "active", "suspended", "retired"):
            with self.Session() as db:
                db.query(HostedSubdomainPortal).one().status = status
                db.commit()
            for slug in ("north-star", "NORTH-STAR", " North-Star "):
                with self.subTest(status=status, slug=slug):
                    owner = self.client.get(self.base + "/availability", headers=self.headers(), params={"slug": slug})
                    self.assertEqual(owner.json()["status"], "reserved")
                    response = self.client.get(self.base + "/availability", headers=self.headers(user="another"), params={"slug": slug})
                    self.assertEqual(response.status_code, 200, response.text)
                    self.assertEqual(response.json(), {"available": False, "status": "taken",
                        "message": "This address is already taken. Choose another name."})
                    rejected = self.save(slug, user="another")
                    self.assertEqual(rejected.status_code, 409, rejected.text)
            self.assertEqual(self.client.get(self.base + "/availability", headers=self.headers(user="another"),
                params={"slug": "different-agency"}).json()["available"], True)
            with self.Session() as db:
                self.assertEqual(db.query(HostedSubdomainPortal).count(), 1)
                self.assertEqual(db.query(HostedSubdomainPortal).one().organization_id, 1)

    def test_database_rejects_a_duplicate_even_when_the_availability_result_is_stale(self):
        available = self.client.get(self.base + "/availability", headers=self.headers(user="another"), params={"slug": "north-star"})
        self.assertTrue(available.json()["available"])
        self.assertEqual(self.save().status_code, 200)
        with patch.object(portals, "reserved_address", return_value=None):
            rejected = self.save("NORTH-STAR", user="another")
        self.assertEqual(rejected.status_code, 409, rejected.text)
        with self.Session() as db:
            self.assertEqual(db.query(HostedSubdomainPortal).count(), 1)
            self.assertEqual(db.query(HostedSubdomainPortal).one().organization_id, 1)
            self.assertEqual(db.query(HostedSubdomainEvent).count(), 1)
        self.assertEqual(self.save("another-agency", user="another").status_code, 200)

    def test_address_checks_reject_invalid_and_platform_reserved_names(self):
        for slug in ("App", "billing", "www", "a", "ab--cd", "-hello", "hello-", "a.b", "a" * 41, "north_st\u00e4r"):
            with self.subTest(slug=slug):
                response = self.client.get(self.base + "/availability", headers=self.headers(), params={"slug": slug})
                self.assertEqual(response.status_code, 200, response.text)
                self.assertFalse(response.json()["available"])
                self.assertEqual(response.json()["status"], "invalid")
                self.assertEqual(self.save(slug).status_code, 422)

    def test_address_checks_require_an_authorized_white_label_agency(self):
        self.assertEqual(self.client.get(self.base + "/availability", params={"slug": "north-star"}).status_code, 401)
        for user, workspace in (("client", "agency:client:1"), ("staff", "agency")):
            response = self.client.get(self.base + "/availability", headers=self.headers(user=user, workspace=workspace), params={"slug": "north-star"})
            self.assertEqual(response.status_code, 403, response.text)
        with self.Session() as db:
            db.get(WorkspaceSubscription, 1).plan = "agency"
            db.commit()
        self.assertEqual(self.client.get(self.base + "/availability", headers=self.headers(), params={"slug": "north-star"}).status_code, 200)

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

    def test_hosted_client_creation_includes_the_owner_invitation_and_automatic_email(self):
        self.publish()
        origin = "https://north-star.decisionate.app"

        def sent(recipient, subject, body, **kwargs):
            with self.Session() as db:
                invite = db.query(OrganizationInvite).filter_by(email=recipient).one()
                workspace = db.get(Organization, invite.organization_id)
                self.assertEqual(workspace.managing_agency_workspace_id, "agency")
                self.assertEqual(invite.role, "client_owner")
                self.assertEqual(invite.status, "pending")
                self.assertEqual(invite.email_status, "sending")
            self.assertIn(origin + "/sign-in?", body)

        with patch.object(invitations, "send_platform_system_email", side_effect=sent) as send:
            response = self.client.post("/organizations/client-workspaces", headers=self.headers(origin=origin),
                json={"name": "New client", "client_email": " NEW@EXAMPLE.TEST "})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["invitation_email_status"], "sent")
        send.assert_called_once()
        self.assertEqual(send.call_args.args[0], "new@example.test")
        with self.Session() as db:
            invite = db.query(OrganizationInvite).filter_by(organization_id=response.json()["id"]).one()
            self.assertEqual(invite.email_status, "sent")
            self.assertEqual(db.query(OrganizationMember).filter_by(organization_id=response.json()["id"]).count(), 0)

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

    def test_agency_owner_can_read_edit_and_publish_from_its_own_hosted_portal(self):
        row = self.publish()
        origin = "https://north-star.decisionate.app"
        headers = self.headers(origin=origin)
        setup = self.client.get(self.base, headers=headers)
        self.assertEqual(setup.status_code, 200, setup.text)
        self.assertEqual(setup.json()["portal"]["id"], row["id"])
        changed = {**self.brand, "name": "Updated agency"}
        saved = self.client.put(self.base, headers=headers, json={
            "slug": "north-star", "configuration": changed, "revision": row["revision"],
        })
        self.assertEqual(saved.status_code, 200, saved.text)
        self.assertEqual(saved.json()["id"], row["id"])
        self.assertEqual(self.client.get(self.base + "/resolve?hostname=north-star.decisionate.app").json()["branding"]["name"], self.brand["name"])
        rename = self.client.put(self.base, headers=headers, json={
            "slug": "different-agency", "configuration": changed, "revision": saved.json()["revision"],
        })
        self.assertEqual(rename.status_code, 409, rename.text)
        with patch.object(portals, "ensure_satellite", return_value="domain_north") as satellite:
            published = self.client.post(self.base + "/activate", headers=headers, json={
                "revision": saved.json()["revision"], "confirmation": "PUBLISH PORTAL",
            })
        self.assertEqual(published.status_code, 200, published.text)
        satellite.assert_called_once_with("north-star.decisionate.app")
        self.assertEqual(self.client.get(self.base + "/resolve?hostname=north-star.decisionate.app").json()["branding"]["name"], "Updated agency")
        with self.Session() as db:
            self.assertEqual(db.query(HostedSubdomainPortal).count(), 1)
            self.assertEqual(db.get(Organization, 1).name, "Original agency")
            self.assertEqual(db.get(WorkspaceSubscription, 1).provider_subscription_id, "sub_agency")

    def test_hosted_portal_management_rejects_clients_staff_and_other_agencies(self):
        row = self.publish()
        origin = "https://north-star.decisionate.app"
        for user, workspace in (("client", "agency:client:1"), ("client", "agency"),
                                ("staff", "agency"), ("another", "another"), ("another", "agency")):
            with self.subTest(user=user, workspace=workspace):
                headers = self.headers(user=user, workspace=workspace, origin=origin)
                self.assertEqual(self.client.get(self.base, headers=headers).status_code, 403)
                self.assertEqual(self.save(revision=row["revision"], user=user, workspace=workspace, origin=origin).status_code, 403)
                with patch.object(portals, "ensure_satellite") as satellite:
                    response = self.client.post(self.base + "/activate", headers=headers, json={
                        "revision": row["revision"], "confirmation": "PUBLISH PORTAL",
                    })
                self.assertEqual(response.status_code, 403, response.text)
                satellite.assert_not_called()
        self.assertEqual(self.client.get(self.base, headers={"Origin": origin}).status_code, 401)
        with self.Session() as db:
            self.assertEqual(db.query(HostedSubdomainPortal).one().revision, row["revision"])

    def test_white_label_base_plan_includes_portal_without_a_separate_purchase(self):
        with patch("app.modules.billing.service.stripe_request", side_effect=AssertionError("Portal setup must not charge Stripe")) as stripe:
            setup = self.client.get(self.base, headers=self.headers())
            self.assertTrue(setup.json()["entitled"])
            self.publish()
        stripe.assert_not_called()
        with self.Session() as db:
            self.assertEqual(db.query(HostedSubdomainEntitlement).count(), 0)
            subscription = db.get(WorkspaceSubscription, 1)
            self.assertEqual(subscription.plan, "agency_subdomain")
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
        for path in ("/marketing/consent?language=en", "/marketing/preferences"):
            self.assertEqual(self.client.get(path, headers=headers).status_code, 404)
        self.assertFalse(self.client.get("/api/v2/application", headers=headers).json()["features"]["marketing_preferences"])

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

    def test_clerk_domain_requests_identify_the_application_and_keep_authentication(self):
        for body in (None, {"name": "north-star.decisionate.app", "is_satellite": True,
                            "proxy_url": "https://north-star.decisionate.app/__clerk"}):
            with self.subTest(method="POST" if body else "GET"):
                with patch.object(service, "urlopen", return_value=BytesIO(b'{"data":[]}')) as provider:
                    self.assertEqual(service.clerk_request("/domains", body=body), {"data": []})
                request = provider.call_args.args[0]
                self.assertEqual(request.full_url, "https://api.clerk.com/v1/domains")
                self.assertEqual(request.get_header("User-agent"), "Decisionate/1.0")
                self.assertEqual(request.get_header("Authorization"), "Bearer sk_test_shared")
                self.assertEqual(request.get_header("Accept"), "application/json")
                self.assertEqual(request.get_method(), "POST" if body else "GET")
                self.assertEqual(json.loads(request.data) if request.data else None, body)
                self.assertEqual(provider.call_args.kwargs["timeout"], 15)

    def test_clerk_http_failures_explain_the_blocker_and_log_only_safe_diagnostics(self):
        from fastapi import HTTPException
        for status, code, expected in (
            (422, "invalid_proxy_configuration", "HTTPS hosting and sign-in proxy"),
            (400, "domain_update_forbidden", "production Clerk instance"),
            (401, "invalid_clerk_secret_key", "sign-in credentials"),
            (403, "feature_not_enabled", "instance's enabled features"),
            (403, "authorization_missing_scopes", "domain lookup and creation permissions"),
            (403, "domain_managed_by_integration", "integration's settings"),
            (403, "feature_requires_custom_domain", "requires a verified custom domain"),
            (403, "provider_domain_operation_not_allowed", "existing production instance's domain setup"),
            (403, "operation_not_allowed_on_primary_domain", "without changing the existing primary domain"),
            (429, "too_many_requests", "Wait a moment"),
            (500, "internal_server_error", "Retry without changing your address"),
        ):
            with self.subTest(status=status):
                error = HTTPError("https://api.clerk.com/v1/domains", status, "Provider rejected secret sk_test_private",
                    {"x-request-id": "req_portal_test"}, BytesIO(json.dumps({"errors": [{"code": code,
                        "message": "Secret sk_test_private and account details must never be logged"}]}).encode()))
                with patch.object(service, "urlopen", side_effect=error), self.assertLogs(service.logger, level="WARNING") as logs:
                    with self.assertRaises(HTTPException) as caught:
                        service.clerk_request("/domains", body={"name": "north-star.decisionate.app"})
                self.assertEqual(caught.exception.status_code, 503)
                self.assertIn(expected, caught.exception.detail)
                self.assertIn("Your draft is saved", caught.exception.detail)
                reference = code if status != 500 else "clerk_http_500"
                self.assertIn(f"Reference: {reference}/domain_create.", caught.exception.detail)
                output = " ".join(logs.output)
                self.assertIn(f"status={status} code={code}", output)
                self.assertIn("phase=domain_create", output)
                self.assertIn("request_id=req_portal_test", output)
                self.assertNotIn("sk_test", output + caught.exception.detail)
                self.assertNotIn("account details", output + caught.exception.detail)

    def test_clerk_network_and_invalid_response_failures_remain_bounded_and_secret_free(self):
        from fastapi import HTTPException
        for failure in (URLError("sk_test_private"), TimeoutError("sk_test_private"), ValueError("sk_test_private")):
            with self.subTest(error=type(failure).__name__), patch.object(service, "urlopen", side_effect=failure), self.assertLogs(service.logger, level="WARNING") as logs:
                with self.assertRaises(HTTPException) as caught:
                    service.clerk_request("/domains")
                self.assertEqual(caught.exception.status_code, 503)
                self.assertIn("phase=domain_lookup", " ".join(logs.output))
                self.assertNotIn("sk_test", " ".join(logs.output) + caught.exception.detail)
        for response in (b"[]", b"<html>Gateway error</html>", b"x" * 64_001):
            with self.subTest(response_size=len(response)), patch.object(service, "urlopen", return_value=BytesIO(response)), self.assertLogs(service.logger, level="WARNING"):
                with self.assertRaises(HTTPException) as caught:
                    service.clerk_request("/domains")
                self.assertEqual(caught.exception.status_code, 503)

    def test_clerk_error_payloads_and_headers_cannot_inject_logs(self):
        from fastapi import HTTPException
        for raw in (b"Not JSON", b"[]", b"x" * 64_001,
                    json.dumps({"errors": [{"code": "malicious\nlog-entry"}]}).encode()):
            error = HTTPError("https://api.clerk.com/v1/domains", 422, "failure", {"x-request-id": "unsafe\nheader"}, BytesIO(raw))
            with patch.object(service, "urlopen", side_effect=error), self.assertLogs(service.logger, level="WARNING") as logs:
                with self.assertRaises(HTTPException):
                    service.clerk_request("/domains")
            output = " ".join(logs.output)
            self.assertIn("code=unknown request_id=unknown", output)
            self.assertNotIn("malicious", output)
            self.assertNotIn("unsafe", output)

    def test_clerk_failure_during_activation_preserves_the_reserved_draft_and_its_reason(self):
        self.assertEqual(self.save().status_code, 200)
        error = HTTPError("https://api.clerk.com/v1/domains", 403, "Forbidden", {"x-request-id": "req_blocked"},
            BytesIO(b'{"errors":[{"code":"feature_not_enabled","message":"private account information"}]}'))
        with patch.object(service, "urlopen", side_effect=error), self.assertLogs(service.logger, level="WARNING"):
            result = self.client.post(self.base + "/activate", headers=self.headers(), json={"revision": 1, "confirmation": "PUBLISH PORTAL"})
        self.assertEqual(result.status_code, 503)
        self.assertIn("instance's enabled features", result.json()["detail"])
        self.assertIn("Reference: feature_not_enabled/domain_lookup.", result.json()["detail"])
        with self.Session() as db:
            row = db.query(HostedSubdomainPortal).one()
            self.assertEqual(row.status, "reserved")
            self.assertEqual(row.revision, 1)
            self.assertIsNone(row.published_configuration)
            self.assertIsNone(row.clerk_domain_id)
            self.assertEqual(row.last_error, result.json()["detail"])
        public = self.client.get(self.base + "/resolve?hostname=north-star.decisionate.app")
        self.assertFalse(public.json()["active"])
        self.assertIsNone(public.json()["branding"])

    def test_unrecognized_provider_codes_are_not_exposed_in_the_customer_reference(self):
        from fastapi import HTTPException
        for code in ("sk_live_private", "unknown_future_error", "malicious\ncontent"):
            error = HTTPError("https://api.clerk.com/v1/domains", 403, "Forbidden", {"x-request-id": "req_test"},
                BytesIO(json.dumps({"errors": [{"code": code, "message": "Private provider content"}]}).encode()))
            with patch.object(service, "urlopen", side_effect=error), self.assertLogs(service.logger, level="WARNING") as logs:
                with self.assertRaises(HTTPException) as caught:
                    service.clerk_request("/domains")
            self.assertIn("Reference: clerk_http_403/domain_lookup.", caught.exception.detail)
            self.assertNotIn(code, caught.exception.detail)
            self.assertNotIn("Private provider content", caught.exception.detail)
            if code.startswith("sk_"):
                self.assertNotIn(code, " ".join(logs.output))

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

    def test_readiness_only_requires_the_real_shared_clerk_credential(self):
        self.assertEqual(service.launch_blockers(), [])
        self.assertEqual(self.save().status_code, 200)
        for secret in ("", "   "):
            with patch.dict(os.environ, {"CLERK_SECRET_KEY": secret}), patch.object(portals, "ensure_satellite") as clerk:
                self.assertEqual(len(service.launch_blockers()), 1)
                result = self.client.post(self.base + "/activate", headers=self.headers(), json={"revision": 1, "confirmation": "PUBLISH PORTAL"})
                self.assertEqual(result.status_code, 503, result.text)
                self.assertEqual(result.json()["detail"], "Shared sign-in setup is not configured.")
                clerk.assert_not_called()

    def test_real_clerk_registration_failure_cannot_publish_the_portal(self):
        from fastapi import HTTPException

        self.assertEqual(self.save().status_code, 200)
        with patch.object(portals, "ensure_satellite", side_effect=HTTPException(503, "Shared sign-in setup could not be confirmed.")) as clerk:
            result = self.client.post(self.base + "/activate", headers=self.headers(), json={"revision": 1, "confirmation": "PUBLISH PORTAL"})
        self.assertEqual(result.status_code, 503, result.text)
        clerk.assert_called_once_with("north-star.decisionate.app")
        with self.Session() as db:
            row = db.query(HostedSubdomainPortal).one()
            self.assertEqual(row.status, "reserved")
            self.assertIsNone(row.published_configuration)
            self.assertIsNone(row.clerk_domain_id)
            self.assertEqual(row.last_error, "Shared sign-in setup could not be confirmed.")
        self.assertFalse(self.client.get(self.base + "/resolve?hostname=north-star.decisionate.app").json()["active"])

    def test_removed_purchase_and_cancellation_routes_cannot_modify_billing(self):
        self.publish()
        with patch("app.modules.billing.service.stripe_request") as stripe:
            for method, path in [("GET", "/subscription-offer"), ("POST", "/subscription"), ("DELETE", "/subscription")]:
                result = self.client.request(method, self.base + path, headers=self.headers(), json={"confirmation": "old-client"})
                self.assertEqual(result.status_code, 404, result.text)
            stripe.assert_not_called()
        with self.Session() as db:
            self.assertEqual(db.get(WorkspaceSubscription, 1).plan, "agency_subdomain")
            self.assertEqual(db.get(WorkspaceSubscription, 1).status, "active")
            self.assertEqual(db.get(HostedSubdomainPortal, self.portal_id).status, "active")
        self.assertTrue(self.client.get(self.base + "/resolve?hostname=north-star.decisionate.app").json()["active"])

    def test_known_black_backed_logo_is_restored_on_new_uploads_without_touching_other_images(self):
        jpeg = (Path(__file__).parent / "fixtures" / "legacy-decisionate-logo.jpg").read_bytes()
        value = "data:image/jpeg;base64," + base64.b64encode(jpeg).decode()
        for field in ("logo_url", "favicon_url"):
            brand = service.Branding.model_validate({**self.brand, field: value})
            self.assertEqual(brand.logo_url, service.TRANSPARENT_DECISIONATE_LOGO)
            self.assertEqual(brand.favicon_url, "")
        self.brand["logo_url"] = value
        saved = self.save()
        self.assertEqual(saved.status_code, 200, saved.text)
        self.assertEqual(saved.json()["configuration"]["logo_url"], service.TRANSPARENT_DECISIONATE_LOGO)
        with self.Session() as db:
            self.assertEqual(json.loads(db.query(HostedSubdomainPortal).one().configuration)["logo_url"], service.TRANSPARENT_DECISIONATE_LOGO)
        for other in ("", service.TRANSPARENT_DECISIONATE_LOGO, "https://cdn.agency.test/black-logo.jpg",
                      "data:image/jpeg;base64," + base64.b64encode(jpeg + b"another agency image").decode(),
                      "data:image/png;base64," + base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"\x00" * 16).decode()):
            self.assertEqual(service.restore_legacy_logo(other), other)
        malformed = "data:image/jpeg;base64,not-a-valid-image!"
        self.assertEqual(service.restore_legacy_logo(malformed), malformed)

    def test_saved_black_backed_logos_are_restored_for_preview_publication_and_old_asset_links(self):
        self.publish()
        jpeg = (Path(__file__).parent / "fixtures" / "legacy-decisionate-logo.jpg").read_bytes()
        value = "data:image/jpeg;base64," + base64.b64encode(jpeg).decode()
        for field in ("logo_url", "favicon_url"):
            with self.subTest(field=field):
                original = json.dumps({**self.brand, "logo_url": "", "favicon_url": "", field: value})
                with self.Session() as db:
                    row = db.get(HostedSubdomainPortal, self.portal_id)
                    row.configuration = row.published_configuration = original
                    db.commit()
                preview = self.client.get(self.base, headers=self.headers())
                self.assertEqual(preview.status_code, 200, preview.text)
                self.assertEqual(preview.json()["portal"]["configuration"]["logo_url"], service.TRANSPARENT_DECISIONATE_LOGO)
                public = self.client.get(self.base + "/resolve?hostname=north-star.decisionate.app")
                self.assertEqual(public.json()["branding"]["logo_url"], service.TRANSPARENT_DECISIONATE_LOGO)
                self.assertEqual(public.json()["branding"]["favicon_url"], service.TRANSPARENT_DECISIONATE_LOGO)
                for asset in ("logo_url", "favicon_url"):
                    response = self.client.get(self.base + "/assets/north-star.decisionate.app/" + asset, follow_redirects=False)
                    self.assertEqual(response.status_code, 307, response.text)
                    self.assertEqual(response.headers["location"], service.TRANSPARENT_DECISIONATE_LOGO)
                    self.assertEqual(response.headers["cache-control"], "no-store")
                with self.Session() as db:
                    row = db.get(HostedSubdomainPortal, self.portal_id)
                    self.assertEqual(row.configuration, original)
                    self.assertEqual(row.published_configuration, original)
        with self.Session() as db:
            db.get(HostedSubdomainPortal, self.portal_id).status = "suspended"
            db.commit()
        self.assertIsNone(self.client.get(self.base + "/resolve?hostname=north-star.decisionate.app").json()["branding"])
        for asset in ("logo_url", "favicon_url"):
            response = self.client.get(self.base + "/assets/north-star.decisionate.app/" + asset, follow_redirects=False)
            self.assertEqual(response.status_code, 404)
            self.assertNotIn("location", response.headers)

    def test_uploaded_images_are_published_as_bounded_raster_assets_and_hidden_when_suspended(self):
        png = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6jXAAAAAASUVORK5CYII=")
        self.brand["logo_url"] = "data:image/png;base64," + base64.b64encode(png).decode()
        self.publish()
        config = self.client.get(self.base + "/resolve?hostname=north-star.decisionate.app").json()
        self.assertEqual(config["branding"]["logo_url"], "https://api.decisionate.ca" + self.base + "/assets/north-star.decisionate.app/logo_url?v="
            + hashlib.sha256(self.brand["logo_url"].encode()).hexdigest()[:16])
        result = self.client.get(self.base + "/assets/north-star.decisionate.app/logo_url")
        self.assertEqual(result.content, png)
        self.assertEqual(result.headers["content-type"], "image/png")
        self.assertEqual(result.headers["x-content-type-options"], "nosniff")
        with self.Session() as db:
            db.get(HostedSubdomainPortal, self.portal_id).status = "suspended"
            db.commit()
        self.assertEqual(self.client.get(self.base + "/assets/north-star.decisionate.app/logo_url").status_code, 404)

    def test_uploaded_logo_version_changes_only_when_a_different_image_is_published(self):
        original = b"\x89PNG\r\n\x1a\n" + b"0" * 16
        replacement = b"\x89PNG\r\n\x1a\n" + b"1" * 16
        self.brand["logo_url"] = "data:image/png;base64," + base64.b64encode(original).decode()
        published = self.publish()
        logo = self.client.get("/organizations/me", headers=self.headers()).json()["hosted_portal_logo_url"]
        self.brand["logo_url"] = "data:image/png;base64," + base64.b64encode(replacement).decode()
        saved = self.save(revision=published["revision"])
        self.assertEqual(self.client.get("/organizations/me", headers=self.headers()).json()["hosted_portal_logo_url"], logo)
        self.assertEqual(self.client.get(logo).content, original)
        with patch.object(portals, "ensure_satellite", return_value="domain_north"):
            response = self.client.post(self.base + "/activate", headers=self.headers(),
                json={"revision": saved.json()["revision"], "confirmation": "PUBLISH PORTAL"})
        self.assertEqual(response.status_code, 200, response.text)
        updated = self.client.get("/organizations/me", headers=self.headers()).json()["hosted_portal_logo_url"]
        self.assertNotEqual(updated, logo)
        self.assertEqual(self.client.get(updated).content, replacement)
        self.assertEqual(self.client.get(self.base + "/resolve?hostname=north-star.decisionate.app").json()["branding"]["logo_url"], updated)

    def test_inline_images_reject_html_svg_invalid_base64_and_excessive_sizes(self):
        for value in ["data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=", "data:image/png;base64,PHNjcmlwdD4=",
                      "data:image/png;base64,!!!!", "data:image/png;base64," + base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"0" * (1024 * 1024)).decode()]:
            with self.assertRaises(ValueError):
                service.Branding(**{**self.brand, "logo_url": value})

    def test_logo_accepts_one_mb_and_other_images_keep_their_128_kb_limits(self):
        for field, limit in (("logo_url", 1024 * 1024), ("favicon_url", 128 * 1024), ("background_url", 128 * 1024)):
            for media, signature in (("png", b"\x89PNG\r\n\x1a\n"), ("jpeg", b"\xff\xd8\xff"), ("webp", b"RIFF\x00\x00\x00\x00WEBP")):
                with self.subTest(field=field, media=media):
                    image = signature + b"0" * (limit - len(signature))
                    value = f"data:image/{media};base64," + base64.b64encode(image).decode()
                    result = service.Branding(**{**self.brand, field: value})
                    self.assertEqual(getattr(result, "logo_url" if field == "favicon_url" else field), value)
                    self.assertEqual(result.favicon_url, "")
                    too_large = f"data:image/{media};base64," + base64.b64encode(image + b"0").decode()
                    with self.assertRaises(ValueError):
                        service.Branding(**{**self.brand, field: too_large})

    def test_one_mb_logo_can_be_saved_published_and_fetched_through_request_limits(self):
        from app.security.request_limits import RequestBodyLimitMiddleware
        png = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6jXAAAAAASUVORK5CYII=")
        image = png + b"\x00" * (1024 * 1024 - len(png))
        self.brand["logo_url"] = "data:image/png;base64," + base64.b64encode(image).decode()
        self.client = TestClient(RequestBodyLimitMiddleware(self.client.app))
        self.addCleanup(self.client.close)
        self.publish()
        config = self.client.get(self.base + "/resolve?hostname=north-star.decisionate.app").json()
        self.assertNotIn("data:image", config["branding"]["logo_url"])
        result = self.client.get(self.base + "/assets/north-star.decisionate.app/logo_url")
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.content, image)
        self.assertEqual(result.headers["content-type"], "image/png")

    def test_external_https_logo_url_is_supported_without_server_fetches(self):
        self.brand["logo_url"] = "https://cdn.agency.test/brand/logo?version=2"
        with patch.object(service, "urlopen", side_effect=AssertionError("Logo URLs must not be fetched by the server")):
            self.publish()
            response = self.client.get(self.base + "/resolve?hostname=north-star.decisionate.app")
            self.assertEqual(response.json()["branding"]["logo_url"], self.brand["logo_url"])
            self.assertEqual(response.json()["branding"]["favicon_url"], self.brand["logo_url"])
            self.assertEqual(self.client.get(self.base + "/assets/north-star.decisionate.app/logo_url").status_code, 404)
        for url in ("http://agency.test/logo.png", "https://user:secret@agency.test/logo.png", "https://agency.test:444/logo.png",
                    "https://agency.test/a b.png", "https://agency.test/\\bad.png", "https://agency.test/" + "a" * 2048):
            with self.subTest(url=url), self.assertRaises(ValueError):
                service.Branding(**{**self.brand, "logo_url": url})

    def test_icon_only_saved_portal_is_restored_as_the_logo_in_preview_and_public_assets(self):
        self.publish()
        image = b"\x89PNG\r\n\x1a\n" + b"0" * 16
        legacy = {**self.brand, "logo_url": "", "favicon_url": "data:image/png;base64," + base64.b64encode(image).decode()}
        with self.Session() as db:
            row = db.get(HostedSubdomainPortal, self.portal_id)
            row.configuration = row.published_configuration = json.dumps(legacy)
            db.commit()
        draft = self.client.get(self.base, headers=self.headers()).json()["portal"]["configuration"]
        self.assertEqual(draft["logo_url"], legacy["favicon_url"])
        self.assertEqual(draft["favicon_url"], "")
        published = self.client.get(self.base + "/resolve?hostname=north-star.decisionate.app").json()["branding"]
        self.assertEqual(published["logo_url"], published["favicon_url"])
        self.assertIn("/logo_url?v=", published["logo_url"])
        for field in ("logo_url", "favicon_url"):
            result = self.client.get(self.base + "/assets/north-star.decisionate.app/" + field)
            self.assertEqual(result.status_code, 200)
            self.assertEqual(result.content, image)
        self.brand = {**draft, "logo_url": "", "favicon_url": ""}
        self.assertEqual(self.save(revision=2).status_code, 200)
        with patch.object(portals, "ensure_satellite", return_value="domain_north"):
            result = self.client.post(self.base + "/activate", headers=self.headers(), json={"revision": 3, "confirmation": "PUBLISH PORTAL"})
        self.assertEqual(result.status_code, 200, result.text)
        cleared = self.client.get(self.base + "/resolve?hostname=north-star.decisionate.app").json()["branding"]
        self.assertEqual((cleared["logo_url"], cleared["favicon_url"]), ("", ""))
        self.assertEqual(self.client.get(self.base + "/assets/north-star.decisionate.app/favicon_url").status_code, 404)

    def test_explicit_logo_takes_precedence_over_a_different_legacy_icon(self):
        logo = "https://cdn.agency.test/logo.png"
        icon = "https://app.decisionate.ca/old-icon.png"
        result = service.Branding(**{**self.brand, "logo_url": logo, "favicon_url": icon})
        self.assertEqual((result.logo_url, result.favicon_url), (logo, ""))
        self.assertEqual(service.canonical_branding({"logo_url": logo, "favicon_url": icon})["logo_url"], logo)

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
