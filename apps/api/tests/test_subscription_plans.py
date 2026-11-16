from datetime import timedelta
import ast
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.database import Base
from app.db.models import Organization, PlatformBillingSettings, WhiteLabelAvailability, WorkspaceSubscription, utc_now
from app.modules import applications, platform_admin, hosted_portals, white_label_availability
from app.modules.billing import service, router as billing
from app.modules.hosted_subdomains import context, service as hosted_service


class SubscriptionPlanTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.addCleanup(self.engine.dispose)
        self.Session = sessionmaker(bind=self.engine, expire_on_commit=False)
        for module in (applications, platform_admin, service, billing, white_label_availability):
            self.mock(patch.object(module, "SessionLocal", self.Session))
        self.mock(patch.object(platform_admin, "require_platform_admin", return_value=SimpleNamespace(user_id="operator")))
        self.mock(patch.object(white_label_availability, "require_platform_admin_full_access", return_value=SimpleNamespace(user_id="operator")))
        self.mock(patch.object(hosted_service, "launch_blockers", return_value=[]))
        self.mock(patch.object(hosted_portals, "platform_blockers", return_value=[]))
        app = FastAPI()
        app.include_router(platform_admin.router, prefix="/admin")
        app.include_router(applications.router)
        app.include_router(white_label_availability.router)
        app.include_router(billing.router, prefix="/billing")
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def mock(self, patcher):
        value = patcher.start()
        self.addCleanup(patcher.stop)
        return value

    def test_four_alternative_plans_keep_existing_prices_and_capacity(self):
        with self.Session() as db:
            plans = service.get_billing_plan_options(db)
        self.assertEqual([plan["plan"] for plan in plans], ["professional", "agency", "agency_subdomain", "agency_custom_domain"])
        self.assertEqual([plan["monthly_price_cents"] for plan in plans], [7900, 19900, 0, 0])
        self.assertEqual([plan["available"] for plan in plans], [True, True, False, False])
        for plan in service.AGENCY_PLANS:
            self.assertTrue(service.is_agency_plan(plan))
            self.assertEqual(service.get_client_workspace_limit(plan, 2), 12)
            self.assertEqual(service.get_billing_plan_definition(plan)["ai_credit_limit"], 25000)
        self.assertEqual(service.normalize_billing_plan("agency_growth"), "agency")

    def test_additive_migration_preserves_current_prices_and_is_repeatable(self):
        engine = create_engine("sqlite://")
        self.addCleanup(engine.dispose)
        with engine.begin() as connection:
            connection.execute(text("CREATE TABLE platform_billing_settings (id INTEGER PRIMARY KEY, professional_monthly_price_cents INTEGER, agency_monthly_price_cents INTEGER)"))
            connection.execute(text("INSERT INTO platform_billing_settings VALUES (1, 1234, 5678)"))
        tree = ast.parse((Path(__file__).parents[1] / "app/main.py").read_text())
        function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "ensure_platform_billing_columns")
        namespace = {"engine": engine, "text": text, "get_table_columns": lambda connection, name: {col["name"] for col in inspect(connection).get_columns(name)}}
        exec(compile(ast.Module(body=[function], type_ignores=[]), "pricing-migration", "exec"), namespace)
        namespace["ensure_platform_billing_columns"]()
        namespace["ensure_platform_billing_columns"]()
        with engine.connect() as connection:
            row = connection.execute(text("SELECT * FROM platform_billing_settings")).mappings().one()
        self.assertEqual(row["professional_monthly_price_cents"], 1234)
        self.assertEqual(row["agency_monthly_price_cents"], 5678)
        self.assertEqual(row["agency_subdomain_monthly_price_cents"], 0)
        self.assertIsNone(row["agency_custom_domain_price_id"])

    def test_admin_prices_persist_and_public_catalog_excludes_stripe_ids(self):
        payload = {}
        for index, plan in enumerate(service.PUBLIC_BILLING_PLANS, start=1):
            payload.update({f"{plan}_monthly_price_cents": index * 1000, f"{plan}_annual_price_cents": index * 10000,
                            f"{plan}_price_id": f"price_{plan}_month", f"{plan}_annual_price_id": f"price_{plan}_year"})
        saved = self.client.patch("/admin/credit-settings", json=payload)
        self.assertEqual(saved.status_code, 200, saved.text)
        for key, value in payload.items():
            self.assertEqual(saved.json()[key], value)
        self.assertEqual(self.client.patch("/admin/credit-settings", json={"agency_ai_credits": 31000}).status_code, 200)
        result = self.client.get("/api/v2/application/plans")
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.headers["Cache-Control"], "no-store")
        self.assertNotIn("price_id", result.text)
        self.assertNotIn("secret_key", result.text)
        for index, option in enumerate(result.json()["plans"], start=1):
            self.assertEqual(option["monthly_price_cents"], index * 1000)
            self.assertTrue(option["monthly_configured"])
            self.assertEqual(option["annual_price_cents"], index * 10000)
            if option["billing_model"] == "agency":
                self.assertEqual(option["ai_credit_limit"], 31000)
        negative = self.client.patch("/admin/credit-settings", json={"agency_custom_domain_monthly_price_cents": -1})
        self.assertEqual(negative.status_code, 400)

    def test_custom_domain_stays_closed_until_admin_enables_it(self):
        with self.Session() as db:
            self.assertFalse(service.plan_available(service.AGENCY_CUSTOM_DOMAIN_PLAN, db))
        response = self.client.put("/admin/white-label-availability", json={"offering": "custom_domain", "enabled": True,
            "revision": 0, "confirmation": "CHANGE AVAILABILITY"})
        self.assertEqual(response.status_code, 200, response.text)
        with self.Session() as db:
            self.assertTrue(service.plan_available(service.AGENCY_CUSTOM_DOMAIN_PLAN, db))
            self.assertFalse(service.plan_available(service.AGENCY_SUBDOMAIN_PLAN, db))
        with patch.object(hosted_portals, "platform_blockers", return_value=["Not ready"]), self.Session() as db:
            self.assertFalse(service.plan_available(service.AGENCY_CUSTOM_DOMAIN_PLAN, db))

    def test_closed_plan_rejects_checkout_before_calling_stripe(self):
        self.mock(patch.object(billing, "require_billing_owner", return_value=SimpleNamespace(user_id="owner", workspace_id="owner")))
        self.mock(patch.object(billing, "require_payments_enabled"))
        with patch.object(billing, "create_checkout_session") as checkout:
            result = self.client.post("/billing/checkout", json={"plan": "agency_custom_domain"})
        self.assertEqual(result.status_code, 409, result.text)
        checkout.assert_not_called()

    def test_hosted_portal_requires_white_label_not_standard_agency(self):
        with self.Session() as db:
            agency = Organization(owner_user_id="owner", name="Agency")
            subscription = WorkspaceSubscription(workspace_id="owner", status="active", plan="agency", current_period_end=utc_now() + timedelta(days=30))
            db.add_all([agency, subscription])
            db.commit()
            self.assertFalse(context.entitled(db, agency))
            for plan in ("agency_subdomain", "agency_custom_domain"):
                subscription.plan = plan
                db.flush()
                self.assertTrue(context.entitled(db, agency))
            subscription.status = "canceled"
            subscription.current_period_end = utc_now() - timedelta(days=1)
            db.flush()
            self.assertFalse(context.entitled(db, agency))

    def test_new_plan_checkout_uses_one_base_price_and_existing_addons(self):
        for plan in ("agency_subdomain", "agency_custom_domain"):
            for interval in ("month", "year"):
                key = f"{plan}_{'annual_' if interval == 'year' else ''}price_id"
                with patch.object(service, "plan_available", return_value=True), patch.object(service, "require_billing_config", return_value={key: "price_base", "secret_key": "test", "web_app_url": "https://app.test"}), patch.object(service, "stripe_request", return_value={"id": "cs_test", "url": "https://checkout.test"}) as stripe:
                    service.create_checkout_session(workspace_id="owner", owner_user_id="owner", owner_email=None,
                        organization_name="Agency", plan=plan, billing_interval=interval)
                fields = stripe.call_args.args[1]
                self.assertEqual(fields["line_items[0][price]"], "price_base")
                self.assertEqual(fields["metadata[plan]"], plan)
                self.assertNotIn("line_items[1][price]", fields)
