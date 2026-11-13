import asyncio
from datetime import UTC, datetime, timedelta
import hashlib
import hmac
import json
import os
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.testclient import TestClient
import jwt
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from starlette.middleware.cors import CORSMiddleware

from app.application_context import (
    DEFAULT_APPLICATION_ID, application_scope, applications, get_application, validate_applications,
)
from app.configuration import get_runtime_configuration, get_provider_setting
from app.db.database import Base
from app.db.models import (
    AppUser, AuthIdentity, BillingWebhookEvent, Organization, OrganizationInvite, OrganizationMember,
    PlatformBillingSettings, PlatformEmailSettings, WorkspaceApplication, WorkspaceSubscription,
    OAuthConnectionState, DataIngestionJob, AgencyClientInvitation, Dataset,
)
from app.modules import applications as app_services, auth_context, workspace_lifecycle
from app.modules.alerts import email_delivery
from app.modules.billing import router as billing, service as payments
from app.modules.identity import service as identity
from app.modules.organizations import router as organizations, agency_accounts
from app.modules.organizations.invitations import build_invitation_sign_in_url
from app.modules.oauth import router as oauth


REGISTRATION = {
    "id": "decisionate-ai", "name": "Decisionate International",
    "web_url": "https://decisionate.ai", "allowed_origins": ["https://www.decisionate.ai"],
    "environment_prefix": "DECISIONATE_AI_",
}


class ApplicationIsolationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.keys = {name: rsa.generate_private_key(public_exponent=65537, key_size=2048)
                    for name in (DEFAULT_APPLICATION_ID, "decisionate-ai")}

    def setUp(self):
        settings = {
            "APP_ENV": "test", "OBJECT_STORAGE_PROVIDER": "local",
            "DECISIONATE_WEB_APP_URL": "https://www.decisionate.ca",
            "DECISIONATE_API_URL": "https://api.decisionate.ca",
            "DECISIONATE_APPLICATIONS": json.dumps([REGISTRATION]),
            "AUTH_JWKS_URL": "https://ca.identity.test/jwks", "AUTH_JWT_ISSUER": "https://ca.identity.test",
            "AUTH_JWT_AUDIENCE": "ca-api", "BILLING_PROVIDER": "stripe",
            "STRIPE_SECRET_KEY": "ca-test-key", "STRIPE_WEBHOOK_SECRET": "ca-webhook",
            "STRIPE_PROFESSIONAL_PRICE_ID": "price_ca", "STRIPE_API_URL": "https://api.stripe.com/v1",
            "EMAIL_PROVIDER": "resend", "RESEND_API_KEY": "ca-mail-key", "RESEND_FROM_EMAIL": "no-reply@decisionate.ca",
            "DECISIONATE_AI_AUTH_JWKS_URL": "https://ai.identity.test/jwks",
            "DECISIONATE_AI_AUTH_JWT_ISSUER": "https://ai.identity.test",
            "DECISIONATE_AI_AUTH_JWT_AUDIENCE": "ai-api",
            "DECISIONATE_AI_BILLING_PROVIDER": "stripe", "DECISIONATE_AI_STRIPE_SECRET_KEY": "ai-test-key",
            "DECISIONATE_AI_STRIPE_WEBHOOK_SECRET": "ai-webhook",
            "DECISIONATE_AI_STRIPE_PROFESSIONAL_PRICE_ID": "price_ai",
            "DECISIONATE_AI_BILLING_CURRENCY": "USD",
            "DECISIONATE_AI_BILLING_PROFESSIONAL_MONTHLY_PRICE_CENTS": "4900",
            "DECISIONATE_AI_EMAIL_PROVIDER": "resend", "DECISIONATE_AI_RESEND_API_KEY": "ai-mail-key",
            "DECISIONATE_AI_RESEND_FROM_EMAIL": "no-reply@decisionate.ai",
        }
        self.env = patch.dict(os.environ, settings, clear=True)
        self.env.start()
        self.addCleanup(self.env.stop)
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.addCleanup(self.engine.dispose)
        self.Session = sessionmaker(bind=self.engine, expire_on_commit=False)
        for module in (app_services, auth_context, workspace_lifecycle, identity, organizations,
                       agency_accounts, billing, payments, email_delivery, oauth):
            item = patch.object(module, "SessionLocal", self.Session)
            item.start()
            self.addCleanup(item.stop)
        item = patch.object(auth_context, "get_jwks_client", side_effect=lambda: SimpleNamespace(
            get_signing_key_from_jwt=lambda token: SimpleNamespace(key=self.keys[get_application().id].public_key()),
        ))
        item.start()
        self.addCleanup(item.stop)
        application = FastAPI()
        application.include_router(app_services.router)
        application.include_router(organizations.router, prefix="/organizations")
        application.include_router(billing.router, prefix="/billing")
        application.include_router(oauth.router, prefix="/oauth")

        @application.get("/identity")
        def whoami(request: Request):
            auth = auth_context.get_auth_context(request)
            return {"user": auth.user_id, "workspace": auth.workspace_id, "application": auth.application_id}

        app_services.install_api_contract(application)
        self.client = TestClient(CORSMiddleware(
            app_services.ApplicationContextMiddleware(application),
            allow_origins=[origin for item in applications().values() for origin in item.allowed_origins],
            allow_methods=["*"], allow_headers=["*"],
        ))
        self.addCleanup(self.client.close)

    def headers(self, application=DEFAULT_APPLICATION_ID, subject="same-subject", workspace=None, email="same@example.test"):
        secondary = application != DEFAULT_APPLICATION_ID
        issuer = "ai" if secondary else "ca"
        token = jwt.encode({"sub": subject, "iss": f"https://{issuer}.identity.test", "aud": f"{issuer}-api",
                            "exp": datetime.now(UTC) + timedelta(minutes=10),
                            "email": email, "email_verified": True}, self.keys[application], algorithm="RS256")
        headers = {"Authorization": "Bearer " + token, "Origin": f"https://www.decisionate.{issuer}",
                   "X-User-Id": subject}
        if workspace:
            headers["X-Workspace-Id"] = workspace
        return headers

    def identities(self):
        ca = self.client.get("/identity", headers=self.headers())
        ai = self.client.get("/identity", headers=self.headers("decisionate-ai"))
        self.assertEqual(ca.status_code, 200, ca.text)
        self.assertEqual(ai.status_code, 200, ai.text)
        return ca.json()["user"], ai.json()["user"]

    def test_same_subject_and_verified_email_are_separate_accounts(self):
        ca, ai = self.identities()
        self.assertNotEqual(ca, ai)
        self.assertEqual(self.identities(), (ca, ai))
        with self.Session() as db:
            self.assertEqual(db.query(AppUser).count(), 2)
            self.assertEqual(db.get(WorkspaceApplication, ai).application_id, "decisionate-ai")
            self.assertIsNone(db.get(WorkspaceApplication, ca))
            self.assertEqual({row.provider for row in db.query(AuthIdentity)}, {"clerk", "application:decisionate-ai:clerk"})

    def test_foreign_workspace_is_denied_even_with_membership(self):
        ca, ai = self.identities()
        with self.Session() as db:
            db.add(Organization(id=1, name="CA", owner_user_id=ca))
            db.add(OrganizationMember(organization_id=1, clerk_user_id=ai, role="owner"))
            db.commit()
        response = self.client.get("/identity", headers=self.headers("decisionate-ai", workspace=ca))
        self.assertEqual(response.status_code, 403, response.text)
        self.assertEqual(self.client.get("/identity", headers=self.headers(workspace=ai)).status_code, 403)

    def test_token_for_other_issuer_cannot_be_used_with_application_header_or_origin(self):
        headers = self.headers()
        headers["Origin"] = "https://decisionate.ai"
        self.assertEqual(self.client.get("/identity", headers=headers).status_code, 401)
        headers["Origin"] = "https://www.decisionate.ca"
        headers["X-Application-Id"] = "decisionate-ai"
        self.assertEqual(self.client.get("/identity", headers=headers).status_code, 400)

    def test_unknown_application_and_unregistered_origin_fail_closed(self):
        self.assertEqual(self.client.get("/api/v2/application", headers={"X-Application-Id": "unknown"}).status_code, 400)
        self.assertEqual(self.client.get("/api/v2/application", headers={"Origin": "https://evil.test"}).status_code, 403)

    def test_secondary_application_requires_a_token(self):
        self.assertEqual(self.client.get("/identity", headers={"Origin": "https://decisionate.ai", "X-User-Id": "fake"}).status_code, 401)

    def test_api_documentation_origin_can_use_an_explicit_application_and_verified_token(self):
        headers = self.headers("decisionate-ai")
        headers.update({"Origin": "https://api.decisionate.ca", "X-Application-Id": "decisionate-ai"})
        response = self.client.get("/identity", headers=headers)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["application"], "decisionate-ai")

    def test_public_contract_has_no_credentials_and_default_requires_no_new_header(self):
        ca = self.client.get("/api/v2/application").json()
        ai = self.client.get("/api/v2/application", headers={"Origin": "https://decisionate.ai"}).json()
        self.assertEqual(ca["id"], DEFAULT_APPLICATION_ID)
        self.assertEqual(ai["billing_currency"], "USD")
        self.assertNotIn("key", json.dumps(ai).lower())
        self.assertFalse(ai["features"]["marketing_preferences"])

    def test_api_clients_can_select_application_without_browser_origin(self):
        headers = self.headers("decisionate-ai")
        headers.pop("Origin")
        headers["X-Application-Id"] = "decisionate-ai"
        self.assertEqual(self.client.get("/identity", headers=headers).json()["application"], "decisionate-ai")

    def test_invites_and_workspace_discovery_are_application_scoped(self):
        ca, ai = self.identities()
        with self.Session() as db:
            db.add_all([Organization(id=1, name="CA", owner_user_id=ca), Organization(id=2, name="AI", owner_user_id=ai)])
            db.add_all([OrganizationInvite(organization_id=number, email="same@example.test", role="member", status="pending")
                        for number in (1, 2)])
            db.commit()
        response = self.client.get("/organizations/workspaces", headers=self.headers("decisionate-ai"))
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual([row["name"] for row in response.json()], ["AI"])
        with self.Session() as db:
            self.assertEqual(db.query(OrganizationInvite).filter_by(organization_id=1).one().status, "pending")
            self.assertEqual(db.query(OrganizationInvite).filter_by(organization_id=2).one().status, "accepted")

    def test_billing_and_email_do_not_use_default_admin_settings(self):
        with self.Session() as db:
            db.add(PlatformBillingSettings(id=1, professional_price_id="price_ca_admin", professional_monthly_price_cents=9999))
            db.add(PlatformEmailSettings(id=1, provider="resend", resend_from_email="admin@decisionate.ca"))
            db.commit()
        self.assertEqual(payments.get_billing_config()["professional_price_id"], "price_ca_admin")
        with application_scope("decisionate-ai"):
            config = payments.get_billing_config()
            self.assertEqual(config["secret_key"], "ai-test-key")
            self.assertEqual(config["professional_price_id"], "price_ai")
            self.assertEqual(config["web_app_url"], "https://decisionate.ai")
            self.assertEqual(payments.get_billing_pricing()["professional_monthly_price_cents"], 4900)
            self.assertEqual(email_delivery.get_platform_email_settings()["resend_from_email"], "no-reply@decisionate.ai")
            self.assertTrue(build_invitation_sign_in_url("workspace").startswith("https://decisionate.ai/sign-in?"))

    def test_secondary_agency_client_creation_and_invitation_claim_keep_application(self):
        from app.modules.organizations import invitations
        _, agency = self.identities()
        with self.Session() as db:
            db.add(Organization(name="AI Agency", owner_user_id=agency))
            db.add(WorkspaceSubscription(workspace_id=agency, plan="agency", status="active",
                                         current_period_end=datetime.now(UTC) + timedelta(days=30)))
            db.commit()

        def send(recipient, subject, body, **kwargs):
            self.assertEqual(get_application().id, "decisionate-ai")
            self.assertEqual(recipient, "client@example.test")
            self.assertIn("https://decisionate.ai/sign-in?", body)
            self.assertEqual(email_delivery.get_platform_email_settings()["resend_from_email"], "no-reply@decisionate.ai")

        with patch.object(invitations, "send_platform_system_email", side_effect=send) as mail:
            response = self.client.post("/organizations/client-workspaces", headers=self.headers("decisionate-ai"),
                                        json={"name": "AI Client", "client_email": "client@example.test"})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["invitation_email_status"], "sent")
        mail.assert_called_once()
        workspace = response.json()["owner_user_id"]
        with self.Session() as db:
            self.assertEqual(app_services.workspace_application_id(db, workspace), "decisionate-ai")

        ca_headers = self.headers(subject="client", email="client@example.test")
        listing = self.client.get("/organizations/workspaces", headers=ca_headers)
        self.assertEqual(listing.status_code, 200, listing.text)
        self.assertNotIn(workspace, [item["owner_user_id"] for item in listing.json()])
        with self.Session() as db:
            self.assertEqual(db.query(OrganizationInvite).filter_by(email="client@example.test").one().status, "pending")
        ai_headers = self.headers("decisionate-ai", subject="client", email="client@example.test")
        listing = self.client.get("/organizations/workspaces", headers=ai_headers)
        self.assertEqual(listing.status_code, 200, listing.text)
        client = next(item for item in listing.json() if item["owner_user_id"] == workspace)
        self.assertEqual(client["role"], "client_owner")
        ai_headers["X-Workspace-Id"] = workspace
        self.assertEqual(self.client.get("/identity", headers=ai_headers).json()["workspace"], workspace)

    def test_missing_secondary_billing_credentials_never_fall_back(self):
        with application_scope("decisionate-ai"), patch.dict(os.environ, {"DECISIONATE_AI_STRIPE_SECRET_KEY": ""}):
            self.assertEqual(payments.get_billing_config()["secret_key"], "")
            self.assertFalse(payments.is_billing_configured())

    def test_checkout_uses_own_prices_destination_and_application_metadata(self):
        with application_scope("decisionate-ai"), patch.object(payments, "stripe_request", return_value={"url": "https://checkout.test", "id": "cs_ai"}) as provider:
            payments.create_checkout_session(workspace_id="ai-workspace", owner_user_id="ai-user", plan="professional",
                                             owner_email="owner@example.test", organization_name="AI Workspace")
        params = provider.call_args.args[1]
        self.assertIn("decisionate.ai", str(params))
        self.assertIn("price_ai", str(params))
        self.assertIn("application_id", str(params))

    def test_billing_events_cannot_modify_the_other_app(self):
        ca, ai = self.identities()
        with self.Session() as db:
            db.add(WorkspaceSubscription(workspace_id=ca, provider_subscription_id="sub_ca", status="active"))
            db.commit()
            event = {"id": "sub_ca", "status": "canceled", "metadata": {"workspace_id": ca, "application_id": DEFAULT_APPLICATION_ID}}
            with application_scope("decisionate-ai"), self.assertRaises(payments.BillingProviderUnavailable):
                billing.apply_stripe_billing_event(db, "customer.subscription.deleted", event)
            self.assertEqual(db.query(WorkspaceSubscription).one().status, "active")
            with application_scope("decisionate-ai"), self.assertRaises(payments.BillingProviderUnavailable):
                payments.require_billing_application(db, ai, {"workspace_id": ai})

    def test_secondary_subscription_event_updates_only_its_own_workspace(self):
        ca, ai = self.identities()
        with self.Session() as db:
            db.add_all([WorkspaceSubscription(workspace_id=ca, status="active", provider_subscription_id="sub_ca"),
                        WorkspaceSubscription(workspace_id=ai, status="trialing", provider_subscription_id="sub_ai")])
            db.commit()
            event = {"id": "sub_ai", "customer": "cus_ai", "status": "active",
                     "metadata": {"workspace_id": ai, "application_id": "decisionate-ai", "plan": "professional"},
                     "items": {"data": [{"id": "si_ai", "price": {"id": "price_ai", "recurring": {"interval": "month"}}}]}}
            with application_scope("decisionate-ai"):
                billing.apply_stripe_billing_event(db, "customer.subscription.updated", event)
            self.assertEqual(db.query(WorkspaceSubscription).filter_by(workspace_id=ai).one().price_id, "price_ai")
            self.assertEqual(db.query(WorkspaceSubscription).filter_by(workspace_id=ca).one().provider_subscription_id, "sub_ca")

    def test_openapi_documents_auth_workspace_and_application_without_changing_routes(self):
        schema = self.client.get("/openapi.json").json()
        operation = schema["paths"]["/organizations/workspaces"]["get"]
        self.assertIn({"BearerAuth": []}, operation["security"])
        self.assertTrue({"X-Application-Id", "X-Workspace-Id"}.issubset({value["name"] for value in operation["parameters"]}))
        public = schema["paths"]["/api/v2/application"]["get"]
        self.assertNotIn("security", public)
        webhook = schema["paths"]["/billing/webhook/{application_id}"]["post"]
        self.assertTrue(any(value["name"] == "application_id" and value["in"] == "path" for value in webhook["parameters"]))

    def test_cors_preflight_allows_registered_frontends_and_denies_others(self):
        for origin in ("https://www.decisionate.ca", "https://decisionate.ai"):
            response = self.client.options("/organizations/workspaces", headers={
                "Origin": origin, "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "authorization,x-application-id,x-workspace-id",
            })
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.headers["access-control-allow-origin"], origin)
        response = self.client.options("/organizations/workspaces", headers={
            "Origin": "https://evil.test", "Access-Control-Request-Method": "GET",
        })
        self.assertEqual(response.status_code, 400)
        self.assertNotIn("access-control-allow-origin", response.headers)

    def test_oauth_callback_uses_saved_workspace_for_redirect_and_resets_context(self):
        _ca, ai = self.identities()
        with self.Session() as db:
            db.add(OAuthConnectionState(state_token="state-ai", connection_id=1, workspace_id=ai,
                                       user_id=ai, source_type="meta_ads", expires_at=datetime.now(UTC) + timedelta(minutes=5)))
            db.commit()
        request = Request({"type": "http", "method": "GET", "path": "/oauth/callback",
                           "headers": [], "query_string": b"state=state-ai&error=access_denied"})
        response = oauth.process_oauth_callback(request)
        self.assertTrue(response.headers["location"].startswith("https://decisionate.ai/dashboard/connections?"))
        response = self.client.get("/oauth/callback?state=state-ai&error=access_denied", headers={
            "Origin": "https://external-provider.test", "X-Application-Id": "untrusted",
        }, follow_redirects=False)
        self.assertEqual(response.status_code, 303, response.text)
        self.assertTrue(response.headers["location"].startswith("https://decisionate.ai/dashboard/connections?"))
        self.assertTrue(get_application().is_default)

    def test_ingestion_worker_restores_secondary_context_from_job(self):
        from app.infrastructure import ingestion_worker
        from app.modules.datasets import router as datasets
        _ca, ai = self.identities()
        with self.Session() as db:
            job = DataIngestionJob(user_id=ai, workspace_id=ai, job_type="file_upload", status="queued")
            db.add(job)
            db.commit()
            job_id = job.id
        observed = []
        with patch.object(ingestion_worker, "SessionLocal", self.Session), patch.object(
            datasets, "run_file_ingestion_job", side_effect=lambda identity: observed.append((identity, get_application().id)),
        ):
            ingestion_worker.execute_job(job_id)
        self.assertEqual(observed, [(job_id, "decisionate-ai")])
        self.assertTrue(get_application().is_default)

    def test_secondary_application_cannot_use_global_marketing_or_admin_settings(self):
        for path in ("/admin/email-settings", "/marketing/preferences"):
            response = self.client.get(path, headers=self.headers("decisionate-ai"))
            self.assertEqual(response.status_code, 404)

    def test_public_dashboard_share_cannot_cross_applications(self):
        from app.modules import public_dashboard
        _, ai = self.identities()
        with self.Session() as db:
            db.add(Dataset(id=1, file_name="private.csv", file_path="manual_upload", row_count=1,
                           column_count=1, user_id=ai, workspace_id=ai, share_token="share-token"))
            db.commit()
        with patch.object(public_dashboard, "SessionLocal", self.Session), patch.object(
            public_dashboard, "load_dataframe_from_dataset",
        ) as load_rows, self.assertRaises(HTTPException) as error:
            public_dashboard.get_public_shared_dashboard(1, Response(), "share-token")
        self.assertEqual(error.exception.status_code, 404)
        load_rows.assert_not_called()

    def test_connector_credentials_are_separate_but_public_endpoints_can_be_shared(self):
        from app.modules.datasets.services.google_analytics import get_google_analytics_service_account_json
        with patch.dict(os.environ, {
            "GOOGLE_ANALYTICS_SERVICE_ACCOUNT_JSON": "ca-service-account",
            "POSTGRESQL_SOURCE_URL": "ca-database-source",
            "GOOGLE_OAUTH_TOKEN_URL": "https://provider.test/token",
            "GOOGLE_ADS_DEVELOPER_TOKEN": "ca-developer-token",
        }), application_scope("decisionate-ai"):
            self.assertEqual(get_google_analytics_service_account_json(), "")
            self.assertEqual(get_provider_setting("POSTGRESQL_SOURCE_URL"), "")
            self.assertEqual(get_provider_setting("GOOGLE_ADS_DEVELOPER_TOKEN"), "")
            self.assertEqual(get_provider_setting("GOOGLE_OAUTH_TOKEN_URL"), "https://provider.test/token")

    def test_analysis_worker_uses_its_workspaces_email_and_billing_configuration(self):
        from app.infrastructure import analysis_worker
        from app.modules.reports.models import ReportAnalysisJob
        ca, ai = self.identities()
        with self.Session() as db:
            for workspace in (ca, ai):
                db.add(ReportAnalysisJob(id=workspace, workspace_id=workspace, user_id=workspace,
                                        kind="weekly_preview", request_key=workspace, definition="{}", sources="[]"))
            db.commit()
        observed = []

        def run_weekly(db, job, definition):
            observed.append((job.workspace_id, get_application().id, payments.get_billing_config()["secret_key"]))
            return {"name": "Weekly Report"}

        with patch.object(analysis_worker, "SessionLocal", self.Session), patch.object(
            analysis_worker, "check_inputs",
        ), patch.object(analysis_worker, "run_weekly", side_effect=run_weekly):
            analysis_worker.execute_job(ai)
            analysis_worker.execute_job(ca)
        self.assertEqual(observed, [(ai, "decisionate-ai", "ai-test-key"), (ca, DEFAULT_APPLICATION_ID, "ca-test-key")])
        self.assertTrue(get_application().is_default)
        with self.Session() as db:
            self.assertEqual({job.status for job in db.query(ReportAnalysisJob)}, {"succeeded"})

    def webhook(self, path, key, identity="evt_same"):
        body = json.dumps({"id": identity, "type": "test.unhandled", "data": {"object": {}}}).encode()
        stamp = str(int(time.time()))
        digest = hmac.new(key.encode(), stamp.encode() + b"." + body, hashlib.sha256).hexdigest()
        return self.client.post(path, content=body, headers={"Stripe-Signature": f"t={stamp},v1={digest}"})

    def test_separate_signed_webhooks_and_idempotency(self):
        self.assertEqual(self.webhook("/billing/webhook/decisionate-ai", "ca-webhook").status_code, 400)
        self.assertEqual(self.webhook("/billing/webhook", "ca-webhook").status_code, 200)
        response = self.webhook("/billing/webhook/decisionate-ai", "ai-webhook")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertFalse(response.json()["duplicate"])
        self.assertTrue(self.webhook("/billing/webhook/decisionate-ai", "ai-webhook").json()["duplicate"])
        with self.Session() as db:
            self.assertEqual(db.query(BillingWebhookEvent).count(), 2)

    def test_background_work_uses_persisted_application_and_restores_context(self):
        ca, ai = self.identities()

        @app_services.workspace_scoped()
        def work(workspace_id, db):
            return get_runtime_configuration().web_url, payments.get_billing_config()["secret_key"]

        with self.Session() as db:
            self.assertEqual(work(ai, db), ("https://decisionate.ai", "ai-test-key"))
            self.assertEqual(work(ca, db), ("https://www.decisionate.ca", "ca-test-key"))
            with self.assertRaisesRegex(RuntimeError, "stopped"):
                with app_services.workspace_application_scope(ai, db):
                    raise RuntimeError("stopped")
        self.assertTrue(get_application().is_default)

    def test_lifecycle_scheduler_sends_each_app_its_own_billing_link_and_sender(self):
        from app.modules.billing import notifications
        ca, ai = self.identities()
        now = datetime.now(UTC).replace(tzinfo=None)
        sent = []

        def send(recipient, subject, body):
            sent.append((get_application().id, body, email_delivery.get_platform_email_settings()["resend_from_email"]))

        with self.Session() as db:
            for workspace in (ca, ai):
                db.add(Organization(owner_user_id=workspace, name="Workspace"))
                db.add(WorkspaceSubscription(workspace_id=workspace, plan="professional", status="trialing",
                                             current_period_start=now - timedelta(days=27),
                                             current_period_end=now + timedelta(days=3)))
            db.commit()
            with patch.object(notifications, "send_platform_system_email", side_effect=send):
                result = notifications.send_due_billing_lifecycle_notifications(db, now)
                repeat = notifications.send_due_billing_lifecycle_notifications(db, now)
        self.assertEqual((result["notified"], repeat["notified"]), (2, 0))
        by_app = {identity: (body, sender) for identity, body, sender in sent}
        self.assertIn("https://decisionate.ai/dashboard/billing", by_app["decisionate-ai"][0])
        self.assertEqual(by_app["decisionate-ai"][1], "no-reply@decisionate.ai")
        self.assertIn("https://www.decisionate.ca/dashboard/billing", by_app[DEFAULT_APPLICATION_ID][0])
        self.assertEqual(by_app[DEFAULT_APPLICATION_ID][1], "no-reply@decisionate.ca")
        self.assertTrue(get_application().is_default)

    def test_concurrent_application_context_does_not_leak(self):
        async def run(identity):
            with application_scope(identity):
                await asyncio.sleep(0.001)
                return payments.get_billing_config()["secret_key"]

        async def run_all():
            return await asyncio.gather(run(DEFAULT_APPLICATION_ID), run("decisionate-ai"))

        self.assertEqual(asyncio.run(run_all()), ["ca-test-key", "ai-test-key"])

    def test_removed_registration_never_reassigns_existing_workspace(self):
        ca, ai = self.identities()
        with patch.dict(os.environ, {"DECISIONATE_APPLICATIONS": "[]"}), self.Session() as db:
            with self.assertRaises(ValueError):
                with app_services.workspace_application_scope(ai, db):
                    self.fail("Unregistered application must not run work")
            self.assertFalse(app_services.workspace_belongs_to_application(db, ai))

    def test_workspace_deletion_preserves_other_application_accounts_and_invitations(self):
        from app.modules.platform_admin import delete_workspace_records
        ca, ai = self.identities()
        with self.Session() as db:
            db.add(Organization(id=1, owner_user_id=ai, name="AI account"))
            db.add(WorkspaceApplication(workspace_id="ai-agency", application_id="decisionate-ai"))
            db.add_all([AgencyClientInvitation(id="ca-invite", agency_workspace_id=ca, email="same@example.test"),
                        AgencyClientInvitation(id="ai-invite", agency_workspace_id="ai-agency", email="same@example.test")])
            db.commit()
            delete_workspace_records(db, ai, 1)
            db.commit()
            db.expire_all()
            self.assertIsNone(db.get(AppUser, ai))
            self.assertIsNone(db.get(WorkspaceApplication, ai))
            self.assertIsNotNone(db.get(AppUser, ca))
            self.assertIsNotNone(db.get(AgencyClientInvitation, "ca-invite"))
            self.assertIsNone(db.get(AgencyClientInvitation, "ai-invite"))
        self.assertTrue(get_application().is_default)

    def test_surviving_member_keeps_their_home_application_binding(self):
        from app.modules.platform_admin import delete_workspace_records
        _ca, ai = self.identities()
        with self.Session() as db:
            db.add_all([Organization(id=1, owner_user_id=ai, name="Own workspace"),
                        Organization(id=2, owner_user_id="ai-team", name="Team workspace"),
                        OrganizationMember(organization_id=2, clerk_user_id=ai, role="member"),
                        WorkspaceApplication(workspace_id="ai-team", application_id="decisionate-ai")])
            db.commit()
            delete_workspace_records(db, ai, 1)
            db.commit()
            self.assertIsNotNone(db.get(AppUser, ai))
            self.assertEqual(db.get(WorkspaceApplication, ai).application_id, "decisionate-ai")

    def test_registration_rejects_duplicate_origins_prefixes_and_auth_issuers(self):
        validate_applications()
        duplicate = {**REGISTRATION, "id": "other", "environment_prefix": "OTHER_"}
        with patch.dict(os.environ, {"DECISIONATE_APPLICATIONS": json.dumps([REGISTRATION, duplicate])}), self.assertRaises(ValueError):
            applications()
        with patch.dict(os.environ, {"DECISIONATE_AI_AUTH_JWT_ISSUER": "https://ca.identity.test"}), self.assertRaises(ValueError):
            validate_applications()


if __name__ == "__main__":
    unittest.main()
