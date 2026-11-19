import json
import asyncio
import os
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from uuid import uuid4

from sqlalchemy import create_engine, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.schema import CreateSchema, DropSchema

from app.application_context import get_application
from app.db.models import AppUser, AuthIdentity, Organization, WorkspaceApplication
from app.modules import platform_admin as admin
from app.modules.identity import service
from tests.test_user_email_repair import UserEmailRepairTests


class UserEmailMappingTests(UserEmailRepairTests):
    def map_email(self, user_id="usr_empty", email="owner@example.test", **updates):
        return self.client.post("/admin/users/map-email", json={
            "user_id": user_id, "email": email, "confirmation": "MAP USER EMAIL", **updates,
        })

    def test_mapping_retains_user_id_data_and_records_an_audit_without_creating_a_login_alias(self):
        self.add_user()
        with self.sessions() as db:
            db.add(Organization(name="Existing", owner_user_id="usr_empty")); db.commit()
        response = self.map_email(email=" OWNER@example.test ")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["email"], "owner@example.test")
        with self.sessions() as db:
            self.assertEqual(db.get(AppUser, "usr_empty").email, "owner@example.test")
            self.assertEqual(db.query(Organization).one().owner_user_id, "usr_empty")
            self.assertEqual(db.query(AuthIdentity).count(), 0)
            event = db.query(admin.PlatformAdminAuditEvent).one()
            self.assertEqual((event.action, event.target_user_id, event.target_email), ("user_email_mapped", "usr_empty", "owner@example.test"))

    def test_mapping_is_idempotent_but_cannot_replace_an_existing_email(self):
        self.add_user()
        self.assertEqual(self.map_email().status_code, 200)
        self.assertFalse(self.map_email().json()["changed"])
        self.assertEqual(self.map_email(email="different@example.test").status_code, 409)
        with self.sessions() as db:
            self.assertEqual(db.query(admin.PlatformAdminAuditEvent).count(), 1)
            self.assertEqual(db.get(AppUser, "usr_empty").email, "owner@example.test")

    def test_mapping_requires_full_access_confirmation_valid_email_and_a_known_account(self):
        self.add_user()
        with patch.object(admin, "platform_admin_is_full_access", return_value=False):
            self.assertEqual(self.map_email().status_code, 403)
        self.assertEqual(self.map_email(confirmation="wrong").status_code, 400)
        for value in ("bad-address", "x@example.test\nBcc: victim@example.test", "@example.test"):
            self.assertEqual(self.map_email(email=value).status_code, 400)
        self.assertEqual(self.map_email(user_id="usr_unknown").status_code, 404)
        self.assertEqual(self.map_email(user_id="usr_parent:client:one").status_code, 422)
        self.assertEqual(self.map_email(unexpected="extra").status_code, 422)
        with self.sessions() as db:
            self.assertIsNone(db.get(AppUser, "usr_empty").email)

    def test_user_list_exposes_blank_emails_as_missing_for_manual_mapping(self):
        self.add_user(email="   ")
        users = asyncio.run(admin.get_platform_admin_users(SimpleNamespace()))
        self.assertEqual(len(users), 1)
        self.assertIsNone(users[0].email)
        self.assertEqual(users[0].clerk_user_id, "usr_empty")

    def test_workspace_namespaces_do_not_require_a_login_email(self):
        self.add_user("usr_parent:client:one")
        result = self.run_repair()
        self.assertEqual(result["remaining_unmapped"], 0)
        self.assertEqual(result["checked"], 0)
        self.assertEqual(result["unresolved"], [])
        self.assertEqual(result["users_deleted"], 0)

    def test_existing_clerk_account_requires_its_own_verified_primary_email(self):
        self.add_user(provider="clerk", subject="user_existing")
        self.lookup.return_value = (True, "correct@example.test")
        self.assertEqual(self.map_email(email="wrong@example.test").status_code, 409)
        self.lookup.return_value = (True, None)
        self.assertEqual(self.map_email(email="correct@example.test").status_code, 409)
        self.lookup.return_value = (True, "correct@example.test")
        self.assertEqual(self.map_email(email="correct@example.test").status_code, 200)

    def test_provider_failure_never_falls_back_to_an_unverified_manual_mapping(self):
        from fastapi import HTTPException
        self.add_user(provider="clerk", subject="user_existing")
        self.lookup.side_effect = HTTPException(503, "Provider unavailable")
        self.assertEqual(self.map_email().status_code, 503)
        with self.sessions() as db:
            self.assertIsNone(db.get(AppUser, "usr_empty").email)
            self.assertEqual(db.query(admin.PlatformAdminAuditEvent).count(), 0)

    def test_duplicate_profile_and_alias_emails_cannot_be_assigned_or_merged(self):
        self.add_user()
        self.add_user("usr_other", email="other@example.test", provider="clerk", subject="user_other", identity_email="alias@example.test")
        self.assertEqual(self.map_email(email="OTHER@example.test").status_code, 409)
        self.assertEqual(self.map_email(email="alias@example.test").status_code, 409)
        with self.sessions() as db:
            self.assertEqual(db.query(AppUser).count(), 2)
            self.assertIsNone(db.get(AppUser, "usr_empty").email)

    def test_missing_profile_can_be_recovered_for_an_existing_owner_reference(self):
        with self.sessions() as db:
            db.add(Organization(name="Legacy owner", owner_user_id="usr_owner_without_profile")); db.commit()
        self.assertEqual(self.map_email(user_id="usr_owner_without_profile").status_code, 200)
        with self.sessions() as db:
            self.assertEqual(db.get(AppUser, "usr_owner_without_profile").email, "owner@example.test")
            self.assertEqual(db.query(Organization).one().owner_user_id, "usr_owner_without_profile")

    def test_secondary_application_mapping_uses_its_own_clerk_and_email_namespace(self):
        self.add_user(provider="application:decisionate-ai:clerk", subject="user_secondary")
        self.add_user("usr_main", email="same@example.test")
        with self.sessions() as db:
            db.add(WorkspaceApplication(workspace_id="usr_empty", application_id="decisionate-ai")); db.commit()
        registration = {"id": "decisionate-ai", "name": "International", "web_url": "https://decisionate.ai",
                        "allowed_origins": ["https://decisionate.ai"], "environment_prefix": "DECISIONATE_AI_"}
        observed = []
        self.lookup.side_effect = lambda subject: (observed.append(get_application().id) or True, "same@example.test")
        with patch.dict("os.environ", {"DECISIONATE_APPLICATIONS": json.dumps([registration])}):
            self.assertEqual(self.map_email(email="same@example.test").status_code, 200)
        self.assertEqual(observed, ["decisionate-ai"])

    def test_repair_reports_mapping_required_and_does_not_assign_one_email_to_two_accounts(self):
        self.add_user(provider="clerk", subject="user_existing")
        self.add_user("usr_other", email="owner@example.test")
        self.lookup.return_value = (True, "owner@example.test")
        result = self.run_repair()
        self.assertEqual(result["emails_updated"], 0)
        self.assertEqual(result["remaining_unmapped"], 1)
        self.assertEqual(len(result["unresolved"]), 1)

    def test_backfill_does_not_create_an_unmapped_internal_account(self):
        with self.sessions() as db:
            self.assertIsNone(service._ensure_legacy_user_mapping(db, "user_unknown_legacy"))
            self.assertEqual(db.query(AppUser).count(), 0)
            self.assertEqual(db.query(AuthIdentity).count(), 0)
        self.add_user(email="known@example.test", provider="clerk", subject="user_known")
        with self.sessions() as db:
            self.assertEqual(service._ensure_legacy_user_mapping(db, "user_known"), "usr_empty")
            db.commit()
            self.assertEqual(db.query(AppUser).count(), 1)


    def test_live_identity_creation_rejects_missing_or_invalid_email_before_persistence(self):
        with patch.object(service, "SessionLocal", self.sessions), patch.object(service, "get_runtime_configuration",
                return_value=SimpleNamespace(auth_jwks_url="https://issuer/jwks", app_env="production")):
            for value in (None, "", "not-an-email"):
                with self.assertRaisesRegex(ValueError, "email"):
                    service.resolve_external_identity("user_unmapped", email=value)
        with self.sessions() as db:
            self.assertEqual(db.query(AppUser).count(), 0)

    def test_live_linking_cannot_attach_a_login_to_an_empty_profile(self):
        self.add_user()
        with patch.object(service, "SessionLocal", self.sessions), patch.object(service, "get_runtime_configuration",
                return_value=SimpleNamespace(auth_jwks_url="https://issuer/jwks", app_env="production")):
            with self.assertRaisesRegex(ValueError, "email"):
                service.link_external_identity("user_empty", "usr_empty")
            service.link_external_identity("user_empty", "usr_empty", email="owner@example.test")
        with self.sessions() as db:
            self.assertEqual(db.get(AppUser, "usr_empty").email, "owner@example.test")
            self.assertEqual(db.query(AuthIdentity).count(), 1)

    def test_verified_login_recovers_a_missing_profile_without_changing_its_id(self):
        with self.sessions() as db:
            db.add(AuthIdentity(user_id="usr_missing", provider="clerk", subject="user_old")); db.commit()
        with patch.object(service, "SessionLocal", self.sessions), patch.object(service, "capture_identity"), patch.object(service, "get_runtime_configuration",
                return_value=SimpleNamespace(auth_jwks_url="https://issuer/jwks", app_env="production")):
            self.assertEqual(service.resolve_external_identity("user_old", email="owner@example.test", email_verified=True), "usr_missing")
        with self.sessions() as db:
            self.assertEqual(db.get(AppUser, "usr_missing").email, "owner@example.test")

    def test_database_guard_rejects_new_unmapped_users_and_clearing_emails_but_keeps_legacy_recoverable(self):
        self.add_user()
        service.ensure_user_email_constraint(self.engine)
        service.ensure_user_email_constraint(self.engine)
        for value in (None, "", "   "):
            with self.sessions() as db:
                db.add(AppUser(id="usr_new", email=value))
                with self.assertRaises(IntegrityError):
                    db.commit()
        self.assertEqual(self.map_email().status_code, 200)
        with self.sessions() as db:
            user = db.get(AppUser, "usr_empty")
            self.assertEqual(user.email, "owner@example.test")
            user.email = None
            with self.assertRaises(IntegrityError):
                db.commit()

    def test_first_verified_legacy_login_migrates_existing_workspace_without_a_blank_profile(self):
        subject = "user_legacy_new"
        with self.sessions() as db:
            db.add(Organization(name="Old workspace", owner_user_id=subject))
            db.add(Organization(name="Old client", owner_user_id=subject + ":client:one"))
            db.commit()
        with patch.object(service, "SessionLocal", self.sessions), patch.object(service, "capture_identity"):
            user_id = service.resolve_external_identity(subject, email="owner@example.test", email_verified=True)
        with self.sessions() as db:
            self.assertEqual(db.get(AppUser, user_id).email, "owner@example.test")
            owners = {item.owner_user_id for item in db.query(Organization).all()}
            self.assertEqual(owners, {user_id, user_id + ":client:one"})
            self.assertEqual(db.query(AppUser).count(), 1)


