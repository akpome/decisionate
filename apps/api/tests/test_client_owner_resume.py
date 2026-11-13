import unittest
from datetime import timedelta
from unittest.mock import patch

from fastapi import HTTPException, Request

from app.db.models import Dataset, Organization, OrganizationMember, WorkspaceSubscription, utc_now
from app.modules.auth_context import get_auth_context
from app.modules.billing import router as billing
from tests import test_agency_client_ownership as ownership_tests


class ClientOwnerResumeTests(unittest.TestCase):
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

    def resume(self, workspace=None):
        return self.client.post("/organizations/resume-workspace", headers=self.headers(workspace or self.workspace))

    def test_status_explains_a_pause_without_unlocking_data_or_billing_management(self):
        status = self.client.get("/billing/access", headers=self.headers(self.workspace))
        self.assertEqual(status.status_code, 200, status.text)
        self.assertEqual(status.json()["status"], "paused")
        self.assertFalse(status.json()["access_allowed"])
        self.assertFalse(status.json()["requires_billing_action"])
        self.assertIn("data is preserved", status.json()["reason"])
        for path in ("/datasets/21", "/billing", "/organizations/preferences/dashboard"):
            self.assertEqual(self.client.get(path, headers=self.headers(self.workspace)).status_code, 403)
        self.assertEqual(self.client.post("/billing/access", headers=self.headers(self.workspace)).status_code, 403)
        self.assertEqual(self.client.get("/organizations/resume-workspace", headers=self.headers(self.workspace)).status_code, 403)
        with self.Session() as db:
            self.assertTrue(db.get(Organization, 2).is_paused)

    def test_owner_resume_restores_the_same_workspace_without_granting_agency_access(self):
        before = self.client.get("/datasets/21", headers=self.headers(self.workspace))
        self.assertEqual(before.status_code, 403)
        for _ in range(2):
            resumed = self.resume()
            self.assertEqual(resumed.status_code, 200, resumed.text)
            self.assertEqual(resumed.json()["workspace_id"], self.workspace)
        self.assertEqual(self.client.get("/datasets/21", headers=self.headers(self.workspace)).json(), {"id": 21})
        with self.Session() as db:
            organization = db.get(Organization, 2)
            self.assertFalse(organization.is_paused)
            self.assertFalse(organization.agency_owner_access_enabled)
            self.assertIsNone(organization.independent_trial_started_at)
            self.assertEqual(db.query(OrganizationMember).count(), 1)
            self.assertEqual(db.get(Dataset, 21).workspace_id, self.workspace)
            self.assertEqual(db.query(WorkspaceSubscription).filter_by(workspace_id="agency").one().status, "active")
        status = self.client.get("/billing/access", headers=self.headers(self.workspace))
        self.assertTrue(status.json()["access_allowed"])
        self.assertEqual(status.json()["status"], "active")

    def test_client_users_can_read_status_but_cannot_resume_the_owners_workspace(self):
        with self.Session() as db:
            db.add(OrganizationMember(organization_id=2, clerk_user_id="client-user", role="client_user"))
            db.commit()
        self.actor = "client-user"
        self.assertEqual(self.client.get("/billing/access", headers=self.headers(self.workspace)).status_code, 200)
        self.assertEqual(self.resume().status_code, 403)
        with self.Session() as db:
            self.assertTrue(db.get(Organization, 2).is_paused)

    def test_legacy_client_owner_roles_can_resume_without_an_agency_data_grant(self):
        with self.Session() as db:
            db.query(OrganizationMember).filter_by(organization_id=2, clerk_user_id="client").one().role = "client"
            db.commit()
        response = self.resume()
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.client.get("/datasets/21", headers=self.headers(self.workspace)).status_code, 200)

    def test_agencies_and_unrelated_accounts_cannot_resume_client_owned_workspaces(self):
        for grant in (False, True):
            with self.Session() as db:
                db.get(Organization, 2).agency_owner_access_enabled = grant
                db.commit()
            for actor in ("agency", "other", "stranger"):
                self.actor = actor
                self.assertEqual(self.resume().status_code, 403)
            with self.Session() as db:
                self.assertTrue(db.get(Organization, 2).is_paused)

    def test_status_still_requires_membership_or_explicit_agency_data_access(self):
        for actor in ("agency", "other", "stranger"):
            self.actor = actor
            self.assertEqual(self.client.get("/billing/access", headers=self.headers(self.workspace)).status_code, 403)
        with self.Session() as db:
            self.assertTrue(db.get(Organization, 2).is_paused)

    def test_resume_cannot_bypass_an_expired_or_missing_agency_subscription(self):
        for missing in (False, True):
            with self.Session() as db:
                subscription = db.query(WorkspaceSubscription).filter_by(workspace_id="agency").one()
                if missing:
                    db.delete(subscription)
                else:
                    subscription.status = "canceled"
                    subscription.current_period_end = utc_now() - timedelta(days=30)
                db.commit()
            response = self.resume()
            self.assertEqual(response.status_code, 402, response.text)
            with self.Session() as db:
                self.assertTrue(db.get(Organization, 2).is_paused)

    def test_detached_owners_must_choose_their_own_trial_or_plan_not_resume_agency_access(self):
        self.actor = "agency"
        removed = self.client.delete("/organizations/client-workspaces/2", headers=self.headers())
        self.assertEqual(removed.status_code, 200, removed.text)
        self.actor = "client"
        self.assertEqual(self.resume().status_code, 409)
        status = self.client.get("/billing/access", headers=self.headers(self.workspace))
        self.assertEqual(status.status_code, 200)
        self.assertFalse(status.json()["access_allowed"])
        self.assertNotEqual(status.json()["status"], "paused")
        with self.Session() as db:
            self.assertTrue(db.get(Organization, 2).is_paused)
            self.assertIsNone(db.get(Organization, 2).independent_trial_started_at)

    def test_a_non_agency_plan_does_not_restore_agency_funding(self):
        with self.Session() as db:
            db.query(WorkspaceSubscription).filter_by(workspace_id="agency").one().plan = "professional"
            db.commit()
        self.assertEqual(self.resume().status_code, 402)
        with self.Session() as db:
            self.assertTrue(db.get(Organization, 2).is_paused)

    def test_a_business_owner_cannot_use_client_resume_for_an_unrelated_workspace(self):
        self.actor = "agency"
        self.assertEqual(self.resume("agency").status_code, 409)
        self.assertEqual(self.resume("other:client:one").status_code, 403)


if __name__ == "__main__":
    unittest.main()
