import io
import json
import unittest
from unittest.mock import patch

from scripts.sync_due_connectors import build_sync_due_url, main


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return json.dumps(self.payload).encode("utf-8")


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

    def test_item_failure_does_not_fail_the_scheduler_process(self):
        with patch(
            "urllib.request.urlopen",
            return_value=FakeResponse({
                "processed_count": 1,
                "synced_count": 0,
                "failed_count": 1,
                "results": [{"connection_id": 26, "status": "failed"}],
            }),
        ), patch("sys.stdout", new_callable=io.StringIO), patch(
            "sys.stderr", new_callable=io.StringIO
        ):
            self.assertEqual(
                main([
                    "--api-url",
                    "https://api.example.com",
                    "--secret",
                    "connector-secret",
                ]),
                0,
            )


if __name__ == "__main__":
    unittest.main()
