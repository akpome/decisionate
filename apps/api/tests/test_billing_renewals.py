import ast
import os
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker
from starlette.requests import Request

from app.db.models import BillingWebhookEvent, Organization, WorkspaceSubscription, utc_now
from app.modules.billing import notifications, router as billing, service
from app.modules.billing.lifecycle import build_subscription_access_state
from app.modules.billing.renewals import apply_renewal_period, reconcile_subscription_if_needed


def timestamp(date):
    return int(date.replace(tzinfo=UTC).timestamp())


class BillingRenewalTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.engine = create_engine(f"sqlite:///{self.directory.name}/renewals.db", connect_args={"timeout": 30})
        for table in (WorkspaceSubscription.__table__, BillingWebhookEvent.__table__, Organization.__table__):
            table.create(self.engine)
        self.sessions = sessionmaker(bind=self.engine, expire_on_commit=False)
        self.now = utc_now().replace(microsecond=0)
        self.start = self.now - timedelta(days=30)
        self.config = {
            "provider": "stripe", "professional_price_id": "price_month",
            "professional_annual_price_id": "price_year", "agency_price_id": "price_agency",
            "agency_annual_price_id": "price_agency_year",
        }
        self.patches = [
            patch.dict(os.environ, {"BILLING_ENFORCEMENT_ENABLED": "true", "BILLING_GRACE_PERIOD_DAYS": "7"}),
            patch.object(billing, "SessionLocal", self.sessions),
            patch.object(billing, "get_billing_config", return_value=self.config),
            patch.object(billing, "get_auth_context", return_value=SimpleNamespace(
                workspace_id="owner", user_id="owner", workspace_role="owner", email="owner@example.test",
            )),
        ]
        for item in self.patches:
            item.start()
        self.request = Request({"type": "http", "headers": [], "method": "GET", "path": "/billing/access"})

    def tearDown(self):
        for item in reversed(self.patches):
            item.stop()
        self.engine.dispose()
        self.directory.cleanup()

    def seed(self, **values):
        defaults = dict(
            workspace_id="owner", provider_subscription_id="sub_owner", provider_customer_id="cus_owner",
            plan="professional", status="active", billing_interval="month",
            current_period_start=self.start, current_period_end=self.now,
            ai_credit_period_start=self.start, ai_credits_used=4000, ai_recurring_credits_used=4000,
            ai_credit_topup_credits=123, cancel_at_period_end=0,
        )
        defaults.update(values)
        with self.sessions() as db:
            db.add(WorkspaceSubscription(**defaults))
            db.commit()

    def remote(self, interval="month", **values):
        return {
            "id": "sub_owner", "customer": "cus_owner", "status": "active",
            "metadata": {"workspace_id": "owner", "plan": "professional", "billing_interval": "month"},
            "items": {"data": [{"id": "si_base", "price": {"id": f"price_{interval}", "recurring": {"interval": interval}},
                "current_period_start": timestamp(self.now),
                "current_period_end": timestamp(self.now + timedelta(days=365 if interval == "year" else 31)),
            }]},
            "latest_invoice": {"id": "in_renewal", "status": "paid", "billing_reason": "subscription_cycle", "created": timestamp(self.now)},
            **values,
        }

    def apply(self, remote):
        with self.sessions() as db:
            billing.apply_stripe_billing_event(db, "customer.subscription.updated", remote)
            db.commit()
            return db.query(WorkspaceSubscription).one()

    def failed(self, interval="month", **values):
        remote = self.remote(interval, status="past_due", latest_invoice={
            "id": "in_renewal", "status": "open", "billing_reason": "subscription_cycle", "created": timestamp(self.now),
        })
        remote.update(values)
        return remote

    def test_failed_monthly_and_annual_renewals_use_same_bounded_grace(self):
        for interval in ("month", "year"):
            with self.subTest(interval=interval):
                with self.sessions() as db:
                    db.query(WorkspaceSubscription).delete()
                    db.commit()
                self.seed(billing_interval=interval)
                subscription = self.apply(self.failed(interval))
                self.assertEqual(subscription.payment_due_at, self.now)
                state = build_subscription_access_state(subscription, self.now + timedelta(days=6))
                self.assertTrue(state.access_allowed)
                self.assertEqual(state.grace_period_end, self.now + timedelta(days=7))
                self.assertFalse(build_subscription_access_state(subscription, self.now + timedelta(days=7)).access_allowed)
                self.assertEqual(subscription.ai_recurring_credits_used, 4000)
                self.assertEqual(subscription.ai_credit_period_start, self.start)
                self.assertEqual(subscription.ai_credit_topup_credits, 123)

    def test_retries_and_next_unpaid_period_cannot_extend_grace(self):
        self.seed()
        self.apply(self.failed())
        later = self.now + timedelta(days=31)
        remote = self.failed(latest_invoice={"status": "open", "created": timestamp(later)})
        remote["items"]["data"][0]["current_period_start"] = timestamp(later)
        with patch("app.modules.billing.renewals.utc_now", return_value=later):
            subscription = self.apply(remote)
        self.assertEqual(subscription.payment_due_at, self.now)
        self.assertFalse(build_subscription_access_state(subscription, later).access_allowed)
        self.assertEqual(subscription.ai_recurring_credits_used, 4000)

    def test_midyear_invoice_failure_is_not_backdated_to_last_year(self):
        start = self.now - timedelta(days=200)
        self.seed(billing_interval="year", current_period_start=start, current_period_end=self.now + timedelta(days=165))
        remote = self.failed("year")
        remote["items"]["data"][0]["current_period_start"] = timestamp(start)
        subscription = self.apply(remote)
        self.assertEqual(subscription.payment_due_at, self.now)
        self.assertTrue(build_subscription_access_state(subscription, self.now + timedelta(days=1)).access_allowed)

    async def test_canceled_monthly_and_annual_subscriptions_can_checkout_without_new_trial(self):
        from app.modules.billing.schemas import BillingCheckoutRequest

        for interval in ("month", "year"):
            with self.sessions() as db:
                db.query(WorkspaceSubscription).delete()
                db.commit()
            self.seed(status="canceled", billing_interval=interval)
            with patch.object(billing, "retrieve_stripe_subscription", return_value=self.remote(interval, status="canceled")), patch.object(
                billing, "create_checkout_session", return_value={"session_id": "cs_new", "checkout_url": "https://checkout.test"}
            ) as create:
                await billing.create_billing_checkout(BillingCheckoutRequest(billing_interval=interval), self.request)
            self.assertEqual(create.call_args.kwargs["billing_interval"], interval)
            self.assertIsNone(create.call_args.kwargs["trial_period_days"])
            self.assertIsNone(create.call_args.kwargs["trial_end"])

    def test_legacy_past_due_future_end_without_anchor_does_not_grant_free_year(self):
        subscription = WorkspaceSubscription(plan="professional", status="past_due", current_period_end=self.now + timedelta(days=365))
        self.assertFalse(build_subscription_access_state(subscription, self.now).access_allowed)

    def test_paid_renewal_and_payment_recovery_reset_credits_once(self):
        for interval in ("month", "year"):
            with self.sessions() as db:
                db.query(WorkspaceSubscription).delete()
                db.commit()
            self.seed(billing_interval=interval)
            self.apply(self.failed(interval))
            subscription = self.apply(self.remote(interval))
            self.assertIsNone(subscription.payment_due_at)
            self.assertEqual(subscription.ai_recurring_credits_used, 0)
            self.assertEqual(subscription.ai_credit_period_start, self.now)
            self.assertEqual(subscription.ai_credit_topup_credits, 123)
            self.assertTrue(build_subscription_access_state(subscription).access_allowed)
            with self.sessions() as db:
                subscription = db.query(WorkspaceSubscription).one()
                subscription.ai_recurring_credits_used = 12
                subscription.ai_credits_used = 12
                db.commit()
            self.assertEqual(self.apply(self.remote(interval)).ai_recurring_credits_used, 12)

    def test_active_but_unpaid_invoice_never_grants_new_allocation(self):
        self.seed()
        for invoice_status in ("draft", "open", "uncollectible"):
            remote = self.remote(latest_invoice={"status": invoice_status, "billing_reason": "subscription_cycle", "created": timestamp(self.now)})
            subscription = self.apply(remote)
            self.assertEqual(subscription.status, "past_due")
            self.assertEqual(subscription.ai_recurring_credits_used, 4000)

    def test_failed_monthly_to_annual_change_preserves_paid_credit_limit(self):
        from app.modules.ai.credits import get_recurring_ai_credit_limit

        self.seed()
        with self.sessions() as db:
            prior_limit = get_recurring_ai_credit_limit(db.query(WorkspaceSubscription).one())
        subscription = self.apply(self.failed("year"))
        self.assertEqual(get_recurring_ai_credit_limit(subscription), prior_limit)
        self.assertEqual(subscription.ai_grace_credit_limit, prior_limit)
        subscription = self.apply(self.remote("year"))
        self.assertIsNone(subscription.ai_grace_credit_limit)
        self.assertGreater(get_recurring_ai_credit_limit(subscription), prior_limit)

    def test_initial_incomplete_payment_and_paused_subscription_block_access(self):
        self.seed()
        for status in ("incomplete", "incomplete_expired", "unpaid", "paused", "canceled"):
            subscription = self.apply(self.remote(status=status))
            self.assertFalse(build_subscription_access_state(subscription).access_allowed)
            self.assertEqual(subscription.ai_recurring_credits_used, 4000)

    def test_cancel_at_period_end_is_healthy_and_resumption_does_not_reset_credits(self):
        self.seed(current_period_start=self.now, ai_credit_period_start=self.now)
        subscription = self.apply(self.remote(cancel_at_period_end=True))
        state = build_subscription_access_state(subscription)
        self.assertTrue(state.access_allowed)
        self.assertEqual(state.status, "canceling")
        self.assertFalse(state.requires_billing_action)
        self.assertEqual(subscription.ai_recurring_credits_used, 4000)
        subscription = self.apply(self.remote(cancel_at_period_end=False))
        self.assertEqual(build_subscription_access_state(subscription).status, "active")
        self.assertEqual(subscription.ai_recurring_credits_used, 4000)

    def test_actual_cancellation_uses_end_not_earlier_request_date(self):
        self.seed()
        subscription = self.apply(self.remote(status="canceled", canceled_at=timestamp(self.start), ended_at=timestamp(self.now)))
        self.assertEqual(subscription.canceled_at, self.now)
        self.assertFalse(build_subscription_access_state(subscription).access_allowed)

    def test_portal_interval_and_plan_changes_override_stale_metadata(self):
        self.seed()
        remote = self.remote("year")
        remote["items"]["data"][0]["price"]["id"] = "price_agency_year"
        subscription = self.apply(remote)
        self.assertEqual(subscription.billing_interval, "year")
        self.assertEqual(subscription.plan, "agency")

    def test_calendar_periods_follow_provider_including_leap_year(self):
        subscription = WorkspaceSubscription(current_period_start=datetime(2027, 2, 28), status="active")
        start, end = datetime(2028, 2, 29), datetime(2029, 2, 28)
        apply_renewal_period(subscription, {"status": "active"}, {
            "current_period_start": timestamp(start), "current_period_end": timestamp(end),
        })
        self.assertEqual(subscription.current_period_end, end)
        self.assertEqual(subscription.current_period_start, start)

    async def test_access_read_recovers_missed_monthly_and_annual_webhooks(self):
        for interval in ("month", "year"):
            with self.sessions() as db:
                db.query(WorkspaceSubscription).delete()
                db.commit()
            self.seed(billing_interval=interval)
            with patch.object(billing, "retrieve_stripe_subscription", return_value=self.remote(interval)) as retrieve:
                response = await billing.get_billing_access(self.request)
            self.assertTrue(response.access_allowed)
            retrieve.assert_called_once_with("sub_owner")

    async def test_agency_client_access_reconciles_shared_agency_subscription(self):
        self.seed()
        with patch.object(billing, "get_auth_context", return_value=SimpleNamespace(workspace_id="owner:client:1")), patch.object(
            billing, "retrieve_stripe_subscription", return_value=self.remote()
        ):
            response = await billing.get_billing_access(self.request)
        self.assertEqual(response.billing_workspace_id, "owner")
        self.assertTrue(response.access_allowed)

    async def test_provider_outage_returns_retryable_error_not_false_expiry(self):
        self.seed()
        with patch.object(billing, "retrieve_stripe_subscription", side_effect=service.BillingProviderUnavailable("timeout")):
            with self.assertRaises(HTTPException) as failure:
                await billing.get_billing_access(self.request)
        self.assertEqual(failure.exception.status_code, 503)
        with self.sessions() as db:
            self.assertEqual(db.query(WorkspaceSubscription).one().current_period_end, self.now)

    def test_healthy_access_reads_do_not_hit_provider_and_expiry_boundary_does(self):
        self.seed(current_period_end=self.now + timedelta(days=1), provider_checked_at=self.now)
        with self.sessions() as db, patch.object(billing, "retrieve_stripe_subscription", return_value=self.remote()) as retrieve:
            subscription = db.query(WorkspaceSubscription).one()
            self.assertFalse(reconcile_subscription_if_needed(db, subscription, now=self.now))
            subscription.current_period_end = self.now
            subscription.provider_checked_at = self.now - timedelta(seconds=5)
            self.assertTrue(reconcile_subscription_if_needed(db, subscription, now=self.now))
            retrieve.assert_called_once()

    def test_grace_reconciliation_is_throttled_but_not_across_expiry_boundary(self):
        self.seed(status="past_due", payment_due_at=self.now - timedelta(days=6), provider_checked_at=self.now)
        with self.sessions() as db, patch.object(billing, "retrieve_stripe_subscription") as retrieve:
            subscription = db.query(WorkspaceSubscription).one()
            self.assertFalse(reconcile_subscription_if_needed(db, subscription, now=self.now))
            retrieve.assert_not_called()

    def test_duplicate_renewals_racing_credit_reservations_preserve_usage(self):
        from app.modules.ai import credits

        self.seed()
        self.apply(self.remote())
        remote = self.remote()
        def transact(task):
            if task == "use":
                credits.reserve_ai_credits(workspace_id="owner", operation="renewal-test", estimated_tokens=1000)
            else:
                self.apply(remote)
        from app.db.models import AIUsageEvent
        AIUsageEvent.__table__.create(self.engine)
        with patch.object(credits, "SessionLocal", self.sessions), patch.object(credits, "_maybe_notify_low_balance"), patch.object(
            credits, "get_billing_plan_definition", return_value={"ai_credit_limit": 5000}
        ), patch.object(credits, "get_ai_credit_allocations", return_value={"additional_client_workspace": 0}), patch.object(
            credits, "get_ai_credit_pack_size", return_value=5000
        ):
            with ThreadPoolExecutor(max_workers=4) as pool:
                list(pool.map(transact, ["renew", "use"] * 8))
        with self.sessions() as db:
            subscription = db.query(WorkspaceSubscription).one()
            self.assertEqual(subscription.ai_recurring_credits_used, 8)
            self.assertEqual(subscription.ai_credits_used, 8)
            self.assertEqual(subscription.ai_credit_topup_credits, 123)

    def test_payment_reminder_contains_grace_deadline_not_next_year_end(self):
        self.seed()
        subscription = self.apply(self.failed("year"))
        state = build_subscription_access_state(subscription, self.now)
        key, _, body = notifications.build_lifecycle_notice(subscription, state)
        self.assertIn(state.grace_period_end.isoformat(), key)
        self.assertIn(state.grace_period_end.isoformat(), body)
        self.assertNotIn(subscription.current_period_end.isoformat(), body)

    def test_canceled_trial_reminder_never_promises_automatic_charge(self):
        self.seed(status="trialing", current_period_end=self.now + timedelta(days=3), cancel_at_period_end=1)
        with self.sessions() as db:
            subscription = db.query(WorkspaceSubscription).one()
            notice = notifications.build_lifecycle_notice(subscription, build_subscription_access_state(subscription))
        self.assertIn("Auto-renewal is off", notice[2])
        self.assertNotIn("billing automatically", notice[2])

    def test_annual_renewal_reminder_and_monthly_auto_renew_are_not_expiry(self):
        subscription = WorkspaceSubscription(workspace_id="owner", plan="professional", status="active", billing_interval="year", current_period_end=self.now + timedelta(days=29))
        notice = notifications.build_lifecycle_notice(subscription, build_subscription_access_state(subscription))
        self.assertIn("renews soon", notice[1])
        self.assertIn("renew automatically", notice[2])
        subscription.billing_interval = "month"
        self.assertIsNone(notifications.build_lifecycle_notice(subscription, build_subscription_access_state(subscription)))

    def test_scheduler_verifies_before_notices_or_deletion_and_deduplicates(self):
        self.seed(current_period_end=self.now - timedelta(days=100), billing_interval="year")
        with self.sessions() as db:
            db.add(Organization(owner_user_id="owner", name="Test", country="Canada"))
            db.commit()
            remote = self.remote("year")
            remote["items"]["data"][0]["current_period_end"] = timestamp(self.now + timedelta(days=15))
            with patch.object(billing, "retrieve_stripe_subscription", return_value=remote), patch.object(
                notifications, "purge_workspace_data_after_expiry"
            ) as purge, patch.object(notifications, "get_workspace_owner_email", return_value="owner@example.test"), patch.object(
                notifications, "send_platform_system_email"
            ) as email:
                first = notifications.send_due_billing_lifecycle_notifications(db, self.now)
                second = notifications.send_due_billing_lifecycle_notifications(db, self.now)
            self.assertEqual(first["notified"], 1)
            self.assertEqual(second["notified"], 0)
            purge.assert_not_called()
            email.assert_called_once()

    def test_scheduler_provider_outage_never_deletes_or_emails_stale_expiry(self):
        self.seed(current_period_end=self.now - timedelta(days=100))
        with self.sessions() as db, patch.object(billing, "retrieve_stripe_subscription", side_effect=service.BillingProviderUnavailable("timeout")), patch.object(
            notifications, "purge_workspace_data_after_expiry"
        ) as purge, patch.object(notifications, "send_platform_system_email") as email:
            result = notifications.send_due_billing_lifecycle_notifications(db, self.now)
        self.assertEqual(result["failed"], 1)
        purge.assert_not_called()
        email.assert_not_called()

    async def test_stale_failed_invoice_cannot_undo_verified_paid_renewal(self):
        self.seed()
        event = {"id": "evt_old_failure", "type": "invoice.payment_failed", "data": {"object": {"parent": {"subscription_details": {"subscription": "sub_owner"}}}}}
        request = Request({"type": "http", "headers": []}, AsyncMock(return_value={"type": "http.request", "body": b"{}", "more_body": False}))
        with patch.object(billing, "verify_stripe_webhook", return_value=event), patch.object(billing, "retrieve_stripe_subscription", return_value=self.remote()):
            await billing.billing_webhook(request)
            duplicate = await billing.billing_webhook(request)
        self.assertTrue(duplicate["duplicate"])
        with self.sessions() as db:
            subscription = db.query(WorkspaceSubscription).one()
            self.assertEqual(subscription.status, "active")
            self.assertIsNone(subscription.payment_due_at)

    def test_provider_retrieval_expands_invoice(self):
        with patch.object(service, "require_billing_config", return_value={"secret_key": "test"}), patch.object(service, "stripe_request", return_value={}) as request:
            service.retrieve_stripe_subscription("sub_owner")
        self.assertEqual(request.call_args.args[1], {"expand[0]": "latest_invoice"})

    def test_existing_database_migration_preserves_consumed_credit_period(self):
        engine = create_engine("sqlite:///:memory:")
        with engine.begin() as connection:
            connection.execute(text("CREATE TABLE workspace_subscriptions (current_period_start TIMESTAMP, ai_credits_used INTEGER)"))
            connection.execute(text("INSERT INTO workspace_subscriptions VALUES ('2026-10-01 00:00:00', 321)"))
        tree = ast.parse((Path(__file__).parents[1] / "app/main.py").read_text())
        function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "ensure_billing_subscription_columns")
        namespace = {"engine": engine, "text": text, "get_table_columns": lambda connection, name: {col["name"] for col in inspect(connection).get_columns(name)}}
        exec(compile(ast.Module(body=[function], type_ignores=[]), "billing-migration", "exec"), namespace)
        namespace["ensure_billing_subscription_columns"]()
        namespace["ensure_billing_subscription_columns"]()
        with engine.connect() as connection:
            row = connection.execute(text("SELECT ai_credit_period_start, ai_recurring_credits_used FROM workspace_subscriptions")).one()
        self.assertEqual(row[0], "2026-10-01 00:00:00")
        self.assertEqual(row[1], 321)
        engine.dispose()


