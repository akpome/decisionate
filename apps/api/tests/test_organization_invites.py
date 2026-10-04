import unittest
from types import SimpleNamespace
from unittest.mock import Mock

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.models import Organization, OrganizationInvite, OrganizationMember
from app.modules.auth_context import AuthContext
from app.modules.organizations.router import (
    canonical_client_workspace_role,
    claim_pending_invites,
    get_managed_organization_or_404,
    validate_client_workspace_role_capacity,
)


class OrganizationInviteClaimTests(unittest.TestCase):
    def test_managed_client_invites_accept_external_agency_owner_identity(self):
        organization = SimpleNamespace(
            owner_user_id="external-owner:client:workspace-1",
        )
        query = Mock()
        query.filter.return_value.first.return_value = organization
        db = Mock()
        db.query.return_value = query
        auth_context = AuthContext(
            user_id="usr_internal_owner",
            external_user_id="external-owner",
            workspace_id=organization.owner_user_id,
            workspace_role="owner",
        )

        self.assertIs(
            get_managed_organization_or_404(
                db,
                auth_context,
            ),
            organization,
        )

    def test_pending_invite_creates_membership_and_is_idempotent(self):
        engine = create_engine("sqlite:///:memory:")
        Organization.__table__.create(engine)
        OrganizationMember.__table__.create(engine)
        OrganizationInvite.__table__.create(engine)
        session = sessionmaker(bind=engine)()

        try:
            session.add(
                Organization(
                    id=42,
                    name="Client workspace",
                    owner_user_id="agency-1:client:workspace-1",
                )
            )
            session.add(
                OrganizationInvite(
                    organization_id=42,
                    email="invitee@example.com",
                    role="client",
                    status="pending",
                )
            )
            session.commit()

            claimed_count = claim_pending_invites(
                session,
                "user-42",
                " Invitee@Example.com ",
            )
            session.commit()

            invite = session.query(OrganizationInvite).one()
            member = session.query(OrganizationMember).one()

            self.assertEqual(claimed_count, 1)
            self.assertEqual(invite.status, "accepted")
            self.assertEqual(member.organization_id, 42)
            self.assertEqual(member.clerk_user_id, "user-42")
            self.assertEqual(member.role, "client_owner")
            self.assertEqual(
                claim_pending_invites(
                    session,
                    "user-42",
                    "invitee@example.com",
                ),
                0,
            )
        finally:
            session.close()
            engine.dispose()

    def test_client_role_capacity_counts_members_and_pending_invites(self):
        engine = create_engine("sqlite:///:memory:")
        Organization.__table__.create(engine)
        OrganizationMember.__table__.create(engine)
        OrganizationInvite.__table__.create(engine)
        session = sessionmaker(bind=engine)()

        try:
            organization = Organization(
                name="Client workspace",
                owner_user_id="agency-1:client:workspace-1",
            )
            session.add(organization)
            session.flush()
            session.add(
                OrganizationMember(
                    organization_id=organization.id,
                    clerk_user_id="client-owner",
                    role="client_owner",
                )
            )
            session.add(
                OrganizationInvite(
                    organization_id=organization.id,
                    email="client-user@example.com",
                    role="client_user",
                    status="pending",
                )
            )
            session.commit()

            with self.assertRaisesRegex(
                Exception,
                "only one client owner",
            ):
                validate_client_workspace_role_capacity(
                    session,
                    organization,
                    "client_owner",
                )

            with self.assertRaisesRegex(
                Exception,
                "only one client user",
            ):
                validate_client_workspace_role_capacity(
                    session,
                    organization,
                    "client_user",
                )

            self.assertEqual(
                canonical_client_workspace_role(organization, "client"),
                "client_owner",
            )
        finally:
            session.close()
            engine.dispose()


if __name__ == "__main__":
    unittest.main()
