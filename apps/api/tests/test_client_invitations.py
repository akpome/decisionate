import json
import unittest
from datetime import timedelta
from email.message import EmailMessage
from types import SimpleNamespace
from unittest.mock import patch
from urllib.error import URLError
from urllib.parse import parse_qs, urlsplit

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import main
from app.db.database import Base
from app.db.models import AppUser, AuthIdentity, Organization, OrganizationInvite, OrganizationMember, WorkspaceSubscription, utc_now
from app.modules import auth_context, workspace_lifecycle
from app.modules.alerts import email_delivery
from app.modules.organizations import invitations, router


class ClientInvitationFlowTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine)
        self.actor = "agency"
        self.email = "agency@example.test"
        self.verified = True
        self.workspace = "agency:client:client-one"
        patches = [
            patch.object(router, "SessionLocal", self.Session),
            patch.object(auth_context, "SessionLocal", self.Session),
            patch.object(workspace_lifecycle, "SessionLocal", self.Session),
            patch.object(auth_context, "get_verified_user_identity", side_effect=lambda request: (self.actor + "-external", self.email, self.verified)),
            patch.object(auth_context, "resolve_external_identity", side_effect=lambda subject, **kwargs: subject.removesuffix("-external")),
            patch.object(auth_context, "resolve_workspace_reference", side_effect=lambda reference, user_id, **kwargs: reference or user_id),
            patch.object(main, "is_subscription_exempt_path", return_value=True),
            patch.object(invitations, "send_platform_system_email"),
            patch.object(invitations, "get_runtime_configuration", return_value=SimpleNamespace(web_url="https://app.example.test")),
        ]
        for item in patches:
            result = item.start()
            if item.attribute == "send_platform_system_email":
                self.send = result
            self.addCleanup(item.stop)
        self.addCleanup(self.engine.dispose)
        with self.Session() as db:
            db.add_all([
                AppUser(id="agency", email="agency@example.test"),
                AppUser(id="client"),
                AuthIdentity(user_id="client", provider="clerk", subject="client-external"),
                Organization(id=1, name="North Star Agency", owner_user_id="agency", logo_url="https://example.test/agency.png"),
                Organization(id=2, name="Client Shop", owner_user_id=self.workspace, agency_owner_access_enabled=False),
                Organization(id=3, name="Other Agency", owner_user_id="other"),
                Organization(id=4, name="Other Client", owner_user_id="other:client:one"),
                WorkspaceSubscription(workspace_id="agency", plan="agency", status="active", current_period_end=utc_now() + timedelta(days=30)),
                OrganizationInvite(id=7, organization_id=2, email="client@example.test", role="client_owner", status="pending"),
            ])
            db.commit()
        app = FastAPI()
        app.middleware("http")(main.enforce_product_route_auth)
        app.include_router(router.router, prefix="/organizations")
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def headers(self, workspace=None, hint=None):
        result = {"X-User-Id": self.actor + "-external", "X-Workspace-Id": workspace or self.actor}
        if hint:
            result["X-User-Email"] = hint
        return result

    def resend(self, identity=7, workspace=None):
        return self.client.post(f"/organizations/invites/{identity}/send", headers=self.headers(workspace or self.workspace))

    def create(self):
        return self.client.post("/organizations/client-workspaces", json={"name": "New Client", "client_email": "new@example.test"}, headers=self.headers())

    def test_creation_commits_the_invitation_then_sends_a_branded_workspace_specific_link(self):
        def committed(recipient, subject, body, **kwargs):
            with self.Session() as db:
                invite = db.query(OrganizationInvite).filter_by(email=recipient).one()
                self.assertIsNotNone(db.get(Organization, invite.organization_id))
                self.assertEqual(invite.email_status, "sending")
        self.send.side_effect = committed
        response = self.create()
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["invitation_email_status"], "sent")
        recipient, subject, body = self.send.call_args.args
        self.assertEqual(recipient, "new@example.test")
        self.assertIn("North Star Agency", subject)
        url = next(word for word in body.split() if word.startswith("https://"))
        self.assertEqual(urlsplit(url).path, "/sign-in")
        destination = parse_qs(urlsplit(url).query)["redirect_url"][0]
        self.assertEqual(parse_qs(urlsplit(destination).query)["workspace_id"], [response.json()["owner_user_id"]])
        self.assertEqual(self.send.call_args.kwargs["sender_name"], "North Star Agency via Decisionate")
        self.assertIn("workspace-invite-", self.send.call_args.kwargs["idempotency_key"])
        with self.Session() as db:
            invite = db.query(OrganizationInvite).filter_by(email="new@example.test").one()
            self.assertEqual(invite.status, "pending")
            self.assertIsNotNone(invite.email_sent_at)

    def test_email_failure_preserves_the_created_workspace_and_returns_honest_status(self):
        self.send.side_effect = HTTPException(502, "Private provider detail")
        response = self.create()
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["invitation_email_status"], "unknown")
        self.assertNotIn("Private provider detail", response.text)
        with self.Session() as db:
            self.assertIsNotNone(db.get(Organization, response.json()["id"]))
            invite = db.query(OrganizationInvite).filter_by(email="new@example.test").one()
            self.assertEqual(invite.status, "pending")
            self.assertIsNone(invite.email_sent_at)

    def test_creation_automatically_sends_to_the_client_owner_through_each_platform_transport(self):
        self.send.side_effect = email_delivery.send_platform_system_email
        for provider in ("resend", "smtp"):
            settings = {
                "provider": provider, "configured": True, "smtp_host": "smtp.example.test", "smtp_port": 587,
                "smtp_from_email": "no-reply@example.test", "smtp_from_name": "Decisionate",
                "smtp_use_tls": True, "smtp_use_ssl": False, "smtp_username": "", "smtp_password": "",
                "smtp_timeout_seconds": 5, "resend_api_url": "https://email.example.test",
                "resend_api_key": "test-only", "resend_from_email": "no-reply@example.test", "resend_from_name": "Decisionate",
            }
            with self.subTest(provider=provider), patch.object(email_delivery, "get_platform_email_settings", return_value=settings), \
                    patch.object(email_delivery, "urlopen") as network, patch.object(email_delivery.smtplib, "SMTP") as smtp, \
                    self.assertLogs(invitations.logger, level="INFO") as logs:
                network.return_value.__enter__.return_value.status = 200
                smtp.return_value.__enter__.return_value.send_message.return_value = {}
                response = self.create()
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.json()["invitation_email_status"], "sent")
                if provider == "resend":
                    network.assert_called_once()
                    request = network.call_args.args[0]
                    message = json.loads(request.data)
                    self.assertEqual(message["to"], ["new@example.test"])
                    self.assertIn("North Star Agency via Decisionate", message["from"])
                    self.assertIn("https://app.example.test/sign-in?redirect_url=", message["html"])
                    self.assertTrue(request.get_header("Idempotency-key").startswith("workspace-invite-"))
                    smtp.assert_not_called()
                else:
                    connection = smtp.return_value.__enter__.return_value
                    connection.starttls.assert_called_once()
                    connection.send_message.assert_called_once()
                    message = connection.send_message.call_args.args[0]
                    self.assertEqual(message["To"], "new@example.test")
                    self.assertIn("North Star Agency via Decisionate", message["From"])
                    self.assertIn("https://app.example.test/sign-in?redirect_url=", message.get_body(preferencelist=("plain",)).get_content())
                    network.assert_not_called()
                with self.Session() as db:
                    invite = db.query(OrganizationInvite).filter_by(organization_id=response.json()["id"]).one()
                    self.assertEqual(invite.role, "client_owner")
                    self.assertEqual(invite.status, "pending")
                    self.assertEqual(invite.email_status, "sent")
                    self.assertIsNotNone(invite.email_sent_at)
                self.assertIn("accepted by provider", logs.output[0])
                self.assertNotIn("new@example.test", " ".join(logs.output))

    def test_automatic_transport_failure_is_not_reported_as_a_sent_invitation(self):
        self.send.side_effect = email_delivery.send_platform_system_email
        settings = {"provider": "resend", "configured": True, "resend_from_email": "no-reply@example.test",
                    "resend_from_name": "Decisionate", "resend_api_url": "https://email.example.test",
                    "resend_api_key": "test-only", "smtp_timeout_seconds": 5}
        with patch.object(email_delivery, "get_platform_email_settings", return_value=settings), \
                patch.object(email_delivery, "urlopen", side_effect=URLError("private transport detail")), \
                self.assertLogs(invitations.logger, level="WARNING") as logs:
            response = self.create()
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["invitation_email_status"], "unknown")
        self.assertNotIn("private transport detail", response.text)
        self.assertIn("status=502", logs.output[0])
        self.assertNotIn("private transport detail", logs.output[0])
        with self.Session() as db:
            self.assertIsNotNone(db.get(Organization, response.json()["id"]))
            invite = db.query(OrganizationInvite).filter_by(organization_id=response.json()["id"]).one()
            self.assertEqual(invite.status, "pending")
            self.assertIsNone(invite.email_sent_at)

    def test_agency_can_view_and_resend_invites_without_permission_to_view_client_data(self):
        listing = self.client.get("/organizations/invites", headers=self.headers(self.workspace))
        self.assertEqual(listing.status_code, 200, listing.text)
        self.assertEqual(listing.json()[0]["id"], 7)
        response = self.resend()
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["email_status"], "sent")
        blocked = self.client.get("/datasets/1", headers=self.headers(self.workspace))
        self.assertEqual(blocked.status_code, 403)
        with self.Session() as db:
            self.assertFalse(db.get(Organization, 2).agency_owner_access_enabled)

    def test_adding_a_client_user_invitation_sends_once_and_leaves_access_pending(self):
        def add():
            return self.client.post("/organizations/invites", headers=self.headers(self.workspace),
                                    json={"email": "teammate@example.test", "role": "client_user"})
        response = add()
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["email_status"], "sent")
        self.assertEqual(response.json()["status"], "pending")
        repeat = add()
        self.assertEqual(repeat.status_code, 200, repeat.text)
        self.assertEqual(repeat.json()["id"], response.json()["id"])
        self.assertEqual(self.send.call_count, 1)
        self.assertEqual(self.send.call_args.args[0], "teammate@example.test")
        with self.Session() as db:
            self.assertEqual(db.query(OrganizationMember).count(), 0)
            self.assertEqual(db.query(OrganizationInvite).count(), 2)

    def test_unconfigured_mail_preserves_the_workspace_and_marks_the_email_failed(self):
        self.send.side_effect = HTTPException(503, "Private configuration detail")
        response = self.create()
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["invitation_email_status"], "failed")
        self.assertNotIn("Private configuration detail", response.text)
        with self.Session() as db:
            self.assertIsNotNone(db.get(Organization, response.json()["id"]))
            self.assertEqual(db.query(OrganizationInvite).filter_by(email="new@example.test").one().status, "pending")

    def test_resend_is_throttled_and_can_be_retried_without_creating_another_workspace(self):
        self.assertEqual(self.resend().status_code, 200)
        self.assertEqual(self.resend().status_code, 429)
        self.assertEqual(self.send.call_count, 1)
        with self.Session() as db:
            db.get(OrganizationInvite, 7).email_attempted_at = utc_now() - timedelta(seconds=61)
            db.commit()
        self.assertEqual(self.resend().status_code, 200)
        self.assertEqual(self.send.call_count, 2)
        with self.Session() as db:
            self.assertEqual(db.query(Organization).count(), 4)
            self.assertEqual(db.query(OrganizationInvite).count(), 1)

    def test_other_agencies_client_members_revoked_and_paused_invites_cannot_send(self):
        self.assertEqual(self.resend(workspace="other:client:one").status_code, 403)
        self.assertEqual(self.resend(identity=999).status_code, 404)
        self.actor = "client"
        with self.Session() as db:
            db.add(OrganizationMember(organization_id=2, clerk_user_id="client", role="client_user"))
            db.commit()
        self.assertEqual(self.resend().status_code, 403)
        self.actor = "agency"
        with self.Session() as db:
            db.get(OrganizationInvite, 7).status = "accepted"
            db.commit()
        self.assertEqual(self.resend().status_code, 409)
        with self.Session() as db:
            db.get(Organization, 2).is_paused = True
            db.commit()
        self.assertEqual(self.resend().status_code, 403)
        self.send.assert_not_called()

    def discover(self, hint="client@example.test"):
        return self.client.get("/organizations/workspaces", headers=self.headers(hint=hint))

    def test_standard_tokens_without_email_claims_accept_only_the_server_verified_primary_email(self):
        self.actor, self.email, self.verified = "client", None, False
        with patch.object(router, "get_auth_jwks_url", return_value="https://auth.example.test"), patch.object(
            router, "get_verified_clerk_primary_email", return_value="client@example.test"
        ) as lookup:
            response = self.discover()
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()[0]["owner_user_id"], self.workspace)
            self.assertEqual(response.json()[0]["role"], "client_owner")
            self.assertEqual(self.discover().status_code, 200)
            lookup.assert_called_once_with("client-external")
        with self.Session() as db:
            self.assertEqual(db.get(OrganizationInvite, 7).status, "accepted")
            self.assertEqual(db.query(OrganizationMember).filter_by(clerk_user_id="client").count(), 1)
            self.assertEqual(db.get(AppUser, "client").email, "client@example.test")

    def test_spoofed_browser_email_does_not_accept_another_persons_invitation(self):
        self.actor, self.email, self.verified = "attacker", None, False
        with patch.object(router, "get_auth_jwks_url", return_value="https://auth.example.test"), patch.object(
            router, "get_verified_clerk_primary_email", return_value="attacker@example.test"
        ):
            response = self.discover()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [])
        with self.Session() as db:
            self.assertEqual(db.get(OrganizationInvite, 7).status, "pending")
            self.assertEqual(db.query(OrganizationMember).count(), 0)

    def test_unverified_email_and_failed_provider_lookup_do_not_silently_send_clients_to_onboarding(self):
        self.actor, self.email, self.verified = "client", None, False
        for outcome, code in ((None, 403), (HTTPException(503, "Email verification is unavailable"), 503)):
            with patch.object(router, "get_auth_jwks_url", return_value="https://auth.example.test"), patch.object(
                router, "get_verified_clerk_primary_email", **({"side_effect": outcome} if isinstance(outcome, Exception) else {"return_value": outcome})
            ):
                self.assertEqual(self.discover().status_code, code)
        with self.Session() as db:
            self.assertEqual(db.query(OrganizationMember).count(), 0)

    def test_verified_token_email_needs_no_provider_lookup_or_browser_address(self):
        self.actor, self.email, self.verified = "client", "client@example.test", True
        with patch.object(router, "get_verified_clerk_primary_email") as lookup:
            response = self.discover(hint="wrong@example.test")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()[0]["owner_user_id"], self.workspace)
        lookup.assert_not_called()

    def test_schema_upgrade_preserves_existing_pending_invitations(self):
        legacy = create_engine("sqlite://")
        self.addCleanup(legacy.dispose)
        with legacy.begin() as connection:
            connection.execute(text("CREATE TABLE organization_invites (id INTEGER PRIMARY KEY, status VARCHAR)"))
            connection.execute(text("INSERT INTO organization_invites VALUES (1, 'pending')"))
        with patch.object(main, "engine", legacy):
            main.ensure_organization_invite_email_columns()
            main.ensure_organization_invite_email_columns()
        with legacy.connect() as connection:
            row = connection.execute(text("SELECT status, email_status, email_sent_at FROM organization_invites")).one()
            self.assertEqual(tuple(row), ("pending", None, None))


class InvitationTransportTests(unittest.TestCase):
    def test_resend_transport_forwards_the_invitation_idempotency_key(self):
        message = EmailMessage()
        message["Subject"], message["From"], message["To"] = "Invitation", "Agency via Decisionate <no-reply@example.test>", "client@example.test"
        message["X-Decisionate-Idempotency-Key"] = "workspace-invite-test"
        message.set_content("Open your workspace")
        settings = {"resend_from_email": "no-reply@example.test", "resend_from_name": "Decisionate",
                    "resend_api_url": "https://email.example.test", "resend_api_key": "test-only", "smtp_timeout_seconds": 5}
        with patch.object(email_delivery, "urlopen") as send:
            send.return_value.__enter__.return_value.status = 200
            email_delivery._send_resend_message(message, settings)
        request = send.call_args.args[0]
        self.assertEqual(request.get_header("Idempotency-key"), "workspace-invite-test")
        self.assertEqual(json.loads(request.data)["to"], ["client@example.test"])


if __name__ == "__main__":
    unittest.main()
