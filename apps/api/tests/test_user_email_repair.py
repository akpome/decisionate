import asyncio
import json
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import Column, Integer, MetaData, String, Table, create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.application_context import get_application
from app.db.models import AppUser, AuthIdentity, Dataset, Organization, OrganizationMember, WorkspaceApplication, WorkspaceSubscription
from app.modules import platform_admin as admin
from app.modules.identity import repair, service


class UserEmailRepairTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        self.addCleanup(self.engine.dispose)
        for model in (AppUser, AuthIdentity, Dataset, Organization, OrganizationMember, WorkspaceApplication,
                      WorkspaceSubscription, admin.PlatformAdminRole, admin.PlatformAdminAuditEvent):
            model.__table__.create(self.engine)
        self.events = Table("historical_events", MetaData(), Column("id", Integer, primary_key=True), Column("actor_user_id", String))
        self.events.create(self.engine)
        self.sessions = sessionmaker(bind=self.engine)
        self.lookup = self.enterContext(patch.object(repair, "lookup_clerk_email", return_value=(False, None)))
        self.enterContext(patch.object(admin, "SessionLocal", self.sessions))
        self.enterContext(patch.object(admin, "require_platform_admin", return_value=SimpleNamespace(user_id="usr_operator")))
        self.enterContext(patch.object(admin, "platform_admin_is_full_access", return_value=True))
        self.enterContext(patch.object(admin, "platform_owner_user_ids", return_value={"usr_operator"}))
        application = FastAPI()
        application.include_router(admin.router, prefix="/admin")
        self.client = TestClient(application)
        self.addCleanup(self.client.close)

    def add_user(self, user_id="usr_empty", *, provider=None, subject="old-reference", email=None, identity_email=None):
        with self.sessions() as db:
            db.add(AppUser(id=user_id, email=email))
            if provider:
                db.add(AuthIdentity(user_id=user_id, provider=provider, subject=subject, email=identity_email))
            db.commit()
        return user_id

    def run_repair(self, **kwargs):
        with self.sessions() as db:
            result = repair.repair_user_emails(db, **kwargs)
            db.commit()
            return result

    def test_recovers_stored_identity_email_without_provider_calls(self):
        self.add_user(provider="clerk", subject="user_existing", identity_email="known@example.test")
        result = self.run_repair()
        self.assertEqual(result["emails_updated"], 1)
        self.lookup.assert_not_called()
        with self.sessions() as db:
            self.assertEqual(db.get(AppUser, "usr_empty").email, "known@example.test")

    def test_verified_provider_email_is_attached_without_changing_ids_or_data(self):
        self.add_user(provider="clerk", subject="user_existing")
        self.lookup.return_value = (True, "owner@example.test")
        with self.sessions() as db:
            db.add(Organization(name="Existing business", owner_user_id="usr_empty")); db.commit()
        self.assertEqual(self.run_repair()["emails_updated"], 1)
        with self.sessions() as db:
            self.assertEqual(db.get(AppUser, "usr_empty").email, "owner@example.test")
            self.assertEqual(db.query(Organization).one().owner_user_id, "usr_empty")
            self.assertEqual(db.query(AuthIdentity).one().subject, "user_existing")

    def test_unused_empty_records_and_their_aliases_are_removed(self):
        self.add_user(provider="legacy")
        result = self.run_repair()
        self.assertEqual(result["users_deleted"], 1)
        with self.sessions() as db:
            self.assertEqual(db.query(AppUser).count(), 0)
            self.assertEqual(db.query(AuthIdentity).count(), 0)
        self.lookup.assert_not_called()

    def test_active_provider_account_without_verified_email_is_not_deleted(self):
        self.add_user(provider="clerk", subject="user_unverified")
        self.lookup.return_value = (True, None)
        result = self.run_repair()
        self.assertEqual(result["users_deleted"], 0)
        self.assertEqual(len(result["unresolved"]), 1)
        with self.sessions() as db:
            self.assertIsNotNone(db.get(AppUser, "usr_empty"))

    def test_provider_failure_preserves_records_and_stops_the_batch(self):
        self.add_user(provider="clerk", subject="user_existing")
        self.add_user("usr_later")
        self.lookup.side_effect = HTTPException(503, "Provider unavailable")
        result = self.run_repair()
        self.assertTrue(result["provider_unavailable"])
        self.assertEqual(result["users_deleted"], 0)
        with self.sessions() as db:
            self.assertEqual(db.query(AppUser).count(), 2)

    def test_workspace_owners_members_billing_and_historical_actors_are_preserved(self):
        for value in ("usr_owner", "usr_member", "usr_bill", "usr_actor", "usr_source", "usr_client_parent", "usr_protected"):
            self.add_user(value)
        with self.sessions() as db:
            organization = Organization(name="Existing", owner_user_id="usr_owner")
            db.add(organization); db.flush()
            db.add(OrganizationMember(organization_id=organization.id, clerk_user_id="usr_member", role="member"))
            db.add(WorkspaceSubscription(workspace_id="usr_bill"))
            db.add(Organization(name="Client", owner_user_id="usr_client_parent:client:one"))
            db.add(Dataset(user_id="usr_source", workspace_id="usr_source", file_name="sales.csv", source_type="csv", file_path="sales.csv", row_count=1, column_count=1))
            db.execute(self.events.insert().values(actor_user_id="usr_actor"))
            db.commit()
        result = self.run_repair(protected_ids={"usr_protected"})
        self.assertEqual(result["users_deleted"], 0)
        self.assertEqual(len(result["unresolved"]), 7)

    def test_legacy_subject_references_are_also_preserved(self):
        self.add_user(provider="legacy", subject="legacy-owner")
        with self.sessions() as db:
            db.add(Organization(name="Legacy business", owner_user_id="legacy-owner")); db.commit()
        self.assertEqual(self.run_repair()["users_deleted"], 0)

    def test_email_addresses_are_never_invented_from_identity_subjects(self):
        self.add_user(provider="legacy", subject="unverified@example.test")
        with self.sessions() as db:
            db.add(Organization(name="Legacy", owner_user_id="usr_empty")); db.commit()
        result = self.run_repair()
        self.assertEqual(result["emails_updated"], 0)
        with self.sessions() as db:
            self.assertIsNone(db.get(AppUser, "usr_empty").email)

    def test_only_blank_internal_records_are_candidates(self):
        self.add_user("usr_known", email="known@example.test")
        self.add_user("not-internal")
        self.add_user("usr_blank", email="  ")
        result = self.run_repair()
        self.assertEqual(result["checked"], 1)
        self.assertEqual(result["users_deleted"], 1)
        self.assertEqual(self.run_repair()["checked"], 0)

    def test_batches_and_provider_calls_are_bounded_and_can_continue(self):
        for index in range(7):
            self.add_user(f"usr_{index:02}", provider="clerk", subject=f"user_{index}")
        self.lookup.side_effect = lambda subject: (True, subject + "@example.test")
        first = self.run_repair()
        self.assertEqual(first["checked"], 5)
        self.assertEqual(self.lookup.call_count, 5)
        second = self.run_repair(after=first["next_user_id"])
        self.assertEqual(second["checked"], 2)
        self.assertIsNone(second["next_user_id"])

    def test_many_aliases_cannot_starve_a_batch_or_cause_unchecked_deletion(self):
        self.add_user()
        with self.sessions() as db:
            for index in range(7):
                db.add(AuthIdentity(user_id="usr_empty", provider="clerk", subject=f"user_{index}"))
            db.commit()
        result = self.run_repair()
        self.assertEqual(self.lookup.call_count, 5)
        self.assertEqual(result["users_deleted"], 0)
        self.assertEqual(len(result["unresolved"]), 1)

    def test_unknown_authentication_provider_is_not_deleted(self):
        self.add_user(provider="other-provider")
        self.assertEqual(self.run_repair()["users_deleted"], 0)
        self.lookup.assert_not_called()

    def test_secondary_application_uses_its_own_provider_context(self):
        self.add_user(provider="application:decisionate-ai:clerk", subject="user_secondary")
        with self.sessions() as db:
            db.add(WorkspaceApplication(workspace_id="usr_empty", application_id="decisionate-ai")); db.commit()
        registration = {"id": "decisionate-ai", "name": "International", "web_url": "https://decisionate.ai",
                        "allowed_origins": ["https://decisionate.ai"], "environment_prefix": "DECISIONATE_AI_"}
        observed = []
        self.lookup.side_effect = lambda subject: (observed.append(get_application().id) or True, "verified@example.test")
        with patch.dict("os.environ", {"DECISIONATE_APPLICATIONS": json.dumps([registration])}):
            self.assertEqual(self.run_repair()["emails_updated"], 1)
        self.assertEqual(observed, ["decisionate-ai"])

    def test_admin_endpoint_requires_confirmation_and_full_access_and_audits_results(self):
        self.add_user()
        path = "/admin/users/repair-emails"
        self.assertEqual(self.client.post(path, json={"confirmation": "wrong"}).status_code, 400)
        for updates in ({"limit": 26}, {"after_user_id": "https://bad.example"}, {"unknown": True}):
            self.assertEqual(self.client.post(path, json={"confirmation": "REPAIR USERS", **updates}).status_code, 422)
        with patch.object(admin, "platform_admin_is_full_access", return_value=False):
            self.assertEqual(self.client.post(path, json={"confirmation": "REPAIR USERS"}).status_code, 403)
        response = self.client.post(path, json={"confirmation": "REPAIR USERS"})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["users_deleted"], 1)
        with self.sessions() as db:
            self.assertEqual(db.query(admin.PlatformAdminAuditEvent).one().action, "user_emails_repaired")

    def test_unknown_member_references_do_not_create_empty_accounts(self):
        with patch.object(service, "SessionLocal", self.sessions):
            with self.assertRaisesRegex(ValueError, "invitation"):
                service.resolve_user_reference("someone@example.test")
        with self.sessions() as db:
            self.assertEqual(db.query(AppUser).count(), 0)

    def test_existing_email_reference_uses_the_existing_user_without_creating_a_duplicate(self):
        self.add_user(email="member@example.test", provider="clerk", subject="user_member")
        with patch.object(service, "SessionLocal", self.sessions):
            self.assertEqual(service.resolve_user_reference(" MEMBER@example.test "), "usr_empty")
        with self.sessions() as db:
            self.assertEqual(db.query(AppUser).count(), 1)
            self.assertEqual(db.query(AuthIdentity).count(), 1)

    def test_user_list_does_not_invent_accounts_for_client_workspace_ids(self):
        self.add_user("usr_agency", email="agency@example.test")
        self.add_user("usr_client", email="client@example.test")
        with self.sessions() as db:
            db.add(Organization(name="Agency", owner_user_id="usr_agency", business_type="agency"))
            client = Organization(name="Client", owner_user_id="usr_agency:client:one", managing_agency_workspace_id="usr_agency")
            db.add(client); db.flush()
            db.add(OrganizationMember(organization_id=client.id, clerk_user_id="usr_client", role="client_owner"))
            db.add(Organization(name="Pending client", owner_user_id="usr_agency:client:pending", managing_agency_workspace_id="usr_agency"))
            db.commit()
        users = asyncio.run(admin.get_platform_admin_users(SimpleNamespace()))
        self.assertEqual({user.clerk_user_id for user in users}, {"usr_agency", "usr_client"})
        owner = next(user for user in users if user.clerk_user_id == "usr_client")
        self.assertTrue(owner.owner)
        self.assertEqual(owner.email, "client@example.test")
        self.assertEqual(owner.organization_count, 1)
        with self.sessions() as db:
            self.assertEqual(db.query(Organization).count(), 3)

    def test_configured_admin_references_do_not_create_empty_profiles_at_startup(self):
        with patch.dict("os.environ", {"DECISIONATE_PLATFORM_ADMIN_USER_IDS": "user_not_registered"}):
            admin.ensure_platform_admin_roles()
        with self.sessions() as db:
            self.assertEqual(db.query(AppUser).count(), 0)
            self.assertEqual(db.query(admin.PlatformAdminRole).count(), 0)

    def test_nonblocking_repair_lock_rejects_another_operation_without_waiting(self):
        from app.infrastructure.ingestion_jobs import lock_workspace_queue
        db = Mock()
        db.get_bind.return_value.dialect.name = "postgresql"
        db.execute.return_value.scalar.return_value = False
        with self.assertRaises(HTTPException) as failure:
            lock_workspace_queue(db, "user-email-repair", wait=False)
        self.assertEqual(failure.exception.status_code, 409)
        self.assertIn("pg_try_advisory_xact_lock", str(db.execute.call_args.args[0]))
        db.reset_mock()
        lock_workspace_queue(db, "existing-queue")
        self.assertIn("pg_advisory_xact_lock", str(db.execute.call_args.args[0]))
        db.execute.return_value.scalar.assert_not_called()


if __name__ == "__main__":
    unittest.main()
