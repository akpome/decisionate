import json
import os
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException, Request
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker

from app.db.models import AppUser, AuthIdentity, Dataset, Organization, WorkspaceSubscription, utc_now
from app.modules import auth_context, platform_admin as admin, workspace_lifecycle
from app.modules.billing.notifications import get_workspace_owner_email
from app.modules.identity import service
from app.modules.marketing.service import capture_identity
from app.modules.marketing.models import MarketingContact
from tests import test_user_email_reassignment as existing


class UserEmailTransferTests(existing.UserEmailReassignmentTests):
    def prepare_transfer(self):
        self.prepare()
        self.add_user("usr_destination", email="destination@example.test", provider="clerk",
                      subject="user_destination", identity_email="destination@example.test")
        with self.sessions() as db:
            db.add(Organization(name="Destination business", owner_user_id="usr_destination"))
            db.add(WorkspaceSubscription(workspace_id="usr_destination", plan="agency",
                                         provider_subscription_id="sub_destination"))
            db.add(Dataset(user_id="usr_departing", workspace_id="usr_departing", source_type="csv",
                           file_name="history.csv", file_path="history.csv", row_count=1, column_count=1))
            db.add(AuthIdentity(user_id="usr_departing", provider="clerk", subject="user_other_email",
                                email="other@example.test"))
            db.commit()

    def preview_transfer(self, **updates):
        return self.client.post("/admin/users/reassign-email/preview", json={
            "user_id": "usr_destination", "email": "former@example.test",
            "previous_email": "destination@example.test", **updates,
        })

    def transfer(self, **updates):
        return self.reassign(user_id="usr_destination", email="former@example.test",
                             previous_email="destination@example.test", source_user_id="usr_departing", **updates)

    def test_preview_identifies_the_previous_account_without_writing(self):
        self.prepare_transfer()
        result = self.preview_transfer(email=" FORMER@example.test ")
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json()["source_user_id"], "usr_departing")
        self.assertEqual(result.json()["email"], "former@example.test")
        with self.sessions() as db:
            self.assertIsNone(db.get(AppUser, "usr_departing").access_paused_at)
            self.assertEqual(db.get(AppUser, "usr_destination").email, "destination@example.test")
            self.assertEqual(db.query(admin.PlatformAdminAuditEvent).count(), 0)

    def test_transfer_pauses_previous_account_moves_only_matching_sign_ins_and_preserves_each_workspace(self):
        self.prepare_transfer()
        result = self.transfer()
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json()["paused_user_id"], "usr_departing")
        with self.sessions() as db:
            source = db.get(AppUser, "usr_departing")
            self.assertIsNotNone(source.access_paused_at)
            self.assertEqual(source.email, "former@example.test", "Keep an historical address, not an active assignment")
            destination = db.get(AppUser, "usr_destination")
            self.assertEqual(destination.email, "former@example.test")
            self.assertIsNone(destination.access_paused_at)
            self.assertEqual(db.query(AuthIdentity).filter_by(subject="user_former").one().user_id, destination.id)
            self.assertIsNotNone(db.query(AuthIdentity).filter_by(subject="user_destination").one().revoked_at)
            self.assertIsNotNone(db.query(AuthIdentity).filter_by(subject="user_other_email").one().revoked_at)
            self.assertEqual(db.query(Dataset).one().workspace_id, source.id)
            self.assertEqual({item.owner_user_id for item in db.query(Organization)}, {source.id, destination.id})
            self.assertEqual({item.provider_subscription_id for item in db.query(WorkspaceSubscription)},
                             {"sub_existing", "sub_destination"})
            self.assertEqual(service._find_unique_user_by_email(db, "former@example.test").id, destination.id)
            events = db.query(admin.PlatformAdminAuditEvent).all()
            self.assertEqual({item.action for item in events}, {"user_email_reassigned", "user_paused_after_email_transfer"})
            details = json.loads(next(item.details for item in events if item.action == "user_email_reassigned"))
            self.assertEqual(details["paused_user_id"], source.id)
        self.assertEqual(service.resolve_external_identity("user_former", email="former@example.test", email_verified=True), "usr_destination")
        for subject in ("user_destination", "user_other_email"):
            with self.assertRaises(HTTPException):
                service.resolve_external_identity(subject, email="other@example.test", email_verified=True)

    def test_paused_account_can_be_reassigned_to_another_email_and_becomes_active(self):
        self.prepare_transfer()
        self.assertEqual(self.transfer().status_code, 200)
        result = self.reassign()
        self.assertEqual(result.status_code, 200, result.text)
        with self.sessions() as db:
            source = db.get(AppUser, "usr_departing")
            self.assertIsNone(source.access_paused_at)
            self.assertEqual(source.email, "replacement@example.test")
            self.assertEqual(db.query(Dataset).one().workspace_id, source.id)
        self.assertEqual(service.resolve_external_identity("user_replacement", email="replacement@example.test", email_verified=True), "usr_departing")
        self.assertEqual(service.resolve_external_identity("user_former", email="former@example.test", email_verified=True), "usr_destination")

    def test_an_explicit_transfer_can_return_the_email_to_its_previous_paused_id(self):
        self.prepare_transfer()
        self.assertEqual(self.transfer().status_code, 200)
        result = self.reassign(email="former@example.test", previous_email="former@example.test", source_user_id="usr_destination")
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json()["paused_user_id"], "usr_destination")
        self.assertEqual(service.resolve_external_identity("user_former", email="former@example.test", email_verified=True), "usr_departing")
        with self.sessions() as db:
            self.assertIsNone(db.get(AppUser, "usr_departing").access_paused_at)
            self.assertIsNotNone(db.get(AppUser, "usr_destination").access_paused_at)

    def test_incomplete_source_sign_in_is_verified_before_it_moves(self):
        self.prepare_transfer()
        with self.sessions() as db:
            db.query(AuthIdentity).filter_by(subject="user_former").one().email = None
            db.commit()
        self.lookup.return_value = (True, "former@example.test")
        self.assertEqual(self.transfer().status_code, 200)
        self.lookup.assert_called_once_with("user_former")
        self.assertEqual(service.resolve_external_identity("user_former", email="former@example.test", email_verified=True), "usr_destination")

    def test_incomplete_source_sign_in_lookup_failure_preserves_both_accounts(self):
        self.prepare_transfer()
        with self.sessions() as db:
            db.query(AuthIdentity).filter_by(subject="user_former").one().email = None
            db.commit()
        self.lookup.side_effect = HTTPException(503, "Email verification unavailable")
        self.assertEqual(self.transfer().status_code, 503)
        with self.sessions() as db:
            self.assertIsNone(db.get(AppUser, "usr_departing").access_paused_at)
            self.assertEqual(db.get(AppUser, "usr_destination").email, "destination@example.test")

    def test_access_check_does_not_undo_a_recovered_email_when_autoflush_is_disabled(self):
        self.add_user("usr_incomplete", provider="clerk", subject="user_incomplete")
        sessions = sessionmaker(bind=self.engine, autoflush=False)
        with patch.object(service, "SessionLocal", sessions), patch.object(service, "_email_mapping_enforced", return_value=True):
            self.assertEqual(service.resolve_external_identity("user_incomplete", email="owner@example.test", email_verified=True), "usr_incomplete")
        with sessions() as db:
            self.assertEqual(db.get(AppUser, "usr_incomplete").email, "owner@example.test")

    def test_transfer_requires_an_explicit_and_current_source_and_full_permission(self):
        self.prepare_transfer()
        for source_id in (None, "usr_wrong"):
            result = self.reassign(user_id="usr_destination", email="former@example.test",
                previous_email="destination@example.test", source_user_id=source_id)
            self.assertEqual(result.status_code, 409, result.text)
        with patch.object(admin, "platform_admin_is_full_access", return_value=False):
            self.assertEqual(self.preview_transfer().status_code, 403)
            self.assertEqual(self.transfer().status_code, 403)
        with self.sessions() as db:
            self.assertIsNone(db.get(AppUser, "usr_departing").access_paused_at)
            self.assertEqual(db.query(admin.PlatformAdminAuditEvent).count(), 0)

    def test_stale_source_assignment_requires_another_review(self):
        self.prepare_transfer()
        self.assertEqual(self.preview_transfer().json()["source_user_id"], "usr_departing")
        with self.sessions() as db:
            db.get(AppUser, "usr_departing").email = "changed@example.test"
            db.query(AuthIdentity).filter_by(user_id="usr_departing").update({"email": "changed@example.test"})
            db.commit()
        self.assertEqual(self.transfer().status_code, 409)
        with self.sessions() as db:
            self.assertEqual(db.get(AppUser, "usr_destination").email, "destination@example.test")
            self.assertIsNone(db.get(AppUser, "usr_departing").access_paused_at)

    def test_ambiguous_legacy_duplicates_must_be_reviewed_instead_of_pausing_an_arbitrary_account(self):
        self.prepare_transfer()
        self.add_user("usr_duplicate", email="former@example.test")
        self.assertEqual(self.preview_transfer().status_code, 409)
        self.assertEqual(self.transfer().status_code, 409)

    def test_another_applications_email_assignment_and_access_are_not_transferred(self):
        self.prepare_transfer()
        from app.application_context import application_scope
        from app.db.models import WorkspaceApplication
        with self.sessions() as db:
            db.add(WorkspaceApplication(workspace_id="usr_departing", application_id="decisionate-ai"))
            db.query(AuthIdentity).filter_by(user_id="usr_departing").update({"provider": "application:decisionate-ai:clerk"})
            db.commit()
        self.assertIsNone(self.preview_transfer().json()["source_user_id"])
        self.assertEqual(self.transfer().status_code, 409, "A different application's ID is never accepted as the transfer source")
        result = self.reassign(user_id="usr_destination", email="former@example.test", previous_email="destination@example.test")
        self.assertEqual(result.status_code, 200, result.text)
        with self.sessions() as db:
            self.assertIsNone(db.get(AppUser, "usr_departing").access_paused_at)
        registration = {"id": "decisionate-ai", "name": "International", "web_url": "https://decisionate.ai",
                        "allowed_origins": ["https://decisionate.ai"], "environment_prefix": "DECISIONATE_AI_"}
        with patch.dict("os.environ", {"DECISIONATE_APPLICATIONS": json.dumps([registration])}), application_scope("decisionate-ai"):
            self.assertEqual(service.resolve_external_identity("user_former", email="former@example.test", email_verified=True), "usr_departing")

    def test_the_moved_email_does_not_inherit_marketing_consent_or_revive_the_paused_account(self):
        self.prepare_transfer()
        with self.sessions() as db:
            db.add(MarketingContact(user_id="usr_departing", email="former@example.test", marketing_status="subscribed",
                                    consent_at=utc_now(), email_verified_at=utc_now()))
            db.commit()
        self.assertEqual(self.transfer().status_code, 200)
        service.resolve_external_identity("user_former", email="former@example.test", email_verified=True)
        with self.sessions() as db:
            contact = db.query(MarketingContact).filter_by(email="former@example.test").one()
            self.assertEqual(contact.user_id, "usr_destination")
            self.assertEqual(contact.marketing_status, "unknown")
            self.assertIsNone(contact.consent_at)
            self.assertIsNone(capture_identity(db, "usr_departing", "former@example.test", verified=True))

    def test_source_administrators_and_protected_accounts_cannot_be_paused(self):
        self.prepare_transfer()
        with patch.object(admin, "platform_owner_user_ids", return_value={"usr_departing"}):
            self.assertEqual(self.preview_transfer().status_code, 409)
            self.assertEqual(self.transfer().status_code, 409)
        with self.sessions() as db:
            db.add(admin.PlatformAdminRole(user_id="usr_departing", granted_by_user_id="usr_operator"))
            db.commit()
        self.assertEqual(self.transfer().status_code, 409)

    def test_administrator_grants_do_not_reactivate_a_paused_id_or_pick_its_historical_email(self):
        self.prepare_transfer()
        self.assertEqual(self.transfer().status_code, 200)
        auth = SimpleNamespace(user_id="usr_operator", auth_provider="clerk")
        permissions = [next(iter(admin.PLATFORM_ADMIN_PERMISSION_KEYS))]
        with patch.object(admin, "require_platform_admin", return_value=auth):
            paused = self.client.post("/admin/administrators", json={"user_references": ["usr_departing"], "permissions": permissions})
            self.assertEqual(paused.status_code, 409, paused.text)
            active = self.client.post("/admin/administrators", json={"user_references": ["former@example.test"], "permissions": permissions})
            self.assertEqual(active.status_code, 200, active.text)
            self.assertEqual(active.json()["administrators"][0]["user_id"], "usr_destination")
        with self.sessions() as db:
            self.assertIsNotNone(db.get(AppUser, "usr_departing").access_paused_at)
            self.assertIsNone(db.query(admin.PlatformAdminRole).filter_by(user_id="usr_departing").first())

    def test_paused_accounts_cannot_sign_in_be_relinked_or_receive_owner_email(self):
        self.prepare_transfer()
        with self.sessions() as db:
            db.get(AppUser, "usr_departing").access_paused_at = utc_now()
            db.commit()
        with self.assertRaises(HTTPException):
            service.resolve_external_identity("user_former", email="former@example.test", email_verified=True)
        with self.assertRaises(HTTPException):
            service.link_external_identity("user_new", "usr_departing", email="former@example.test")
        with self.sessions() as db:
            source_workspace = db.query(Organization).filter_by(owner_user_id="usr_departing").one()
            self.assertIsNone(get_workspace_owner_email(db, source_workspace))
            self.assertIsNone(capture_identity(db, "usr_departing", "former@example.test", verified=True))

    def test_transfer_rolls_back_both_accounts_and_sign_ins_when_audit_fails(self):
        self.prepare_transfer()
        with patch.object(admin, "record_platform_admin_audit", side_effect=HTTPException(503, "Try again")):
            self.assertEqual(self.transfer().status_code, 503)
        with self.sessions() as db:
            self.assertIsNone(db.get(AppUser, "usr_departing").access_paused_at)
            self.assertEqual(db.get(AppUser, "usr_destination").email, "destination@example.test")
            self.assertEqual(db.query(AuthIdentity).filter_by(subject="user_former").one().user_id, "usr_departing")
            self.assertFalse(any(item.revoked_at for item in db.query(AuthIdentity)))

    def test_replayed_transfer_does_not_pause_another_account_or_revoke_the_moved_login(self):
        self.prepare_transfer()
        self.assertEqual(self.transfer().status_code, 200)
        replay = self.transfer()
        self.assertEqual(replay.status_code, 200, replay.text)
        self.assertFalse(replay.json()["changed"])
        self.assertEqual(service.resolve_external_identity("user_former", email="former@example.test", email_verified=True), "usr_destination")
        users = self.client.get("/admin/users").json()
        self.assertTrue(next(item for item in users if item["clerk_user_id"] == "usr_departing")["access_paused"])

    def test_api_authentication_uses_destination_and_cannot_open_the_paused_accounts_workspace(self):
        self.prepare_transfer()
        self.assertEqual(self.transfer().status_code, 200)

        @self.client.app.get("/transfer-probe")
        def probe(request: Request):
            context = auth_context.get_auth_context(request)
            return {"user_id": context.user_id, "workspace_id": context.workspace_id}

        with patch.object(auth_context, "SessionLocal", self.sessions), patch.object(workspace_lifecycle, "SessionLocal", self.sessions), \
                patch.object(auth_context, "get_auth_jwks_url", return_value="https://issuer.test/jwks"), \
                patch.object(auth_context, "verify_clerk_bearer_token_identity", return_value=("user_former", "former@example.test")):
            response = self.client.get("/transfer-probe", headers={"Authorization": "Bearer existing"})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()["user_id"], "usr_destination")
            blocked = self.client.get("/transfer-probe", headers={"Authorization": "Bearer existing", "X-Workspace-Id": "usr_departing"})
            self.assertEqual(blocked.status_code, 403, blocked.text)

    def test_access_column_upgrade_is_idempotent_and_preserves_existing_profiles(self):
        engine = create_engine("sqlite://")
        self.addCleanup(engine.dispose)
        with engine.begin() as connection:
            connection.execute(text("CREATE TABLE app_users (id VARCHAR PRIMARY KEY, email VARCHAR)"))
            connection.execute(text("INSERT INTO app_users (id, email) VALUES ('usr_existing', 'owner@example.test')"))
        service.ensure_user_access_column(engine)
        service.ensure_user_access_column(engine)
        with engine.connect() as connection:
            self.assertIn("access_paused_at", {item["name"] for item in inspect(connection).get_columns("app_users")})
            self.assertEqual(connection.execute(text("SELECT email, access_paused_at FROM app_users")).one(), ("owner@example.test", None))


