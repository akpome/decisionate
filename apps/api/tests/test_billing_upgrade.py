import os
import unittest
from datetime import UTC, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from starlette.requests import Request

from app.db.models import WorkspaceSubscription, BillingWebhookEvent, Organization, utc_now
from app.modules.billing import router as billing
from app.modules.billing import service
from app.modules.billing.notifications import build_lifecycle_notice
from app.modules.billing.lifecycle import build_subscription_access_state, subscription_access_error
from app.modules.billing.schemas import BillingCheckoutRequest, BillingCheckoutConfirmationRequest, AICreditTopupRequest


class BillingUpgradeTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        for table in (WorkspaceSubscription.__table__, BillingWebhookEvent.__table__, Organization.__table__):
            table.create(self.engine)
        self.sessions = sessionmaker(bind=self.engine, expire_on_commit=False)
        self.patches = [
            patch.object(billing, "SessionLocal", self.sessions),
            patch.object(billing, "get_auth_context", return_value=SimpleNamespace(
                user_id="owner", workspace_id="owner", workspace_role="owner", email="owner@example.test",
            )),
            patch.dict(os.environ, {"BILLING_ENFORCEMENT_ENABLED": "true"}),
        ]
        for item in self.patches:
            item.start()
        self.request = Request({"type": "http", "method": "POST", "path": "/billing/checkout", "headers": []})
        self.now = utc_now()

    def tearDown(self):
        for item in reversed(self.patches):
            item.stop()
        self.engine.dispose()

    def seed(self, **values):
        with self.sessions() as db:
            subscription = WorkspaceSubscription(workspace_id="owner", plan="professional", **values)
            db.add(subscription)
            db.commit()
            return subscription

    def remote(self, **values):
        return {
            "id": "sub_new", "customer": "cus_owner", "status": "active",
            "metadata": {"workspace_id": "owner", "plan": "professional", "billing_interval": "month"},
            "items": {"data": [{"id": "si_base", "price": {"id": "price_professional"},
                "current_period_start": int(self.now.replace(tzinfo=UTC).timestamp()),
                "current_period_end": int((self.now + timedelta(days=30)).replace(tzinfo=UTC).timestamp()),
            }]}, **values,
        }

    def checkout(self, **values):
        return {"id": "cs_review", "mode": "subscription", "status": "complete", "payment_status": "paid",
            "customer": "cus_owner", "subscription": "sub_new", "metadata": {"workspace_id": "owner"}, **values}

    async def confirm(self, checkout, remote=None):
        with patch.object(billing, "retrieve_stripe_checkout", return_value=checkout), patch.object(
            billing, "retrieve_stripe_subscription", return_value=remote or self.remote()
        ):
            return await billing.confirm_billing_checkout(BillingCheckoutConfirmationRequest(session_id="cs_review"), self.request)

    async def test_expired_trial_checkout_does_not_grant_access_or_restart_trial(self):
        self.seed(status="trialing", current_period_start=self.now - timedelta(days=31), current_period_end=self.now - timedelta(days=1))
        with patch.object(billing, "create_checkout_session", return_value={"session_id": "cs_review", "checkout_url": "https://checkout.test"}) as create:
            await billing.create_billing_checkout(BillingCheckoutRequest(), self.request)
        self.assertIsNone(create.call_args.kwargs["trial_period_days"])
        self.assertIsNone(create.call_args.kwargs["trial_end"])
        with self.sessions() as db:
            self.assertFalse(build_subscription_access_state(db.query(WorkspaceSubscription).one()).access_allowed)

    async def test_active_local_trial_preserves_exact_end(self):
        end = self.now + timedelta(days=3)
        self.seed(status="trialing", current_period_start=self.now - timedelta(days=27), current_period_end=end)
        with patch.object(billing, "create_checkout_session", return_value={"session_id": "cs_review", "checkout_url": "https://checkout.test"}) as create:
            await billing.create_billing_checkout(BillingCheckoutRequest(billing_interval="year"), self.request)
        self.assertIsNone(create.call_args.kwargs["trial_period_days"])
        self.assertEqual(create.call_args.kwargs["trial_end"], int(end.replace(tzinfo=UTC).timestamp()))

    async def test_existing_past_due_subscription_uses_recovery_not_new_checkout(self):
        self.seed(status="past_due", provider_subscription_id="sub_new", current_period_end=self.now - timedelta(days=10))
        with patch.object(billing, "retrieve_stripe_subscription", return_value=self.remote(status="past_due")), patch.object(billing, "create_checkout_session") as create:
            with self.assertRaises(HTTPException) as failure:
                await billing.create_billing_checkout(BillingCheckoutRequest(), self.request)
        self.assertEqual(failure.exception.status_code, 409)
        create.assert_not_called()

    async def test_canceled_subscription_can_resubscribe_without_second_trial(self):
        self.seed(status="canceled", provider_subscription_id="sub_new")
        with patch.object(billing, "retrieve_stripe_subscription", return_value=self.remote(status="canceled")), patch.object(billing, "create_checkout_session", return_value={"session_id": "cs_review", "checkout_url": "https://checkout.test"}) as create:
            await billing.create_billing_checkout(BillingCheckoutRequest(), self.request)
        self.assertIsNone(create.call_args.kwargs["trial_period_days"])

    async def test_confirmed_payment_restores_access_using_item_periods(self):
        self.seed(status="trialing", current_period_end=self.now - timedelta(days=1))
        result = await self.confirm(self.checkout())
        self.assertEqual(result.status, "confirmed")
        self.assertTrue(result.access_allowed)
        with self.sessions() as db:
            subscription = db.query(WorkspaceSubscription).one()
            self.assertEqual(subscription.status, "active")
            self.assertGreater(subscription.current_period_end, self.now)

    async def test_unpaid_or_open_checkout_never_restores_access(self):
        self.seed(status="trialing", current_period_end=self.now - timedelta(days=1))
        for checkout in (self.checkout(payment_status="unpaid"), self.checkout(status="open")):
            result = await self.confirm(checkout)
            self.assertEqual(result.status, "pending")
            self.assertFalse(result.access_allowed)
        with self.sessions() as db:
            self.assertEqual(db.query(WorkspaceSubscription).one().status, "trialing")

    async def test_expired_checkout_is_explicit(self):
        self.assertEqual((await self.confirm(self.checkout(status="expired"))).status, "expired")

    async def test_session_for_another_workspace_is_rejected(self):
        with self.assertRaises(HTTPException) as failure:
            await self.confirm(self.checkout(metadata={"workspace_id": "other"}))
        self.assertEqual(failure.exception.status_code, 403)

    async def test_subscription_for_another_workspace_or_customer_is_rejected(self):
        for remote in (self.remote(customer="cus_other"), self.remote(metadata={"workspace_id": "other"})):
            with self.assertRaises(HTTPException) as failure:
                await self.confirm(self.checkout(), remote)
            self.assertEqual(failure.exception.status_code, 503)
        with self.sessions() as db:
            self.assertEqual(db.query(WorkspaceSubscription).count(), 0)

    async def test_no_payment_required_confirms_only_actual_active_trial(self):
        result = await self.confirm(self.checkout(payment_status="no_payment_required"), self.remote(status="trialing"))
        self.assertEqual(result.status, "confirmed")

    async def test_incomplete_subscription_is_not_confirmed(self):
        result = await self.confirm(self.checkout(), self.remote(status="incomplete"))
        self.assertEqual(result.status, "requires_action")
        self.assertFalse(result.access_allowed)

    async def test_provider_without_period_is_not_confirmed(self):
        result = await self.confirm(self.checkout(), self.remote(items={"data": []}))
        self.assertFalse(result.access_allowed)

    async def test_delayed_checkout_event_preserves_authoritative_period(self):
        self.seed(status="active", provider_subscription_id="sub_new", provider_customer_id="cus_owner", current_period_end=self.now + timedelta(days=30))
        result = await self.confirm(self.checkout())
        self.assertEqual(result.status, "confirmed")
        with self.sessions() as db:
            self.assertGreater(db.query(WorkspaceSubscription).one().current_period_end, self.now)

    async def test_old_subscription_event_cannot_replace_current_subscription(self):
        self.seed(status="active", provider_subscription_id="sub_new", provider_customer_id="cus_owner", current_period_end=self.now + timedelta(days=30))
        with self.sessions() as db:
            billing.apply_stripe_billing_event(db, "customer.subscription.deleted", self.remote(id="sub_old", status="canceled"))
            db.commit()
            self.assertEqual(db.query(WorkspaceSubscription).one().provider_subscription_id, "sub_new")
            self.assertEqual(db.query(WorkspaceSubscription).one().status, "active")

    async def test_disabled_payments_do_not_call_stripe(self):
        with patch.dict(os.environ, {"BILLING_ENFORCEMENT_ENABLED": "false"}), patch.object(billing, "retrieve_stripe_checkout") as retrieve, patch.object(billing, "create_checkout_session") as create:
            for action in (
                lambda: billing.create_billing_checkout(BillingCheckoutRequest(), self.request),
                lambda: billing.confirm_billing_checkout(BillingCheckoutConfirmationRequest(session_id="cs_review"), self.request),
                lambda: billing.create_billing_portal(self.request),
                lambda: billing.create_ai_credit_topup(AICreditTopupRequest(credit_packs=1), self.request),
            ):
                with self.assertRaises(HTTPException) as failure:
                    await action()
                self.assertEqual(failure.exception.status_code, 409)
            retrieve.assert_not_called()
            create.assert_not_called()

    async def test_nonowners_cannot_confirm_or_create_checkout(self):
        for role, workspace in (("member", "owner"), ("owner", "owner:client:1")):
            with patch.object(billing, "get_auth_context", return_value=SimpleNamespace(workspace_role=role, workspace_id=workspace)):
                with self.assertRaises(HTTPException) as failure:
                    await billing.confirm_billing_checkout(BillingCheckoutConfirmationRequest(session_id="cs_review"), self.request)
                self.assertEqual(failure.exception.status_code, 403)

    async def test_invalid_interval_is_rejected(self):
        with self.assertRaises(HTTPException) as failure:
            await billing.create_billing_checkout(BillingCheckoutRequest(billing_interval="weekly"), self.request)
        self.assertEqual(failure.exception.status_code, 400)

    def test_checkout_completed_does_not_grant_indefinite_access(self):
        for plan in ("free", "professional", "agency"):
            self.assertFalse(build_subscription_access_state(WorkspaceSubscription(plan=plan, status="checkout_completed")).access_allowed)

    def test_paid_plan_trial_expiry_has_trial_message(self):
        state = build_subscription_access_state(WorkspaceSubscription(plan="professional", status="trialing", current_period_end=self.now - timedelta(days=1)))
        self.assertIn("trial has ended", subscription_access_error(state))

    def test_checkout_return_urls_preserve_workspace_and_session(self):
        with patch.object(service, "require_billing_config", return_value={"professional_price_id": "price_professional", "secret_key": "test", "web_app_url": "https://app.test"}), patch.object(service, "stripe_request", return_value={"id": "cs_review", "url": "https://checkout.test"}) as stripe:
            service.create_checkout_session(workspace_id="owner", owner_user_id="owner", owner_email=None, organization_name=None, trial_period_days=None)
        params = stripe.call_args.args[1]
        self.assertIn("workspace_id=owner", params["success_url"])
        self.assertIn("session_id={CHECKOUT_SESSION_ID}", params["success_url"])
        self.assertIn("workspace_id=owner", params["cancel_url"])
        self.assertNotIn("subscription_data[trial_period_days]", params)

    def test_final_trial_day_preserves_remaining_time_without_early_charge(self):
        end = int((self.now + timedelta(hours=12)).replace(tzinfo=UTC).timestamp())
        with patch.object(service, "require_billing_config", return_value={"professional_price_id": "price_professional", "secret_key": "test", "web_app_url": "https://app.test"}), patch.object(service, "stripe_request", return_value={"id": "cs_review", "url": "https://checkout.test"}) as stripe:
            service.create_checkout_session(workspace_id="owner", owner_user_id="owner", owner_email=None, organization_name=None, trial_period_days=None, trial_end=end)
        params = stripe.call_args.args[1]
        self.assertEqual(params["subscription_data[billing_cycle_anchor]"], str(end))
        self.assertEqual(params["subscription_data[proration_behavior]"], "none")
        self.assertEqual(params["payment_method_collection"], "always")
        self.assertNotIn("subscription_data[trial_end]", params)

    def test_trial_expiry_email_has_upgrade_link_not_a_renewal_claim(self):
        subscription = WorkspaceSubscription(workspace_id="owner", plan="professional", status="trialing", current_period_end=self.now - timedelta(days=1))
        notice = build_lifecycle_notice(subscription, build_subscription_access_state(subscription))
        self.assertIn("trial has ended", notice[1])
        self.assertIn("Choose a paid plan", notice[2])
        self.assertIn("workspace_id=owner", notice[2])

    def test_paid_auto_renewing_subscription_does_not_receive_expiry_reminders(self):
        subscription = WorkspaceSubscription(plan="professional", status="active", current_period_end=self.now + timedelta(hours=12), cancel_at_period_end=0)
        self.assertIsNone(build_lifecycle_notice(subscription, build_subscription_access_state(subscription)))

    def test_local_trial_reminder_and_provider_trial_reminder_differ(self):
        subscription = WorkspaceSubscription(workspace_id="owner", plan="professional", status="trialing", current_period_end=self.now + timedelta(days=2))
        self.assertIn("Choose a paid plan", build_lifecycle_notice(subscription, build_subscription_access_state(subscription))[2])
        subscription.provider_subscription_id = "sub_new"
        self.assertIn("billing automatically", build_lifecycle_notice(subscription, build_subscription_access_state(subscription))[2])

    async def test_old_invoice_failure_uses_current_provider_status(self):
        self.seed(status="past_due", provider_customer_id="cus_owner", provider_subscription_id="sub_new")
        event = {"id": "evt_old_invoice", "type": "invoice.payment_failed", "data": {"object": {"parent": {"subscription_details": {"subscription": "sub_new"}}}}}
        request = Request({"type": "http", "headers": []}, AsyncMock(return_value={"type": "http.request", "body": b"{}", "more_body": False}))
        with patch.object(billing, "verify_stripe_webhook", return_value=event), patch.object(billing, "retrieve_stripe_subscription", return_value=self.remote()) as retrieve:
            result = await billing.billing_webhook(request)
        self.assertTrue(result["received"])
        retrieve.assert_called_once_with("sub_new")
        with self.sessions() as db:
            self.assertEqual(db.query(WorkspaceSubscription).one().status, "active")

    async def test_failed_provider_lookup_rolls_back_webhook_for_retry(self):
        event = {"id": "evt_retry", "type": "customer.subscription.updated", "data": {"object": {"id": "sub_new"}}}
        request = Request({"type": "http", "headers": []}, AsyncMock(return_value={"type": "http.request", "body": b"{}", "more_body": False}))
        with patch.object(billing, "verify_stripe_webhook", return_value=event), patch.object(billing, "retrieve_stripe_subscription", side_effect=service.BillingProviderUnavailable("Provider timeout")):
            with self.assertRaises(HTTPException) as failure:
                await billing.billing_webhook(request)
        self.assertEqual(failure.exception.status_code, 503)
        with self.sessions() as db:
            self.assertEqual(db.query(BillingWebhookEvent).count(), 0)

    async def test_portal_return_refreshes_without_waiting_for_webhook(self):
        self.seed(status="past_due", provider_customer_id="cus_owner", provider_subscription_id="sub_new")
        with patch.object(billing, "retrieve_stripe_subscription", return_value=self.remote()), patch.object(billing, "get_billing_status", new_callable=AsyncMock) as status:
            await billing.refresh_billing_subscription(self.request)
        status.assert_awaited_once()
        with self.sessions() as db:
            self.assertTrue(build_subscription_access_state(db.query(WorkspaceSubscription).one()).access_allowed)


if __name__ == "__main__":
    unittest.main()
