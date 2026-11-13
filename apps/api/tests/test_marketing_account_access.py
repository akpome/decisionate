import unittest
from unittest.mock import patch

from fastapi import HTTPException

from app import main
from app.db.models import AppUser, Dataset, Organization, OrganizationMember, WorkspaceSubscription
from app.modules import auth_context
from app.modules.billing.lifecycle import is_subscription_exempt_path
from app.modules.marketing import config, router
from app.modules.marketing.models import MarketingContact
from tests import test_agency_pause_authority as pause_tests


class MarketingAccountAccessTests(unittest.TestCase):
    headers = pause_tests.AgencyPauseAuthorityTests.headers

    def setUp(self):
        pause_tests.AgencyPauseAuthorityTests.setUp(self)
        for item in (
            patch.object(router, "SessionLocal", self.Session),
            patch.object(config, "SessionLocal", self.Session),
            patch.object(main, "is_subscription_exempt_path", side_effect=is_subscription_exempt_path),
        ):
            item.start()
            self.addCleanup(item.stop)
        self.client.app.include_router(router.router)

    def preferences(self, *, method="GET", workspace=None, **kwargs):
        return self.client.request(method, "/marketing/preferences", headers=self.headers(workspace or self.workspace), **kwargs)

    def assert_personal_preferences_available(self):
        response = self.preferences()
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["email"], "client@example.test")
        response = self.preferences(method="PUT", json={"subscribed": False})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["marketing_status"], "unsubscribed")

    def test_unlinked_owner_can_read_and_withdraw_preferences_without_starting_a_trial(self):
        response = self.client.post("/organizations/leave-agency", headers=self.headers(self.workspace))
        self.assertEqual(response.status_code, 200, response.text)
        self.assert_personal_preferences_available()
        self.assertEqual(self.client.get("/datasets/21", headers=self.headers(self.workspace)).status_code, 402)
        self.assertEqual(self.client.post("/marketing/activity", headers=self.headers(self.workspace)).status_code, 402)
        with self.Session() as db:
            organization = db.get(Organization, 2)
            self.assertTrue(organization.is_paused)
            self.assertIsNone(organization.independent_trial_started_at)
            self.assertIsNotNone(db.get(Dataset, 21))
            self.assertEqual(db.query(WorkspaceSubscription).filter_by(workspace_id=self.workspace).one().status, "inactive")

    def test_agency_paused_owner_can_manage_personal_preferences_without_unlocking_workspace(self):
        self.assert_personal_preferences_available()
        self.assertEqual(self.client.get("/datasets/21", headers=self.headers(self.workspace)).status_code, 403)
        self.assertEqual(self.client.post("/marketing/activity", headers=self.headers(self.workspace)).status_code, 403)
        self.assertEqual(self.client.get("/marketing/admin", headers=self.headers(self.workspace)).status_code, 403)
        with self.Session() as db:
            self.assertTrue(db.get(Organization, 2).is_paused)

    def test_client_users_can_change_only_their_own_preferences(self):
        self.assertEqual(self.preferences().status_code, 200)
        with self.Session() as db:
            db.add(AppUser(id="viewer", email="viewer@example.test"))
            db.add(OrganizationMember(organization_id=2, clerk_user_id="viewer", role="client_user"))
            db.commit()
        self.actor, self.email = "viewer", "viewer@example.test"
        response = self.preferences(method="PUT", json={"subscribed": False, "user_id": "client"})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["email"], "viewer@example.test")
        with self.Session() as db:
            self.assertEqual(db.query(MarketingContact).filter_by(user_id="viewer").one().marketing_status, "unsubscribed")
            self.assertEqual(db.query(MarketingContact).filter_by(user_id="client").one().marketing_status, "unknown")
            self.assertTrue(db.get(Organization, 2).is_paused)

    def test_preferences_still_require_authentication_and_workspace_membership(self):
        for method in ("GET", "PUT"):
            with patch.object(auth_context, "get_verified_user_identity", side_effect=HTTPException(401, "Missing authorization")):
                self.assertEqual(self.preferences(method=method, json={"subscribed": False}).status_code, 401)
            self.actor, self.email = "other", "other@example.test"
            self.assertEqual(self.preferences(method=method, json={"subscribed": False}).status_code, 403)
        with self.Session() as db:
            self.assertEqual(db.query(MarketingContact).count(), 0)

    def test_account_preference_exemption_does_not_cover_other_methods_or_routes(self):
        for method in ("POST", "PATCH", "DELETE"):
            self.assertEqual(self.preferences(method=method, json={"subscribed": False}).status_code, 403)
        for path in ("/marketing/preferences/other", "/marketing/preferences-admin", "/marketing/admin/contacts"):
            self.assertEqual(self.client.get(path, headers=self.headers(self.workspace)).status_code, 403)


if __name__ == "__main__":
    unittest.main()
