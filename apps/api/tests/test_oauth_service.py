import os
import unittest
from datetime import datetime, timedelta
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

    def test_salesforce_oauth_requires_api_and_refresh_scopes(self):
        key = Fernet.generate_key().decode()
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
                "OAUTH_TOKEN_ENCRYPTION_KEY": key,
            },
            clear=False,
        ):
            url = build_authorization_url(
                "salesforce",
                "state-salesforce",
            )

            self.assertTrue(is_oauth_provider_configured("salesforce"))
            self.assertIn("state=state-salesforce", url)

    def test_netsuite_oauth_uses_account_specific_endpoints_and_scope(self):
        key = Fernet.generate_key().decode()
        with patch.dict(
            os.environ,
            {
                "NETSUITE_CLIENT_ID": "client-id",
                "NETSUITE_CLIENT_SECRET": "client-secret",
                "NETSUITE_OAUTH_AUTHORIZATION_URL_TEMPLATE": (
                    "https://{account_id}.app.netsuite.com/app/login/"
                    "oauth2/authorize.nl"
                ),
                "NETSUITE_OAUTH_TOKEN_URL_TEMPLATE": (
                    "https://{account_id}.suitetalk.api.netsuite.com/"
                    "services/rest/auth/oauth2/v1/token"
                ),
                "NETSUITE_API_BASE_URL_TEMPLATE": (
                    "https://{account_id}.suitetalk.api.netsuite.com/"
                    "services/rest/record/v1"
                ),
                "NETSUITE_OAUTH_SCOPES": "rest_webservices",
                "OAUTH_TOKEN_ENCRYPTION_KEY": key,
            },
            clear=False,
        ):
            url = build_authorization_url(
                "netsuite",
                "state-netsuite",
                {
                    "account_id": "1234567_SB1",
                    "record_type": "invoice",
                },
            )

            self.assertTrue(is_oauth_provider_configured("netsuite"))
            self.assertIn(
                "https://1234567_SB1.app.netsuite.com/",
                url,
            )
            self.assertIn("rest_webservices", url)


if __name__ == "__main__":
    unittest.main()
