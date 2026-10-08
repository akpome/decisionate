import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app.main import get_allowed_origins, health


class HealthEndpointTests(unittest.TestCase):
    def test_allowed_origins_include_decisionate_www_alias(self):
        with patch(
            "app.main.get_runtime_configuration",
            return_value=SimpleNamespace(
                cors_allowed_origins=(
                    "https://decisionate.ca",
                ),
                web_url="https://decisionate.ca",
            ),
        ):
            origins = get_allowed_origins()

        self.assertIn(
            "https://decisionate.ca",
            origins,
        )
        self.assertIn(
            "https://www.decisionate.ca",
            origins,
        )

    def test_health_reports_non_secret_alert_readiness(self):
        with patch.dict(
            "os.environ",
            {},
            clear=True,
        ), patch(
            "app.main.build_analytics_engine_status",
            return_value={
                "engine": "duckdb",
                "storage_format": "parquet",
            },
        ), patch(
            "app.main.build_ai_status",
            return_value={
                "provider": "openai",
                "configured": False,
                "model": "gpt-4o-mini",
            },
        ):
            response = health()

        body = json.loads(response.body)
        self.assertEqual(
            body["status"],
            "ok",
        )
        self.assertEqual(
            body["capabilities"]["alerts"],
            {
                "server_smtp_configured": False,
                "scheduler_configured": False,
            },
        )
        self.assertEqual(
            body["capabilities"]["connectors"],
            {
                "google_analytics": {
                    "configured": False,
                },
                "scheduler_configured": False,
            },
        )
        self.assertEqual(
            body["capabilities"]["billing"],
            {
                "provider": "",
                "configured": False,
                "lifecycle_scheduler_configured": False,
                "enabled": True,
            },
        )


if __name__ == "__main__":
    unittest.main()
