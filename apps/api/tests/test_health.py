import json
import unittest
from unittest.mock import patch

from app.main import health


class HealthEndpointTests(unittest.TestCase):
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
                "provider": "stripe",
                "configured": False,
            },
        )


if __name__ == "__main__":
    unittest.main()
