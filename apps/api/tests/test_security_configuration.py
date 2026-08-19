import unittest
from unittest.mock import patch

from app.security.config import build_security_configuration_status


class SecurityConfigurationTests(unittest.TestCase):
    def test_production_requires_security_dependencies(self):
        with patch.dict(
            "os.environ",
            {"APP_ENV": "production"},
            clear=True,
        ):
            status = build_security_configuration_status()

        self.assertFalse(status["production_ready"])
        self.assertIn("SENTRY_DSN is required", status["issues"])
        self.assertIn("a non-SQLite DATABASE_URL is required", status["issues"])

    def test_production_accepts_verified_remote_configuration(self):
        with patch.dict(
            "os.environ",
            {
                "APP_ENV": "production",
                "AUTH_JWKS_URL": "https://auth.example/.well-known/jwks.json",
                "OAUTH_TOKEN_ENCRYPTION_KEY": "configured",
                "SENTRY_DSN": "https://public@example.ingest.sentry.io/1",
                "DATABASE_URL": "postgresql://db.example/decisionate",
                "OBJECT_STORAGE_PROVIDER": "r2",
                "DECISIONATE_WEB_APP_URL": "https://app.example",
                "DECISIONATE_API_URL": "https://api.example",
                "CORS_ALLOWED_ORIGINS": "https://app.example",
            },
            clear=True,
        ), patch(
            "app.security.config.secret_encryption_is_configured",
            return_value=True,
        ):
            status = build_security_configuration_status()

        self.assertTrue(status["production_ready"])
        self.assertEqual(status["issues"], [])


if __name__ == "__main__":
    unittest.main()
