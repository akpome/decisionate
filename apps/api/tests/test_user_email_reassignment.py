import json
import os
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
from uuid import uuid4

from fastapi import HTTPException, Request
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.schema import CreateSchema, DropSchema

from app.application_context import application_scope
from app.db.models import AppUser, AuthIdentity, Dataset, Organization, OrganizationMember, WorkspaceApplication, WorkspaceSubscription, utc_now
from app.modules import platform_admin as admin
from app.modules import auth_context, workspace_lifecycle
from app.modules.identity import service
from app.modules.identity.repair import reassign_user_email
from app.modules.marketing.models import MarketingContact, MarketingConsentEvent, MarketingEmail, MarketingJob, MarketingMembership
from tests.test_user_email_repair import UserEmailRepairTests


class UserEmailReassignmentTests(UserEmailRepairTests):
    def setUp(self):
        super().setUp()
        for model in (MarketingContact, MarketingConsentEvent, MarketingEmail, MarketingJob, MarketingMembership):
            model.__table__.create(self.engine)
        self.enterContext(patch.object(service, "SessionLocal", self.sessions))

    def prepare(self):
        self.add_user("usr_departing", email="former@example.test", provider="clerk", subject="user_former", identity_email="former@example.test")
        with self.sessions() as db:
            db.get(AppUser, "usr_departing").display_name = "Former employee"
            db.add(AuthIdentity(user_id="usr_departing", provider="legacy", subject="legacy_former", email="former@example.test"))
            db.add(Organization(name="Company", owner_user_id="usr_departing"))
            db.add(WorkspaceSubscription(workspace_id="usr_departing", plan="professional", status="active", provider_subscription_id="sub_existing"))
            db.commit()

    def reassign(self, **updates):
        return self.client.post("/admin/users/reassign-email", json={
            "user_id": "usr_departing", "email": "replacement@example.test", "previous_email": "former@example.test",
            "reason": "Employee left the company", "confirmation": "REASSIGN USER EMAIL", **updates,
        })

    def test_reassignment_retains_data_billing_and_id_revokes_all_logins_and_audits_both_emails(self):
        self.prepare()
        result = self.reassign(email=" REPLACEMENT@example.test ")
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json()["revoked_sign_ins"], 2)
        with self.sessions() as db:
            user = db.get(AppUser, "usr_departing")
            self.assertEqual(user.email, "replacement@example.test")
            self.assertIsNone(user.display_name)
            self.assertTrue(all(identity.revoked_at for identity in db.query(AuthIdentity).all()))
            self.assertEqual(db.query(Organization).one().owner_user_id, user.id)
            self.assertEqual(db.query(WorkspaceSubscription).one().provider_subscription_id, "sub_existing")
            event = db.query(admin.PlatformAdminAuditEvent).one()
            self.assertEqual(event.action, "user_email_reassigned")
            details = json.loads(event.details)
            self.assertEqual(details["previous_email"], "former@example.test")
            self.assertEqual(details["new_email"], user.email)
            self.assertEqual(details["reason"], "Employee left the company")

    def test_previous_sign_ins_stay_revoked_even_with_a_valid_email_and_replacement_reuses_the_id(self):
        self.prepare()
        self.assertEqual(self.reassign().status_code, 200)
        for subject in ("user_former", "legacy_former"):
            with self.assertRaises(HTTPException) as denied:
                service.resolve_external_identity(subject, email="replacement@example.test", email_verified=True)
            self.assertEqual(denied.exception.status_code, 403)
            with self.sessions() as db:
                self.assertIsNone(service.find_internal_user_id(db, subject))
                self.assertIsNone(service._ensure_legacy_user_mapping(db, subject))
        with self.assertRaises(HTTPException):
            service.link_external_identity("user_former", "usr_departing", email="replacement@example.test")
        self.assertEqual(service.resolve_external_identity("user_replacement", email="replacement@example.test", email_verified=True), "usr_departing")
        with self.sessions() as db:
            self.assertEqual(db.query(AppUser).count(), 1)
            self.assertIsNone(db.query(AuthIdentity).filter_by(subject="user_replacement").one().revoked_at)
            self.assertEqual(db.get(AppUser, "usr_departing").email, "replacement@example.test")

    def test_authenticated_api_requests_reject_former_bearer_and_allow_verified_replacement(self):
        self.prepare()
        @self.client.app.get("/identity-probe")
        def probe(request: Request):
            return {"user_id": auth_context.get_auth_context(request).user_id}
        self.assertEqual(self.reassign().status_code, 200)
        with patch.object(auth_context, "SessionLocal", self.sessions), patch.object(workspace_lifecycle, "SessionLocal", self.sessions), \
                patch.object(auth_context, "get_auth_jwks_url", return_value="https://issuer.test/jwks"), \
                patch.object(auth_context, "verify_clerk_bearer_token_identity", return_value=("user_former", "former@example.test")):
            self.assertEqual(self.client.get("/identity-probe", headers={"Authorization": "Bearer existing-session"}).status_code, 403)
        with patch.object(auth_context, "SessionLocal", self.sessions), patch.object(workspace_lifecycle, "SessionLocal", self.sessions), \
                patch.object(auth_context, "get_auth_jwks_url", return_value="https://issuer.test/jwks"), \
                patch.object(auth_context, "verify_clerk_bearer_token_identity", return_value=("user_replacement", "replacement@example.test")):
            response = self.client.get("/identity-probe", headers={"Authorization": "Bearer replacement-session"})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["user_id"], "usr_departing")

    def test_conflicts_stale_versions_and_bad_requests_make_no_changes(self):
        self.prepare()
        self.add_user("usr_other", email="occupied@example.test")
        for fields, status in (({"email": "occupied@example.test"}, 409), ({"previous_email": "stale@example.test"}, 409),
                ({"email": "invalid"}, 400), ({"reason": " "}, 422), ({"confirmation": "wrong"}, 400),
                ({"unexpected": True}, 422), ({"user_id": "usr_parent:client:one"}, 422), ({"user_id": "usr_unknown"}, 404)):
            response = self.reassign(**fields)
            self.assertEqual(response.status_code, status, response.text)
        with self.sessions() as db:
            self.assertEqual(db.get(AppUser, "usr_departing").email, "former@example.test")
            self.assertFalse(any(item.revoked_at for item in db.query(AuthIdentity).all()))
            self.assertEqual(db.query(admin.PlatformAdminAuditEvent).count(), 0)

    def test_replay_does_not_revoke_the_replacements_new_login_or_duplicate_the_audit(self):
        self.prepare()
        self.assertEqual(self.reassign().status_code, 200)
        service.resolve_external_identity("user_replacement", email="replacement@example.test", email_verified=True)
        replay = self.reassign()
        self.assertEqual(replay.status_code, 200, replay.text)
        self.assertFalse(replay.json()["changed"])
        self.assertEqual(service.resolve_external_identity("user_replacement", email="replacement@example.test", email_verified=True), "usr_departing")
        with self.sessions() as db:
            self.assertEqual(db.query(admin.PlatformAdminAuditEvent).count(), 1)

    def test_full_admin_only_and_protected_or_admin_accounts_cannot_be_transferred(self):
        self.prepare()
        with patch.object(admin, "platform_admin_is_full_access", return_value=False):
            self.assertEqual(self.reassign().status_code, 403)
            self.assertEqual(self.client.post("/admin/identity-links", json={"target_user_id": "usr_departing"}).status_code, 403)
        with patch.object(admin, "platform_owner_user_ids", return_value={"usr_departing"}):
            self.assertEqual(self.reassign().status_code, 409)
        with self.sessions() as db:
            db.add(admin.PlatformAdminRole(user_id="usr_departing", granted_by_user_id="usr_operator")); db.commit()
        self.assertEqual(self.reassign().status_code, 409)
        with self.sessions() as db:
            self.assertEqual(db.get(AppUser, "usr_departing").email, "former@example.test")

    def test_unknown_legacy_email_can_be_recovered_without_creating_an_unmapped_user(self):
        with self.sessions() as db:
            db.add(Organization(name="Legacy", owner_user_id="usr_departing")); db.commit()
        response = self.reassign(previous_email=None)
        self.assertEqual(response.status_code, 200, response.text)
        with self.sessions() as db:
            self.assertEqual(db.get(AppUser, "usr_departing").email, "replacement@example.test")

    def test_existing_identity_email_fallback_is_the_expected_address_for_legacy_recovery(self):
        self.add_user("usr_departing", provider="clerk", subject="user_former", identity_email="former@example.test")
        self.assertEqual(self.reassign().status_code, 200)

    def test_a_malformed_legacy_address_can_be_replaced_but_the_new_address_must_be_valid(self):
        self.add_user("usr_departing", email="legacy-address")
        result = self.reassign(previous_email="legacy-address")
        self.assertEqual(result.status_code, 200, result.text)
        with self.sessions() as db:
            self.assertEqual(db.get(AppUser, "usr_departing").email, "replacement@example.test")

    def test_marketing_consent_is_not_transferred_and_pending_messages_to_former_user_are_stopped(self):
        self.prepare()
        with self.sessions() as db:
            contact = MarketingContact(user_id="usr_departing", email="former@example.test", marketing_status="subscribed", consent_at=utc_now(), email_verified_at=utc_now())
            db.add(contact); db.flush()
            db.add(MarketingMembership(contact_id=contact.id, workspace_id="usr_departing", role="owner", eligible=True))
            db.add(MarketingEmail(contact_id=contact.id, workspace_id="usr_departing", sequence_instance="one", message_type="trial", status="pending", due_at=utc_now()))
            db.commit()
        self.assertEqual(self.reassign().status_code, 200)
        with self.sessions() as db:
            self.assertIsNotNone(db.query(MarketingContact).one().deleted_at)
            self.assertEqual(db.query(MarketingEmail).one().status, "skipped")
            self.assertFalse(db.query(MarketingMembership).one().eligible)
        service.resolve_external_identity("user_replacement", email="replacement@example.test", email_verified=True)
        with self.sessions() as db:
            replacement = db.query(MarketingContact).filter_by(email="replacement@example.test").one()
            self.assertEqual(replacement.marketing_status, "unknown")
            self.assertIsNone(replacement.consent_at)

    def test_failure_before_commit_preserves_former_access_and_email(self):
        self.prepare()
        with patch("app.modules.marketing.service.retire_account_identity", side_effect=HTTPException(503, "Try again later")):
            self.assertEqual(self.reassign().status_code, 503)
        with self.sessions() as db:
            self.assertEqual(db.get(AppUser, "usr_departing").email, "former@example.test")
            self.assertFalse(any(item.revoked_at for item in db.query(AuthIdentity).all()))
            self.assertEqual(db.query(admin.PlatformAdminAuditEvent).count(), 0)

    def test_legacy_cleanup_preserves_revoked_alias_data_without_restoring_the_departed_email(self):
        self.add_user("usr_legacy", provider="legacy", subject="legacy_owner", identity_email="former@example.test")
        with self.sessions() as db:
            db.query(AuthIdentity).one().revoked_at = utc_now()
            db.add(Dataset(user_id="legacy_owner", workspace_id="legacy_owner", source_type="csv", file_name="history.csv", file_path="history.csv", row_count=1, column_count=1))
            db.commit()
        result = self.run_repair()
        self.assertEqual(result["users_deleted"], 0)
        self.assertEqual(result["emails_updated"], 0)
        self.lookup.assert_not_called()
        with self.sessions() as db:
            self.assertIsNotNone(db.get(AppUser, "usr_legacy"))
            self.assertIsNone(db.get(AppUser, "usr_legacy").email)
            self.assertIsNotNone(db.query(AuthIdentity).one().revoked_at)

    def test_secondary_application_can_reuse_an_email_without_affecting_other_application_logins(self):
        self.prepare()
        self.add_user("usr_main", email="replacement@example.test", provider="clerk", subject="user_main")
        with self.sessions() as db:
            db.add(WorkspaceApplication(workspace_id="usr_departing", application_id="decisionate-ai"))
            db.query(AuthIdentity).filter_by(user_id="usr_departing").delete()
            db.add(AuthIdentity(user_id="usr_departing", provider="application:decisionate-ai:clerk", subject="user_former", email="former@example.test"))
            db.commit()
        registration = {"id": "decisionate-ai", "name": "International", "web_url": "https://decisionate.ai", "allowed_origins": ["https://decisionate.ai"], "environment_prefix": "DECISIONATE_AI_"}
        with patch.dict("os.environ", {"DECISIONATE_APPLICATIONS": json.dumps([registration])}):
            self.assertEqual(self.reassign().status_code, 200)
            with application_scope("decisionate-ai"):
                with self.assertRaises(HTTPException):
                    service.resolve_external_identity("user_former", email="former@example.test", email_verified=True)
                self.assertEqual(service.resolve_external_identity("user_replacement", email="replacement@example.test", email_verified=True), "usr_departing")
        with self.sessions() as db:
            self.assertIsNone(db.query(AuthIdentity).filter_by(subject="user_main").one().revoked_at)

    def test_revocation_column_upgrade_is_idempotent_and_preserves_older_rows(self):
        from sqlalchemy import create_engine
        engine = create_engine("sqlite://")
        self.addCleanup(engine.dispose)
        with engine.begin() as connection:
            connection.execute(text("CREATE TABLE auth_identities (id INTEGER PRIMARY KEY, subject VARCHAR, email VARCHAR)"))
            connection.execute(text("INSERT INTO auth_identities (subject, email) VALUES ('existing', 'owner@example.test')"))
        service.ensure_identity_revocation_column(engine)
        service.ensure_identity_revocation_column(engine)
        with engine.connect() as connection:
            self.assertIn("revoked_at", {item["name"] for item in inspect(connection).get_columns("auth_identities")})
            self.assertEqual(connection.execute(text("SELECT email, revoked_at FROM auth_identities")).one(), ("owner@example.test", None))