@unittest.skipUnless(os.getenv("DECISIONATE_TEST_POSTGRES_URL"), "An isolated PostgreSQL test database is required")
class PostgresEmailTransferTests(existing.PostgresUserEmailReassignmentTests):
    def prepare_destination(self):
        with self.sessions() as db:
            db.add(AppUser(id="usr_destination", email="destination@example.test"))
            db.commit()

    def transfer(self):
        with self.sessions() as db:
            result = existing.reassign_user_email(db, "usr_destination", "former@example.test", "destination@example.test",
                actor_user_id="usr_operator", source_user_id="usr_departing")
            db.commit()
            return result

    def test_email_constraint_keeps_historical_address_while_only_destination_is_active(self):
        self.prepare_destination()
        self.assertEqual(self.transfer()["paused_user_id"], "usr_departing")
        with self.sessions() as db:
            self.assertIsNotNone(db.get(AppUser, "usr_departing").access_paused_at)
            self.assertEqual(service._find_unique_user_by_email(db, "former@example.test").id, "usr_destination")

    def test_sign_in_racing_a_transfer_cannot_reactivate_the_previous_account(self):
        self.prepare_destination()
        start = threading.Barrier(2)

        def transfer():
            start.wait(timeout=10)
            return self.transfer()

        def sign_in():
            start.wait(timeout=10)
            return service.resolve_external_identity("user_former", email="former@example.test", email_verified=True)

        with ThreadPoolExecutor(max_workers=2) as executor:
            transferred, signed_in = executor.submit(transfer), executor.submit(sign_in)
            self.assertEqual(transferred.result(timeout=20)["paused_user_id"], "usr_departing")
            self.assertIn(signed_in.result(timeout=20), {"usr_departing", "usr_destination"})
        self.assertEqual(service.resolve_external_identity("user_former", email="former@example.test", email_verified=True), "usr_destination")
        with self.sessions() as db:
            self.assertIsNotNone(db.get(AppUser, "usr_departing").access_paused_at)
