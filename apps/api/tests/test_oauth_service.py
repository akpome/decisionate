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
                "GOOGLE_DRIVE_CLIENT_ID": "client-id",
                "GOOGLE_DRIVE_CLIENT_SECRET": "client-secret",
                "OAUTH_TOKEN_ENCRYPTION_KEY": key,
            },
            clear=False,
        ):
            url = build_authorization_url("google_drive", "state-1")
            encrypted = encrypt_token("access-token")

            self.assertTrue(is_oauth_provider_configured("google_drive"))
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


if __name__ == "__main__":
    unittest.main()
