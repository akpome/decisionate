import unittest
from datetime import timedelta
from unittest.mock import patch

from sqlalchemy import create_engine, text

from app.db.models import AgencyClientInvitation, Dataset, Organization, OrganizationMember, WorkspaceSubscription, utc_now
from app.modules.platform_admin import delete_internal_user_records
from app.modules.billing.lifecycle import get_subscription_for_workspace
from app.modules.organizations import agency_accounts, router
from app.modules.organizations.branding import get_managing_agency
from app.modules.workspace_lifecycle import require_workspace_active, workspace_is_paused
from tests import test_client_invitations as invitation_tests


class AgencyClientOwnershipTests(unittest.TestCase):
    headers = invitation_tests.ClientInvitationFlowTests.headers

    def setUp(self):
        invitation_tests.ClientInvitationFlowTests.setUp(self)
        for item in (patch.object(agency_accounts, "SessionLocal", self.Session), patch.object(agency_accounts, "send_platform_system_email")):
            value = item.start(); self.addCleanup(item.stop)
            if item.attribute == "send_platform_system_email": self.mail = value
        with self.Session() as db:
            db.add_all([
                OrganizationMember(organization_id=2, clerk_user_id="client", role="client_owner"),
                Dataset(id=21, file_name="kept.csv", file_path="manual_upload", row_count=2, column_count=1, user_id="client", workspace_id=self.workspace),
                WorkspaceSubscription(workspace_id="other", plan="agency", status="active", current_period_end=utc_now() + timedelta(days=30)),
            ]); db.commit()

    def detach(self):
        self.actor, self.email, self.verified = "agency", "agency@example.test", True
        return self.client.delete("/organizations/client-workspaces/2", headers=self.headers())

    def client_request(self, path, method="post", **kwargs):
        self.actor, self.email, self.verified = "client", "client@example.test", True
        return getattr(self.client, method)("/organizations/" + path, headers=self.headers(self.workspace), **kwargs)

    def invite(self, agency="other"):
        self.actor, self.email, self.verified = agency, agency + "@example.test", True
        response = self.client.post("/organizations/agency-invitations", headers=self.headers(), json={"email": "client@example.test"})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["id"]

    def test_agency_removal_preserves_workspace_and_revokes_all_former_agency_access(self):
        response = self.detach(); self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual((response.json()["deleted"], response.json()["removed"]), (False, True))
        with self.Session() as db:
            organization = db.get(Organization, 2)
            self.assertEqual(organization.owner_user_id, self.workspace)
            self.assertIsNotNone(db.get(Dataset, 21)); self.assertEqual(db.query(OrganizationMember).count(), 1)
            self.assertTrue(organization.is_paused); self.assertFalse(organization.agency_owner_access_enabled)
            self.assertEqual(get_subscription_for_workspace(db, self.workspace).workspace_id, self.workspace)
            self.assertIsNone(get_managing_agency(db, organization))
        listing = self.client.get("/organizations/workspaces?include_managed_client_workspaces=true", headers=self.headers())
        self.assertFalse(any(item["id"] == 2 for item in listing.json()))
        for path in ("/datasets/21", "/organizations/invites"):
            self.assertEqual(self.client.get(path, headers=self.headers(self.workspace)).status_code, 403)
        self.assertEqual(self.detach().status_code, 403)

    def test_trial_restores_full_owner_access_to_the_same_data_and_cannot_restart(self):
        self.detach()
        response = self.client_request("independent-trial")
        self.assertEqual(response.status_code, 200, response.text)
        with self.Session() as db:
            organization = db.get(Organization, 2); subscription = get_subscription_for_workspace(db, self.workspace)
            self.assertEqual((subscription.plan, subscription.status), ("professional", "trialing"))
            self.assertFalse(organization.is_paused); self.assertIsNotNone(db.get(Dataset, 21))
            end = subscription.current_period_end
        self.assertEqual(self.client_request("independent-trial").status_code, 409)
        listing = self.client_request("workspaces", "get")
        workspace = next(item for item in listing.json() if item["id"] == 2)
        self.assertEqual(workspace["role"], "owner"); self.assertFalse(workspace["is_managed_client"])
        self.assertTrue(workspace["independent_trial_started"])
        with self.Session() as db: self.assertEqual(get_subscription_for_workspace(db, self.workspace).current_period_end, end)

    def test_accepted_clients_cannot_be_paused_or_have_their_owner_removed_by_an_agency(self):
        for method, path, payload in (("patch", "/organizations/client-workspaces/2", {"is_paused": True}),
                                      ("delete", "/organizations/members/1", None),
                                      ("patch", "/organizations/members/1", {"role": "member"})):
            response = getattr(self.client, method)(path, headers=self.headers(self.workspace if "/members/" in path else None), **({"json": payload} if payload else {}))
            self.assertEqual(response.status_code, 403, response.text)
        with self.Session() as db: self.assertIsNotNone(db.get(OrganizationMember, 1))

    def test_only_the_client_owner_can_delete_the_workspace_with_its_name_confirmed(self):
        denied = self.client.request("DELETE", "/organizations/workspace", headers=self.headers(self.workspace), json={"confirmation": "Client Shop"})
        self.assertEqual(denied.status_code, 403)
        self.actor, self.email = "client", "client@example.test"
        for confirmation, code in (("wrong", 400), ("Client Shop", 200)):
            response = self.client.request("DELETE", "/organizations/workspace", headers=self.headers(self.workspace), json={"confirmation": confirmation})
            self.assertEqual(response.status_code, code, response.text)
        with self.Session() as db:
            self.assertIsNone(db.get(Organization, 2)); self.assertIsNone(db.get(Dataset, 21)); self.assertIsNotNone(db.get(Organization, 1))

    def test_new_agency_can_only_add_the_existing_workspace_after_verified_owner_approval(self):
        self.detach(); invitation = self.invite()
        self.assertEqual(self.mail.call_args.args[0], "client@example.test")
        before = self.client_request("agency-invitations", "get")
        self.assertEqual(before.json()[0]["id"], invitation)
        response = self.client_request(f"agency-invitations/{invitation}/accept")
        self.assertEqual(response.status_code, 200, response.text)
        with self.Session() as db:
            organization = db.get(Organization, 2)
            self.assertEqual(organization.managing_agency_workspace_id, "other")
            self.assertEqual(organization.owner_user_id, self.workspace)
            self.assertIsNotNone(db.get(Dataset, 21)); self.assertFalse(organization.agency_owner_access_enabled)
            self.assertEqual(get_subscription_for_workspace(db, self.workspace).workspace_id, "other")
        self.actor = "agency"
        self.assertEqual(self.client.get("/datasets/21", headers=self.headers(self.workspace)).status_code, 403)
        self.actor = "other"
        self.assertEqual(self.client.get("/datasets/21", headers=self.headers(self.workspace)).status_code, 403)
        listing = self.client.get("/organizations/workspaces?include_managed_client_workspaces=true", headers=self.headers())
        self.assertTrue(any(item["id"] == 2 for item in listing.json()))
        self.assertEqual(self.client_request(f"agency-invitations/{invitation}/accept").status_code, 409)

    def test_old_agency_can_reinvite_but_cannot_reclaim_the_workspace_without_consent(self):
        self.detach(); invitation = self.invite("agency")
        with self.Session() as db: self.assertIsNone(db.get(Organization, 2).managing_agency_workspace_id)
        self.assertEqual(self.client_request(f"agency-invitations/{invitation}/accept").status_code, 200)
        with self.Session() as db: self.assertEqual(db.get(Organization, 2).managing_agency_workspace_id, "agency")

    def test_other_users_and_unverified_addresses_cannot_accept_an_invitation(self):
        self.detach(); invitation = self.invite()
        self.actor, self.email = "agency", "client@example.test"
        response = self.client.post(f"/organizations/agency-invitations/{invitation}/accept", headers=self.headers(self.workspace))
        self.assertEqual(response.status_code, 403)
        self.actor, self.email, self.verified = "client", "wrong@example.test", True
        response = self.client.post(f"/organizations/agency-invitations/{invitation}/accept", headers=self.headers(self.workspace))
        self.assertEqual(response.status_code, 404)
        self.email, self.verified = "client@example.test", False
        with patch.object(agency_accounts, "get_auth_jwks_url", return_value=None):
            response = self.client.post(f"/organizations/agency-invitations/{invitation}/accept", headers=self.headers(self.workspace))
        self.assertEqual(response.status_code, 403)

    def test_declining_or_full_agency_capacity_preserves_independent_ownership(self):
        self.detach(); invitation = self.invite()
        with patch.object(agency_accounts, "get_client_workspace_limit", return_value=1):
            response = self.client_request(f"agency-invitations/{invitation}/accept")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(self.client_request(f"agency-invitations/{invitation}/decline").status_code, 200)
        with self.Session() as db:
            self.assertEqual(db.get(AgencyClientInvitation, invitation).status, "declined")
            self.assertIsNone(db.get(Organization, 2).managing_agency_workspace_id)

    def test_a_trial_cannot_be_reset_by_joining_and_leaving_an_agency(self):
        self.detach(); self.assertEqual(self.client_request("independent-trial").status_code, 200)
        invitation = self.invite("agency")
        self.assertEqual(self.client_request(f"agency-invitations/{invitation}/accept").status_code, 200)
        self.detach(); self.assertEqual(self.client_request("independent-trial").status_code, 409)

    def test_client_ownership_cannot_be_removed_to_restore_agency_deletion_rights(self):
        self.actor, self.email = "client", "client@example.test"
        response = self.client.delete("/organizations/members/1", headers=self.headers(self.workspace))
        self.assertEqual(response.status_code, 400)
        response = self.detach()
        self.assertFalse(response.json()["deleted"])

    def test_accepted_ownership_remains_protected_if_legacy_membership_is_missing(self):
        with self.Session() as db:
            db.get(Organization, 2).client_owner_accepted_at = utc_now()
            db.query(OrganizationMember).filter_by(organization_id=2).delete()
            db.commit()
        response = self.detach()
        self.assertEqual(response.status_code, 200, response.text)
        self.assertFalse(response.json()["deleted"])
        with self.Session() as db:
            self.assertIsNotNone(db.get(Organization, 2))
            self.assertIsNotNone(db.get(Dataset, 21))

    def test_expired_independent_trials_keep_settings_but_block_analysis(self):
        self.detach(); self.client_request("independent-trial")
        with self.Session() as db:
            get_subscription_for_workspace(db, self.workspace).current_period_end = utc_now() - timedelta(days=1)
            db.commit()
        self.assertEqual(self.client.get("/datasets/21", headers=self.headers(self.workspace)).status_code, 402)
        self.assertEqual(self.client_request("me", "get").status_code, 200)
        with self.Session() as db:
            self.assertTrue(workspace_is_paused(db, self.workspace))

    def test_paying_directly_restores_access_without_starting_the_trial(self):
        self.detach()
        with self.Session() as db:
            self.assertTrue(workspace_is_paused(db, self.workspace))
            subscription = get_subscription_for_workspace(db, self.workspace)
            subscription.status = "active"
            subscription.provider_subscription_id = "sub_independent"
            subscription.current_period_end = utc_now() + timedelta(days=30)
            db.commit()
            require_workspace_active(self.workspace, db)
            self.assertFalse(workspace_is_paused(db, self.workspace))
        listing = self.client_request("workspaces", "get")
        workspace = next(item for item in listing.json() if item["id"] == 2)
        self.assertFalse(workspace["is_paused"])
        self.assertFalse(workspace["independent_trial_started"])

    def test_deleting_an_agency_account_does_not_delete_accepted_client_workspaces(self):
        with self.Session() as db:
            db.get(Dataset, 21).user_id = "agency"
            delete_internal_user_records(db, "agency")
            db.commit()
            self.assertIsNone(db.get(Organization, 1))
            self.assertIsNotNone(db.get(Organization, 2)); self.assertIsNotNone(db.get(Dataset, 21))
            self.assertIsNotNone(db.get(Organization, 2).agency_detached_at)

    def test_an_independent_paid_subscription_must_be_canceled_before_joining_or_deleting(self):
        self.detach(); invitation = self.invite()
        with self.Session() as db:
            subscription = db.query(WorkspaceSubscription).filter_by(workspace_id=self.workspace).one()
            subscription.provider_subscription_id, subscription.status = "sub_existing", "active"
            subscription.current_period_end = utc_now() + timedelta(days=30)
            db.commit()
        self.assertEqual(self.client_request(f"agency-invitations/{invitation}/accept").status_code, 409)
        self.actor, self.email = "client", "client@example.test"
        response = self.client.request("DELETE", "/organizations/workspace", headers=self.headers(self.workspace), json={"confirmation": "Client Shop"})
        self.assertEqual(response.status_code, 409)


