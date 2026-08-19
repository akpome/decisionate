import io
import unittest
from unittest.mock import patch

from scripts.sync_due_connectors import build_sync_due_url, main


class ConnectorSchedulerRunnerTests(unittest.TestCase):
    def test_build_sync_due_url(self):
        self.assertEqual(
            build_sync_due_url("https://api.example.com/"),
            "https://api.example.com/datasets/source-connections/sync-due",
        )

    def test_runner_requires_secret(self):
        with patch("sys.stderr", new_callable=io.StringIO):
            self.assertEqual(
                main(["--api-url", "https://api.example.com"]),
                1,
            )


if __name__ == "__main__":
    unittest.main()
