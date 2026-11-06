"""Regression coverage for identity migrations on partially migrated accounts."""

from contextlib import ExitStack
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from uuid import uuid4

from sqlalchemy import Column, Integer, MetaData, String, Table, create_engine, inspect, select, text
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.schema import CreateSchema, DropSchema

from app.db.models import AppUser, AuthIdentity, Dataset, WeeklyReportPreference, WorkspaceSubscription
from app.modules.identity import service


class InternalIdentityBackfillTests(unittest.TestCase):
    legacy = "user_legacy_owner"
    internal = "usr_internal_owner"

    def database_engine(self, directory):
        return create_engine(f"sqlite:///{Path(directory) / 'identity.db'}")

    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        directory = self.stack.enter_context(tempfile.TemporaryDirectory())
        self.engine = self.database_engine(directory)
        self.addCleanup(self.engine.dispose)
        for model in (AppUser, AuthIdentity, Dataset, WeeklyReportPreference, WorkspaceSubscription):
            model.__table__.create(self.engine)
        existing = set(inspect(self.engine).get_table_names())
        identifier_columns = {}
        for table_name, column_name in (*service.LEGACY_IDENTITY_COLUMNS, *service.WORKSPACE_COLUMNS):
            if table_name not in existing:
                identifier_columns.setdefault(table_name, set()).add(column_name)
        legacy_schema = MetaData()
        for table_name, columns in identifier_columns.items():
            Table(table_name, legacy_schema, *(Column(name, String) for name in sorted(columns)))
        legacy_schema.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine)
        self.stack.enter_context(patch.object(service, "engine", self.engine))
        self.stack.enter_context(patch.object(service, "SessionLocal", self.sessions))
        with self.sessions() as db:
            db.add(AppUser(id=self.internal))
            db.add(AuthIdentity(user_id=self.internal, provider="legacy", subject=self.legacy))
            db.commit()

    def add_subscription(self, workspace, **values):
        with self.sessions() as db:
            record = WorkspaceSubscription(workspace_id=workspace, **values)
            db.add(record)
            db.commit()
            return record.id

    def subscriptions(self):
        with self.engine.connect() as connection:
            return [dict(row) for row in connection.execute(
                select(WorkspaceSubscription.__table__).order_by(WorkspaceSubscription.id),
            ).mappings()]

    def test_legacy_subscription_migrates_without_changing_billing_fields(self):
        self.add_subscription(self.legacy, plan="professional", status="active",
                              provider_subscription_id="sub_legacy", ai_credits_used=7, ai_credit_topup_credits=100)
        before = self.subscriptions()
        service.ensure_internal_identity_backfill()
        before[0]["workspace_id"] = self.internal
        self.assertEqual(self.subscriptions(), before)

    def test_duplicate_workspace_subscriptions_are_preserved_without_overwriting_either(self):
        self.add_subscription(self.legacy, plan="professional", status="active",
                              provider_subscription_id="sub_legacy", ai_credits_used=7, ai_credit_topup_credits=100)
        self.add_subscription(self.internal, plan="agency", status="past_due",
                              provider_subscription_id="sub_canonical", ai_credits_used=11, ai_credit_topup_credits=200)
        before = self.subscriptions()
        with self.assertLogs(service.logger, level="WARNING") as logs:
            service.ensure_internal_identity_backfill()
        self.assertEqual(self.subscriptions(), before)
        self.assertIn("billing reconciliation is required", logs.output[0])
        self.assertEqual(logs.records[0].legacy_workspace_id, self.legacy)
        self.assertEqual(logs.records[0].workspace_id, self.internal)

    def test_an_existing_free_record_does_not_silently_replace_a_legacy_paid_record(self):
        self.add_subscription(self.legacy, plan="professional", status="active", provider_subscription_id="sub_paid")
        self.add_subscription(self.internal)
        before = self.subscriptions()
        with self.assertLogs(service.logger, level="WARNING"):
            service.ensure_internal_identity_backfill()
        self.assertEqual(self.subscriptions(), before)

    def test_a_billing_collision_does_not_roll_back_other_workspace_migrations(self):
        self.add_subscription(self.legacy)
        self.add_subscription(self.internal)
        with self.sessions() as db:
            db.add(Dataset(user_id=self.legacy, workspace_id=self.legacy, source_type="csv", file_name="sales.csv",
                           file_path="sales.parquet", row_count=2, column_count=2))
            db.add(WeeklyReportPreference(workspace_id=self.legacy))
            db.commit()
        with self.assertLogs(service.logger, level="WARNING"):
            service.ensure_internal_identity_backfill()
        with self.sessions() as db:
            dataset = db.query(Dataset).one()
            self.assertEqual((dataset.user_id, dataset.workspace_id), (self.internal, self.internal))
            self.assertEqual(db.query(WeeklyReportPreference).one().workspace_id, self.internal)

    def test_client_workspace_prefixes_use_the_same_collision_policy(self):
        for suffix in (":client:one", ":client:two"):
            self.add_subscription(f"{self.legacy}{suffix}")
        self.add_subscription(f"{self.internal}:client:two")
        before = self.subscriptions()
        with self.assertLogs(service.logger, level="WARNING"):
            service.ensure_internal_identity_backfill()
        before[0]["workspace_id"] = f"{self.internal}:client:one"
        self.assertEqual(self.subscriptions(), before)

    def test_repeated_startup_does_not_create_users_or_change_subscription_balances(self):
        self.add_subscription(self.legacy, ai_credit_topup_credits=35)
        self.add_subscription(self.internal, ai_credit_topup_credits=65)
        before = self.subscriptions()
        with self.assertLogs(service.logger, level="WARNING"):
            service.ensure_internal_identity_backfill()
            service.ensure_internal_identity_backfill()
        self.assertEqual(self.subscriptions(), before)
        with self.sessions() as db:
            self.assertEqual(db.query(AppUser).count(), 1)
            self.assertEqual(db.query(AuthIdentity).count(), 1)

    def test_already_migrated_or_unrelated_workspaces_are_unchanged(self):
        self.add_subscription(self.internal)
        self.add_subscription("another-workspace", plan="professional")
        before = self.subscriptions()
        service.ensure_internal_identity_backfill()
        self.assertEqual(self.subscriptions(), before)

    def test_missing_optional_workspace_columns_do_not_prevent_backfill(self):
        WeeklyReportPreference.__table__.drop(self.engine)
        Table("weekly_report_preferences", MetaData(), Column("id", Integer, primary_key=True)).create(self.engine)
        self.add_subscription(self.legacy)
        service.ensure_internal_identity_backfill()
        self.assertEqual(self.subscriptions()[0]["workspace_id"], self.internal)

    def test_late_unique_conflict_uses_a_savepoint_and_keeps_the_transaction_usable(self):
        self.add_subscription(self.legacy)
        self.add_subscription(self.internal)
        before = self.subscriptions()
        with self.engine.begin() as connection:
            execute = connection.execute
            first_update = True
            def concurrent_conflict(statement, *args, **kwargs):
                nonlocal first_update
                if getattr(statement, "is_update", False) and first_update:
                    first_update = False
                    # Reproduce a constraint violation after the precondition
                    # was checked, using the same failing update as the logs.
                    return execute(text("UPDATE workspace_subscriptions SET workspace_id = :new WHERE workspace_id = :old"),
                                   {"new": self.internal, "old": self.legacy})
                return execute(statement, *args, **kwargs)
            with patch.object(connection, "execute", side_effect=concurrent_conflict):
                with self.assertLogs(service.logger, level="WARNING"):
                    service._migrate_subscription_workspace(connection, self.legacy, self.internal)
            self.assertEqual(connection.execute(text("SELECT 1")).scalar(), 1)
        self.assertEqual(self.subscriptions(), before)

    def test_unrelated_integrity_and_connection_failures_are_not_suppressed(self):
        self.add_subscription(self.legacy)
        self.add_subscription(self.internal)
        for error_type in (IntegrityError, OperationalError):
            with self.subTest(error=error_type.__name__):
                with self.engine.begin() as connection:
                    execute = connection.execute
                    def fail_update(statement, *args, **kwargs):
                        if getattr(statement, "is_update", False):
                            raise error_type("UPDATE", {}, RuntimeError("Unrelated database failure"))
                        return execute(statement, *args, **kwargs)
                    with patch.object(connection, "execute", side_effect=fail_update):
                        with self.assertRaises(error_type):
                            service._migrate_subscription_workspace(connection, self.legacy, self.internal)
        self.assertEqual(self.subscriptions()[0]["workspace_id"], self.legacy)


@unittest.skipUnless(os.getenv("DECISIONATE_TEST_POSTGRES_URL"), "An isolated PostgreSQL test database is required")
class PostgresInternalIdentityBackfillTests(InternalIdentityBackfillTests):
    def database_engine(self, directory):
        url = os.environ["DECISIONATE_TEST_POSTGRES_URL"]
        schema = f"identity_test_{uuid4().hex}"
        admin_engine = create_engine(url)
        self.stack.callback(admin_engine.dispose)
        with admin_engine.begin() as connection:
            connection.execute(CreateSchema(schema))
        def remove_schema():
            with admin_engine.begin() as connection:
                connection.execute(DropSchema(schema, cascade=True))
        self.stack.callback(remove_schema)
        return create_engine(url, connect_args={"options": f"-csearch_path={schema}"})


if __name__ == "__main__":
    unittest.main()
