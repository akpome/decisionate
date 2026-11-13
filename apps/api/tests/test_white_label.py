from datetime import timedelta
from io import BytesIO
import json
import os
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from zipfile import ZipFile

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.application_context import application_branding, application_scope, applications
from app.db.database import Base
from app.db.models import Organization, PlatformAdminRole, WhiteLabelLaunchConfirmation, WhiteLabelSetup, WorkspaceSubscription, utc_now
from app.infrastructure.email_branding import build_system_email_html, build_decisionate_logo_url
from app.modules import applications as application_api, platform_admin, white_label
from app.modules.alerts.router import get_weekly_report_branding
from app.modules.billing.notifications import build_lifecycle_notice
from app.modules.billing.service import get_billing_config, get_billing_pricing


class WhiteLabelTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {
            "APP_ENV": "test", "OBJECT_STORAGE_PROVIDER": "local",
            "DECISIONATE_WEB_APP_URL": "https://www.decisionate.ca",
            "DECISIONATE_API_URL": "https://api.decisionate.ca",
            "STRIPE_SECRET_KEY": "default-private-key-must-never-leak",
            "AUTH_JWT_ISSUER": "https://ca.clerk.test",
        }, clear=True)
        self.env.start()
        self.addCleanup(self.env.stop)
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.addCleanup(self.engine.dispose)
        self.Session = sessionmaker(bind=self.engine, expire_on_commit=False)
        for module in (white_label, platform_admin):
            item = patch.object(module, "SessionLocal", self.Session)
            item.start(); self.addCleanup(item.stop)
        self.auth = patch.object(platform_admin, "get_auth_context", return_value=SimpleNamespace(user_id="admin"))
        self.auth_mock = self.auth.start(); self.addCleanup(self.auth.stop)
        item = patch.object(platform_admin, "get_platform_admin_user_ids", return_value={"admin"})
        item.start(); self.addCleanup(item.stop)
        app = FastAPI()
        app.include_router(white_label.router)
        app.include_router(application_api.router)
        app.add_middleware(application_api.ApplicationContextMiddleware)
        self.client = TestClient(app)
        self.addCleanup(self.client.close)
        self.config = {
            "id": "north-star", "name": "North Star", "web_url": "https://northstar.example",
            "allowed_origins": ["https://www.northstar.example"],
            "currency": "USD", "support_email": "support@northstar.example", "sender_email": "no-reply@northstar.example",
            "auth_issuer": "https://northstar.clerk.test", "privacy_url": "https://northstar.example/privacy",
            "terms_url": "https://northstar.example/terms", "primary_color": "#008844",
            "prices": {key: {"price_id": "price_" + str(index), "amount_cents": 4900}
                       for index, (key, _, _) in enumerate(white_label.PRICES)},
        }

    def save(self, configuration=None, revision=0):
        config = configuration or self.config
        return self.client.put(f'/admin/white-label/{config["id"]}', json={"configuration": config, "revision": revision})

    def register(self):
        config = white_label.SetupConfiguration(**self.config)
        os.environ["DECISIONATE_APPLICATIONS"] = json.dumps([white_label.registration(config)])
        return config

    def test_draft_save_does_not_activate_application(self):
        response = self.save()
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["revision"], 1)
        self.assertFalse(response.json()["readiness"]["registered"])
        self.assertEqual(response.json()["stage"], "ready_to_deploy")
        self.assertNotIn("north-star", applications())
        listing = self.client.get("/admin/white-label")
        self.assertEqual(listing.headers["cache-control"], "no-store")
        self.assertEqual(len(listing.json()["setups"]), 1)

    def test_non_admin_cannot_read_write_download_or_delete(self):
        self.auth_mock.return_value = SimpleNamespace(user_id="customer")
        self.assertEqual(self.client.get("/admin/white-label").status_code, 403)
        self.assertEqual(self.save().status_code, 403)
        self.assertEqual(self.client.get("/admin/white-label/north-star/package").status_code, 403)
        self.assertEqual(self.client.delete("/admin/white-label/north-star").status_code, 403)
        self.assertEqual(self.client.post("/admin/white-label/north-star/complete", json={"revision": 1}).status_code, 403)

    def test_limited_admin_cannot_provision_an_application(self):
        with self.Session() as db:
            db.add(PlatformAdminRole(user_id="admin", permissions=json.dumps(["email_settings"])))
            db.commit()
        self.assertEqual(self.save().status_code, 403)
        self.assertEqual(self.client.get("/admin/white-label").status_code, 403)

    def test_secondary_application_cannot_reach_operator_routes(self):
        self.register()
        response = self.client.get("/admin/white-label", headers={"Origin": self.config["web_url"]})
        self.assertEqual(response.status_code, 404)

    def test_default_registration_cannot_be_replaced(self):
        self.config["id"] = "decisionate-ca"
        self.assertEqual(self.save().status_code, 422)

    def test_domain_and_issuer_collisions_rejected(self):
        for field, value in (("web_url", "https://www.decisionate.ca"), ("auth_issuer", "https://ca.clerk.test")):
            config = {**self.config, field: value}
            self.assertEqual(self.save(config).status_code, 409)

    def test_drafts_reserve_domains_and_sign_in_issuers(self):
        self.assertEqual(self.save().status_code, 200)
        config = {**self.config, "id": "another-brand"}
        self.assertEqual(self.save(config).status_code, 409)
        config["web_url"] = "https://another.example"
        config["allowed_origins"] = []
        self.assertEqual(self.save(config).status_code, 409)

    def test_secrets_are_not_accepted_by_draft_schema(self):
        self.config["stripe_secret_key"] = "secret"
        self.assertEqual(self.save().status_code, 422)
        with self.Session() as db:
            self.assertEqual(db.query(WhiteLabelSetup).count(), 0)

    def test_invalid_urls_colors_names_and_service_names_rejected(self):
        for field, value in (("logo_url", "javascript:alert(1)"), ("web_url", "https://northstar.example/path"),
                             ("primary_color", "red;background:url(evil)"), ("railway_api_service", "api}}\nBAD=1"),
                             ("sender_email", "a@example.com\nBcc:evil@example.com"), ("name", "name\nBcc:evil")):
            with self.subTest(field=field):
                self.assertEqual(self.save({**self.config, field: value}).status_code, 422)

    def test_duplicate_and_stale_saves_do_not_overwrite(self):
        self.assertEqual(self.save().status_code, 200)
        self.assertEqual(self.save().status_code, 409)
        updated = self.save({**self.config, "name": "North Star Analytics"}, revision=1)
        self.assertEqual(updated.status_code, 200, updated.text)
        self.assertEqual(updated.json()["revision"], 2)
        self.assertEqual(self.save(revision=1).status_code, 409)

    def test_launch_checks_are_saved_but_invalidated_by_setup_changes(self):
        initial = self.save().json()["configuration"]
        checked = {**initial, "confirmed_checks": [0, 1]}
        result = self.save(checked, revision=1)
        self.assertEqual(result.json()["configuration"]["confirmed_checks"], [0, 1])
        result = self.save({**checked, "name": "New name"}, revision=2)
        self.assertEqual(result.json()["configuration"]["confirmed_checks"], [])

    def test_package_merges_existing_registry_and_never_exports_secrets(self):
        other = {"id": "other-brand", "name": "Other", "web_url": "https://other.example",
                 "environment_prefix": "OTHER_"}
        os.environ["DECISIONATE_APPLICATIONS"] = json.dumps([other])
        os.environ["NORTH_STAR_STRIPE_SECRET_KEY"] = "secondary-private-key-must-never-leak"
        self.assertEqual(self.save().status_code, 200)
        response = self.client.get("/admin/white-label/north-star/package")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.headers["cache-control"], "no-store")
        with ZipFile(BytesIO(response.content)) as bundle:
            text = "\n".join(bundle.read(name).decode() for name in bundle.namelist())
            self.assertNotIn("private-key-must-never-leak", text)
            values = json.loads(bundle.read("api-variables.json"))
            registry = json.loads(values["DECISIONATE_APPLICATIONS"])
            self.assertEqual(registry[0], other)
            self.assertEqual(registry[1]["id"], "north-star")
            self.assertNotIn("NORTH_STAR_STRIPE_SECRET_KEY", values)
            workers = json.loads(bundle.read("worker-references.json"))
            self.assertEqual(workers["NORTH_STAR_STRIPE_SECRET_KEY"], "${{decisionate-api.NORTH_STAR_STRIPE_SECRET_KEY}}")
            self.assertIn("/billing/webhook/north-star", bundle.read("START-HERE.md").decode())

    def test_package_requires_sign_in_issuer(self):
        self.config["auth_issuer"] = ""
        self.assertEqual(self.save().status_code, 200)
        self.assertEqual(self.client.get("/admin/white-label/north-star/package").status_code, 422)

    def deploy(self):
        config = self.register()
        os.environ.update({"NORTH_STAR_" + name: value for name, value in white_label.public_variables(config).items()})
        os.environ.update({"NORTH_STAR_" + name: "test-credential" for name in white_label.SECRET_NAMES})

    def confirm(self, revision):
        return self.client.post("/admin/white-label/north-star/complete", json={"revision": revision})

    def test_incomplete_drafts_can_be_saved_but_not_deployed(self):
        self.config["prices"] = {}
        result = self.save()
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()["stage"], "draft")
        self.assertFalse(result.json()["readiness"]["package_ready"])
        response = self.client.get("/admin/white-label/north-star/package")
        self.assertEqual(response.status_code, 422)
        self.assertIn("Professional monthly price and amount", response.text)
        self.assertEqual(self.confirm(1).status_code, 409)

    def test_package_rejects_stale_revision(self):
        self.save()
        self.save({**self.config, "name": "Changed name"}, revision=1)
        self.assertEqual(self.client.get("/admin/white-label/north-star/package?revision=1").status_code, 409)
        self.assertEqual(self.client.get("/admin/white-label/north-star/package?revision=2").status_code, 200)

    def test_package_requires_real_api_address_and_complete_prices(self):
        self.save()
        for value in ("", "http://localhost:8000", "https://user:password@api.example", "https://api.example/extra"):
            with self.subTest(value=value), patch.dict(os.environ, {"DECISIONATE_API_URL": value}):
                response = self.client.get("/admin/white-label/north-star/package")
                self.assertEqual(response.status_code, 422)
                self.assertIn("DECISIONATE_API_URL", response.text)
                self.assertNotIn("password", response.text)
        self.config["prices"]["PROFESSIONAL"]["price_id"] = "price_REPLACE"
        self.assertFalse(white_label.readiness(white_label.SetupConfiguration(**self.config))["package_ready"])

    def test_completion_requires_deployment_saved_checks_and_current_revision(self):
        self.save()
        self.assertEqual(self.confirm(1).status_code, 409)
        self.deploy()
        self.assertEqual(self.client.get("/admin/white-label").json()["setups"][0]["stage"], "launch_review")
        self.assertEqual(self.confirm(1).status_code, 409)
        checked = {**self.config, "confirmed_checks": list(range(len(white_label.MANUAL_CHECKS)))}
        self.assertEqual(self.save(checked, revision=1).status_code, 200)
        self.assertEqual(self.confirm(1).status_code, 409)
        response = self.confirm(2)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertEqual(response.json()["stage"], "launch_confirmed")
        self.assertTrue(response.json()["completion"]["current"])
        self.assertTrue(response.json()["completion"]["confirmed_at"].endswith("Z"))
        self.assertEqual(response.json()["revision"], 3)
        again = self.confirm(3)
        self.assertEqual(again.json()["completion"], response.json()["completion"])
        self.assertEqual(again.json()["revision"], 3)
        with self.Session() as db:
            event = db.query(platform_admin.PlatformAdminAuditEvent).filter_by(action="white_label_launch_confirmed").one()
            self.assertIn("north-star", event.details)
            self.assertEqual(db.query(WhiteLabelLaunchConfirmation).count(), 1)
        self.assertNotIn("test-credential", response.text)
        self.assertNotIn("configuration_digest", response.text)

    def test_runtime_changes_require_new_launch_checks_and_confirmation(self):
        self.deploy()
        checked = {**self.config, "confirmed_checks": list(range(len(white_label.MANUAL_CHECKS)))}
        self.save(checked)
        self.assertEqual(self.confirm(1).status_code, 200)
        os.environ["NORTH_STAR_STRIPE_SECRET_KEY"] = "rotated-private-credential"
        stale = self.client.get("/admin/white-label").json()["setups"][0]
        self.assertEqual(stale["stage"], "needs_review")
        self.assertFalse(stale["completion"]["current"])
        self.assertEqual(stale["configuration"]["confirmed_checks"], [])
        self.assertEqual(self.confirm(2).status_code, 409)
        self.assertEqual(self.save(checked, revision=2).status_code, 200)
        self.assertEqual(self.confirm(3).json()["stage"], "launch_confirmed")
        del os.environ["NORTH_STAR_RESEND_API_KEY"]
        self.assertEqual(self.confirm(4).status_code, 409)
        current = self.client.get("/admin/white-label").json()["setups"][0]
        self.assertFalse(current["readiness"]["configuration_complete"])
        self.assertFalse(current["completion"]["current"])
        self.assertNotIn("rotated-private-credential", json.dumps(current))

    def test_setup_edits_invalidate_confirmation_without_changing_live_configuration(self):
        self.deploy()
        checked = {**self.config, "confirmed_checks": list(range(len(white_label.MANUAL_CHECKS)))}
        self.save(checked)
        self.confirm(1)
        response = self.save({**checked, "primary_color": "#123456"}, revision=2)
        self.assertEqual(response.json()["stage"], "needs_review")
        self.assertEqual(response.json()["configuration"]["confirmed_checks"], [])
        self.assertEqual(os.environ["NORTH_STAR_APPLICATION_PRIMARY_COLOR"], "#008844")
        self.assertFalse(response.json()["completion"]["current"])

    def test_completion_rejects_unknown_drafts_and_invalid_revisions(self):
        self.assertEqual(self.confirm(1).status_code, 404)
        self.save()
        for revision in (0, -1, "1", True):
            with self.subTest(revision=revision):
                self.assertEqual(self.confirm(revision).status_code, 422)

    def test_removing_an_unregistered_draft_clears_its_confirmation_only(self):
        self.save()
        with self.Session() as db:
            for application_id in ("north-star", "other-brand"):
                db.add(WhiteLabelLaunchConfirmation(application_id=application_id, revision=1,
                    configuration_digest="test-only-digest", confirmed_by_user_id="operator"))
            db.commit()
        self.assertEqual(self.client.delete("/admin/white-label/north-star").status_code, 200)
        with self.Session() as db:
            self.assertIsNone(db.get(WhiteLabelLaunchConfirmation, "north-star"))
            self.assertIsNotNone(db.get(WhiteLabelLaunchConfirmation, "other-brand"))

    def test_active_identity_and_domain_cannot_be_changed(self):
        self.register()
        os.environ["NORTH_STAR_AUTH_JWT_ISSUER"] = self.config["auth_issuer"]
        self.assertEqual(self.save().status_code, 200)
        for field, value in (("web_url", "https://changed.example"), ("auth_issuer", "https://changed.clerk.test")):
            self.assertEqual(self.save({**self.config, field: value}, revision=1).status_code, 409)
        self.assertEqual(self.client.delete("/admin/white-label/north-star").status_code, 409)

    def test_only_unregistered_draft_can_be_deleted(self):
        self.save()
        self.assertEqual(self.client.delete("/admin/white-label/north-star").status_code, 200)
        self.assertEqual(self.client.get("/admin/white-label").json()["setups"], [])

    def test_readiness_does_not_borrow_default_credentials(self):
        config = self.register()
        checks = white_label.readiness(config)
        self.assertFalse(checks["configuration_complete"])
        stripe = next(item for item in checks["checks"] if item["key"] == "STRIPE_SECRET_KEY")
        self.assertFalse(stripe["complete"])
        os.environ["NORTH_STAR_STRIPE_SECRET_KEY"] = "SET_IN_SECRET_STORE"
        self.assertFalse(next(item for item in white_label.readiness(config)["checks"] if item["key"] == "STRIPE_SECRET_KEY")["complete"])

    def test_complete_configuration_still_requires_manual_launch_checks(self):
        self.config["prices"] = {key: {"price_id": "price_" + str(index), "amount_cents": 4900}
                                 for index, (key, _, _) in enumerate(white_label.PRICES)}
        config = self.register()
        os.environ.update({"NORTH_STAR_" + name: value for name, value in white_label.public_variables(config).items()})
        os.environ.update({"NORTH_STAR_" + name: "test-credential" for name in white_label.SECRET_NAMES})
        status = white_label.readiness(config)
        self.assertTrue(status["configuration_complete"])
        self.assertTrue(status["launch_checks"])
        self.assertIn("not verified", status["scope"])

    def test_generated_prices_are_consumed_by_the_existing_billing_service(self):
        self.config["prices"] = {key: {"price_id": "price_" + str(index), "amount_cents": 1000 + index}
                                 for index, (key, _, _) in enumerate(white_label.PRICES)}
        config = white_label.SetupConfiguration(**self.config)
        variables = json.loads(white_label.build_package(config)["api-variables.json"])
        os.environ.update(variables)
        with application_scope(config.id):
            billing = get_billing_config()
            pricing = get_billing_pricing()
            for index, (key, _, amount_key) in enumerate(white_label.PRICES):
                self.assertEqual(billing[key.lower() + "_price_id"], "price_" + str(index))
                self.assertEqual(pricing[amount_key.lower() + "_price_cents"], 1000 + index)

    def test_public_bootstrap_has_only_brand_fields_not_secret_settings(self):
        self.register()
        os.environ.update({"NORTH_STAR_APPLICATION_PRIMARY_COLOR": "#008844", "NORTH_STAR_SUPPORT_EMAIL": "help@northstar.example",
                           "NORTH_STAR_RESEND_API_KEY": "private-email-key"})
        response = self.client.get("/api/v2/application", headers={"Origin": self.config["web_url"]})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["branding"]["primary_color"], "#008844")
        self.assertEqual(response.json()["branding"]["support_email"], "help@northstar.example")
        self.assertNotIn("private-email-key", response.text)
        self.assertNotIn("decisionate.ca", json.dumps(response.json()["branding"]))

    def test_secondary_email_and_weekly_brand_do_not_use_default_name_or_logo(self):
        self.register()
        with application_scope("north-star"), self.Session() as db:
            self.assertIsNone(build_decisionate_logo_url())
            html = build_system_email_html("Welcome", "Sign in to your workspace.")
            self.assertIn("North Star", html)
            self.assertNotIn("Decisionate", html)
            self.assertNotIn("Decisions from Data", html)
            self.assertEqual(get_weekly_report_branding(db, "missing")["brand_name"], "North Star")
            db.add(Organization(name="Store", owner_user_id="owner")); db.flush()
            self.assertEqual(get_weekly_report_branding(db, "owner")["brand_name"], "North Star")

    def test_branding_fails_safely_for_unsafe_environment_values(self):
        self.register()
        os.environ.update({"NORTH_STAR_APPLICATION_LOGO_URL": "javascript:alert(1)",
                           "NORTH_STAR_APPLICATION_PRIMARY_COLOR": "bad-color"})
        with application_scope("north-star"):
            self.assertEqual(application_branding()["logo_url"], "")
            self.assertEqual(application_branding()["primary_color"], "#0047FF")

    def test_billing_email_uses_brand_name_and_correct_frontend(self):
        self.register()
        subscription = WorkspaceSubscription(workspace_id="owner", current_period_end=utc_now() + timedelta(days=1), cancel_at_period_end=True)
        state = SimpleNamespace(status="active", raw_status="active", grace_period_end=None, days_remaining=1)
        with application_scope("north-star"):
            _, subject, body = build_lifecycle_notice(subscription, state)
            self.assertIn("North Star", subject)
            self.assertIn("https://northstar.example/dashboard/billing", body)
            self.assertNotIn("Decisionate", body + subject)


if __name__ == "__main__":
    unittest.main()
