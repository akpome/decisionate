import unittest
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.models import AIUsageEvent
from app.db.models import WorkspaceSubscription
from app.modules.ai import credits


class AICreditTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        WorkspaceSubscription.__table__.create(self.engine)
        AIUsageEvent.__table__.create(self.engine)
        self.session_factory = sessionmaker(bind=self.engine)
        self.session_patch = patch.object(
            credits,
            "SessionLocal",
            self.session_factory,
        )
        self.session_patch.start()

    def tearDown(self):
        self.session_patch.stop()
        self.engine.dispose()

    def test_credits_round_up_to_one_thousand_tokens(self):
        self.assertEqual(credits.credits_for_tokens(0), 1)
        self.assertEqual(credits.credits_for_tokens(1000), 1)
        self.assertEqual(credits.credits_for_tokens(1001), 2)

    def test_reservation_reconciles_to_actual_usage(self):
        reservation = credits.reserve_ai_credits(
            workspace_id="workspace-1",
            operation="dataset analysis",
            estimated_tokens=4000,
        )

        credits.settle_ai_credits(
            reservation["id"],
            {
                "prompt_tokens": 400,
                "completion_tokens": 100,
                "total_tokens": 500,
            },
        )

        session = self.session_factory()
        try:
            subscription = session.query(WorkspaceSubscription).one()
            event = session.query(AIUsageEvent).one()
            self.assertEqual(subscription.ai_credits_used, 1)
            self.assertEqual(event.status, "completed")
            self.assertEqual(event.credits, 1)
            self.assertEqual(event.total_tokens, 500)
        finally:
            session.close()

    def test_reservation_rejects_usage_over_trial_limit(self):
        credits.reserve_ai_credits(
            workspace_id="workspace-1",
            operation="large analysis",
            estimated_tokens=5_000_000,
        )

        with self.assertRaises(credits.AICreditLimitExceeded):
            credits.reserve_ai_credits(
                workspace_id="workspace-1",
                operation="another analysis",
                estimated_tokens=1000,
            )


if __name__ == "__main__":
    unittest.main()
