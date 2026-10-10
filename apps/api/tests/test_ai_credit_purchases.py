import json
import os
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from pydantic import ValidationError
from sqlalchemy import create_engine, event
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker
from starlette.requests import Request

from app.db.models import AICreditPurchase, AIUsageEvent, BillingWebhookEvent, Organization, WorkspaceSubscription, utc_now
from app.modules.ai import credits
from app.modules.billing import router as billing
from app.modules.billing import service
from app.modules.billing.ai_credit_purchases import credit_purchase_blocker, fulfill_credit_purchase
from app.modules.billing.schemas import AICreditTopupRequest, BillingCheckoutConfirmationRequest, BillingCheckoutRequest


class AICreditPurchaseTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.engine = create_engine(f"sqlite:///{self.directory.name}/credits.db", connect_args={"timeout": 30})
        for table in (WorkspaceSubscription.__table__, AICreditPurchase.__table__, AIUsageEvent.__table__, Organization.__table__):
            table.create(self.engine)
        self.sessions = sessionmaker(bind=self.engine, expire_on_commit=False)
        self.config = {"provider": "stripe", "secret_key": "sk_test", "professional_price_id": "price_professional", "ai_credit_topup_price_id": "price_topup", "web_app_url": "https://app.test"}
        self.patches = [
            patch.object(billing, "SessionLocal", self.sessions),
            patch.object(credits, "SessionLocal", self.sessions),
            patch.object(billing, "get_billing_config", return_value=self.config),
            patch.object(billing, "build_ai_status", return_value={"configured": True}),
            patch.object(billing, "get_auth_context", return_value=SimpleNamespace(user_id="owner", workspace_id="owner", workspace_role="owner", email="owner@example.test")),
            patch.dict(os.environ, {"BILLING_ENFORCEMENT_ENABLED": "true"}),
        ]
        for item in self.patches:
            item.start()
        self.request = Request({"type": "http", "method": "POST", "path": "/billing/ai-credits/topup", "headers": []})
        self.now = utc_now()
        with self.sessions() as db:
            db.add(WorkspaceSubscription(workspace_id="owner", plan="professional", status="active", provider_subscription_id="sub_owner", provider_customer_id="cus_owner", current_period_start=self.now, current_period_end=self.now + timedelta(days=30), ai_credit_topup_credits=50))
            db.commit()

    def tearDown(self):
        for item in reversed(self.patches):
            item.stop()
        self.engine.dispose()
        self.directory.cleanup()

    def checkout(self, **values):
        return {
            "id": "cs_credits", "mode": "payment", "status": "complete", "payment_status": "paid",
            "customer": "cus_owner", "client_reference_id": "owner", "currency": "cad", "amount_total": 2000,
            "metadata": {"purchase_type": "ai_credit_topup", "workspace_id": "owner", "credits": "10000", "credit_packs": "2", "credit_pack_size": "5000", "topup_price_id": "price_topup"},
            "line_items": {"data": [{"price": {"id": "price_topup"}, "quantity": 2}]}, **values,
        }

    def balance(self):
        with self.sessions() as db:
            return db.query(WorkspaceSubscription).one().ai_credit_topup_credits

    async def confirm(self, checkout):
        with patch.object(billing, "retrieve_stripe_checkout", return_value=checkout):
            return await billing.confirm_ai_credit_topup(BillingCheckoutConfirmationRequest(session_id=checkout["id"]), self.request)

    def remote(self, **values):
        return {"id": "sub_owner", "customer": "cus_owner", "status": "active", "metadata": {"workspace_id": "owner", "plan": "professional"},
            "current_period_start": int(self.now.timestamp()), "current_period_end": int((self.now + timedelta(days=30)).timestamp()), **values}

    async def test_payment_is_confirmed_and_balance_is_updated(self):
        result = await self.confirm(self.checkout())
        self.assertEqual(result.status, "confirmed")
        self.assertEqual(result.credits, 10000)
        self.assertEqual(result.purchased_credits_remaining, 10050)
        self.assertGreaterEqual(result.credits_remaining, 10050)
        self.assertEqual(self.balance(), 10050)

    async def test_http_confirmation_and_validation_contract(self):
        app = FastAPI()
        app.include_router(billing.router, prefix="/billing")

        async def post(path, payload):
            messages = []
            async def receive():
                return {"type": "http.request", "body": json.dumps(payload).encode(), "more_body": False}
            async def send(message):
                messages.append(message)
            await app({"type": "http", "asgi": {"version": "3.0"}, "method": "POST", "path": path, "query_string": b"", "headers": [(b"content-type", b"application/json")], "scheme": "http", "server": ("test", 80), "client": ("test", 123)}, receive, send)
            status = next(message["status"] for message in messages if message["type"] == "http.response.start")
            body = json.loads(b"".join(message.get("body", b"") for message in messages if message["type"] == "http.response.body"))
            return status, body

        with patch.object(billing, "retrieve_stripe_checkout", return_value=self.checkout()):
            status, body = await post("/billing/ai-credits/topup/confirm", {"session_id": "cs_credits"})
            self.assertEqual(status, 200, body)
            self.assertEqual(body["purchased_credits_remaining"], 10050)
            self.assertEqual(body["status"], "confirmed")
            for quantity in (0, "2", 1.5, True):
                self.assertEqual((await post("/billing/ai-credits/topup", {"credit_packs": quantity}))[0], 422)

    async def test_status_flags_explain_disabled_ai_and_eligible_purchase(self):
        for configured in (False, True):
            with patch.object(billing, "build_ai_status", return_value={"configured": configured}):
                status = await billing.get_billing_status(self.request)
            self.assertEqual(status.ai_configured, configured)
            self.assertEqual(status.ai_credit_purchase_allowed, configured)
            self.assertEqual(bool(status.ai_credit_purchase_reason), not configured)

    async def test_return_reload_and_two_event_types_fulfill_once(self):
        checkout = self.checkout()
        await self.confirm(checkout)
        await self.confirm(checkout)
        for event_type in ("checkout.session.completed", "checkout.session.async_payment_succeeded"):
            with self.sessions() as db, patch.object(billing, "retrieve_stripe_checkout", return_value=checkout):
                billing.apply_stripe_billing_event(db, event_type, checkout)
                db.commit()
        self.assertEqual(self.balance(), 10050)
        with self.sessions() as db:
            self.assertEqual(db.query(AICreditPurchase).count(), 1)

    async def test_unpaid_open_missing_status_and_processing_are_pending(self):
        for checkout in (self.checkout(payment_status="unpaid"), self.checkout(payment_status=None), self.checkout(status="open"), self.checkout(payment_status="unpaid", payment_intent={"status": "processing"})):
            with self.subTest(checkout=checkout):
                self.assertEqual((await self.confirm(checkout)).status, "pending")
                self.assertEqual(self.balance(), 50)

    async def test_delayed_payment_can_finish_after_initial_pending_return(self):
        self.assertEqual((await self.confirm(self.checkout(payment_status="unpaid"))).status, "pending")
        self.assertEqual((await self.confirm(self.checkout())).status, "confirmed")
        self.assertEqual(self.balance(), 10050)

    async def test_failed_and_expired_are_explicit_without_credits(self):
        for expected, checkout in (("expired", self.checkout(status="expired", payment_status="unpaid")), ("failed", self.checkout(payment_status="unpaid", payment_intent={"status": "requires_payment_method"}))):
            self.assertEqual((await self.confirm(checkout)).status, expected)
            self.assertEqual(self.balance(), 50)

    async def test_confirm_rejects_another_workspace_and_other_purchase_modes(self):
        for checkout in (self.checkout(metadata={"workspace_id": "other", "purchase_type": "ai_credit_topup"}), self.checkout(mode="subscription"), self.checkout(metadata={"workspace_id": "owner", "purchase_type": "other"})):
            with self.assertRaises(HTTPException) as failure:
                await self.confirm(checkout)
            self.assertEqual(failure.exception.status_code, 403)
        self.assertEqual(self.balance(), 50)

    async def test_mismatched_customer_and_line_items_fail_closed(self):
        for checkout in (self.checkout(customer="cus_other"), self.checkout(client_reference_id="other"), self.checkout(line_items={"data": []}), self.checkout(line_items={"data": [{"price": {"id": "price_other"}, "quantity": 2}]})):
            with self.assertRaises(HTTPException) as failure:
                await self.confirm(checkout)
            self.assertEqual(failure.exception.status_code, 503)
        self.assertEqual(self.balance(), 50)

    async def test_invalid_credit_metadata_is_not_fulfilled(self):
        for fields in ({"credits": "0"}, {"credit_packs": "-1"}, {"credits": "5001"}, {"credit_pack_size": "0"}, {"credits": "Infinity"}):
            checkout = self.checkout()
            checkout["metadata"].update(fields)
            with self.assertRaises(HTTPException):
                await self.confirm(checkout)
        self.assertEqual(self.balance(), 50)

    async def test_historical_pack_allocation_survives_admin_change(self):
        with patch.object(service, "get_ai_credit_pack_size", return_value=123):
            result = await self.confirm(self.checkout())
        self.assertEqual(result.credits, 10000)

    async def test_existing_payment_is_fulfilled_even_if_ai_was_disabled_after_purchase(self):
        with patch.object(billing, "build_ai_status", return_value={"configured": False}):
            self.assertEqual((await self.confirm(self.checkout())).status, "confirmed")

    async def test_missing_workspace_balance_is_retryable_not_silently_lost(self):
        with self.sessions() as db:
            db.query(WorkspaceSubscription).delete()
            db.commit()
        with self.assertRaises(HTTPException) as failure:
            await self.confirm(self.checkout())
        self.assertEqual(failure.exception.status_code, 503)

    async def test_member_and_agency_client_cannot_buy_or_confirm(self):
        for role, workspace in (("member", "owner"), ("owner", "owner:client:first")):
            with patch.object(billing, "get_auth_context", return_value=SimpleNamespace(workspace_role=role, workspace_id=workspace)):
                for call in (lambda: billing.create_ai_credit_topup(AICreditTopupRequest(credit_packs=1), self.request), lambda: self.confirm(self.checkout())):
                    with self.assertRaises(HTTPException) as failure:
                        await call()
                    self.assertEqual(failure.exception.status_code, 403)

    async def test_disabled_ai_prevents_both_one_time_and_recurring_credit_sales(self):
        with patch.object(billing, "build_ai_status", return_value={"configured": False}), patch.object(billing, "create_ai_credit_topup_session") as create:
            for call in (lambda: billing.create_ai_credit_topup(AICreditTopupRequest(credit_packs=1), self.request), lambda: billing.create_billing_checkout(BillingCheckoutRequest(additional_ai_credit_packs=1), self.request)):
                with self.assertRaises(HTTPException) as failure:
                    await call()
                self.assertEqual(failure.exception.status_code, 409)
            create.assert_not_called()

    async def test_billing_disabled_cannot_sell_or_confirm_credits(self):
        with patch.dict(os.environ, {"BILLING_ENFORCEMENT_ENABLED": "false"}):
            for call in (lambda: billing.create_ai_credit_topup(AICreditTopupRequest(credit_packs=1), self.request), lambda: self.confirm(self.checkout())):
                with self.assertRaises(HTTPException) as failure:
                    await call()
                self.assertEqual(failure.exception.status_code, 409)

    async def test_current_provider_cancellation_prevents_purchase(self):
        with patch.object(billing, "retrieve_stripe_subscription", return_value=self.remote(status="canceled")), patch.object(billing, "create_ai_credit_topup_session") as create:
            with self.assertRaises(HTTPException) as failure:
                await billing.create_ai_credit_topup(AICreditTopupRequest(credit_packs=1), self.request)
            self.assertEqual(failure.exception.status_code, 409)
            create.assert_not_called()

    async def test_eligible_owner_can_buy_with_fresh_provider_status(self):
        with patch.object(billing, "retrieve_stripe_subscription", return_value=self.remote()), patch.object(billing, "create_ai_credit_topup_session", return_value={"checkout_url": "https://checkout.test", "session_id": "cs_credits", "credits": 15000, "credit_packs": 3}) as create:
            result = await billing.create_ai_credit_topup(AICreditTopupRequest(credit_packs=3), self.request)
        self.assertEqual(result.credits, 15000)
        self.assertEqual(create.call_args.kwargs["workspace_id"], "owner")
        self.assertEqual(create.call_args.kwargs["customer_id"], "cus_owner")

    async def test_stale_quote_returns_actionable_conflict_not_server_error(self):
        with patch.object(billing, "retrieve_stripe_subscription", return_value=self.remote()), patch.object(billing, "create_ai_credit_topup_session", side_effect=service.BillingQuoteChanged("AI credit pricing has changed. Refresh billing before purchasing.")):
            with self.assertRaises(HTTPException) as failure:
                await billing.create_ai_credit_topup(AICreditTopupRequest(credit_packs=1, expected_pack_size=5000, expected_price_cents=1000), self.request)
        self.assertEqual(failure.exception.status_code, 409)
        self.assertIn("Refresh billing", failure.exception.detail)

    def test_free_local_trial_expired_and_past_due_cannot_purchase(self):
        for plan, status, provider, end in (("free", "trialing", None, self.now + timedelta(days=1)), ("professional", "trialing", None, self.now + timedelta(days=1)), ("professional", "active", "sub_owner", self.now - timedelta(days=1)), ("agency", "past_due", "sub_owner", self.now - timedelta(days=1))):
            subscription = WorkspaceSubscription(plan=plan, status=status, provider_subscription_id=provider, current_period_end=end)
            self.assertTrue(credit_purchase_blocker(subscription, self.config, ai_configured=True))

    def test_quantities_require_real_positive_integers(self):
        for value in (0, -1, 1.5, "2", True):
            with self.assertRaises(ValidationError):
                AICreditTopupRequest(credit_packs=value)

    def test_return_urls_and_metadata_include_workspace_and_snapshot(self):
        with patch.object(service, "require_billing_config", return_value=self.config), patch.object(service, "get_ai_credit_pack_size", return_value=5000), patch.object(service, "get_billing_pricing", return_value={"ai_credit_topup_price_cents": 1000}), patch.object(service, "stripe_request", side_effect=[{"active": True, "type": "one_time", "currency": "cad", "unit_amount": 1000}, {"id": "cs_credits", "url": "https://checkout.test"}]) as create:
            service.create_ai_credit_topup_session(workspace_id="agency:test", owner_user_id="owner", owner_email="owner@example.test", organization_name=None, credit_packs=1000)
        params = create.call_args.args[1]
        self.assertIn("workspace_id=agency%3Atest&session_id={CHECKOUT_SESSION_ID}", params["success_url"])
        self.assertIn("workspace_id=agency%3Atest", params["cancel_url"])
        self.assertEqual(params["metadata[credit_pack_size]"], "5000")
        self.assertEqual(params["mode"], "payment")

    def test_price_must_match_one_time_cad_quote_before_payment(self):
        valid = {"active": True, "type": "one_time", "currency": "cad", "unit_amount": 1000}
        for changes in ({"active": False}, {"type": "recurring"}, {"currency": "usd"}, {"unit_amount": 900}):
            with patch.object(service, "require_billing_config", return_value=self.config), patch.object(service, "get_billing_pricing", return_value={"ai_credit_topup_price_cents": 1000}), patch.object(service, "stripe_request", return_value={**valid, **changes}) as create:
                with self.assertRaises(service.BillingProviderUnavailable):
                    service.create_ai_credit_topup_session(workspace_id="owner", owner_user_id="owner", owner_email=None, organization_name=None, credit_packs=1)
                self.assertEqual(create.call_count, 1)

    def test_stale_browser_quote_is_rejected_before_checkout(self):
        for fields in ({"expected_pack_size": 2500}, {"expected_price_cents": 900}):
            with patch.object(service, "require_billing_config", return_value=self.config), patch.object(service, "get_ai_credit_pack_size", return_value=5000), patch.object(service, "get_billing_pricing", return_value={"ai_credit_topup_price_cents": 1000}), patch.object(service, "stripe_request", return_value={"active": True, "type": "one_time", "currency": "cad", "unit_amount": 1000}) as create:
                with self.assertRaisesRegex(service.BillingProviderUnavailable, "pricing has changed"):
                    service.create_ai_credit_topup_session(workspace_id="owner", owner_user_id="owner", owner_email=None, organization_name=None, credit_packs=1, **fields)
                self.assertEqual(create.call_count, 1)

    def test_zero_credit_pack_configuration_cannot_charge_customer(self):
        with patch.object(service, "require_billing_config", return_value=self.config), patch.object(service, "get_ai_credit_pack_size", return_value=0), patch.object(service, "get_billing_pricing", return_value={"ai_credit_topup_price_cents": 1000}), patch.object(service, "stripe_request", return_value={"active": True, "type": "one_time", "currency": "cad", "unit_amount": 1000}) as create:
            with self.assertRaises(service.BillingProviderUnavailable):
                service.create_ai_credit_topup_session(workspace_id="owner", owner_user_id="owner", owner_email=None, organization_name=None, credit_packs=1)
            self.assertEqual(create.call_count, 1)
        with self.sessions() as db:
            self.assertTrue(credit_purchase_blocker(db.query(WorkspaceSubscription).one(), self.config, ai_configured=True, pack_size=0))

    def test_concurrent_duplicates_and_distinct_payments_preserve_balance(self):
        def pay(session_id):
            with self.sessions() as db:
                fulfill_credit_purchase(db, self.checkout(id=session_id))
                db.commit()
        with ThreadPoolExecutor(max_workers=8) as pool:
            list(pool.map(pay, ["cs_same"] * 8 + [f"cs_{index}" for index in range(8)]))
        self.assertEqual(self.balance(), 90050)
        with self.sessions() as db:
            self.assertEqual(db.query(AICreditPurchase).count(), 9)

    def test_rollback_keeps_ledger_and_balance_atomic_on_sqlite(self):
        with self.sessions() as db:
            fulfill_credit_purchase(db, self.checkout())
            db.rollback()
        self.assertEqual(self.balance(), 50)
        with self.sessions() as db:
            self.assertEqual(db.query(AICreditPurchase).count(), 0)
            fulfill_credit_purchase(db, self.checkout())
            db.commit()
        self.assertEqual(self.balance(), 10050)

    def test_ai_usage_cannot_renew_expired_provider_period_or_paid_trial(self):
        for provider, status in (("sub_owner", "active"), (None, "trialing")):
            with self.sessions() as db:
                subscription = db.query(WorkspaceSubscription).one()
                subscription.provider_subscription_id = provider
                subscription.status = status
                subscription.current_period_start = self.now - timedelta(days=31)
                subscription.current_period_end = self.now - timedelta(days=1)
                db.commit()
            with self.assertRaises(credits.AICreditLimitExceeded):
                credits.reserve_ai_credits(workspace_id="owner", operation="analysis", estimated_tokens=1000)
            self.assertEqual(self.balance(), 50)


