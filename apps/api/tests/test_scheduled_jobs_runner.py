import io
import unittest
from unittest.mock import MagicMock, patch
from urllib.error import HTTPError

from scripts.run_scheduled_jobs import ScheduledJob, run_job


JOB = ScheduledJob(
    name="connectors",
    path="/datasets/source-connections/sync-due",
    secret_name="CONNECTORS_SCHEDULER_SECRET",
    header_name="X-Connectors-Scheduler-Secret",
)


class ScheduledJobsRunnerTests(unittest.TestCase):
    def test_retries_transient_api_failure(self):
        response = MagicMock()
        response.__enter__.return_value.read.return_value = b'{"ok": true}'
        transient_error = HTTPError(
            "https://api.example.com",
            502,
            "Bad Gateway",
            {},
            io.BytesIO(b"Application failed to respond"),
        )

        with patch(
            "scripts.run_scheduled_jobs.clean_env_value",
            return_value="secret",
        ), patch(
            "scripts.run_scheduled_jobs.urllib.request.urlopen",
            side_effect=[transient_error, response],
        ), patch("scripts.run_scheduled_jobs.sleep") as wait:
            result = run_job(
                "https://api.example.com",
                JOB,
                timeout_seconds=10,
                retry_attempts=2,
                retry_delay_seconds=5,
            )

        self.assertEqual(result["status"], "succeeded")
        self.assertEqual(result["attempts"], 2)
        wait.assert_called_once_with(5)

    def test_does_not_retry_non_transient_http_failure(self):
        not_found = HTTPError(
            "https://api.example.com",
            404,
            "Not Found",
            {},
            io.BytesIO(b"route missing"),
        )

        with patch(
            "scripts.run_scheduled_jobs.clean_env_value",
            return_value="secret",
        ), patch(
            "scripts.run_scheduled_jobs.urllib.request.urlopen",
            side_effect=not_found,
        ) as urlopen, patch("scripts.run_scheduled_jobs.sleep") as wait:
            result = run_job(
                "https://api.example.com",
                JOB,
                timeout_seconds=10,
                retry_attempts=3,
                retry_delay_seconds=5,
            )

        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["attempts"], 1)
        urlopen.assert_called_once()
        wait.assert_not_called()


if __name__ == "__main__":
    unittest.main()
