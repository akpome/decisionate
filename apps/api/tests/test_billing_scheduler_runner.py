import io
import json
import os
import unittest
from unittest.mock import patch

from scripts import run_scheduled_jobs
from scripts.run_scheduled_jobs import JOBS, reported_failure_count, run_job
from scripts.send_due_billing_lifecycle import main


class BillingSchedulerRunnerTests(unittest.TestCase):
    def test_combined_runner_fails_when_billing_verification_or_deletion_failed(self):
        with patch.dict(os.environ, {
            "SCHEDULED_JOBS": "billing", "BILLING_SCHEDULER_SECRET": "test-only",
            "DECISIONATE_API_URL": "https://api.test",
        }, clear=True), patch("urllib.request.urlopen", side_effect=lambda *args, **kwargs: io.BytesIO(json.dumps({"failed": 1}).encode())), patch(
            "sys.stdout", new=io.StringIO()
        ):
            self.assertEqual(run_job("https://api.test", JOBS["billing"], 60)["status"], "failed")
            self.assertEqual(run_scheduled_jobs.main(), 1)

    def test_billing_failure_counts_are_reported_to_combined_runner(self):
        self.assertEqual(reported_failure_count({"failed": 3}), 3)
        self.assertEqual(reported_failure_count({"failed": 3, "data_purge_failed": 2}), 3)
        self.assertEqual(reported_failure_count({"failed_count": 4}), 4)
        self.assertEqual(reported_failure_count({"failed_count": "invalid", "failed": 2}), 2)
        self.assertEqual(reported_failure_count({"failed": -1}), 0)

    def test_standalone_runner_marks_verification_failure_as_failed_run(self):
        for failures, expected in ((0, 0), (1, 1)):
            response = io.BytesIO(json.dumps({"processed": 1, "failed": failures}).encode())
            with patch("urllib.request.urlopen", return_value=response), patch("sys.stdout", new=io.StringIO()):
                result = main(["--api-url", "https://api.test", "--secret", "test-only"])
            self.assertEqual(result, expected)
