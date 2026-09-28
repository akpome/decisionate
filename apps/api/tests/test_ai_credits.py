import unittest
from datetime import timedelta
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.models import AIUsageEvent
from app.db.models import WorkspaceSubscription
from app.db.models import utc_now
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
            estimated_tokens=1_000_000,
        )

        with self.assertRaises(credits.AICreditLimitExceeded):
            credits.reserve_ai_credits(
                workspace_id="workspace-1",
                operation="another analysis",
                estimated_tokens=1000,
            )

    def test_annual_subscription_gets_twelve_monthly_credits(self):
        subscription = WorkspaceSubscription(
            workspace_id="workspace-1",
            plan="professional",
            billing_interval="year",
            additional_client_workspaces=0,
            additional_ai_credit_packs=0,
        )

        with patch.object(
            credits,
            "get_billing_plan_definition",
            return_value={"ai_credit_limit": 5000},
        ), patch.object(
            credits,
            "get_ai_credit_allocations",
            return_value={"additional_client_workspace": 2500},
        ):
            self.assertEqual(
                credits._get_credit_limit(subscription),
                60000,
            )

    def test_annual_additional_workspace_credits_are_thirty_thousand(self):
        subscription = WorkspaceSubscription(
            workspace_id="workspace-1",
            plan="agency",
            billing_interval="year",
            additional_client_workspaces=1,
            additional_ai_credit_packs=0,
        )

        with patch.object(
            credits,
            "get_billing_plan_definition",
            return_value={"ai_credit_limit": 25000},
        ), patch.object(
            credits,
            "get_ai_credit_allocations",
            return_value={"additional_client_workspace": 2500},
        ):
            self.assertEqual(
                credits._get_credit_limit(subscription),
                330000,
            )

    def test_topup_credits_are_used_after_recurring_credits(self):
        session = self.session_factory()
        period_start = utc_now()
        session.add(
            WorkspaceSubscription(
                workspace_id="workspace-1",
                plan="professional",
                status="active",
                current_period_start=period_start,
                current_period_end=period_start + timedelta(days=30),
                ai_credit_topup_credits=3,
            )
        )
        session.commit()
        session.close()

        with patch.object(
            credits,
            "get_billing_plan_definition",
            return_value={"ai_credit_limit": 2},
        ), patch.object(
            credits,
            "get_ai_credit_allocations",
            return_value={"additional_client_workspace": 0},
        ):
            recurring_reservation = credits.reserve_ai_credits(
                workspace_id="workspace-1",
                operation="recurring analysis",
                estimated_tokens=2000,
            )
            topup_reservation = credits.reserve_ai_credits(
                workspace_id="workspace-1",
                operation="topup analysis",
                estimated_tokens=2000,
            )

        session = self.session_factory()
        try:
            subscription = session.query(WorkspaceSubscription).one()
            events = session.query(AIUsageEvent).order_by(AIUsageEvent.id).all()
            self.assertEqual(subscription.ai_credits_used, 4)
            self.assertEqual(subscription.ai_recurring_credits_used, 2)
            self.assertEqual(subscription.ai_credit_topup_credits, 1)
            self.assertEqual(events[0].topup_credits_reserved, 0)
            self.assertEqual(events[1].topup_credits_reserved, 2)
            with patch.object(
                credits,
                "get_billing_plan_definition",
                return_value={"ai_credit_limit": 2},
            ), patch.object(
                credits,
                "get_ai_credit_allocations",
                return_value={"additional_client_workspace": 0},
            ):
                self.assertEqual(
                    credits.get_ai_credit_remaining(subscription),
                    1,
                )
            self.assertNotEqual(
                recurring_reservation["id"],
                topup_reservation["id"],
            )
        finally:
            session.close()

    def test_settlement_and_release_restore_reserved_topups(self):
        session = self.session_factory()
        period_start = utc_now()
        session.add(
            WorkspaceSubscription(
                workspace_id="workspace-1",
                plan="professional",
                status="active",
                current_period_start=period_start,
                current_period_end=period_start + timedelta(days=30),
                ai_recurring_credits_used=2,
                ai_credits_used=2,
                ai_credit_topup_credits=3,
            )
        )
        session.commit()
        session.close()

        with patch.object(
            credits,
            "get_billing_plan_definition",
            return_value={"ai_credit_limit": 2},
        ), patch.object(
            credits,
            "get_ai_credit_allocations",
            return_value={"additional_client_workspace": 0},
        ):
            failed_reservation = credits.reserve_ai_credits(
                workspace_id="workspace-1",
                operation="failed analysis",
                estimated_tokens=2000,
            )

        session = self.session_factory()
        try:
            subscription = session.query(WorkspaceSubscription).one()
            self.assertEqual(subscription.ai_credit_topup_credits, 1)
        finally:
            session.close()

        credits.release_ai_credits(failed_reservation["id"])

        session = self.session_factory()
        try:
            subscription = session.query(WorkspaceSubscription).one()
            self.assertEqual(subscription.ai_credit_topup_credits, 3)
            self.assertEqual(subscription.ai_credits_used, 2)
            self.assertEqual(subscription.ai_recurring_credits_used, 2)
        finally:
            session.close()

        with patch.object(
            credits,
            "get_billing_plan_definition",
            return_value={"ai_credit_limit": 2},
        ), patch.object(
            credits,
            "get_ai_credit_allocations",
            return_value={"additional_client_workspace": 0},
        ):
            settled_reservation = credits.reserve_ai_credits(
                workspace_id="workspace-1",
                operation="settled analysis",
                estimated_tokens=2000,
            )

        credits.settle_ai_credits(
            settled_reservation["id"],
            {"total_tokens": 1000},
        )

        session = self.session_factory()
        try:
            subscription = session.query(WorkspaceSubscription).one()
            self.assertEqual(subscription.ai_credit_topup_credits, 2)
            self.assertEqual(subscription.ai_credits_used, 3)
            self.assertEqual(subscription.ai_recurring_credits_used, 2)
        finally:
            session.close()

    def test_period_rollover_resets_recurring_usage_but_keeps_topups(self):
        session = self.session_factory()
        now = utc_now()
        session.add(
            WorkspaceSubscription(
                workspace_id="workspace-1",
                plan="professional",
                status="active",
                current_period_start=now - timedelta(days=60),
                current_period_end=now - timedelta(days=30),
                ai_credits_used=4,
                ai_recurring_credits_used=4,
                ai_credit_topup_credits=7,
            )
        )
        session.commit()
        session.close()

        with patch.object(
            credits,
            "get_billing_plan_definition",
            return_value={"ai_credit_limit": 2},
        ), patch.object(
            credits,
            "get_ai_credit_allocations",
            return_value={"additional_client_workspace": 0},
        ):
            credits.reserve_ai_credits(
                workspace_id="workspace-1",
                operation="new period analysis",
                estimated_tokens=1000,
            )

        session = self.session_factory()
        try:
            subscription = session.query(WorkspaceSubscription).one()
            self.assertEqual(subscription.ai_credits_used, 1)
            self.assertEqual(subscription.ai_recurring_credits_used, 1)
            self.assertEqual(subscription.ai_credit_topup_credits, 7)
        finally:
            session.close()


if __name__ == "__main__":
    unittest.main()
