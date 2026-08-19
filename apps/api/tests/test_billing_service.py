import hashlib
import hmac
import json
import os
import time
import unittest
from datetime import datetime, timedelta
from unittest.mock import patch

from app.db.models import WorkspaceSubscription
from app.modules.billing.lifecycle import build_subscription_access_state
from app.modules.billing.service import (
    BillingWebhookSignatureError,
    create_checkout_session,
    verify_stripe_webhook,
)


class FakeResponse:
    def __init__(self, body):
        self.body = body

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return self.body


class BillingServiceTests(unittest.TestCase):
    def test_subscription_lifecycle_allows_active_period(self):
        now = datetime(2026, 1, 1)
        subscription = WorkspaceSubscription(
            plan="professional",
            status="active",
            current_period_end=now + timedelta(days=10),
        )

        state = build_subscription_access_state(subscription, now)

        self.assertTrue(state.access_allowed)
        self.assertEqual(state.status, "active")

    def test_subscription_lifecycle_allows_past_due_grace_period(self):
        now = datetime(2026, 1, 10)
        subscription = WorkspaceSubscription(
            plan="professional",
            status="past_due",
            current_period_end=now - timedelta(days=2),
        )

        state = build_subscription_access_state(subscription, now)

        self.assertTrue(state.access_allowed)
        self.assertEqual(state.status, "grace_period")

    def test_subscription_lifecycle_blocks_expired_trial(self):
        now = datetime(2026, 1, 31)
        subscription = WorkspaceSubscription(
            plan="professional",
            status="trialing",
            current_period_end=now - timedelta(days=1),
        )

        state = build_subscription_access_state(subscription, now)

        self.assertFalse(state.access_allowed)
        self.assertEqual(state.status, "expired")

    def test_stripe_webhook_signature_is_verified(self):
        payload = b'{"id":"evt_1","type":"checkout.session.completed"}'
        secret = "whsec_test"
        timestamp = int(time.time())
        digest = hmac.new(
            secret.encode(),
            f"{timestamp}.".encode() + payload,
            hashlib.sha256,
        ).hexdigest()
        event = verify_stripe_webhook(
            payload,
            f"t={timestamp},v1={digest}",
            secret,
            now=timestamp,
        )
        self.assertEqual(event["id"], "evt_1")

    def test_stripe_webhook_rejects_invalid_signature(self):
        with self.assertRaises(BillingWebhookSignatureError):
            verify_stripe_webhook(
                b"{}",
                "t=1,v1=invalid",
                "whsec_test",
                now=1,
            )

    def test_checkout_session_contains_workspace_metadata(self):
        response = {"id": "cs_test", "url": "https://checkout.test"}
        with patch.dict(
            os.environ,
            {
                "STRIPE_SECRET_KEY": "sk_test",
                "STRIPE_PRICE_ID": "price_test",
                "DECISIONATE_WEB_APP_URL": "https://app.test",
            },
            clear=False,
        ), patch(
            "app.modules.billing.service.urlopen",
            return_value=FakeResponse(json.dumps(response).encode()),
        ) as mocked_urlopen:
            result = create_checkout_session(
                workspace_id="workspace_1",
                owner_user_id="user_1",
                owner_email="owner@example.com",
                organization_name="Acme",
            )

        self.assertEqual(result["session_id"], "cs_test")
        request = mocked_urlopen.call_args.args[0]
        body = request.data.decode()
        self.assertIn("client_reference_id=workspace_1", body)
        self.assertIn("subscription_data%5Bmetadata%5D%5Bworkspace_id%5D=workspace_1", body)
        self.assertIn("subscription_data%5Btrial_period_days%5D=30", body)


if __name__ == "__main__":
    unittest.main()
