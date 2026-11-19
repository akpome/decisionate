import unittest
from unittest.mock import patch

from app.db.models import AppUser, Dataset, Organization, OrganizationMember, UserPreference, WorkspaceSubscription, utc_now
from tests import test_agency_client_ownership as ownership_tests


class OwnedWorkspaceDeletionTests(unittest.TestCase):
    headers = ownership_tests.AgencyClientOwnershipTests.headers

    def setUp(self):
        ownership_tests.AgencyClientOwnershipTests.setUp(self)
        self.actor, self.email, self.verified = "agency", "agency@example.test", True
        with self.Session() as db:
            db.add(Dataset(id=10, file_name="owner.csv", file_path="manual_upload", row_count=2,
                           column_count=1, user_id="agency", workspace_id="agency"))
            db.commit()

    def detach_clients(self, plan="professional", status="trialing", provider_id=None):
        with self.Session() as db:
            db.get(Organization, 2).agency_detached_at = utc_now()
            subscription = db.query(WorkspaceSubscription).filter_by(workspace_id="agency").one()
            subscription.plan, subscription.status, subscription.provider_subscription_id = plan, status, provider_id
            db.commit()

    def delete(self, confirmation="North Star Agency"):
        return self.client.request("DELETE", "/organizations/workspace", headers=self.headers("agency"), json={"confirmation": confirmation})

    def test_professional_owner_can_delete_only_their_workspace_after_name_confirmation(self):
        self.detach_clients()
        self.assertEqual(self.delete("wrong").status_code, 400)
        response = self.delete()
        self.assertEqual(response.status_code, 200, response.text)
        with self.Session() as db:
            self.assertIsNone(db.get(Organization, 1))
            self.assertIsNone(db.get(Dataset, 10))
            self.assertIsNotNone(db.get(Organization, 2))
            self.assertIsNotNone(db.get(Dataset, 21))
            self.assertIsNotNone(db.get(Organization, 3))

    def test_agency_owner_must_remove_clients_before_deleting_agency(self):
        response = self.delete()
        self.assertEqual(response.status_code, 409, response.text)
        self.assertIn("Remove or unlink client workspaces", response.json()["detail"])
        with self.Session() as db:
            for identity in (1, 2):
                self.assertIsNotNone(db.get(Organization, identity))
            for identity in (10, 21):
                self.assertIsNotNone(db.get(Dataset, identity))
        removal = self.client.delete("/organizations/client-workspaces/2", headers=self.headers())
        self.assertEqual(removal.status_code, 200, removal.text)
        self.assertTrue(removal.json()["removed"])
        self.assertEqual(self.delete().status_code, 200)
        with self.Session() as db:
            self.assertIsNotNone(db.get(Organization, 2))
            self.assertIsNotNone(db.get(Dataset, 21))

    def test_active_provider_subscription_must_be_cancelled_first(self):
        self.detach_clients(plan="agency_subdomain", status="active", provider_id="sub_example")
        response = self.delete()
        self.assertEqual(response.status_code, 409, response.text)
        self.assertIn("Cancel the workspace subscription", response.json()["detail"])
        with self.Session() as db:
            self.assertIsNotNone(db.get(Dataset, 10))
            db.query(WorkspaceSubscription).filter_by(workspace_id="agency").one().status = "canceled"
            db.commit()
        self.assertEqual(self.delete().status_code, 200)

    def test_other_users_and_assigned_owner_members_cannot_delete_primary_owners_workspace(self):
        self.detach_clients()
        with self.Session() as db:
            db.add(OrganizationMember(organization_id=1, clerk_user_id="client", role="owner"))
            db.commit()
        for actor in ("client", "other"):
            self.actor = actor
            response = self.delete()
            self.assertEqual(response.status_code, 403, response.text)
        with self.Session() as db:
            self.assertIsNotNone(db.get(Organization, 1))
            self.assertIsNotNone(db.get(Dataset, 10))

    def test_active_work_blocks_deletion_without_losing_workspace(self):
        from fastapi import HTTPException
        self.detach_clients()
        with patch("app.modules.organizations.router.ensure_client_workspace_idle", side_effect=HTTPException(409, "An analysis is active.")):
            self.assertEqual(self.delete().status_code, 409)
        with self.Session() as db:
            self.assertIsNotNone(db.get(Organization, 1))
            self.assertIsNotNone(db.get(Dataset, 10))

    def test_owner_account_and_preferences_in_another_workspace_are_preserved(self):
        self.detach_clients()
        with self.Session() as db:
            db.add(OrganizationMember(organization_id=3, clerk_user_id="agency", role="member"))
            db.add(Dataset(id=22, file_name="other.csv", file_path="manual_upload", row_count=2,
                           column_count=1, user_id="agency", workspace_id="other"))
            db.add_all([
                UserPreference(clerk_user_id="agency", workspace_id="agency", selected_dataset_id=10),
                UserPreference(clerk_user_id="agency", workspace_id="other", selected_dataset_id=22),
            ])
            db.commit()
        response = self.delete()
        self.assertEqual(response.status_code, 200, response.text)
        with self.Session() as db:
            self.assertIsNotNone(db.get(AppUser, "agency"))
            self.assertIsNotNone(db.get(Dataset, 22))
            self.assertEqual(db.query(OrganizationMember).filter_by(organization_id=3, clerk_user_id="agency").count(), 1)
            self.assertEqual(db.query(UserPreference).filter_by(workspace_id="agency").count(), 0)
            self.assertEqual(db.query(UserPreference).filter_by(workspace_id="other", clerk_user_id="agency").one().selected_dataset_id, 22)
