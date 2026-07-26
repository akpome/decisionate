import io
import unittest
from unittest.mock import patch

from scripts.send_due_weekly_reports import (
    build_send_due_url,
    main,
)


class AlertSchedulerRunnerTests(unittest.TestCase):
    def test_build_send_due_url_trims_trailing_slash(self):
        self.assertEqual(
            build_send_due_url(
                "https://api.example.com/",
            ),
            "https://api.example.com/alerts/weekly-report/send-due",
        )

    def test_runner_requires_scheduler_secret(self):
        with patch(
            "sys.stderr",
            new_callable=io.StringIO,
        ):
            self.assertEqual(
                main([
                    "--api-url",
                    "https://api.example.com",
                ]),
                1,
            )

    def test_runner_returns_failure_exit_when_any_workspace_fails(self):
        with patch(
            "scripts.send_due_weekly_reports.send_due_weekly_reports",
            return_value={
                "processed_count": 1,
                "sent_count": 0,
                "skipped_count": 0,
                "failed_count": 1,
                "results": [],
            },
        ), patch(
            "sys.stdout",
            new_callable=io.StringIO,
        ):
            self.assertEqual(
                main([
                    "--api-url",
                    "https://api.example.com",
                    "--secret",
                    "secret",
                ]),
                2,
            )


if __name__ == "__main__":
    unittest.main()