@unittest.skipUnless(os.getenv("DECISIONATE_TEST_POSTGRES_URL"), "An isolated PostgreSQL test database is required")
class PostgresUserEmailReassignmentTests(unittest.TestCase):
    def setUp(self):
        schema = "handover_test_" + uuid4().hex
        admin_engine = create_engine(os.environ["DECISIONATE_TEST_POSTGRES_URL"])
        self.addCleanup(admin_engine.dispose)
        with admin_engine.begin() as connection:
            connection.execute(CreateSchema(schema))
        def drop_schema():
            with admin_engine.begin() as connection:
                connection.execute(DropSchema(schema, cascade=True))
        self.addCleanup(drop_schema)
        self.engine = create_engine(os.environ["DECISIONATE_TEST_POSTGRES_URL"], connect_args={"options": f"-csearch_path={schema}"})
        self.addCleanup(self.engine.dispose)
        for model in (AppUser, AuthIdentity, Organization, OrganizationMember, WorkspaceApplication, WorkspaceSubscription,
                      admin.PlatformAdminRole, MarketingContact, MarketingConsentEvent, MarketingEmail, MarketingJob, MarketingMembership):
            model.__table__.create(self.engine)
        service.ensure_user_email_constraint(self.engine)
        self.sessions = sessionmaker(bind=self.engine)
        self.enterContext(patch.object(service, "SessionLocal", self.sessions))
        with self.sessions() as db:
            db.add(AppUser(id="usr_departing", email="former@example.test"))
            db.add(AuthIdentity(user_id="usr_departing", provider="clerk", subject="user_former", email="former@example.test"))
            db.commit()

    def test_an_identity_loaded_before_handover_is_rechecked_after_the_account_lock(self):
        with self.sessions() as stale:
            previous = stale.query(AuthIdentity).one()
            self.assertIsNone(previous.revoked_at)
            with self.sessions() as db:
                reassign_user_email(db, "usr_departing", "replacement@example.test", "former@example.test", actor_user_id="usr_operator")
                db.commit()
            with self.assertRaises(HTTPException) as rejected:
                service._require_active_identity(stale, previous)
            self.assertEqual(rejected.exception.status_code, 403)

    def test_concurrent_registration_and_reassignment_cannot_assign_the_email_to_two_accounts(self):
        start = threading.Barrier(2)
        def transfer():
            start.wait(timeout=10)
            try:
                with self.sessions() as db:
                    reassign_user_email(db, "usr_departing", "replacement@example.test", "former@example.test", actor_user_id="usr_operator")
                    db.commit()
                return 200
            except HTTPException as error:
                return error.status_code
        def register():
            start.wait(timeout=10)
            return service.resolve_external_identity("user_replacement", email="replacement@example.test", email_verified=True)
        with ThreadPoolExecutor(max_workers=2) as executor:
            transferring = executor.submit(transfer)
            registering = executor.submit(register)
            status, recipient_id = transferring.result(timeout=20), registering.result(timeout=20)
        self.assertIn(status, {200, 409})
        with self.sessions() as db:
            self.assertEqual(db.query(AppUser).filter_by(email="replacement@example.test").count(), 1)
            old = db.query(AuthIdentity).filter_by(subject="user_former").one()
            if status == 200:
                self.assertEqual(recipient_id, "usr_departing")
                self.assertIsNotNone(old.revoked_at)
            else:
                self.assertNotEqual(recipient_id, "usr_departing")
                self.assertIsNone(old.revoked_at)
                self.assertEqual(db.get(AppUser, "usr_departing").email, "former@example.test")
