import json
import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import Column, Integer, MetaData, create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from sqlalchemy.schema import CreateSchema, DropSchema

from app.db.models import PlatformBillingSettings, WorkspaceSubscription
from app.modules import platform_admin as admin
from app.modules.billing import service


class AdminPricingSettingsTests(unittest.TestCase):
    def make_engine(self):
        return create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)

    def setUp(self):
        self.enterContext(patch.dict("os.environ", {"APP_ENV": "test", "DATABASE_URL": "sqlite://"}, clear=True))
        self.engine = self.make_engine()
        self.addCleanup(self.engine.dispose)
        for model in (PlatformBillingSettings, WorkspaceSubscription, admin.PlatformAdminAuditEvent):
            model.__table__.create(self.engine)
        self.sessions = sessionmaker(bind=self.engine, autoflush=False)
        self.enterContext(patch.object(admin, "SessionLocal", self.sessions))
        self.enterContext(patch.object(service, "SessionLocal", self.sessions))
        self.enterContext(patch.object(admin, "require_platform_admin", return_value=SimpleNamespace(user_id="usr_operator")))
        application = FastAPI()
        application.include_router(admin.router, prefix="/admin")
        self.client = TestClient(application)
        self.addCleanup(self.client.close)

    def test_first_save_round_trips_all_four_plan_prices_and_stripe_ids(self):
        initial = self.client.get("/admin/credit-settings")
        self.assertEqual(initial.status_code, 200, initial.text)
        payload = {key: (index + 1) * 100 for index, key in enumerate(service.BILLING_PRICING_COLUMNS)}
        payload.update({key: "price_" + key for key in service.BILLING_PRICE_ID_COLUMNS})
        payload.update(free_ai_credits=0, professional_ai_credits=500, agency_ai_credits=1500,
                       additional_client_workspace_ai_credits=125, ai_credit_pack_size=2000)
        saved = self.client.patch("/admin/credit-settings", json=payload)
        self.assertEqual(saved.status_code, 200, saved.text)
        for key, value in payload.items():
            self.assertEqual(saved.json()[key], value, key)
        loaded = self.client.get("/admin/credit-settings")
        self.assertEqual(loaded.status_code, 200, loaded.text)
        self.assertEqual(loaded.json(), saved.json())

    def test_updating_existing_prices_keeps_unsubmitted_settings_and_subscriptions(self):
        with self.sessions() as db:
            db.add(PlatformBillingSettings(id=1, professional_price_id="price_current", agency_annual_price_cents=345600))
            db.add(WorkspaceSubscription(workspace_id="usr_customer", plan="professional", provider_subscription_id="sub_unchanged"))
            db.commit()
        response = self.client.patch("/admin/credit-settings", json={"professional_monthly_price_cents": 8900})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["professional_monthly_price_cents"], 8900)
        self.assertEqual(response.json()["agency_annual_price_cents"], 345600)
        self.assertEqual(response.json()["professional_price_id"], "price_current")
        with self.sessions() as db:
            self.assertEqual(db.query(WorkspaceSubscription).one().provider_subscription_id, "sub_unchanged")
            self.assertEqual(json.loads(db.query(admin.PlatformAdminAuditEvent).one().details)["professional_monthly_price_cents"], 8900)

    def test_first_save_handles_a_retired_required_column_without_a_server_default(self):
        legacy = PlatformBillingSettings.__table__.to_metadata(MetaData())
        if "agency_client_ai_credits" not in legacy.c:
            legacy.append_column(Column("agency_client_ai_credits", Integer, nullable=False))
        PlatformBillingSettings.__table__.drop(self.engine)
        legacy.create(self.engine)
        result = self.client.patch("/admin/credit-settings", json={"professional_monthly_price_cents": 8900})
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json()["professional_monthly_price_cents"], 8900)
        with self.engine.connect() as connection:
            self.assertEqual(connection.execute(text("SELECT agency_client_ai_credits FROM platform_billing_settings")).scalar(), 2500)

    def test_existing_retired_allowance_is_preserved_but_does_not_change_shared_agency_credits(self):
        with self.sessions() as db:
            db.add(PlatformBillingSettings(id=1, agency_client_ai_credits=7654, agency_ai_credits=32000)); db.commit()
        response = self.client.patch("/admin/credit-settings", json={"agency_monthly_price_cents": 21900})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertNotIn("agency_client_ai_credits", response.json())
        with self.sessions() as db:
            self.assertEqual(db.get(PlatformBillingSettings, 1).agency_client_ai_credits, 7654)
            self.assertEqual(service.get_ai_credit_allocations(db)["agency"], 32000)
            self.assertNotIn("agency_client", service.get_ai_credit_allocations(db))

    def test_bootstrap_restores_column_for_databases_created_after_it_was_removed(self):
        from app import main
        with self.sessions() as db:
            db.add(PlatformBillingSettings(id=1, professional_monthly_price_cents=1337)); db.commit()
        with self.engine.begin() as connection:
            connection.execute(text("ALTER TABLE platform_billing_settings DROP COLUMN agency_client_ai_credits"))
        with patch.object(main, "engine", self.engine):
            main.ensure_platform_billing_columns()
            main.ensure_platform_billing_columns()
        loaded = self.client.get("/admin/credit-settings")
        self.assertEqual(loaded.status_code, 200, loaded.text)
        self.assertEqual(loaded.json()["professional_monthly_price_cents"], 1337)
        saved = self.client.patch("/admin/credit-settings", json={"agency_subdomain_monthly_price_cents": 32900})
        self.assertEqual(saved.status_code, 200, saved.text)
        self.assertEqual(saved.json()["agency_subdomain_monthly_price_cents"], 32900)

    def test_zero_values_and_clearing_a_stripe_price_id_are_valid(self):
        self.assertEqual(self.client.patch("/admin/credit-settings", json={"professional_price_id": "price_before"}).status_code, 200)
        result = self.client.patch("/admin/credit-settings", json={"professional_monthly_price_cents": 0, "professional_price_id": "  "})
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json()["professional_monthly_price_cents"], 0)
        self.assertEqual(result.json()["professional_price_id"], "")

    def test_invalid_numeric_values_are_rejected_before_writing_settings(self):
        fields = {*service.BILLING_PRICING_COLUMNS, "free_ai_credits", "professional_ai_credits", "agency_ai_credits", "additional_client_workspace_ai_credits", "ai_credit_pack_size"}
        for field in sorted(fields):
            for amount in (-1, 2147483648):
                with self.subTest(field=field, amount=amount):
                    response = self.client.patch("/admin/credit-settings", json={field: amount})
                    self.assertEqual(response.status_code, 400, response.text)
        with self.sessions() as db:
            self.assertEqual(db.query(PlatformBillingSettings).count(), 0)
            self.assertEqual(db.query(admin.PlatformAdminAuditEvent).count(), 0)

    def test_unregistered_price_id_config_does_not_become_a_save_field_or_audit_secret(self):
        config = {**service.get_billing_config(), "retired_extra_price_id": "price_extra", "secret_key": "sk_private_fixture"}
        with patch.object(admin, "get_billing_config", return_value=config):
            response = self.client.patch("/admin/credit-settings", json={"professional_monthly_price_cents": 8900})
        self.assertEqual(response.status_code, 200, response.text)
        with self.sessions() as db:
            event = db.query(admin.PlatformAdminAuditEvent).one()
            self.assertNotIn("retired_extra_price_id", event.details)
            self.assertNotIn("sk_private_fixture", event.details)

    def test_failed_audit_rolls_back_the_save_and_does_not_leave_a_default_settings_row(self):
        from fastapi import HTTPException
        with patch.object(admin, "record_platform_admin_audit", side_effect=HTTPException(503, "Audit temporarily unavailable")):
            response = self.client.patch("/admin/credit-settings", json={"professional_monthly_price_cents": 8900})
        self.assertEqual(response.status_code, 503, response.text)
        with self.sessions() as db:
            self.assertEqual(db.query(PlatformBillingSettings).count(), 0)
            self.assertEqual(db.query(admin.PlatformAdminAuditEvent).count(), 0)

    def test_prices_require_platform_administrator_permission(self):
        from fastapi import HTTPException
        with patch.object(admin, "require_platform_admin", side_effect=HTTPException(403, "Platform admin access required")):
            self.assertEqual(self.client.get("/admin/credit-settings").status_code, 403)
            self.assertEqual(self.client.patch("/admin/credit-settings", json={"professional_monthly_price_cents": 8900}).status_code, 403)

    def test_saving_settings_does_not_call_stripe_or_change_an_existing_subscription(self):
        with self.sessions() as db:
            db.add(WorkspaceSubscription(workspace_id="usr_customer", plan="professional", status="active", provider_subscription_id="sub_existing")); db.commit()
        with patch.object(service, "urlopen", side_effect=AssertionError("Saving prices must not contact Stripe")) as network:
            response = self.client.patch("/admin/credit-settings", json={"professional_monthly_price_cents": 8900})
        self.assertEqual(response.status_code, 200, response.text)
        network.assert_not_called()
        with self.sessions() as db:
            subscription = db.query(WorkspaceSubscription).one()
            self.assertEqual((subscription.plan, subscription.status, subscription.provider_subscription_id), ("professional", "active", "sub_existing"))


@unittest.skipUnless(os.getenv("DECISIONATE_TEST_POSTGRES_URL"), "An isolated PostgreSQL test database is required")
class PostgresAdminPricingSettingsTests(AdminPricingSettingsTests):
    def setUp(self):
        self.postgres_url = os.environ["DECISIONATE_TEST_POSTGRES_URL"]
        super().setUp()

    def make_engine(self):
        schema = "admin_pricing_test_" + uuid4().hex
        engine = create_engine(self.postgres_url)
        self.addCleanup(engine.dispose)
        with engine.begin() as connection:
            connection.execute(CreateSchema(schema))
        def drop_schema():
            with engine.begin() as connection:
                connection.execute(DropSchema(schema, cascade=True))
        self.addCleanup(drop_schema)
        return create_engine(self.postgres_url, connect_args={"options": f"-csearch_path={schema}"})
