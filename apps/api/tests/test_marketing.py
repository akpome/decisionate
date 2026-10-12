import base64
import json
import os
import unittest
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import Mock, patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from svix.webhooks import Webhook

from app.db.database import Base
from app.db.models import AppUser, Dataset, DataIngestionJob, Organization, OrganizationMember, WorkspaceSubscription, utc_now
from app.modules.marketing import config, provider, router, service, templates, worker
from app.modules.marketing.config import SEGMENTS
from app.modules.marketing.hooks import install_marketing_hooks
from app.modules.marketing.models import MarketingContact, MarketingConsentEvent, MarketingEmail, MarketingJob, MarketingWorkspace, MarketingLinkVisit, MarketingWebhook
from app.modules.marketing.provider import ProviderError


class MarketingTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.factory = sessionmaker(bind=self.engine, autoflush=False)
        self.db = self.factory()
        self.now = utc_now()
        self.config = {
            "enabled": True, "sending": True, "automation": {name: True for name in config.MESSAGE_TYPES},
            "test_mode": True, "production": False, "test_recipients": {"owner@example.test"},
            "identity": "Test Company", "address": "Test-only mailing address", "reply_to": "support@example.test",
            "from_email": "updates@example.test", "from_name": "Decisionate", "consent_version": "test-v1",
            "consent_versions": {"en": "test-v1", "fr": "test-v1-fr"},
            "consent_available": True, "segments": {name: f"segment-{name}" for name in SEGMENTS},
            "inactivity_days": 14, "setup_hours": 48, "trial_hours": 48, "welcome_hours": 48, "frequency_hours": 24,
            "min_notice_hours": 6,
            "cutoff": (self.now - timedelta(days=5)).isoformat(),
        }
        self.patches = []
        for module in (config, router, service, templates, worker):
            self.patches.append(patch.object(module, "settings", side_effect=lambda: self.config))
        for module in (config, router, worker):
            self.patches.append(patch.object(module, "SessionLocal", self.factory))
        self.patches.append(patch.dict(os.environ, {"MARKETING_UNSUBSCRIBE_SECRET": "test-only-secret-" * 4}))
        for item in self.patches:
            item.start()
        install_marketing_hooks(self.factory.class_)
        self.user = AppUser(id="owner", email="owner@example.test", first_name="Sam")
        self.org = Organization(name="Test workspace", owner_user_id="owner", business_type="business")
        self.db.add_all([self.user, self.org])
        self.db.flush()
        self.sub = WorkspaceSubscription(workspace_id="owner", plan="professional", status="trialing",
            current_period_start=self.now, current_period_end=self.now + timedelta(days=30))
        self.db.add(self.sub)
        self.db.commit()
        self.contact = service.capture_identity(self.db, "owner", "owner@example.test", verified=True)
        service.set_preference(self.db, self.contact, True, source="signup", actor="owner", version="test-v1")
        self.contact.provider_contact_id = "provider-contact"
        self.contact.synced_revision = self.contact.revision
        self.db.commit()
        self.provider = Mock()
        self.provider.get_contact.return_value = {"id": "provider-contact", "unsubscribed": False}
        self.provider.segments.return_value = set()
        self.provider.request.return_value = {"id": "provider-message"}

    def tearDown(self):
        self.db.close()
        for item in reversed(self.patches):
            item.stop()
        self.engine.dispose()

    def schedule(self):
        service.schedule_messages(self.db, self.contact, self.now)
        self.db.commit()
        return {message.message_type: message for message in self.db.query(MarketingEmail)}

    def dataset(self, **overrides):
        values = dict(user_id="owner", workspace_id="owner", source_type="csv", source_config="{}",
            row_count=3, column_count=2, file_name="data.csv", file_path="test-only")
        row = Dataset(**{**values, **overrides})
        self.db.add(row)
        self.db.commit()
        return row

    def internal_test(self, **query):
        app = FastAPI(); app.include_router(router.router)
        with patch.object(router, "admin", return_value=SimpleNamespace(user_id="admin")):
            return TestClient(app).post(f"/marketing/admin/contacts/{self.contact.id}/test", params=query)

    def test_paid_account_can_receive_neutral_test_without_lifecycle_automation(self):
        self.sub.status = "active"
        self.db.commit()
        self.config["automation"] = {kind: False for kind in config.MESSAGE_TYPES}
        response = self.internal_test()
        self.assertEqual(response.status_code, 200, response.text)
        message = self.db.get(MarketingEmail, response.json()["message_id"])
        self.assertTrue(message.is_test)
        self.assertEqual(message.message_type, "delivery_test")
        worker.deliver_message(self.db, message, self.provider)
        self.assertEqual(message.status, "submitted")
        payload = self.provider.request.call_args.args[2]
        self.assertEqual(payload["to"], ["owner@example.test"])
        self.assertEqual(payload["subject"], "Decisionate email delivery test")
        self.assertIn("subscription and business data are unchanged", payload["text"])
        self.assertIn("List-Unsubscribe", payload["headers"])
        self.assertNotIn("trial", payload["text"].lower())
        self.db.refresh(self.sub)
        self.assertEqual(self.sub.status, "active")
        self.assertEqual(self.sub.current_period_end, self.now + timedelta(days=30))

    def test_internal_welcome_test_still_requires_an_active_trial(self):
        self.sub.status = "active"
        self.db.commit()
        self.assertEqual(self.internal_test(kind="welcome").status_code, 409)
        self.assertEqual(self.db.query(MarketingEmail).count(), 0)
        self.sub.status = "trialing"
        self.db.commit()
        response = self.internal_test(kind="welcome")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.db.get(MarketingEmail, response.json()["message_id"]).message_type, "welcome")

    def test_repeated_test_requests_reuse_the_pending_message(self):
        first, second = self.internal_test(), self.internal_test()
        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(first.json()["message_id"], second.json()["message_id"])
        self.assertEqual(self.db.query(MarketingEmail).count(), 1)

    def test_delivery_test_rechecks_allowlist_after_queueing(self):
        response = self.internal_test()
        message = self.db.get(MarketingEmail, response.json()["message_id"])
        self.config["test_recipients"] = set()
        worker.deliver_message(self.db, message, self.provider)
        self.assertEqual(message.reason, "test_recipient_required")
        self.provider.request.assert_not_called()

    def test_test_queue_respects_enabled_and_sending_gates(self):
        for flag in ("enabled", "sending"):
            with self.subTest(flag=flag):
                self.config[flag] = False
                self.assertEqual(self.internal_test().status_code, 409)
                self.config[flag] = True
        self.assertEqual(self.db.query(MarketingEmail).count(), 0)

    def test_test_queue_requires_sender_and_activation_cutoff(self):
        for flag in ("consent_available", "from_email", "cutoff"):
            with self.subTest(flag=flag):
                previous = self.config[flag]
                self.config[flag] = ""
                self.assertEqual(self.internal_test().status_code, 409)
                self.config[flag] = previous
        self.assertEqual(self.db.query(MarketingEmail).count(), 0)

    def test_test_queue_requires_verified_consent_and_an_allowlisted_address(self):
        self.config["test_recipients"] = set()
        self.assertEqual(self.internal_test().status_code, 409)
        self.config["test_recipients"] = {self.contact.email}
        for field, value in (("email_verified_at", None), ("marketing_status", "unknown"), ("suppression_reason", "test suppression")):
            with self.subTest(field=field):
                previous = getattr(self.contact, field)
                setattr(self.contact, field, value)
                self.db.commit()
                self.assertEqual(self.internal_test().status_code, 409)
                setattr(self.contact, field, previous)
                self.db.commit()
        self.assertEqual(self.db.query(MarketingEmail).count(), 0)

    def test_test_queue_requires_current_contact_sync(self):
        for field, value in (("provider_contact_id", None), ("sync_error", "test sync error"), ("synced_revision", self.contact.revision - 1)):
            with self.subTest(field=field):
                previous = getattr(self.contact, field)
                setattr(self.contact, field, value)
                self.db.commit()
                self.assertEqual(self.internal_test().status_code, 409)
                setattr(self.contact, field, previous)
                self.db.commit()
        self.assertEqual(self.db.query(MarketingEmail).count(), 0)

    def test_test_queue_requires_an_owned_workspace(self):
        self.contact.user_id = "invited-member"
        self.db.commit()
        self.assertEqual(self.internal_test().status_code, 409)
        self.assertEqual(self.db.query(MarketingEmail).count(), 0)

    def test_ordinary_user_cannot_queue_an_internal_delivery_test(self):
        app = FastAPI(); app.include_router(router.router)
        with patch.object(router, "admin", side_effect=HTTPException(403, "Full platform admin access required")):
            response = TestClient(app).post(f"/marketing/admin/contacts/{self.contact.id}/test")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(self.db.query(MarketingEmail).count(), 0)

    def test_delivery_test_cannot_bypass_sending_gate_after_it_is_queued(self):
        response = self.internal_test()
        message = self.db.get(MarketingEmail, response.json()["message_id"])
        self.config["sending"] = False
        worker.deliver_message(self.db, message, self.provider)
        self.assertEqual(message.reason, "dry_run_sending_disabled")
        self.provider.request.assert_not_called()

    def test_neutral_test_content_cannot_be_used_as_an_automated_message(self):
        response = self.internal_test()
        message = self.db.get(MarketingEmail, response.json()["message_id"])
        message.is_test = False
        self.db.commit()
        worker.deliver_message(self.db, message, self.provider)
        self.assertEqual(message.status, "skipped")
        self.assertEqual(message.reason, "test_recipient_required")
        self.provider.request.assert_not_called()

    def test_delivery_test_rechecks_provider_opt_out(self):
        response = self.internal_test()
        message = self.db.get(MarketingEmail, response.json()["message_id"])
        self.provider.get_contact.return_value["unsubscribed"] = True
        worker.deliver_message(self.db, message, self.provider)
        self.assertEqual(message.reason, "provider_opt_out")
        self.assertEqual(self.contact.marketing_status, "unsubscribed")
        self.provider.request.assert_not_called()

    def test_delivery_test_is_subject_to_the_contact_frequency_cap(self):
        response = self.internal_test()
        message = self.db.get(MarketingEmail, response.json()["message_id"])
        self.db.add(MarketingEmail(contact_id=self.contact.id, workspace_id="owner", sequence_instance="earlier-test",
            is_test=True, message_type="delivery_test", due_at=self.now, status="submitted", first_attempt_at=self.now - timedelta(hours=1)))
        self.db.commit()
        worker.deliver_message(self.db, message, self.provider)
        self.assertEqual(message.reason, "frequency_cap")
        self.provider.request.assert_not_called()

    def test_delivery_test_exception_does_not_allow_trial_emails_for_paid_accounts(self):
        welcome = self.schedule()["welcome"]
        self.sub.status = "active"
        self.db.commit()
        worker.deliver_message(self.db, welcome, self.provider)
        self.assertEqual(welcome.reason, "trial_not_active")
        self.provider.request.assert_not_called()

    def test_admin_test_eligibility_is_limited_to_current_synced_internal_contacts(self):
        service.refresh_memberships(self.db, self.contact)
        self.db.commit()
        app = FastAPI(); app.include_router(router.router)
        with patch.object(router, "admin", return_value=SimpleNamespace(user_id="admin")):
            client = TestClient(app)
            self.assertTrue(client.get("/marketing/admin").json()["contacts"][0]["test_eligible"])
            self.config["test_recipients"] = set()
            self.assertFalse(client.get("/marketing/admin").json()["contacts"][0]["test_eligible"])

    def test_delivery_test_receives_delivery_webhook_updates(self):
        response = self.internal_test()
        message = self.db.get(MarketingEmail, response.json()["message_id"])
        worker.deliver_message(self.db, message, self.provider)
        receipt = MarketingWebhook(event_id="delivery-test-event", event_type="email.delivered",
            payload=json.dumps({"type": "email.delivered", "data": {"email_id": message.provider_message_id}}))
        worker.process_webhook(self.db, receipt, self.provider)
        self.assertEqual(message.status, "delivered")

    def test_unknown_and_unverified_consent_are_ineligible(self):
        self.contact.marketing_status = "unknown"
        self.assertFalse(service.eligible(self.contact))
        self.contact.marketing_status = "subscribed"
        self.contact.email_verified_at = None
        self.assertFalse(service.eligible(self.contact))
        self.assertEqual(service.desired_segments(self.db, self.contact), set())
        service.schedule_messages(self.db, self.contact)
        self.assertEqual(self.db.query(MarketingEmail).count(), 0)

    def test_optional_opt_out_does_not_affect_identity_or_subscription(self):
        service.set_preference(self.db, self.contact, False, source="account_preferences", actor="owner")
        self.db.commit()
        self.assertIsNotNone(self.db.get(AppUser, "owner"))
        self.assertEqual(self.sub.status, "trialing")
        self.assertEqual(self.contact.marketing_status, "unsubscribed")

    def test_subject_only_session_uses_verified_clerk_primary_email_for_preferences(self):
        self.contact.email_verified_at = None
        self.contact.marketing_status = "unknown"
        self.db.commit()
        consent_count = self.db.query(MarketingConsentEvent).count()
        app = FastAPI(); app.include_router(router.router)
        client = TestClient(app)
        auth = SimpleNamespace(user_id="owner", workspace_id="owner", email=None, email_verified=False,
            external_user_id="user_clerk_owner", auth_provider="clerk")
        with patch.object(router, "get_auth_context", return_value=auth), patch.object(router, "get_auth_jwks_url", return_value="https://issuer/jwks"), patch.object(
            router, "get_verified_clerk_primary_email", return_value="owner@example.test"
        ) as lookup:
            response = client.get("/marketing/preferences", headers={"X-User-Email": "other@example.test"})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["email"], "owner@example.test")
            self.assertTrue(response.json()["email_verified"])
            self.assertEqual(response.json()["marketing_status"], "unknown")
            self.assertEqual(self.db.query(MarketingConsentEvent).count(), consent_count)
            lookup.assert_called_once_with("user_clerk_owner")
            response = client.put("/marketing/preferences", json={"subscribed": True, "consent_version": "test-v1"})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["marketing_status"], "subscribed")
        self.assertEqual(self.db.query(MarketingConsentEvent).count(), consent_count + 1)
        self.assertEqual(self.db.query(MarketingContact).count(), 1)

    def test_unverified_clerk_primary_email_does_not_fall_back_to_headers_or_saved_email(self):
        app = FastAPI(); app.include_router(router.router)
        client = TestClient(app)
        auth = SimpleNamespace(user_id="owner", workspace_id="owner", email=None, email_verified=False,
            external_user_id="user_clerk_owner", auth_provider="clerk")
        with patch.object(router, "get_auth_context", return_value=auth), patch.object(router, "get_auth_jwks_url", return_value="https://issuer/jwks"), patch.object(
            router, "get_verified_clerk_primary_email", return_value=None
        ):
            response = client.put("/marketing/preferences", headers={"X-User-Email": "owner@example.test"}, json={"subscribed": True, "consent_version": "test-v1"})
        self.assertEqual(response.status_code, 409)

    def test_clerk_lookup_failure_reports_a_retryable_preferences_error(self):
        app = FastAPI(); app.include_router(router.router)
        client = TestClient(app)
        auth = SimpleNamespace(user_id="owner", workspace_id="owner", email=None, email_verified=False,
            external_user_id="user_clerk_owner", auth_provider="clerk")
        with patch.object(router, "get_auth_context", return_value=auth), patch.object(router, "get_auth_jwks_url", return_value="https://issuer/jwks"), patch.object(
            router, "get_verified_clerk_primary_email", side_effect=HTTPException(503, "Verification temporarily unavailable")
        ):
            response = client.get("/marketing/preferences")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["detail"], "Verification temporarily unavailable")

    def test_development_header_identity_cannot_use_clerk_as_verification(self):
        app = FastAPI(); app.include_router(router.router)
        client = TestClient(app)
        auth = SimpleNamespace(user_id="owner", workspace_id="owner", email=None, email_verified=False,
            external_user_id="user_clerk_owner", auth_provider="clerk")
        with patch.object(router, "get_auth_context", return_value=auth), patch.object(router, "get_auth_jwks_url", return_value=None), patch.object(
            router, "get_verified_clerk_primary_email"
        ) as lookup:
            self.assertEqual(client.get("/marketing/preferences").status_code, 409)
            lookup.assert_not_called()

    def test_verified_email_claim_does_not_require_a_clerk_lookup(self):
        app = FastAPI(); app.include_router(router.router)
        client = TestClient(app)
        auth = SimpleNamespace(user_id="owner", workspace_id="owner", email="owner@example.test", email_verified=True,
            external_user_id="user_clerk_owner", auth_provider="clerk")
        with patch.object(router, "get_auth_context", return_value=auth), patch.object(router, "get_verified_clerk_primary_email") as lookup:
            self.assertEqual(client.get("/marketing/preferences").status_code, 200)
            lookup.assert_not_called()

    def test_clerk_primary_email_change_does_not_transfer_marketing_consent(self):
        app = FastAPI(); app.include_router(router.router)
        client = TestClient(app)
        auth = SimpleNamespace(user_id="owner", workspace_id="owner", email=None, email_verified=False,
            external_user_id="user_clerk_owner", auth_provider="clerk")
        with patch.object(router, "get_auth_context", return_value=auth), patch.object(router, "get_auth_jwks_url", return_value="https://issuer/jwks"), patch.object(
            router, "get_verified_clerk_primary_email", return_value="new@example.test"
        ):
            response = client.get("/marketing/preferences")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["email"], "new@example.test")
        self.assertTrue(response.json()["email_verified"])
        self.assertEqual(response.json()["marketing_status"], "unknown")
        self.db.refresh(self.contact)
        self.assertEqual(self.contact.marketing_status, "unsubscribed")

    def test_clerk_lookup_is_not_called_before_session_authentication(self):
        app = FastAPI(); app.include_router(router.router)
        client = TestClient(app)
        with patch.object(router, "get_auth_context", side_effect=HTTPException(401, "Missing token")), patch.object(
            router, "get_verified_clerk_primary_email"
        ) as lookup:
            self.assertEqual(client.get("/marketing/preferences").status_code, 401)
            lookup.assert_not_called()

    def test_normalization_preserves_dots_and_plus_suffix(self):
        self.assertEqual(service.normalize_email(" Test.Person+news@EXAMPLE.test "), "test.person+news@example.test")
        same = service.capture_identity(self.db, "owner", " OWNER@example.test ", verified=True)
        self.assertEqual(same.id, self.contact.id)
        self.assertEqual(self.db.query(MarketingContact).count(), 1)

    def test_verified_email_change_does_not_transfer_consent(self):
        changed = service.capture_identity(self.db, "owner", "new@example.test", verified=True)
        self.db.commit()
        self.assertEqual(changed.marketing_status, "unknown")
        self.assertFalse(service.eligible(changed))
        self.assertIsNotNone(self.contact.deleted_at)
        self.assertEqual(self.contact.marketing_status, "unsubscribed")

    def test_consent_and_outbox_are_rolled_back_together(self):
        count = self.db.query(MarketingConsentEvent).count()
        service.withdraw(self.db, self.contact, "test")
        self.db.rollback()
        self.assertEqual(self.contact.marketing_status, "subscribed")
        self.assertEqual(self.db.query(MarketingConsentEvent).count(), count)

    def test_successful_usable_upload_not_authorization_sets_readiness(self):
        self.assertEqual(service.workspace_facts(self.db, "owner")["setup_status"], "incomplete")
        self.dataset(row_count=0)
        self.dataset(source_type="demo", row_count=2)
        self.assertIsNone(service.workspace_facts(self.db, "owner")["first_data_ready_at"])
        dataset = self.dataset()
        first = service.workspace_facts(self.db, "owner")["first_data_ready_at"]
        self.assertIsNotNone(first)
        self.assertEqual(service.workspace_facts(self.db, "owner")["setup_status"], "data_ready")
        self.db.delete(dataset)
        self.db.commit()
        facts = service.workspace_facts(self.db, "owner")
        self.assertEqual(facts["setup_status"], "incomplete")
        self.assertEqual(facts["first_data_ready_at"], first)

    def test_async_data_waits_for_successful_completion(self):
        job = DataIngestionJob(user_id="owner", workspace_id="owner", job_type="file_upload", status="running", started_at=self.now)
        self.db.add(job)
        self.db.commit()
        dataset = self.dataset()
        self.assertEqual(service.workspace_facts(self.db, "owner")["setup_status"], "incomplete")
        job.status = "succeeded"
        job.result_payload = json.dumps({"dataset_id": dataset.id})
        job.completed_at = utc_now()
        self.db.commit()
        self.assertEqual(service.workspace_facts(self.db, "owner")["setup_status"], "data_ready")

    def test_failed_async_data_does_not_set_readiness(self):
        job = DataIngestionJob(user_id="owner", workspace_id="owner", job_type="connector_sync", status="running", started_at=self.now)
        self.db.add(job); self.db.commit()
        self.dataset()
        job.status = "failed"
        self.db.commit()
        self.assertEqual(service.workspace_facts(self.db, "owner")["setup_status"], "incomplete")

    def test_ingestion_in_progress_postpones_setup_without_reconnecting(self):
        setup = self.schedule()["incomplete_setup"]
        self.db.add(DataIngestionJob(user_id="owner", workspace_id="owner", job_type="connector_sync", status="queued"))
        self.db.commit()
        worker.deliver_message(self.db, setup, self.provider)
        self.assertEqual(setup.status, "pending")
        self.assertEqual(setup.reason, "ingestion_in_progress")
        self.provider.request.assert_not_called()

    def test_segments_remove_obsolete_membership(self):
        self.contact.provider_contact_id = "provider-contact"
        self.provider.segments.return_value = {"segment-trial_setup_incomplete"}
        self.dataset()
        worker.sync_contact(self.db, self.contact, self.provider)
        self.assertIn(("DELETE", "/contacts/provider-contact/segments/segment-trial_setup_incomplete"), [call.args[:2] for call in self.provider.request.call_args_list])
        self.assertIn(("POST", "/contacts/provider-contact/segments/segment-trial_data_ready"), [call.args[:2] for call in self.provider.request.call_args_list])

    def test_partial_segment_mapping_keeps_unmapped_setup_and_welcome_eligible(self):
        self.config["segments"] = {name: value if name in {"trial_data_ready", "trial_expired"} else ""
            for name, value in self.config["segments"].items()}
        self.contact.provider_contact_id = None
        self.provider.get_contact.return_value = None
        worker.sync_contact(self.db, self.contact, self.provider)
        self.db.commit()
        self.assertEqual(service.desired_segments(self.db, self.contact), {"trial_setup_incomplete"})
        self.assertEqual(self.contact.synced_revision, self.contact.revision)
        self.assertIsNone(self.contact.sync_error)
        self.assertTrue(any(call.args[:2] == ("POST", "/contacts") for call in self.provider.request.call_args_list))
        self.assertFalse(any("/segments/" in call.args[1] for call in self.provider.request.call_args_list))
        welcome = self.schedule()["welcome"]
        self.provider.get_contact.return_value = {"id": self.contact.provider_contact_id, "unsubscribed": False}
        worker.deliver_message(self.db, welcome, self.provider)
        self.assertEqual(welcome.status, "submitted")

    def test_partial_segment_mapping_adds_only_configured_agency_and_ready_groups(self):
        self.config["segments"] = {"trial_data_ready": "segment-ready", "agency_account": "segment-agency"}
        self.org.business_type = "agency"
        self.dataset()
        worker.sync_contact(self.db, self.contact, self.provider)
        additions = {call.args[1] for call in self.provider.request.call_args_list if call.args[0] == "POST"}
        self.assertEqual(additions, {"/contacts/provider-contact/segments/segment-ready", "/contacts/provider-contact/segments/segment-agency"})

    def test_partial_segment_mapping_removes_ready_on_conversion_and_preserves_general(self):
        self.config["segments"] = {"trial_data_ready": "segment-ready", "agency_account": "segment-agency"}
        self.org.business_type = "agency"
        self.sub.status = "active"
        self.db.commit()
        self.provider.segments.return_value = {"segment-ready", "segment-agency", "segment-general"}
        worker.sync_contact(self.db, self.contact, self.provider)
        removals = {call.args[1] for call in self.provider.request.call_args_list if call.args[0] == "DELETE"}
        self.assertEqual(removals, {"/contacts/provider-contact/segments/segment-ready"})
        self.assertEqual(service.desired_segments(self.db, self.contact), {"paying_customer", "agency_account"})

    def test_partial_segment_mapping_withdrawal_removes_even_unmanaged_groups(self):
        self.config["segments"] = {"trial_data_ready": "segment-ready", "agency_account": "segment-agency"}
        self.provider.segments.return_value = {"segment-ready", "segment-agency", "segment-general"}
        service.withdraw(self.db, self.contact, "account_preferences")
        worker.sync_contact(self.db, self.contact, self.provider)
        self.provider.request.assert_any_call("PATCH", "/contacts/provider-contact", {"first_name": "Sam", "unsubscribed": True})
        removals = {call.args[1] for call in self.provider.request.call_args_list if call.args[0] == "DELETE"}
        self.assertEqual(removals, {f"/contacts/provider-contact/segments/{name}" for name in self.provider.segments.return_value})

    def test_partial_segment_mapping_moves_ready_trial_into_configured_expired_group(self):
        self.config["segments"] = {"trial_data_ready": "segment-ready", "trial_expired": "segment-expired"}
        self.dataset()
        worker.sync_contact(self.db, self.contact, self.provider)
        self.provider.request.assert_any_call("POST", "/contacts/provider-contact/segments/segment-ready")
        self.sub.current_period_end = self.now - timedelta(hours=1)
        self.db.commit()
        self.provider.segments.return_value = {"segment-ready"}
        self.provider.request.reset_mock()
        worker.sync_contact(self.db, self.contact, self.provider)
        membership_calls = [call.args[:2] for call in self.provider.request.call_args_list if "/segments/" in call.args[1]]
        self.assertEqual(membership_calls, [
            ("DELETE", "/contacts/provider-contact/segments/segment-ready"),
            ("POST", "/contacts/provider-contact/segments/segment-expired"),
        ])

    def test_future_segment_mapping_is_applied_by_reconciliation_without_new_consent(self):
        self.config["segments"] = {"trial_data_ready": "segment-ready", "trial_expired": "segment-expired"}
        self.org.business_type = "agency"
        self.dataset()
        worker.sync_contact(self.db, self.contact, self.provider)
        self.db.commit()
        consent_count = self.db.query(MarketingConsentEvent).count()
        self.provider.segments.return_value = {"segment-ready"}
        self.provider.request.reset_mock()
        self.config["segments"]["agency_account"] = "segment-agency"
        worker.reconcile_page()
        job = self.db.query(MarketingJob).filter_by(dedupe_key=f"daily:{utc_now().date()}:{self.contact.id}").one()
        self.assertIsNone(job.revision)
        worker.process_job(self.db, job, self.provider)
        self.provider.request.assert_any_call("POST", "/contacts/provider-contact/segments/segment-agency")
        self.assertEqual(self.db.query(MarketingConsentEvent).count(), consent_count)
        self.assertEqual(self.contact.marketing_status, "subscribed")

    def test_cancel_at_period_end_remains_paying_and_payment_failure_is_attention(self):
        self.sub.status = "active"
        self.sub.cancel_at_period_end = 1
        self.db.commit()
        self.assertEqual(service.workspace_facts(self.db, "owner")["subscription_status"], "paying")
        self.sub.status = "past_due"
        self.db.commit()
        self.assertEqual(service.workspace_facts(self.db, "owner")["subscription_status"], "payment_attention")

    def test_conversion_expiry_and_ready_data_cancel_stale_messages(self):
        messages = self.schedule()
        self.dataset()
        self.assertEqual(service.message_blocker(self.db, self.contact, messages["incomplete_setup"]), "data_ready")
        self.sub.status = "active"
        self.db.commit()
        self.assertEqual(service.message_blocker(self.db, self.contact, messages["trial_ending"]), "trial_not_active")
        self.sub.status = "trialing"
        self.sub.current_period_end = self.now - timedelta(seconds=1)
        self.db.commit()
        self.assertEqual(service.message_blocker(self.db, self.contact, messages["trial_ending"]), "trial_not_active")

    def test_extension_moves_pending_date_without_repeating_sent_reminder(self):
        reminder = self.schedule()["trial_ending"]
        self.sub.current_period_end += timedelta(days=10)
        self.db.commit()
        service.schedule_messages(self.db, self.contact)
        self.db.commit()
        self.assertEqual(reminder.due_at, self.sub.current_period_end - timedelta(hours=48))
        reminder.status = "sent"
        self.db.commit()
        self.sub.current_period_start += timedelta(hours=1)
        self.db.commit()
        self.schedule(); self.schedule()
        self.assertEqual(self.db.query(MarketingEmail).count(), 3)
        self.assertEqual(reminder.status, "sent")

    def test_only_owner_is_onboarding_and_billing_recipient(self):
        member = AppUser(id="member", email="member@example.test")
        self.db.add(member)
        self.db.add(OrganizationMember(organization_id=self.org.id, clerk_user_id="member", role="member"))
        self.db.commit()
        contact = service.capture_identity(self.db, "member", member.email, verified=True)
        service.set_preference(self.db, contact, True, source="account_preferences", actor="member", version="test-v1")
        service.schedule_messages(self.db, contact)
        self.assertEqual(self.db.query(MarketingEmail).filter_by(contact_id=contact.id).count(), 0)
        self.assertIsNone(contact.primary_workspace_id)

    def test_inactivity_changes_only_on_explicit_meaningful_activity(self):
        self.org.created_at = self.now - timedelta(days=20)
        self.db.commit()
        self.assertEqual(service.workspace_facts(self.db, "owner")["engagement_status"], "inactive")
        self.dataset()
        self.assertEqual(service.workspace_facts(self.db, "owner")["engagement_status"], "inactive")
        service.record_meaningful_activity(self.db, "owner")
        self.db.commit()
        self.assertEqual(service.workspace_facts(self.db, "owner")["engagement_status"], "active")

    def test_unsubscribe_before_send_and_stale_sync_never_resubscribe(self):
        message = self.schedule()["welcome"]
        service.withdraw(self.db, self.contact, "unsubscribe_link")
        self.db.commit()
        worker.deliver_message(self.db, message, self.provider)
        worker.sync_contact(self.db, self.contact, self.provider)
        self.assertEqual(message.status, "skipped")
        for call in self.provider.request.call_args_list:
            if len(call.args) > 2:
                self.assertNotEqual(call.args[2].get("unsubscribed"), False)

    def test_provider_unsubscribe_is_authoritative_but_fresh_opt_in_can_resubscribe(self):
        self.provider.get_contact.return_value["unsubscribed"] = True
        worker.sync_contact(self.db, self.contact, self.provider)
        self.db.commit()
        self.assertEqual(self.contact.marketing_status, "unsubscribed")
        service.set_preference(self.db, self.contact, True, source="account_preferences", actor="owner", version="test-v1")
        worker.sync_contact(self.db, self.contact, self.provider)
        self.assertEqual(self.contact.marketing_status, "subscribed")
        self.assertTrue(any(len(call.args) > 2 and call.args[2].get("unsubscribed") is False for call in self.provider.request.call_args_list))

    def test_frequency_cap_is_per_contact(self):
        message = self.schedule()["welcome"]
        previous = MarketingEmail(contact_id=self.contact.id, workspace_id="owner", sequence_instance="other",
            message_type="welcome", due_at=self.now, status="submitted", first_attempt_at=self.now - timedelta(hours=1))
        self.db.add(previous); self.db.commit()
        worker.deliver_message(self.db, message, self.provider)
        self.assertEqual(message.reason, "frequency_cap")
        self.provider.request.assert_not_called()

    def test_ambiguous_timeout_reuses_payload_and_key_only_inside_window(self):
        message = self.schedule()["welcome"]
        self.provider.request.side_effect = ProviderError("network", uncertain=True)
        worker.deliver_message(self.db, message, self.provider)
        payload = message.payload
        self.assertEqual(message.status, "retry")
        self.provider.request.side_effect = None
        worker.deliver_message(self.db, message, self.provider)
        self.assertEqual(message.payload, payload)
        self.assertEqual(message.status, "submitted")
        self.assertEqual([call.kwargs["key"] for call in self.provider.request.call_args_list], [f"decisionate-marketing/{message.id}"] * 2)
        worker.deliver_message(self.db, message, self.provider)
        self.assertEqual(self.provider.request.call_count, 2)

    def test_uncertain_submission_is_not_retried_after_retention_window(self):
        message = self.schedule()["welcome"]
        message.first_attempt_at = self.now - timedelta(hours=23)
        message.status = "retry"
        self.db.commit()
        worker.deliver_message(self.db, message, self.provider)
        self.assertEqual(message.status, "uncertain")
        self.provider.request.assert_not_called()

    def test_staging_test_allowlist_and_dry_run(self):
        message = self.schedule()["welcome"]
        self.config["test_recipients"] = set()
        worker.deliver_message(self.db, message, self.provider)
        self.assertEqual(message.reason, "test_recipient_required")
        self.config["sending"] = False
        worker.deliver_message(self.db, message, self.provider)
        self.assertEqual(message.reason, "dry_run_sending_disabled")
        self.provider.request.assert_not_called()

    def test_templates_escape_content_and_have_plain_text_and_unsubscribe(self):
        self.contact.first_name = "<script>alert(1)</script>"
        body = templates.render_message(self.db, self.contact, self.schedule()["welcome"])
        self.assertNotIn("<script>", body["html"])
        self.assertIn("Unsubscribe from marketing:", body["text"])
        self.assertIn("List-Unsubscribe", body["headers"])
        self.assertIn("Test Company", body["html"])

    def test_account_deletion_withdraws_and_preserves_audit(self):
        service.remove_user_marketing(self.db, "owner")
        self.db.commit()
        self.assertIsNotNone(self.contact.deleted_at)
        self.assertEqual(self.contact.marketing_status, "unsubscribed")
        self.assertEqual(self.db.query(MarketingConsentEvent).order_by(MarketingConsentEvent.id.desc()).first().source, "account_deleted")

    def test_signed_webhooks_duplicate_replay_and_opt_out_ordering(self):
        self.contact.provider_contact_id = "provider-contact"
        self.db.commit()
        app = FastAPI(); app.include_router(router.router)
        client = TestClient(app)
        secret = "whsec_" + base64.b64encode(b"test-webhook-secret-32-bytes-only!").decode()
        def send(event_id, kind, data, timestamp=None):
            timestamp = timestamp or datetime.now(UTC)
            raw = json.dumps({"type": kind, "data": data})
            headers = {"svix-id": event_id, "svix-timestamp": str(int(timestamp.timestamp())), "svix-signature": Webhook(secret).sign(event_id, timestamp, raw)}
            return client.post("/marketing/webhook", content=raw, headers=headers)
        with patch.dict(os.environ, {"RESEND_WEBHOOK_SECRET": secret}):
            self.assertEqual(client.post("/marketing/webhook", content="{}").status_code, 400)
            self.assertEqual(send("old", "contact.updated", {}, datetime.now(UTC) - timedelta(minutes=10)).status_code, 400)
            self.assertEqual(send("withdraw", "contact.updated", {"id": "provider-contact", "unsubscribed": True}).status_code, 200)
            self.assertEqual(send("withdraw", "contact.updated", {"id": "provider-contact", "unsubscribed": True}).json()["status"], "duplicate")
            self.assertEqual(send("stale", "contact.updated", {"id": "provider-contact", "unsubscribed": False}).status_code, 200)
        self.db.refresh(self.contact)
        self.assertEqual(self.contact.marketing_status, "unsubscribed")
        self.assertEqual(self.db.query(MarketingConsentEvent).filter_by(source="provider_webhook").count(), 1)

    def test_bounce_or_complaint_suppresses_later_marketing(self):
        from app.modules.marketing.models import MarketingWebhook
        for kind in ("email.bounced", "email.complained"):
            receipt = MarketingWebhook(event_id=kind, event_type=kind,
                payload=json.dumps({"type": kind, "data": {"to": [self.contact.email]}}))
            worker.process_webhook(self.db, receipt, self.provider)
            self.assertFalse(service.eligible(self.contact))
            self.assertEqual(self.contact.suppression_reason, kind)

    def test_unsubscribe_link_requires_no_login_and_does_not_expire(self):
        token = service.unsubscribe_token(self.contact)
        app = FastAPI(); app.include_router(router.router)
        client = TestClient(app)
        self.assertEqual(client.get("/marketing/unsubscribe", params={"token": token}).status_code, 200)
        self.db.refresh(self.contact)
        self.assertEqual(self.contact.marketing_status, "subscribed")
        self.assertEqual(client.post("/marketing/unsubscribe", params={"token": token}).status_code, 200)
        self.db.refresh(self.contact)
        self.assertEqual(self.contact.marketing_status, "unsubscribed")
        self.assertEqual(client.post("/marketing/unsubscribe", params={"token": token}).status_code, 200)

    def test_rate_limit_creates_retry_without_blocking_application_records(self):
        self.db.query(MarketingJob).delete(); self.db.commit()
        service.enqueue(self.db, "contact", self.contact.id)
        self.db.commit()
        self.provider.get_contact.side_effect = ProviderError(429, retry_after=120)
        with patch.object(worker, "ResendMarketing", return_value=self.provider):
            result = worker.process_batch(1)
        self.assertEqual(result["failed_count"], 1)
        job = self.db.query(MarketingJob).first(); self.db.refresh(job)
        self.assertEqual(job.status, "queued")
        self.assertGreater(job.next_attempt_at, self.now + timedelta(seconds=119))
        self.assertIsNotNone(self.db.get(AppUser, "owner"))

    def test_mocked_end_to_end_verification_sync_setup_and_unsubscribe(self):
        self.contact.email_verified_at = None
        self.contact.marketing_status = "unknown"
        self.contact.consent_at = None
        self.db.commit()
        service.set_preference(self.db, self.contact, True, source="signup", actor="owner", version="test-v1")
        self.assertEqual(self.contact.marketing_status, "pending_confirmation")
        self.assertFalse(service.eligible(self.contact))
        service.capture_identity(self.db, "owner", self.contact.email, verified=True)
        worker.sync_contact(self.db, self.contact, self.provider)
        self.db.commit()
        self.assertEqual(service.desired_segments(self.db, self.contact), {"trial_setup_incomplete"})
        welcome = self.db.query(MarketingEmail).filter_by(message_type="welcome").one()
        worker.deliver_message(self.db, welcome, self.provider)
        self.assertEqual(welcome.status, "submitted")
        self.dataset()
        self.provider.segments.return_value = {"segment-trial_setup_incomplete"}
        worker.sync_contact(self.db, self.contact, self.provider)
        self.db.commit()
        self.assertEqual(service.desired_segments(self.db, self.contact), {"trial_data_ready"})
        token = service.unsubscribe_token(self.contact)
        router.unsubscribe(token)
        self.db.refresh(self.contact)
        future = self.db.query(MarketingEmail).filter_by(message_type="trial_ending").one()
        sends = sum(call.args[:2] == ("POST", "/emails") for call in self.provider.request.call_args_list)
        worker.deliver_message(self.db, future, self.provider)
        self.assertEqual(future.status, "skipped")
        self.assertEqual(sum(call.args[:2] == ("POST", "/emails") for call in self.provider.request.call_args_list), sends)

    def test_english_french_consent_evidence_preserves_exact_sender_snapshot(self):
        service.set_preference(self.db, self.contact, True, source="account_preferences", actor="owner", version="test-v1-fr", language="fr")
        self.db.commit()
        evidence = self.db.query(MarketingConsentEvent).order_by(MarketingConsentEvent.id.desc()).first()
        self.assertEqual(evidence.consent_text, config.CONSENT_TEXT_FR)
        self.assertEqual(evidence.sender_identity, "Test Company")
        self.config["identity"] = "Changed sender"
        self.assertEqual(evidence.sender_identity, "Test Company")

    def test_ordinary_customers_cannot_access_global_marketing_support(self):
        app = FastAPI(); app.include_router(router.router)
        with patch.object(router, "admin", side_effect=HTTPException(403, "Full platform admin access required")):
            response = TestClient(app).get("/marketing/admin")
        self.assertEqual(response.status_code, 403)
        self.assertNotIn(self.contact.email, response.text)

    def test_short_trial_cannot_send_reminder_immediately_after_welcome(self):
        self.sub.current_period_end = self.now + timedelta(hours=24)
        self.db.commit()
        reminder = self.schedule()["trial_ending"]
        self.assertEqual(reminder.status, "skipped")
        self.assertEqual(reminder.reason, "short_trial")

    def test_authenticated_link_visits_are_deduplicated_and_do_not_count_as_product_activity(self):
        welcome = self.schedule()["welcome"]
        app = FastAPI(); app.include_router(router.router)
        client = TestClient(app)
        auth = SimpleNamespace(user_id="owner", workspace_id="owner")
        with patch.object(router, "get_auth_context", return_value=auth), patch("app.modules.platform_admin.get_platform_admin_user_ids", return_value=set()):
            for _ in range(2):
                self.assertEqual(client.post("/marketing/activity", json={"event": "link_visit", "message_id": welcome.id}).status_code, 200)
            self.assertEqual(self.db.query(MarketingLinkVisit).count(), 1)
            self.assertIsNone(self.db.get(MarketingWorkspace, "owner").last_meaningful_activity_at)
            auth.user_id = "forwarded-recipient"
            self.assertEqual(client.post("/marketing/activity", json={"event": "link_visit", "message_id": welcome.id}).status_code, 200)
            self.assertEqual(self.db.query(MarketingLinkVisit).count(), 1)

    def test_provider_opt_out_is_checked_again_immediately_before_send(self):
        welcome = self.schedule()["welcome"]
        self.provider.get_contact.return_value["unsubscribed"] = True
        worker.deliver_message(self.db, welcome, self.provider)
        self.assertEqual(welcome.status, "skipped")
        self.assertEqual(welcome.reason, "provider_opt_out")
        self.assertEqual(self.contact.marketing_status, "unsubscribed")
        self.provider.request.assert_not_called()

    def test_agency_onboarding_invites_clients_instead_of_connecting_their_data(self):
        self.org.business_type = "agency"
        self.sub.plan = "agency"
        self.db.commit()
        messages = self.schedule()
        body = templates.render_message(self.db, self.contact, messages["welcome"])
        self.assertIn("Each client connects and manages their own business data", body["text"])
        self.assertIn("/dashboard/settings", body["text"])
        self.db.add(Organization(name="Client", owner_user_id="owner:client:first", business_type="client"))
        self.db.commit()
        self.assertEqual(service.message_blocker(self.db, self.contact, messages["incomplete_setup"]), "agency_client_workspace_created")

    def test_activation_cutoff_does_not_remove_useful_future_trial_reminders(self):
        self.config["cutoff"] = (self.now + timedelta(hours=1)).isoformat()
        messages = self.schedule()
        self.assertEqual(messages["welcome"].status, "skipped")
        self.assertEqual(messages["incomplete_setup"].status, "skipped")
        self.assertEqual(messages["trial_ending"].status, "pending")

    def test_fresh_pending_opt_in_can_resubscribe_after_verification(self):
        service.withdraw(self.db, self.contact, "test")
        self.contact.email_verified_at = None
        self.db.commit()
        service.set_preference(self.db, self.contact, True, source="account_preferences", actor="owner", version="test-v1")
        self.db.commit()
        self.assertEqual(self.contact.marketing_status, "pending_confirmation")
        service.capture_identity(self.db, "owner", self.contact.email, verified=True)
        self.assertEqual(self.contact.resubscribe_revision, self.contact.revision)
        self.provider.get_contact.return_value["unsubscribed"] = True
        worker.sync_contact(self.db, self.contact, self.provider)
        self.assertEqual(self.contact.marketing_status, "subscribed")

    def test_stale_job_does_not_repeat_an_already_synced_revision(self):
        job = MarketingJob(dedupe_key="stale", job_type="contact", entity_id=str(self.contact.id), revision=self.contact.revision - 1)
        worker.process_job(self.db, job, self.provider)
        self.provider.get_contact.assert_not_called()

    def test_old_provider_contact_event_cannot_withdraw_a_new_provider_identity(self):
        from app.modules.marketing.models import MarketingWebhook
        receipt = MarketingWebhook(event_id="old-contact", event_type="contact.updated",
            payload=json.dumps({"type": "contact.updated", "data": {"id": "previous-provider-id", "email": self.contact.email, "unsubscribed": True}}))
        worker.process_webhook(self.db, receipt, self.provider)
        self.assertEqual(self.contact.marketing_status, "subscribed")