@unittest.skipUnless(os.getenv("DECISIONATE_TEST_POSTGRES_URL"), "PostgreSQL test URL is not configured")
class PostgresRenewalConcurrencyTests(unittest.TestCase):
    def test_verified_renewal_and_duplicate_updates_preserve_concurrent_usage(self):
        from app.db.models import AIUsageEvent
        from app.modules.ai import credits

        engine = create_engine(os.environ["DECISIONATE_TEST_POSTGRES_URL"])
        for table in (WorkspaceSubscription.__table__, AIUsageEvent.__table__):
            table.create(engine, checkfirst=True)
        tree = ast.parse((Path(__file__).parents[1] / "app/main.py").read_text())
        function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "ensure_billing_subscription_columns")
        namespace = {"engine": engine, "text": text, "get_table_columns": lambda connection, name: {col["name"] for col in inspect(connection).get_columns(name)}}
        exec(compile(ast.Module(body=[function], type_ignores=[]), "billing-migration", "exec"), namespace)
        namespace["ensure_billing_subscription_columns"]()
        sessions = sessionmaker(bind=engine)
        workspace = f"renewal-test-{uuid4().hex}"
        now = utc_now().replace(microsecond=0)
        remote = {"id": f"sub_{workspace}", "customer": f"cus_{workspace}", "status": "active",
            "metadata": {"workspace_id": workspace, "plan": "professional"},
            "current_period_start": timestamp(now), "current_period_end": timestamp(now + timedelta(days=30)),
            "latest_invoice": {"status": "paid", "billing_reason": "subscription_cycle"},
        }
        with sessions() as db:
            db.add(WorkspaceSubscription(workspace_id=workspace, plan="professional", status="active", provider_subscription_id=remote["id"],
                current_period_start=now - timedelta(days=30), current_period_end=now, ai_credits_used=1000, ai_recurring_credits_used=1000, ai_credit_topup_credits=123))
            db.commit()
        def transact(task):
            if task == "use":
                credits.reserve_ai_credits(workspace_id=workspace, operation="renewal-test", estimated_tokens=1000)
            else:
                with sessions() as db:
                    billing.apply_stripe_billing_event(db, "customer.subscription.updated", remote)
                    db.commit()
        try:
            with patch.dict(os.environ, {"BILLING_ENFORCEMENT_ENABLED": "true"}), patch.object(credits, "SessionLocal", sessions), patch.object(
                credits, "_maybe_notify_low_balance"
            ), patch.object(billing, "get_billing_config", return_value={"provider": "stripe"}), patch.object(
                credits, "get_billing_plan_definition", return_value={"ai_credit_limit": 5000}
            ), patch.object(credits, "get_ai_credit_allocations", return_value={"additional_client_workspace": 0}), patch.object(
                credits, "get_ai_credit_pack_size", return_value=5000
            ):
                transact("renew")
                with ThreadPoolExecutor(max_workers=8) as pool:
                    list(pool.map(transact, ["renew", "use"] * 12))
            with sessions() as db:
                subscription = db.query(WorkspaceSubscription).filter_by(workspace_id=workspace).one()
                self.assertEqual(subscription.ai_recurring_credits_used, 12)
                self.assertEqual(subscription.ai_credits_used, 12)
                self.assertEqual(subscription.ai_credit_topup_credits, 123)
        finally:
            with sessions() as db:
                db.query(AIUsageEvent).filter_by(workspace_id=workspace).delete()
                db.query(WorkspaceSubscription).filter_by(workspace_id=workspace).delete()
                db.commit()
            engine.dispose()
