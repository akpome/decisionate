import os
import unittest
from datetime import datetime, timedelta
from urllib.parse import parse_qs, urlparse
from unittest.mock import patch

from cryptography.fernet import Fernet

from app.modules.oauth.service import (
    build_authorization_url,
    decrypt_token,
    encrypt_token,
    is_oauth_provider_configured,
)
from app.modules.datasets.services.scheduling import (
    connection_sync_is_due,
    read_connection_schedule,
    write_connection_schedule,
)


class OAuthAndSchedulingTests(unittest.TestCase):
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

    def test_google_analytics_uses_dedicated_offline_callback(self):
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
                "http://localhost:8000/oauth/google-analytics/callback"
            ],
        )
        self.assertEqual(query["access_type"], ["offline"])
        self.assertEqual(query["prompt"], ["consent"])
        self.assertEqual(
            query["scope"],
            ["https://www.googleapis.com/auth/analytics.readonly"],
        )

    def test_schedule_is_explicit_and_due(self):
        config = write_connection_schedule(
            '{"property_id":"123"}',
            True,
            6,
        )
        self.assertEqual(read_connection_schedule(config), (True, 6))
        self.assertTrue(
            connection_sync_is_due(
                datetime.now() - timedelta(hours=7),
                datetime.now(),
                6,
            )
        )

if __name__ == "__main__":
    unittest.main()