class MarketingProviderRequestTests(unittest.TestCase):
    def setUp(self):
        configuration = patch.object(provider, "get_platform_email_settings", return_value={"resend_api_key": "test-only-resend-key"})
        self.addCleanup(configuration.stop)
        configuration.start()
        sleep = patch.object(provider.time, "sleep")
        self.addCleanup(sleep.stop)
        sleep.start()
        http = patch.object(provider, "urlopen")
        self.addCleanup(http.stop)
        self.http = http.start()
        self.http.return_value.__enter__.return_value.read.return_value = b'{"id":"test-provider-id"}'
        self.client = provider.ResendMarketing()

    def test_contact_lookup_identifies_client_and_escapes_address(self):
        self.assertEqual(self.client.get_contact("owner+test@example.test"), {"id": "test-provider-id"})
        request = self.http.call_args.args[0]
        self.assertEqual(request.full_url, "https://api.resend.com/contacts/owner%2Btest%40example.test")
        self.assertEqual(request.get_method(), "GET")
        self.assertEqual(request.get_header("User-agent"), "Decisionate/1.0")
        self.assertEqual(request.get_header("Authorization"), "Bearer test-only-resend-key")
        self.assertEqual(self.http.call_args.kwargs, {"timeout": 10})

    def test_submission_identifies_client_and_preserves_idempotency(self):
        payload = {"to": ["owner@example.test"], "subject": "Test-only email"}
        self.client.request("POST", "/emails", payload, key="test-only-message-key")
        request = self.http.call_args.args[0]
        self.assertEqual(request.full_url, "https://api.resend.com/emails")
        self.assertEqual(request.get_method(), "POST")
        self.assertEqual(request.get_header("User-agent"), "Decisionate/1.0")
        self.assertEqual(request.get_header("Content-type"), "application/json")
        self.assertEqual(request.get_header("Idempotency-key"), "test-only-message-key")
        self.assertEqual(json.loads(request.data), payload)

    def test_missing_key_does_not_make_a_provider_request(self):
        self.client.config["resend_api_key"] = ""
        with self.assertRaises(ProviderError) as error:
            self.client.get_contact("owner@example.test")
        self.assertEqual(error.exception.code, "unconfigured")
        self.http.assert_not_called()


if __name__ == "__main__":
    unittest.main()
