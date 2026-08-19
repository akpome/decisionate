import unittest

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.models import OrganizationInvite, OrganizationMember
from app.modules.organizations.router import claim_pending_invites


class OrganizationInviteClaimTests(unittest.TestCase):
    def test_pending_invite_creates_membership_and_is_idempotent(self):
        engine = create_engine("sqlite:///:memory:")
        OrganizationMember.__table__.create(engine)
        OrganizationInvite.__table__.create(engine)
        session = sessionmaker(bind=engine)()

        try:
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
            self.assertEqual(member.role, "client")
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


if __name__ == "__main__":
    unittest.main()
