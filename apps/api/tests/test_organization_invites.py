import os
import unittest
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from types import SimpleNamespace
from unittest.mock import Mock, patch
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.db.models import AppUser, AuthIdentity, Organization, OrganizationInvite, OrganizationMember, WorkspaceApplication
from app.modules.auth_context import AuthContext
from app.modules.organizations import router
from app.modules.organizations.router import (
    canonical_client_workspace_role,
    claim_pending_invites,
    get_managed_organization_or_404,
    validate_client_workspace_role_capacity,
)
from app.modules.organizations.schemas import OrganizationInviteCreate


INVITATION_TABLES = (Organization, OrganizationMember, OrganizationInvite, WorkspaceApplication, AppUser, AuthIdentity)


class OrganizationInviteClaimTests(unittest.TestCase):
    def test_managed_client_invites_accept_external_agency_owner_identity(self):
        organization = SimpleNamespace(
            id=42,
            owner_user_id="external-owner:client:workspace-1",
        )
        query = Mock()
        query.filter.return_value.first.return_value = organization
        query.filter.return_value.order_by.return_value.first.return_value = None
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
        WorkspaceApplication.__table__.create(engine)
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
                email_verified=True,
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
                    email_verified=True,
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
        WorkspaceApplication.__table__.create(engine)
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

    def test_legacy_duplicate_pending_recipients_cannot_both_accept_access(self):
        engine = create_engine("sqlite://")
        self.addCleanup(engine.dispose)
        for model in INVITATION_TABLES:
            model.__table__.create(engine)
        with sessionmaker(bind=engine)() as db:
            db.add(Organization(id=1, owner_user_id="owner", name="Client", managing_agency_workspace_id="agency"))
            db.add_all([
                OrganizationInvite(organization_id=1, email="first@example.test", role="member", status="pending"),
                OrganizationInvite(organization_id=1, email="second@example.test", role="client_user", status="pending"),
            ])
            db.commit()
            self.assertEqual(claim_pending_invites(db, "first", "first@example.test", email_verified=True), 1)
            db.commit()
            self.assertEqual(claim_pending_invites(db, "second", "second@example.test", email_verified=True), 0)
            self.assertEqual(db.query(OrganizationMember).one().clerk_user_id, "first")
            self.assertEqual(db.query(OrganizationInvite).filter_by(email="second@example.test").one().status, "pending")


@unittest.skipUnless(os.getenv("DECISIONATE_TEST_POSTGRES_URL"), "An isolated PostgreSQL test database is required")
class ConcurrentClientInvitationTests(unittest.TestCase):
    def concurrent_invites(self, workspaces, invitations):
        url = os.environ["DECISIONATE_TEST_POSTGRES_URL"]
        admin = create_engine(url)
        schema = "client_invitations_" + uuid4().hex
        with admin.begin() as connection:
            connection.execute(text(f"CREATE SCHEMA {schema}"))

        def remove_schema():
            with admin.begin() as connection:
                connection.execute(text(f"DROP SCHEMA {schema} CASCADE"))
            admin.dispose()

        self.addCleanup(remove_schema)
        engine = create_engine(url, connect_args={"options": f"-csearch_path={schema} -clock_timeout=5000"})
        self.addCleanup(engine.dispose)
        for model in INVITATION_TABLES:
            model.__table__.create(engine)
        sessions = sessionmaker(bind=engine)
        with sessions() as db:
            db.add_all(workspaces)
            db.commit()

        start = Barrier(2, timeout=5)

        def invite(job):
            workspace_id, email, role = job
            start.wait()
            try:
                router.add_organization_invite(workspace_id, OrganizationInviteCreate(email=email, role=role))
            except HTTPException as error:
                return error.status_code
            return 200

        with patch.object(router, "SessionLocal", sessions), patch.object(
            router, "get_auth_context", side_effect=lambda workspace_id, **kwargs: AuthContext(workspace_id, workspace_id)
        ), patch.object(router, "send_invitation_email") as send, ThreadPoolExecutor(max_workers=2) as workers:
            self.assertEqual(sorted(workers.map(invite, invitations)), [200, 409])
            send.assert_called_once()
        with sessions() as db:
            self.assertEqual(db.query(OrganizationInvite).filter_by(status="pending").count(), 1)

    def test_different_emails_cannot_reserve_the_same_collaborator_slot(self):
        self.concurrent_invites(
            [Organization(id=1, owner_user_id="client", name="Client", managing_agency_workspace_id="agency")],
            [("client", email, "client_user") for email in ["first@example.test", "second@example.test"]],
        )

    def test_same_email_cannot_be_reserved_by_two_workspaces(self):
        self.concurrent_invites(
            [Organization(owner_user_id=workspace, name=workspace) for workspace in ["first", "second"]],
            [("first", "same@example.test", "member"), ("second", " SAME@example.test ", "member")],
        )


if __name__ == "__main__":
    unittest.main()
