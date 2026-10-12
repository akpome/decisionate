import json
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

from fastapi import HTTPException

from app.modules.identity import clerk


class ClerkEmailTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict("os.environ", {"CLERK_SECRET_KEY": "test-only-clerk-key"})
        self.environment.start()
        self.http = patch.object(clerk._clerk_opener, "open")
        self.get = self.http.start()
        self.response = self.get.return_value.__enter__.return_value
        self.response.status = 200
        self.profile = {
            "id": "user_owner", "primary_email_address_id": "email_primary",
            "email_addresses": [
                {"id": "email_secondary", "email_address": "secondary@example.test", "verification": {"status": "verified"}},
                {"id": "email_primary", "email_address": "owner@example.test", "verification": {"status": "verified"}},
            ],
        }
        self.response.read.side_effect = lambda: json.dumps(self.profile).encode()

    def tearDown(self):
        self.http.stop()
        self.environment.stop()

    def test_uses_verified_primary_address_for_the_authenticated_subject(self):
        self.assertEqual(clerk.get_verified_clerk_primary_email("user_owner"), "owner@example.test")
        request = self.get.call_args.args[0]
        self.assertEqual(request.full_url, "https://api.clerk.com/v1/users/user_owner")
        self.assertEqual(request.headers["Authorization"], "Bearer test-only-clerk-key")
        self.assertEqual(self.get.call_args.kwargs, {"timeout": 5})

    def test_does_not_use_verified_secondary_when_primary_is_unverified(self):
        self.profile["email_addresses"][1]["verification"]["status"] = "unverified"
        self.assertIsNone(clerk.get_verified_clerk_primary_email("user_owner"))

    def test_missing_primary_address_is_not_substituted(self):
        for primary_id in (None, "", "email_missing"):
            with self.subTest(primary_id=primary_id):
                self.profile["primary_email_address_id"] = primary_id
                self.assertIsNone(clerk.get_verified_clerk_primary_email("user_owner"))

    def test_missing_or_non_verified_verification_cannot_grant_eligibility(self):
        for verification in (None, {}, {"status": True}, {"status": "pending"}):
            with self.subTest(verification=verification):
                self.profile["email_addresses"][1]["verification"] = verification
                self.assertIsNone(clerk.get_verified_clerk_primary_email("user_owner"))

    def test_profile_must_match_the_authenticated_subject(self):
        self.profile["id"] = "user_other"
        with self.assertRaises(HTTPException) as error:
            clerk.get_verified_clerk_primary_email("user_owner")
        self.assertEqual(error.exception.status_code, 503)

    def test_missing_key_does_not_attempt_an_unauthenticated_lookup(self):
        with patch.dict("os.environ", {"CLERK_SECRET_KEY": ""}):
            with self.assertRaises(HTTPException) as error:
                clerk.get_verified_clerk_primary_email("user_owner")
        self.assertEqual(error.exception.status_code, 503)
        self.get.assert_not_called()

    def test_timeouts_provider_errors_and_bad_json_fail_closed(self):
        for failure in (TimeoutError("test timeout"), HTTPError("https://api.clerk.com", 403, "test provider failure", {}, None), ValueError("bad JSON")):
            with self.subTest(failure=type(failure).__name__):
                self.response.read.side_effect = failure
                with self.assertRaises(HTTPException) as error:
                    clerk.get_verified_clerk_primary_email("user_owner")
                self.assertEqual(error.exception.status_code, 503)
                self.assertEqual(error.exception.detail, clerk.LOOKUP_UNAVAILABLE)

    def test_redirects_and_malformed_profiles_fail_closed(self):
        self.response.status = 302
        with self.assertRaises(HTTPException):
            clerk.get_verified_clerk_primary_email("user_owner")
        self.response.status = 200
        for profile in ([], {"id": "user_owner", "email_addresses": {}}, {"id": "user_owner"}):
            with self.subTest(profile=profile):
                self.profile = profile
                with self.assertRaises(HTTPException):
                    clerk.get_verified_clerk_primary_email("user_owner")

    def test_subject_is_escaped_as_a_path_component(self):
        subject = "user/other?lookup=1"
        self.profile["id"] = subject
        clerk.get_verified_clerk_primary_email(subject)
        self.assertEqual(self.get.call_args.args[0].full_url, "https://api.clerk.com/v1/users/user%2Fother%3Flookup%3D1")

    def test_lookup_does_not_redirect_credentials_to_another_host(self):
        self.assertIsNone(clerk._NoRedirects().redirect_request(None, None, 302, "redirect", {}, "https://other.example.test"))


if __name__ == "__main__":
    unittest.main()
