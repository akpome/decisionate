import os
import unittest
from datetime import datetime, timedelta
from urllib.parse import parse_qs, urlparse
from unittest.mock import patch

from cryptography.fernet import Fernet

from app.modules.oauth.service import (
    build_authorization_url,
    create_pkce_challenge,
    decrypt_token,
    encrypt_token,
    exchange_code,
    is_oauth_provider_configured,
)
from app.modules.oauth.router import (
    get_oauth_config_requirement_error,
)
from app.modules.datasets.services.scheduling import (
    connection_sync_is_due,
    read_connection_schedule,
    write_connection_schedule,
)


class OAuthAndSchedulingTests(unittest.TestCase):
    def test_pkce_challenge_matches_rfc7636_s256(self):
        self.assertEqual(
            create_pkce_challenge(
                "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
            ),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
        )

    def test_salesforce_authorization_url_includes_pkce(self):
        with patch.dict(
            os.environ,
            {
                "SALESFORCE_CLIENT_ID": "client-id",
                "SALESFORCE_CLIENT_SECRET": "client-secret",
                "SALESFORCE_OAUTH_AUTHORIZATION_URL": (
                    "https://login.salesforce.com/services/oauth2/authorize"
                ),
                "SALESFORCE_OAUTH_TOKEN_URL": (
                    "https://login.salesforce.com/services/oauth2/token"
                ),
                "SALESFORCE_OAUTH_SCOPES": "api refresh_token",
                "OAUTH_CALLBACK_URL": (
                    "https://api.example.com/oauth/callback"
                ),
            },
            clear=False,
        ):
            url = build_authorization_url(
                "salesforce",
                "state-1",
                code_challenge="challenge-1",
            )

        query = parse_qs(urlparse(url).query)
        self.assertEqual(query["code_challenge"], ["challenge-1"])
        self.assertEqual(query["code_challenge_method"], ["S256"])

    def test_salesforce_token_exchange_includes_pkce_verifier(self):
        class FakeResponse:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self):
                return b'{"access_token":"access-token"}'

        with patch.dict(
            os.environ,
            {
                "SALESFORCE_CLIENT_ID": "client-id",
                "SALESFORCE_CLIENT_SECRET": "client-secret",
                "SALESFORCE_OAUTH_TOKEN_URL": (
                    "https://login.salesforce.com/services/oauth2/token"
                ),
                "OAUTH_CALLBACK_URL": (
                    "https://api.example.com/oauth/callback"
                ),
            },
            clear=False,
        ), patch(
            "app.modules.oauth.service.urlopen",
            return_value=FakeResponse(),
        ) as mocked_urlopen:
            payload = exchange_code(
                "salesforce",
                "auth-code",
                code_verifier="verifier-1",
            )

        request = mocked_urlopen.call_args.args[0]
        body = parse_qs(request.data.decode("utf-8"))
        self.assertEqual(payload["access_token"], "access-token")
        self.assertEqual(body["code_verifier"], ["verifier-1"])

    def test_provider_url_and_encrypted_token(self):
        key = Fernet.generate_key().decode()
        with patch.dict(
            os.environ,
            {
                "SHOPIFY_CLIENT_ID": "client-id",
                "SHOPIFY_CLIENT_SECRET": "client-secret",
                "SHOPIFY_OAUTH_AUTHORIZATION_URL_TEMPLATE": (
                    "https://{shop_domain}/admin/oauth/authorize"
                ),
                "SHOPIFY_OAUTH_TOKEN_URL_TEMPLATE": (
                    "https://{shop_domain}/admin/oauth/access_token"
                ),
                "SHOPIFY_OAUTH_SCOPES": "read_orders",
                "OAUTH_TOKEN_ENCRYPTION_KEY": key,
            },
            clear=False,
        ):
            url = build_authorization_url(
                "shopify",
                "state-1",
                {"shop_domain": "shop.example.com"},
            )
            encrypted = encrypt_token("access-token")

            self.assertTrue(is_oauth_provider_configured("shopify"))
            self.assertIn("state=state-1", url)
            self.assertNotEqual(encrypted, "access-token")
            self.assertEqual(decrypt_token(encrypted), "access-token")

    def test_google_analytics_uses_default_offline_callback(self):
        key = Fernet.generate_key().decode()
        with patch.dict(
            os.environ,
            {
                "GOOGLE_ANALYTICS_CLIENT_ID": "client-id",
                "GOOGLE_ANALYTICS_CLIENT_SECRET": "client-secret",
                "GOOGLE_ANALYTICS_OAUTH_AUTHORIZATION_URL": (
                    "https://accounts.google.com/o/oauth2/v2/auth"
                ),
                "GOOGLE_ANALYTICS_OAUTH_TOKEN_URL": (
                    "https://oauth2.googleapis.com/token"
                ),
                "GOOGLE_ANALYTICS_OAUTH_SCOPES": (
                    "https://www.googleapis.com/auth/analytics.readonly"
                ),
                "OAUTH_CALLBACK_URL": (
                    "http://localhost:8000/oauth/callback"
                ),
                "OAUTH_TOKEN_ENCRYPTION_KEY": key,
            },
            clear=False,
        ):
            url = build_authorization_url(
                "google_analytics",
                "state-1",
            )

        query = parse_qs(urlparse(url).query)
        self.assertEqual(
            query["redirect_uri"],
            [
                "http://localhost:8000/oauth/callback"
            ],
        )
        self.assertEqual(query["access_type"], ["offline"])
        self.assertEqual(query["prompt"], ["consent"])
        self.assertEqual(
            query["scope"],
            ["https://www.googleapis.com/auth/analytics.readonly"],
        )

    def test_google_ads_authorization_uses_offline_adwords_scope(self):
        key = Fernet.generate_key().decode()
        with patch.dict(
            os.environ,
            {
                "GOOGLE_ADS_CLIENT_ID": "client-id",
                "GOOGLE_ADS_CLIENT_SECRET": "client-secret",
                "GOOGLE_ADS_OAUTH_AUTHORIZATION_URL": (
                    "https://accounts.google.com/o/oauth2/v2/auth"
                ),
                "GOOGLE_ADS_OAUTH_TOKEN_URL": (
                    "https://oauth2.googleapis.com/token"
                ),
                "GOOGLE_ADS_OAUTH_SCOPES": (
                    "https://www.googleapis.com/auth/adwords"
                ),
                "OAUTH_CALLBACK_URL": (
                    "https://api.example.com/oauth/callback"
                ),
                "OAUTH_TOKEN_ENCRYPTION_KEY": key,
            },
            clear=False,
        ):
            url = build_authorization_url(
                "google_ads",
                "state-1",
            )

        query = parse_qs(urlparse(url).query)
        self.assertEqual(
            query["scope"],
            ["https://www.googleapis.com/auth/adwords"],
        )
        self.assertEqual(query["access_type"], ["offline"])
        self.assertEqual(query["prompt"], ["consent"])

    def test_oauth_requires_connector_specific_configuration(self):
        self.assertEqual(
            get_oauth_config_requirement_error(
                "google_analytics",
                {},
            ),
            "Enter and save the GA4 property ID before connecting with OAuth",
        )
        self.assertEqual(
            get_oauth_config_requirement_error(
                "shopify",
                {"shop_domain": "store.myshopify.com"},
            ),
            None,
        )
        self.assertEqual(
            get_oauth_config_requirement_error(
                "meta_ads",
                {},
            ),
            "Enter and save the Meta Ads account ID before connecting with OAuth",
        )
        self.assertEqual(
            get_oauth_config_requirement_error(
                "google_ads",
                {},
            ),
            "Enter and save the Google Ads customer ID before connecting with OAuth",
        )

    def test_schedule_is_explicit_and_due(self):
        config = write_connection_schedule(
            '{"property_id":"123"}',
            True,
            24,
        )
        self.assertEqual(read_connection_schedule(config), (True, 24))
        self.assertTrue(
            connection_sync_is_due(
                datetime.now() - timedelta(hours=25),
                datetime.now(),
                24,
            )
        )

        with self.assertRaises(ValueError):
            write_connection_schedule(
                '{"property_id":"123"}',
                True,
                6,
            )

    def test_weekly_schedule_uses_selected_day(self):
        scheduled_time = datetime(2026, 8, 26, 10, 0)
        self.assertTrue(
            connection_sync_is_due(
                scheduled_time - timedelta(days=7, hours=1),
                scheduled_time,
                168,
                "09:00",
                "UTC",
                "2026-08-26",
                3,
            )
        )

if __name__ == "__main__":
    unittest.main()
