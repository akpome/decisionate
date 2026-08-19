import os
import unittest
from unittest.mock import patch

from app.security import secrets


@unittest.skipUnless(
    secrets.Fernet is not None,
    "cryptography is required for the production secret round-trip test",
)
class SecretProtectionTests(unittest.TestCase):
    def test_secret_round_trip_uses_encrypted_storage_value(self):
        with patch.dict(
            os.environ,
            {
                "APP_ENV": "production",
                "OAUTH_TOKEN_ENCRYPTION_KEY": secrets.Fernet.generate_key().decode(),
            },
            clear=True,
        ):
            encrypted = secrets.encrypt_secret("smtp-password")

            self.assertTrue(encrypted.startswith("enc:v1:"))
            self.assertEqual(secrets.decrypt_secret(encrypted), "smtp-password")


if __name__ == "__main__":
    unittest.main()