@unittest.skipUnless(os.getenv("DECISIONATE_TEST_POSTGRES_URL"), "An isolated PostgreSQL test database is required")
class PostgresUserEmailConstraintTests(unittest.TestCase):
    def setUp(self):
        schema = "email_mapping_test_" + uuid4().hex
        admin_engine = create_engine(os.environ["DECISIONATE_TEST_POSTGRES_URL"])
        self.addCleanup(admin_engine.dispose)
        with admin_engine.begin() as connection:
            connection.execute(CreateSchema(schema))
        def remove_schema():
            with admin_engine.begin() as connection:
                connection.execute(DropSchema(schema, cascade=True))
        self.addCleanup(remove_schema)
        self.engine = create_engine(os.environ["DECISIONATE_TEST_POSTGRES_URL"], connect_args={"options": f"-csearch_path={schema}"})
        self.addCleanup(self.engine.dispose)
        AppUser.__table__.create(self.engine)
        self.sessions = sessionmaker(bind=self.engine)

    def test_existing_profiles_can_be_recovered_while_new_blank_emails_are_rejected(self):
        with self.sessions() as db:
            db.add(AppUser(id="usr_legacy")); db.commit()
        service.ensure_user_email_constraint(self.engine)
        service.ensure_user_email_constraint(self.engine)
        for email in (None, "", "   "):
            with self.sessions() as db:
                db.add(AppUser(id="usr_new", email=email))
                with self.assertRaises(IntegrityError):
                    db.commit()
        with self.sessions() as db:
            self.assertIsNone(db.get(AppUser, "usr_legacy").email)
            service.validate_user_email_constraint(db)
            self.assertFalse(db.execute(text("SELECT convalidated FROM pg_constraint WHERE conrelid = 'app_users'::regclass AND conname = 'ck_app_users_email_required'")).scalar())
            db.get(AppUser, "usr_legacy").email = "owner@example.test"
            db.flush()
            service.validate_user_email_constraint(db)
            db.commit()
            self.assertTrue(db.execute(text("SELECT convalidated FROM pg_constraint WHERE conrelid = 'app_users'::regclass AND conname = 'ck_app_users_email_required'")).scalar())
            db.get(AppUser, "usr_legacy").email = None
            with self.assertRaises(IntegrityError):
                db.commit()
