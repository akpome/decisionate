import os
import unittest
from unittest.mock import patch
from uuid import uuid4

from sqlalchemy import create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.schema import CreateSchema, DropSchema

from app.db.models import PlatformBillingSettings, WorkspaceSubscription
from app.modules.billing import service


class BillingSettingsTransactionTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        self.addCleanup(self.engine.dispose)
        WorkspaceSubscription.__table__.create(self.engine)
        self.sessions = sessionmaker(bind=self.engine, autoflush=False)

    def read_fallbacks(self, db):
        with patch.dict(os.environ, {
            "DECISIONATE_AI_CREDIT_PACK_SIZE": "1234",
            "DECISIONATE_PROFESSIONAL_AI_CREDITS": "4567",
            "STRIPE_PROFESSIONAL_PRICE_ID": "price_environment",
        }), patch.object(service, "SessionLocal", side_effect=AssertionError("Reuse the caller's session")):
            self.assertEqual(service.get_ai_credit_pack_size(db), 1234)
            self.assertEqual(service.get_ai_credit_allocations(db)["professional"], 4567)
            self.assertEqual(service.get_billing_pricing(db), service.BILLING_PRICING_DEFAULTS)
            self.assertEqual(service.get_billing_config(db)["professional_price_id"], "price_environment")
        self.assertTrue(db.is_active)
        self.assertTrue(db.in_transaction())

    def test_missing_settings_preserve_pending_writes_and_allow_commit(self):
        with self.sessions() as db:
            db.add(WorkspaceSubscription(workspace_id="pending", ai_credits_used=7))
            self.read_fallbacks(db)
            db.add(WorkspaceSubscription(workspace_id="after-read", ai_credits_used=2))
            db.commit()
        with self.sessions() as db:
            self.assertEqual(db.query(WorkspaceSubscription).filter_by(workspace_id="pending").one().ai_credits_used, 7)
            self.assertEqual(db.query(WorkspaceSubscription).filter_by(workspace_id="after-read").one().ai_credits_used, 2)

    def test_missing_settings_do_not_commit_or_rollback_the_callers_changes(self):
        with self.sessions() as db:
            db.add(WorkspaceSubscription(workspace_id="existing", ai_credits_used=3))
            db.commit()
        with self.sessions() as db:
            subscription = db.query(WorkspaceSubscription).filter_by(workspace_id="existing").one()
            subscription.ai_credits_used = 8
            self.read_fallbacks(db)
            self.assertEqual(subscription.ai_credits_used, 8)
            db.rollback()
        with self.sessions() as db:
            self.assertEqual(db.query(WorkspaceSubscription).filter_by(workspace_id="existing").one().ai_credits_used, 3)

    def test_unrelated_write_errors_are_not_swallowed_as_settings_fallbacks(self):
        with self.sessions() as db:
            db.add(WorkspaceSubscription(workspace_id="duplicate"))
            db.commit()
        with self.sessions() as db:
            db.add(WorkspaceSubscription(workspace_id="duplicate"))
            with self.assertRaises(IntegrityError):
                service.get_ai_credit_pack_size(db)
            db.rollback()

    def test_settings_read_uses_uncommitted_overrides_without_committing_them(self):
        PlatformBillingSettings.__table__.create(self.engine)
        with self.sessions() as db:
            db.add(PlatformBillingSettings(id=1, ai_credit_pack_size=123, professional_ai_credits=456,
                professional_monthly_price_cents=789, professional_price_id="price_pending"))
            self.assertEqual(service.get_ai_credit_pack_size(db), 123)
            self.assertEqual(service.get_ai_credit_allocations(db)["professional"], 456)
            self.assertEqual(service.get_billing_pricing(db)["professional_monthly_price_cents"], 789)
            self.assertEqual(service.get_billing_config(db)["professional_price_id"], "price_pending")
            db.rollback()
        with self.sessions() as db:
            self.assertIsNone(db.get(PlatformBillingSettings, 1))

    def test_owned_session_closes_after_a_failed_settings_read(self):
        with (
            self.sessions() as db,
            patch.object(service, "SessionLocal", return_value=db) as factory,
            patch.object(db, "close", wraps=db.close) as close,
            patch.dict(os.environ, {"DECISIONATE_AI_CREDIT_PACK_SIZE": "1234"}),
        ):
            self.assertEqual(service.get_ai_credit_pack_size(), 1234)
            factory.assert_called_once_with()
            close.assert_called_once_with()
            self.assertFalse(db.in_transaction())


@unittest.skipUnless(os.getenv("DECISIONATE_TEST_POSTGRES_URL"), "An isolated PostgreSQL test database is required")
class BillingSettingsPostgresTransactionTests(BillingSettingsTransactionTests):
    def setUp(self):
        engine = create_engine(os.environ["DECISIONATE_TEST_POSTGRES_URL"])
        self.addCleanup(engine.dispose)
        schema = "test_billing_settings_" + uuid4().hex
        with engine.begin() as connection:
            connection.execute(CreateSchema(schema))

        def drop_schema():
            with engine.begin() as connection:
                connection.execute(DropSchema(schema, cascade=True))

        self.addCleanup(drop_schema)
        self.engine = engine.execution_options(schema_translate_map={None: schema})
        WorkspaceSubscription.__table__.create(self.engine)
        self.sessions = sessionmaker(bind=self.engine, autoflush=False)
