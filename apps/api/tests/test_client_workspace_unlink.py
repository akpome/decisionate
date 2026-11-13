import unittest

from app.db.models import AppUser, DataIngestionJob, Dataset, Organization, OrganizationMember, WorkspaceSubscription
from app.modules.organizations.ownership import managing_agency_workspace_id
from tests import test_agency_pause_authority as pause_tests


class ClientWorkspaceUnlinkTests(unittest.TestCase):
    headers = pause_tests.AgencyPauseAuthorityTests.headers

    def setUp(self):
        pause_tests.AgencyPauseAuthorityTests.setUp(self)

    def post(self, path):
        return self.client.post("/organizations/" + path, headers=self.headers(self.workspace))

    def test_paused_owner_can_only_unlink_until_the_agency_relationship_ends(self):
        for path in ("/datasets/21", "/organizations/me", "/organizations/preferences/dashboard", "/billing"):
            self.assertEqual(self.client.get(path, headers=self.headers(self.workspace)).status_code, 403, path)
        self.assertEqual(self.post("independent-trial").status_code, 403)
        deletion = self.client.request("DELETE", "/organizations/workspace", headers=self.headers(self.workspace), json={"confirmation": "Client Shop"})
        self.assertEqual(deletion.status_code, 403)
        response = self.post("leave-agency")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), {"removed": True, "workspace_id": self.workspace})
        with self.Session() as db:
            organization = db.get(Organization, 2)
            self.assertIsNone(managing_agency_workspace_id(organization))
            self.assertIsNotNone(organization.agency_detached_at)
            self.assertFalse(organization.agency_owner_access_enabled)
            self.assertTrue(organization.is_paused)
            self.assertIsNone(organization.independent_trial_started_at)
            self.assertIsNotNone(db.get(Dataset, 21))
            self.assertIsNotNone(db.get(AppUser, "client"))
            self.assertEqual(db.query(WorkspaceSubscription).filter_by(workspace_id="agency").one().status, "active")
        listing = self.client.get("/organizations/workspaces", headers=self.headers(self.workspace))
        workspace = next(item for item in listing.json() if item["id"] == 2)
        self.assertEqual(workspace["role"], "owner")
        self.assertTrue(workspace["agency_removed"])
        self.assertFalse(workspace["is_managed_client"])
        self.assertEqual(self.client.get("/datasets/21", headers=self.headers(self.workspace)).status_code, 402)

    def test_trial_restores_access_to_the_same_workspace_and_cannot_be_reset(self):
        self.assertEqual(self.post("leave-agency").status_code, 200)
        response = self.post("independent-trial")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["trial_days"], 30)
        self.assertEqual(response.json()["workspace_id"], self.workspace)
        self.assertEqual(self.client.get("/datasets/21", headers=self.headers(self.workspace)).status_code, 200)
        self.assertEqual(self.post("independent-trial").status_code, 409)
        with self.Session() as db:
            organization = db.get(Organization, 2)
            started = organization.independent_trial_started_at
        self.assertEqual(self.post("leave-agency").status_code, 200)
        with self.Session() as db:
            self.assertEqual(db.get(Organization, 2).independent_trial_started_at, started)
            self.assertFalse(db.get(Organization, 2).is_paused)

    def test_former_agency_loses_its_listing_data_and_resume_authority(self):
        with self.Session() as db:
            db.get(Organization, 2).agency_owner_access_enabled = True
            db.commit()
        self.assertEqual(self.post("leave-agency").status_code, 200)
        self.actor = "agency"
        listing = self.client.get("/organizations/workspaces?include_managed_client_workspaces=true", headers=self.headers())
        self.assertNotIn(2, [item["id"] for item in listing.json()])
        self.assertEqual(self.client.get("/datasets/21", headers=self.headers(self.workspace)).status_code, 403)
        status = self.client.patch("/organizations/client-workspaces/2", headers=self.headers(), json={"is_paused": False})
        self.assertEqual(status.status_code, 403)

    def test_only_the_client_owner_can_unlink_not_other_users_or_the_agency(self):
        with self.Session() as db:
            db.add(OrganizationMember(organization_id=2, clerk_user_id="viewer", role="client_user"))
            db.get(Organization, 2).agency_owner_access_enabled = True
            db.commit()
        for actor in ("viewer", "agency", "other"):
            self.actor = actor
            self.assertEqual(self.post("leave-agency").status_code, 403, actor)
        with self.Session() as db:
            self.assertEqual(managing_agency_workspace_id(db.get(Organization, 2)), "agency")
            self.assertTrue(db.get(Organization, 2).is_paused)

    def test_unlinked_owner_can_delete_but_active_linked_owner_must_unlink_first(self):
        with self.Session() as db:
            db.get(Organization, 2).is_paused = False
            db.commit()
        response = self.client.request("DELETE", "/organizations/workspace", headers=self.headers(self.workspace), json={"confirmation": "Client Shop"})
        self.assertEqual(response.status_code, 409)
        self.assertIn("Unlink", response.json()["detail"])
        self.assertEqual(self.post("leave-agency").status_code, 200)
        response = self.client.request("DELETE", "/organizations/workspace", headers=self.headers(self.workspace), json={"confirmation": "Client Shop"})
        self.assertEqual(response.status_code, 200, response.text)
        with self.Session() as db:
            self.assertIsNone(db.get(Organization, 2))
            self.assertIsNone(db.get(Dataset, 21))
            self.assertIsNotNone(db.get(Organization, 1))

    def test_running_work_blocks_unlinking_without_changing_ownership_or_data(self):
        with self.Session() as db:
            db.add(DataIngestionJob(user_id="client", workspace_id=self.workspace, job_type="file_upload", status="running", request_payload="{}"))
            db.commit()
        self.assertEqual(self.post("leave-agency").status_code, 409)
        with self.Session() as db:
            self.assertEqual(managing_agency_workspace_id(db.get(Organization, 2)), "agency")
            self.assertIsNotNone(db.get(Dataset, 21))


if __name__ == "__main__":
    unittest.main()
