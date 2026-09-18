import unittest
from datetime import timedelta
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.models import AIUsageEvent
from app.db.models import WorkspaceSubscription
from app.db.models import utc_now
from app.modules.ai import credits
from app.modules.billing import service as billing_service
from app.modules.billing.router import apply_stripe_billing_event


class AICreditPoolingTests(unittest.TestCase):
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

    def test_client_workspaces_share_the_agency_subscription_pool(self):
        session = self.session_factory()
        period_start = utc_now()
        session.add(
            WorkspaceSubscription(
                workspace_id="agency-1",
                plan="agency",
                status="active",
                current_period_start=period_start,
                current_period_end=period_start + timedelta(days=30),
            )
        )
        session.commit()
        session.close()

        first = credits.reserve_ai_credits(
            workspace_id="agency-1:client:first",
            operation="client analysis",
            estimated_tokens=1000,
        )
        second = credits.reserve_ai_credits(
            workspace_id="agency-1:client:second",
            operation="client analysis",
            estimated_tokens=2000,
        )

        session = self.session_factory()
        try:
            subscription = session.query(WorkspaceSubscription).one()
            events = session.query(AIUsageEvent).order_by(AIUsageEvent.id).all()
            self.assertEqual(subscription.workspace_id, "agency-1")
            self.assertEqual(subscription.ai_credits_used, 3)
            self.assertEqual(
                [event.workspace_id for event in events],
                ["agency-1:client:first", "agency-1:client:second"],
            )
            self.assertNotEqual(first["id"], second["id"])
        finally:
            session.close()

    def test_low_balance_notice_is_sent_once_per_period(self):
        session = self.session_factory()
        period_start = utc_now()
        session.add(
            WorkspaceSubscription(
                workspace_id="professional-1",
                plan="professional",
                status="active",
                current_period_start=period_start,
                current_period_end=period_start + timedelta(days=30),
                ai_credits_used=4000,
            )
        )
        session.commit()
        session.close()

        with patch.object(
            credits,
            "send_ai_credit_low_balance_notification",
            return_value=True,
        ) as notify:
            credits.reserve_ai_credits(
                workspace_id="professional-1",
                operation="analysis",
                estimated_tokens=1000,
            )
            credits.reserve_ai_credits(
                workspace_id="professional-1",
                operation="analysis",
                estimated_tokens=1,
            )

        self.assertEqual(notify.call_count, 1)

    def test_paid_topup_webhook_adds_credits_to_the_parent_pool(self):
        session = self.session_factory()
        session.add(
            WorkspaceSubscription(
                workspace_id="agency-1",
                plan="agency",
                status="active",
                ai_credit_topup_credits=5000,
            )
        )
        session.commit()

        apply_stripe_billing_event(
            session,
            "checkout.session.completed",
            {
                "payment_status": "paid",
                "metadata": {
                    "purchase_type": "ai_credit_topup",
                    "workspace_id": "agency-1:client:first",
                    "credits": "10000",
                },
            },
        )
        session.commit()

        subscription = session.query(WorkspaceSubscription).one()
        self.assertEqual(subscription.ai_credit_topup_credits, 15000)
        session.close()

    def test_topup_checkout_accepts_large_positive_quantities(self):
        with patch.object(
            billing_service,
            "require_billing_config",
            return_value={
                "secret_key": "sk_test",
                "ai_credit_topup_price_id": "price_topup",
                "web_app_url": "https://app.test",
            },
        ), patch.object(
            billing_service,
            "get_ai_credit_pack_size",
            return_value=5000,
        ), patch.object(
            billing_service,
            "stripe_request",
            return_value={
                "id": "cs_topup",
                "url": "https://checkout.test/topup",
            },
        ) as stripe_request:
            result = billing_service.create_ai_credit_topup_session(
                workspace_id="agency-1",
                owner_user_id="owner-1",
                owner_email="owner@example.com",
                organization_name="Agency",
                credit_packs=1000,
            )

        self.assertEqual(result["credits"], 5_000_000)
        params = stripe_request.call_args.args[1]
        self.assertEqual(params["line_items[0][quantity]"], "1000")
        self.assertEqual(params["metadata[credits]"], "5000000")


if __name__ == "__main__":
    unittest.main()
