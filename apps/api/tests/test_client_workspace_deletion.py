import unittest
from unittest.mock import patch

from sqlalchemy import func, select

from app.db.database import Base
from app.db.models import (
    AICreditPurchase, AppUser, AuthIdentity, CanonicalEntity, DataIngestionJob, Dataset, EntityIdentity,
    AgencyClientInvitation, Organization, OrganizationMember, UsageActivityEvent,
    UserPreference, WorkspaceSubscription, utc_now,
)
from app.modules import usage_activity
from app.modules.decisions.models import Decision, DecisionCreationRequest, DecisionDuplicate
from app.modules.marketing.models import (
    MarketingContact, MarketingConsentEvent, MarketingDatasetState, MarketingEmail,
    MarketingJob, MarketingLinkVisit, MarketingMembership, MarketingWorkspace,
)
from app.modules.platform_admin import PlatformAdminAuditEvent
from app.modules.reports.models import ReportAnalysisJob
from tests import test_agency_client_ownership as ownership_tests


class ClientWorkspaceDeletionTests(unittest.TestCase):
    headers = ownership_tests.AgencyClientOwnershipTests.headers

    def setUp(self):
        ownership_tests.AgencyClientOwnershipTests.setUp(self)
        item = patch.object(usage_activity, "SessionLocal", self.Session)
        item.start()
        self.addCleanup(item.stop)
        self.client.app.middleware("http")(usage_activity.collect_usage_activity)
        self.actor, self.email, self.verified = "client", "client@example.test", True
        with self.Session() as db:
            db.get(AppUser, "client").email = self.email
            db.get(Organization, 2).is_paused = True
            db.add(AuthIdentity(user_id="client", provider="clerk", subject="client-subject"))
            db.commit()

    def delete(self, name="Client Shop"):
        return self.client.request("DELETE", "/organizations/workspace", headers=self.headers(self.workspace), json={"confirmation": name})

    def test_paused_owner_can_delete_and_disappears_from_agency_without_recreating_activity(self):
        response = self.delete()
        self.assertEqual(response.status_code, 200, response.text)
        with self.Session() as db:
            self.assertIsNone(db.get(Organization, 2))
            self.assertIsNone(db.get(Dataset, 21))
            self.assertIsNone(db.get(AppUser, "client"))
            self.assertEqual(db.query(AuthIdentity).filter_by(user_id="client").count(), 0)
            self.assertEqual(db.query(OrganizationMember).filter_by(organization_id=2).count(), 0)
            self.assertEqual(db.query(UsageActivityEvent).filter_by(workspace_id=self.workspace).count(), 0)
            self.assertIsNotNone(db.get(Organization, 1))
            self.assertEqual(db.query(WorkspaceSubscription).filter_by(workspace_id="agency").one().status, "active")
        self.actor = "agency"
        listing = self.client.get("/organizations/workspaces?include_managed_client_workspaces=true", headers=self.headers())
        self.assertEqual(listing.status_code, 200, listing.text)
        self.assertNotIn(2, [item["id"] for item in listing.json()])

    def test_shared_accounts_and_other_workspace_data_survive(self):
        with self.Session() as db:
            db.add(OrganizationMember(organization_id=4, clerk_user_id="client", role="member"))
            other = db.get(Organization, 4).owner_user_id
            db.add(Dataset(id=22, file_name="other.csv", file_path="manual_upload", row_count=2, column_count=1, user_id="client", workspace_id=other))
            db.add(UserPreference(clerk_user_id="client", workspace_id=other, selected_dataset_id=22))
            db.commit()
        response = self.delete()
        self.assertEqual(response.status_code, 200, response.text)
        with self.Session() as db:
            self.assertIsNotNone(db.get(AppUser, "client"))
            self.assertEqual(db.query(AuthIdentity).filter_by(user_id="client", subject="client-subject").count(), 1)
            self.assertIsNotNone(db.get(Dataset, 22))
            self.assertEqual(db.query(UserPreference).filter_by(workspace_id=other).count(), 1)

    def test_owner_confirmation_and_nonowner_rejection_preserve_data(self):
        self.assertEqual(self.delete("wrong").status_code, 400)
        with self.Session() as db:
            db.add(OrganizationMember(organization_id=2, clerk_user_id="viewer", role="client_user"))
            db.commit()
        for actor in ("agency", "viewer", "other"):
            self.actor = actor
            self.assertEqual(self.delete().status_code, 403)
        with self.Session() as db:
            self.assertIsNotNone(db.get(Dataset, 21))
            self.assertTrue(db.get(Organization, 2).is_paused)

    def test_cleanup_removes_entity_decision_marketing_and_invitation_references(self):
        with self.Session() as db:
            db.add(CanonicalEntity(id=50, workspace_id=self.workspace, user_id="client", entity_type="customer", canonical_key="customer"))
            db.add(EntityIdentity(canonical_entity_id=50, workspace_id=self.workspace, user_id="client", entity_type="customer", dataset_id=21,
                source_type="csv", source_row_key="1", source_field="email", source_value="client@example.test", match_method="exact"))
            db.add(Decision(id=50, dataset_id=21, clerk_user_id="client", workspace_id=self.workspace, title="Change"))
            db.add(Decision(id=51, dataset_id=21, clerk_user_id="client", workspace_id=self.workspace, title="Duplicate"))
            db.flush()
            db.add(DecisionCreationRequest(request_key="retry-key", payload_hash="hash", decision_id=50))
            db.add(DecisionDuplicate(duplicate_id=51, canonical_id=50))
            db.add(PlatformAdminAuditEvent(admin_user_id="agency", organization_id=2, target_user_id="client", action="invite", details="client details"))
            db.add(AgencyClientInvitation(id="pending-agency", agency_workspace_id="other", email="client@example.test"))
            db.add(AICreditPurchase(provider_session_id="cs_deleted", workspace_id=self.workspace, credit_packs=1, credits=100))
            contact = MarketingContact(id=50, user_id="client", email="client@example.test", first_name="Client", primary_workspace_id=self.workspace)
            db.add(contact)
            db.add(MarketingWorkspace(workspace_id=self.workspace))
            db.add(MarketingDatasetState(dataset_id=21))
            db.add(MarketingMembership(contact_id=50, workspace_id=self.workspace, role="owner"))
            db.add(MarketingEmail(id=50, contact_id=50, workspace_id=self.workspace, sequence_instance="trial", message_type="welcome", due_at=utc_now()))
            db.add(MarketingLinkVisit(message_id=50, contact_id=50, workspace_id=self.workspace))
            db.add(MarketingJob(job_type="workspace", entity_id=self.workspace, dedupe_key="deleted-workspace"))
            db.add(MarketingJob(job_type="dataset", entity_id="21", dedupe_key="deleted-dataset"))
            db.add(MarketingConsentEvent(contact_id=50, revision=1, status="subscribed", source="settings", actor_user_id="client"))
            db.add(UserPreference(clerk_user_id="client", workspace_id=None))
            db.commit()
        response = self.delete()
        self.assertEqual(response.status_code, 200, response.text)
        with self.Session() as db:
            for model in (CanonicalEntity, EntityIdentity, Decision, DecisionCreationRequest, DecisionDuplicate,
                          PlatformAdminAuditEvent, AgencyClientInvitation, AICreditPurchase, MarketingWorkspace,
                          MarketingDatasetState, MarketingMembership, MarketingEmail, MarketingLinkVisit, UserPreference):
                self.assertEqual(db.query(model).count(), 0, model.__name__)
            self.assertEqual(db.query(MarketingJob).filter(MarketingJob.job_type.in_(["workspace", "dataset"])).count(), 0)
            contact = db.get(MarketingContact, 50)
            self.assertIsNotNone(contact.deleted_at)
            self.assertIsNone(contact.user_id)
            self.assertIsNone(contact.primary_workspace_id)
            self.assertEqual(contact.marketing_status, "unsubscribed")
            self.assertGreater(db.query(MarketingJob).filter_by(job_type="contact", entity_id="50").count(), 0)
            self.assertEqual(db.query(MarketingConsentEvent).filter_by(actor_user_id="client").count(), 0)
            for table in Base.metadata.sorted_tables:
                for column_name in ("workspace_id", "agency_workspace_id", "primary_workspace_id", "billing_workspace_id", "owner_user_id"):
                    if column_name in table.c:
                        remaining = db.scalar(select(func.count()).select_from(table).where(table.c[column_name] == self.workspace))
                        self.assertEqual(remaining, 0, f"{table.name}.{column_name}")

    def test_storage_failure_does_not_report_success_or_erase_database_records(self):
        with self.Session() as db:
            db.get(Dataset, 21).file_path = "/data/client.csv"
            db.commit()
        with patch("app.modules.platform_admin.get_object_storage") as storage:
            storage.return_value.delete.side_effect = OSError("storage unavailable")
            with self.assertRaises(OSError):
                self.delete()
        with self.Session() as db:
            self.assertIsNotNone(db.get(Dataset, 21))
            self.assertIsNotNone(db.get(Organization, 2))

    def test_paused_owner_deletion_cancels_queued_work_but_rejects_running_imports(self):
        with self.Session() as db:
            db.add(DataIngestionJob(user_id="client", workspace_id=self.workspace, job_type="file_upload", status="running", request_payload="{}"))
            db.commit()
        self.assertEqual(self.delete().status_code, 409)
        with self.Session() as db:
            db.query(DataIngestionJob).one().status = "queued"
            db.add(ReportAnalysisJob(id="queued-report", workspace_id=self.workspace, user_id="client", kind="report", request_key="queued-report", status="queued", definition="{}", sources="[]"))
            db.commit()
        response = self.delete()
        self.assertEqual(response.status_code, 200, response.text)
        with self.Session() as db:
            self.assertEqual(db.query(DataIngestionJob).count(), 0)
            self.assertEqual(db.query(ReportAnalysisJob).count(), 0)


if __name__ == "__main__":
    unittest.main()