class AgencyOwnershipMigrationTests(unittest.TestCase):
    def test_legacy_accepted_owners_are_protected_without_restoring_removed_agencies(self):
        engine = create_engine("sqlite://")
        self.addCleanup(engine.dispose)
        with engine.begin() as connection:
            connection.execute(text("CREATE TABLE organizations (id INTEGER PRIMARY KEY, owner_user_id VARCHAR)"))
            connection.execute(text("CREATE TABLE organization_members (organization_id INTEGER, role VARCHAR)"))
            connection.execute(text("CREATE TABLE organization_invites (organization_id INTEGER, status VARCHAR, role VARCHAR)"))
            connection.execute(text("INSERT INTO organizations VALUES (1, 'agency:client:accepted'), (2, 'agency:client:pending'), (3, 'agency:client:legacy')"))
            connection.execute(text("INSERT INTO organization_members VALUES (1, 'client_owner')"))
            connection.execute(text("INSERT INTO organization_invites VALUES (2, 'pending', 'client_owner'), (3, 'accepted', 'client')"))
        with patch.object(invitation_tests.main, "engine", engine):
            invitation_tests.main.ensure_agency_relationship_columns()
            with engine.begin() as connection:
                rows = connection.execute(text("SELECT id, client_owner_accepted_at FROM organizations ORDER BY id")).all()
                self.assertIsNotNone(rows[0][1])
                self.assertIsNone(rows[1][1])
                self.assertIsNotNone(rows[2][1])
                connection.execute(text("UPDATE organizations SET agency_detached_at = '2026-11-12', independent_trial_started_at = '2026-11-12' WHERE id = 1"))
            invitation_tests.main.ensure_agency_relationship_columns()
        with engine.connect() as connection:
            row = connection.execute(text("SELECT managing_agency_workspace_id, agency_detached_at, independent_trial_started_at, client_owner_accepted_at FROM organizations WHERE id = 1")).one()
            self.assertEqual(tuple(row[:3]), (None, '2026-11-12', '2026-11-12'))
            self.assertEqual(row[3], rows[0][1])


if __name__ == "__main__": unittest.main()
