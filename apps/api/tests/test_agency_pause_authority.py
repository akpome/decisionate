import unittest
from unittest.mock import patch

from fastapi import HTTPException, Request

from app.db.models import DataIngestionJob, Dataset, Organization, OrganizationMember, WorkspaceSubscription
from app.modules.auth_context import get_auth_context
from app.modules.billing import router as billing
from tests import test_agency_client_ownership as ownership_tests


class AgencyPauseAuthorityTests(unittest.TestCase):
    headers = ownership_tests.AgencyClientOwnershipTests.headers

    def setUp(self):
        ownership_tests.AgencyClientOwnershipTests.setUp(self)
        for item in (
            patch.object(billing, "SessionLocal", self.Session),
            patch.object(billing, "reconcile_subscription_if_needed"),
        ):
            item.start()
            self.addCleanup(item.stop)
        self.client.app.include_router(billing.router, prefix="/billing")

        @self.client.app.get("/datasets/21")
        def data(request: Request):
            auth = get_auth_context(request)
            with self.Session() as db:
                dataset = db.get(Dataset, 21)
                if dataset.workspace_id != auth.workspace_id:
                    raise HTTPException(403, "Workspace access denied")
                return {"id": dataset.id}

        with self.Session() as db:
            db.get(Organization, 2).is_paused = True
            db.commit()
        self.actor, self.email, self.verified = "client", "client@example.test", True

    def agency_status(self, paused, agency="agency"):
        self.actor = agency
        return self.client.patch("/organizations/client-workspaces/2", headers=self.headers(), json={"is_paused": paused})

    def test_status_explains_the_pause_without_unlocking_data_or_billing_management(self):
        status = self.client.get("/billing/access", headers=self.headers(self.workspace))
        self.assertEqual(status.status_code, 200, status.text)
        self.assertEqual(status.json()["status"], "paused")
        self.assertFalse(status.json()["access_allowed"])
        self.assertFalse(status.json()["requires_billing_action"])
        for path in ("/datasets/21", "/billing", "/organizations/preferences/dashboard"):
            self.assertEqual(self.client.get(path, headers=self.headers(self.workspace)).status_code, 403)
        with self.Session() as db:
            self.assertTrue(db.get(Organization, 2).is_paused)

    def test_the_managing_agency_can_resume_and_pause_an_accepted_client(self):
        for paused in (False, False, True, False):
            response = self.agency_status(paused)
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()["is_paused"], paused)
            self.assertTrue(response.json()["client_owner_accepted"])
            self.assertTrue(response.json()["is_managed_client"])
            self.actor = "client"
            status = self.client.get("/billing/access", headers=self.headers(self.workspace))
            self.assertEqual(status.status_code, 200, status.text)
            self.assertEqual(status.json()["access_allowed"], not paused)
            self.assertEqual(self.client.get("/datasets/21", headers=self.headers(self.workspace)).status_code, 403 if paused else 200)
        with self.Session() as db:
            organization = db.get(Organization, 2)
            self.assertFalse(organization.agency_owner_access_enabled)
            self.assertIsNone(organization.independent_trial_started_at)
            self.assertEqual(db.query(OrganizationMember).count(), 1)
            self.assertEqual(db.get(Dataset, 21).workspace_id, self.workspace)
            self.assertEqual(db.query(WorkspaceSubscription).filter_by(workspace_id="agency").one().status, "active")

    def test_client_owners_and_users_cannot_override_the_agencys_pause(self):
        with self.Session() as db:
            db.add(OrganizationMember(organization_id=2, clerk_user_id="client-user", role="client_user"))
            db.commit()
        for role in ("client_owner", "client"):
            with self.Session() as db:
                db.query(OrganizationMember).filter_by(organization_id=2, clerk_user_id="client").one().role = role
                db.commit()
            for actor in ("client", "client-user"):
                self.actor = actor
                response = self.client.patch("/organizations/client-workspaces/2", headers=self.headers(self.workspace), json={"is_paused": False})
                self.assertEqual(response.status_code, 403)
                for path in ("/organizations/resume-workspace", "/organizations/independent-trial"):
                    response = self.client.post(path, headers=self.headers(self.workspace))
                    self.assertEqual(response.status_code, 403, response.text)
                with self.Session() as db:
                    self.assertTrue(db.get(Organization, 2).is_paused)
                    self.assertIsNone(db.get(Organization, 2).independent_trial_started_at)

    def test_the_removed_client_resume_endpoint_cannot_be_used_from_an_old_browser(self):
        self.assertEqual(self.agency_status(False).status_code, 200)
        self.actor = "client"
        response = self.client.post("/organizations/resume-workspace", headers=self.headers(self.workspace))
        self.assertEqual(response.status_code, 404)

    def test_agency_staff_and_other_agencies_cannot_change_a_clients_status(self):
        with self.Session() as db:
            db.add(OrganizationMember(organization_id=1, clerk_user_id="staff", role="member"))
            db.commit()
        for actor, workspace, expected in (("staff", "agency", 403), ("other", "other", 403), ("stranger", "stranger", 404)):
            self.actor = actor
            for paused in (False, True):
                response = self.client.patch("/organizations/client-workspaces/2", headers=self.headers(workspace), json={"is_paused": paused})
                self.assertEqual(response.status_code, expected, response.text)
        with self.Session() as db:
            self.assertTrue(db.get(Organization, 2).is_paused)

    def test_removal_preserves_the_independent_trial_option_but_ends_agency_control(self):
        response = ownership_tests.AgencyClientOwnershipTests.detach(self)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.json()["removed"])
        self.assertFalse(response.json()["deleted"])
        self.assertEqual(self.agency_status(False).status_code, 403)
        self.actor = "client"
        response = self.client.post("/organizations/independent-trial", headers=self.headers(self.workspace))
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.client.get("/datasets/21", headers=self.headers(self.workspace)).status_code, 200)
        with self.Session() as db:
            self.assertIsNotNone(db.get(Dataset, 21))

    def test_only_the_current_agency_controls_pause_after_owner_approved_reattachment(self):
        self.assertEqual(ownership_tests.AgencyClientOwnershipTests.detach(self).status_code, 200)
        invitation = ownership_tests.AgencyClientOwnershipTests.invite(self)
        self.actor, self.email = "client", "client@example.test"
        response = self.client.post(f"/organizations/agency-invitations/{invitation}/accept", headers=self.headers(self.workspace))
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.agency_status(True).status_code, 403)
        self.assertEqual(self.agency_status(True, "other").status_code, 200)
        self.assertEqual(self.agency_status(False).status_code, 403)
        self.assertEqual(self.agency_status(False, "other").status_code, 200)

    def test_import_safety_checks_still_protect_an_accepted_client_when_pausing(self):
        self.assertEqual(self.agency_status(False).status_code, 200)
        with self.Session() as db:
            db.add(DataIngestionJob(user_id="client", workspace_id=self.workspace, job_type="file_upload", status="queued", request_payload="{}"))
            db.commit()
        self.assertEqual(self.agency_status(True).status_code, 409)
        with self.Session() as db:
            self.assertFalse(db.get(Organization, 2).is_paused)
            self.assertIsNotNone(db.get(Dataset, 21))


if __name__ == "__main__":
    unittest.main()
