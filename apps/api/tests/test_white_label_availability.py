import json
import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.database import Base
from app.db.models import HostedPortal, WhiteLabelAvailability
from app.modules import white_label_availability as module
from app.modules.platform_admin import PlatformAdminAuditEvent


class WhiteLabelAvailabilityTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.addCleanup(self.engine.dispose)
        self.Session = sessionmaker(bind=self.engine)
        self.mock(patch.object(module, "SessionLocal", self.Session))
        self.auth = self.mock(patch.object(module, "require_platform_admin_full_access", return_value=SimpleNamespace(user_id="admin")))
        app = FastAPI()
        app.include_router(module.router)
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def mock(self, patcher):
        value = patcher.start()
        self.addCleanup(patcher.stop)
        return value

    def change(self, **values):
        return self.client.put("/admin/white-label-availability", json={
            "offering": "custom_domain", "enabled": True, "revision": 0,
            "confirmation": "CHANGE AVAILABILITY", **values,
        })

    def test_defaults_are_off_without_mutating_database(self):
        result = self.client.get("/admin/white-label-availability")
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.headers["cache-control"], "no-store")
        self.assertFalse(result.json()["custom_domain_enabled"])
        self.assertFalse(result.json()["hosted_subdomain_enabled"])
        with self.Session() as db:
            self.assertEqual(db.query(WhiteLabelAvailability).count(), 0)

    def test_changes_are_persistent_independent_and_audited(self):
        first = self.change(reason="Controlled custom-domain pilot")
        self.assertEqual(first.status_code, 200, first.text)
        self.assertTrue(first.json()["custom_domain_enabled"])
        self.assertFalse(first.json()["hosted_subdomain_enabled"])
        self.assertTrue(self.client.get("/admin/white-label-availability").json()["custom_domain_enabled"])
        with self.Session() as db:
            event = db.query(PlatformAdminAuditEvent).one()
            self.assertEqual(event.admin_user_id, "admin")
            self.assertEqual(json.loads(event.details), {"offering": "custom_domain", "previous": False,
                "enabled": True, "reason": "Controlled custom-domain pilot"})
        self.assertEqual(self.change(enabled=False, revision=1).status_code, 200)

    def test_stale_revision_cannot_overwrite_another_admin(self):
        self.assertEqual(self.change().status_code, 200)
        self.assertEqual(self.change(enabled=False).status_code, 409)
        self.assertTrue(self.client.get("/admin/white-label-availability").json()["custom_domain_enabled"])
        with self.Session() as db:
            self.assertEqual(db.query(PlatformAdminAuditEvent).count(), 1)

    def test_requires_confirmation_and_full_admin_for_read_and_write(self):
        self.assertEqual(self.change(confirmation="yes").status_code, 422)
        self.auth.side_effect = HTTPException(403, "Full platform admin access required")
        self.assertEqual(self.change().status_code, 403)
        self.assertEqual(self.client.get("/admin/white-label-availability").status_code, 403)

    def test_hosted_sales_stay_closed_without_shared_signin_credentials(self):
        for secret in ("", "   "):
            with patch.dict(os.environ, {"CLERK_SECRET_KEY": secret}, clear=True):
                result = self.change(offering="hosted_subdomain")
            self.assertEqual(result.status_code, 409)
            self.assertIn("Configure shared Clerk sign-in", result.json()["detail"])
        with self.Session() as db:
            self.assertEqual(db.query(WhiteLabelAvailability).count(), 0)

    def test_hosted_setup_opens_with_shared_signin_and_no_manual_confirmation(self):
        with patch.dict(os.environ, {"CLERK_SECRET_KEY": "test_only"}, clear=True):
            result = self.change(offering="hosted_subdomain")
        self.assertEqual(result.status_code, 200, result.text)
        self.assertTrue(result.json()["hosted_subdomain_enabled"])
        self.assertEqual(result.json()["hosted_subdomain_blockers"], [])
        self.assertFalse(result.json()["custom_domain_enabled"])

    def test_closing_sales_preserves_live_portals_and_protected_settings(self):
        with self.Session() as db:
            db.add(HostedPortal(id="live-portal", owner_workspace_id="agency", domain="portal.example.test",
                configuration="{}", protected_settings="encrypted-do-not-expose", status="live"))
            db.commit()
        self.assertEqual(self.change().status_code, 200)
        result = self.change(enabled=False, revision=1)
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()["custom_domain_live_count"], 1)
        self.assertNotIn("encrypted-do-not-expose", result.text)
        with self.Session() as db:
            portal = db.get(HostedPortal, "live-portal")
            self.assertEqual(portal.status, "live")
            self.assertEqual(portal.protected_settings, "encrypted-do-not-expose")


if __name__ == "__main__":
    unittest.main()
