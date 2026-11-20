from datetime import timedelta
import unittest
from unittest.mock import patch

from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import Session

from app.application_context import Application, application_scope
from app.db.database import Base
from app.db.models import (
    Dataset, Organization, OrganizationMember, WorkspaceApplication,
    WorkspaceSubscription, utc_now,
)
from app.modules.billing.agency_upgrade import upgrade_agency_subscriptions
from app.modules.billing import service


class AgencyPlanUpgradeTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://")
        Base.metadata.create_all(self.engine)
        self.addCleanup(self.engine.dispose)

    def snapshot(self, table):
        with self.engine.connect() as connection:
            return [dict(row) for row in connection.execute(select(table)).mappings()]

    def test_upgrade_preserves_subscription_charges_client_links_and_data(self):
        with Session(self.engine) as db:
            agency = Organization(owner_user_id="agency-owner", name="Existing agency", business_type="agency")
            client = Organization(owner_user_id="client-owner", name="Existing client", managing_agency_workspace_id="agency-owner", client_owner_accepted_at=utc_now())
            db.add_all([agency, client])
            db.flush()
            db.add_all([
                OrganizationMember(organization_id=client.id, clerk_user_id="client-owner", role="client_owner"),
                Dataset(file_name="sales.csv", file_path="existing-object-key", row_count=12, column_count=3, user_id="client-owner", workspace_id="client-owner"),
                WorkspaceApplication(workspace_id="agency-owner", application_id="decisionate-ca"),
                WorkspaceSubscription(workspace_id="agency-owner", plan="agency", provider="stripe", provider_customer_id="cus_existing", provider_subscription_id="sub_existing", price_id="price_existing", status="active", billing_interval="year", current_period_end=utc_now() + timedelta(days=200), ai_credit_topup_credits=1000, ai_recurring_credits_used=200),
            ])
            db.commit()
        tables = [Organization.__table__, OrganizationMember.__table__, Dataset.__table__, WorkspaceApplication.__table__]
        before = {table.name: self.snapshot(table) for table in tables}
        subscription = self.snapshot(WorkspaceSubscription.__table__)[0]
        with patch.object(service, "stripe_request") as stripe, self.engine.begin() as connection:
            self.assertEqual(upgrade_agency_subscriptions(connection), 1)
            self.assertEqual(upgrade_agency_subscriptions(connection), 0)
        stripe.assert_not_called()
        for table in tables:
            self.assertEqual(self.snapshot(table), before[table.name])
        self.assertEqual(self.snapshot(WorkspaceSubscription.__table__)[0], {**subscription, "plan": "agency_subdomain"})

    def test_all_legacy_aliases_upgrade_but_other_applications_and_plans_do_not(self):
        legacy = ["agency", " AGENCY ", *service.LEGACY_PLAN_ALIASES]
        with Session(self.engine) as db:
            for index, plan in enumerate(legacy):
                db.add(WorkspaceSubscription(workspace_id=f"legacy-{index}", plan=plan))
            for plan in ["professional", "agency_subdomain", "agency_custom_domain", "free"]:
                db.add(WorkspaceSubscription(workspace_id=plan, plan=plan))
            db.add_all([
                WorkspaceSubscription(workspace_id="independent", plan="agency"),
                WorkspaceApplication(workspace_id="independent", application_id="decisionate-ai"),
            ])
            db.commit()
        with self.engine.begin() as connection:
            self.assertEqual(upgrade_agency_subscriptions(connection), len(legacy))
        rows = {row["workspace_id"]: row["plan"] for row in self.snapshot(WorkspaceSubscription.__table__)}
        for index in range(len(legacy)):
            self.assertEqual(rows[f"legacy-{index}"], "agency_subdomain")
        self.assertEqual(rows["independent"], "agency")
        for plan in ["professional", "agency_subdomain", "agency_custom_domain", "free"]:
            self.assertEqual(rows[plan], plan)

    def test_legacy_bootstrap_without_application_table_is_supported(self):
        engine = create_engine("sqlite://")
        self.addCleanup(engine.dispose)
        with engine.begin() as connection:
            self.assertEqual(upgrade_agency_subscriptions(connection), 0)
            connection.execute(text("CREATE TABLE workspace_subscriptions (id INTEGER PRIMARY KEY, workspace_id TEXT, plan TEXT)"))
            connection.execute(text("INSERT INTO workspace_subscriptions VALUES (1, 'existing', 'agency')"))
            self.assertEqual(upgrade_agency_subscriptions(connection), 1)
            self.assertEqual(connection.execute(text("SELECT plan FROM workspace_subscriptions")).scalar_one(), "agency_subdomain")

    def test_independent_application_keeps_its_existing_agency_plan_and_catalog(self):
        app = Application("decisionate-ai", "Independent", "https://example.test", ("https://example.test",), "INDEPENDENT_")
        with application_scope(app), Session(self.engine) as db:
            self.assertEqual(service.normalize_billing_plan("agency"), "agency")
            self.assertEqual(service.normalize_billing_plan("agency_growth"), "agency")
            self.assertEqual([plan["plan"] for plan in service.get_billing_plan_options(db)], ["professional", "agency"])