@unittest.skipUnless(os.getenv("DECISIONATE_TEST_POSTGRES_URL"), "An isolated PostgreSQL test database is required")
class AICreditPurchasePostgresTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(os.environ["DECISIONATE_TEST_POSTGRES_URL"])
        for table in (WorkspaceSubscription.__table__, AICreditPurchase.__table__, AIUsageEvent.__table__, BillingWebhookEvent.__table__):
            table.create(self.engine, checkfirst=True)
        self.sessions = sessionmaker(bind=self.engine)
        self.workspace = f"credit-test-{uuid4().hex}"
        now = utc_now()
        with self.sessions() as db:
            db.add(WorkspaceSubscription(workspace_id=self.workspace, plan="professional", status="active", provider_subscription_id="sub_test", current_period_start=now, current_period_end=now + timedelta(days=30), ai_credit_topup_credits=50))
            db.commit()

    def tearDown(self):
        with self.sessions() as db:
            for model in (AICreditPurchase, AIUsageEvent, WorkspaceSubscription):
                db.query(model).filter_by(workspace_id=self.workspace).delete(synchronize_session=False)
            db.query(BillingWebhookEvent).filter_by(provider_event_id=f"evt_{self.workspace}").delete()
            db.commit()
        self.engine.dispose()

    def test_duplicate_and_distinct_payments_racing_ai_usage_are_atomic(self):
        def transact(task):
            if task == "use":
                credits.reserve_ai_credits(workspace_id=self.workspace, operation="test", estimated_tokens=1000)
            else:
                with self.sessions() as db:
                    fulfill_credit_purchase(db, {"id": task, "mode": "payment", "status": "complete", "payment_status": "paid", "metadata": {"workspace_id": self.workspace, "purchase_type": "ai_credit_topup", "credit_packs": "1", "credits": "10"}})
                    db.commit()
        tasks = [f"cs_same_{self.workspace}"] * 8 + [f"cs_{index}_{self.workspace}" for index in range(8)] + ["use"] * 8
        with patch.object(credits, "SessionLocal", self.sessions), patch.object(credits, "get_billing_plan_definition", return_value={"ai_credit_limit": 0}), patch.object(credits, "get_ai_credit_allocations", return_value={"additional_client_workspace": 0}), patch.object(credits, "_maybe_notify_low_balance"), patch.dict(os.environ, {"BILLING_ENFORCEMENT_ENABLED": "true"}):
            with ThreadPoolExecutor(max_workers=8) as pool:
                list(pool.map(transact, tasks))
        with self.sessions() as db:
            subscription = db.query(WorkspaceSubscription).filter_by(workspace_id=self.workspace).one()
            self.assertEqual(subscription.ai_credit_topup_credits, 132)
            self.assertEqual(subscription.ai_credits_used, 8)
            self.assertEqual(db.query(AICreditPurchase).filter_by(workspace_id=self.workspace).count(), 9)

    def test_same_webhook_event_race_rolls_back_outer_transaction_cleanly(self):
        barrier = threading.Barrier(4)

        def transact(_):
            with self.sessions(autoflush=False) as db:
                def synchronize_event_flush(session, context, instances):
                    if any(isinstance(item, BillingWebhookEvent) for item in session.new):
                        barrier.wait(timeout=10)
                event.listen(db, "before_flush", synchronize_event_flush)
                db.add(BillingWebhookEvent(provider_event_id=f"evt_{self.workspace}", event_type="checkout.session.completed"))
                try:
                    fulfill_credit_purchase(db, {"id": f"cs_{self.workspace}", "mode": "payment", "status": "complete", "payment_status": "paid", "metadata": {"workspace_id": self.workspace, "purchase_type": "ai_credit_topup", "credit_packs": "1", "credits": "10"}})
                    db.commit()
                    return "applied"
                except IntegrityError:
                    db.rollback()
                    return "duplicate"

        with ThreadPoolExecutor(max_workers=4) as pool:
            outcomes = list(pool.map(transact, range(4)))
        self.assertCountEqual(outcomes, ["applied", "duplicate", "duplicate", "duplicate"])
        with self.sessions() as db:
            self.assertEqual(db.query(WorkspaceSubscription).filter_by(workspace_id=self.workspace).one().ai_credit_topup_credits, 60)
            self.assertEqual(db.query(AICreditPurchase).filter_by(workspace_id=self.workspace).count(), 1)


if __name__ == "__main__":
    unittest.main()
