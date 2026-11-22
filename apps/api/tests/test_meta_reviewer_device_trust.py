import json
import unittest

import httpx

from scripts.meta_reviewer_device_trust import REVIEWER, configure


def reviewer(**changes):
    return {
        "id": "user_review123",
        "primary_email_address_id": "idn_review",
        "email_addresses": [{
            "id": "idn_review", "email_address": REVIEWER,
            "verification": {"status": "verified"},
        }],
        "password_enabled": True,
        "two_factor_enabled": False,
        "bypass_client_trust": False,
        **changes,
    }


class MetaReviewerDeviceTrustTests(unittest.TestCase):
    def run_command(self, action, users, writes=None, readback=None):
        writes = [] if writes is None else writes
        def respond(request):
            if request.url.path == "/v1/users":
                self.assertEqual(request.method, "GET")
                self.assertEqual(dict(request.url.params), {"email_address": REVIEWER, "limit": "2"})
                return httpx.Response(200, json=users)
            self.assertEqual(request.url.path, "/v1/users/user_review123")
            if request.method == "PATCH":
                writes.append(json.loads(request.content))
                return httpx.Response(200, json={})
            self.assertEqual(request.method, "GET")
            self.assertIsNotNone(readback)
            return httpx.Response(200, json=readback)

        with httpx.Client(base_url="https://clerk.test", transport=httpx.MockTransport(respond)) as client:
            result = configure(client, action)
        return result, writes

    def test_enable_updates_only_reviewer_device_trust(self):
        on = reviewer(bypass_client_trust=True)
        self.assertEqual(self.run_command("enable", [reviewer()], readback=on),
                         (True, [{"bypass_client_trust": True}]))

    def test_restore_still_possible_after_password_or_mfa_change(self):
        on = reviewer(bypass_client_trust=True, password_enabled=False, two_factor_enabled=True)
        self.assertEqual(self.run_command("restore", [on], readback={**on, "bypass_client_trust": False}),
                         (False, [{"bypass_client_trust": False}]))

    def test_read_only_status_and_idempotent_operations(self):
        for action, current in [("status", False), ("status", True), ("enable", True), ("restore", False)]:
            with self.subTest(action=action, current=current):
                self.assertEqual(self.run_command(action, [reviewer(bypass_client_trust=current)]), (current, []))

    def test_invalid_targets_and_sign_in_methods_do_not_trigger_write(self):
        address = reviewer()["email_addresses"][0]
        for users in [[], [reviewer(), reviewer()], [reviewer(primary_email_address_id="another")],
                      [reviewer(email_addresses=[{**address, "verification": {"status": "unverified"}}])],
                      [reviewer(email_addresses=[{**address, "email_address": REVIEWER + ".example"}])],
                      [reviewer(email_addresses=[address, {**address, "id": "another"}])],
                      [reviewer(password_enabled=False)], [reviewer(two_factor_enabled=True)],
                      [reviewer(bypass_client_trust=None)]]:
            writes = []
            with self.subTest(users=users), self.assertRaises(ValueError):
                self.run_command("enable", users, writes)
            self.assertEqual(writes, [])

    def test_unconfirmed_write_is_not_reported_as_success(self):
        for after in [reviewer(), reviewer(id="user_other", bypass_client_trust=True)]:
            with self.subTest(after=after), self.assertRaisesRegex(ValueError, "could not be verified"):
                self.run_command("enable", [reviewer()], readback=after)
