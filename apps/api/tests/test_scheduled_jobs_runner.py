import os
import unittest
from unittest.mock import patch

from scripts.run_scheduled_jobs import selected_jobs


class ScheduledJobsRunnerTests(unittest.TestCase):
    def test_omitted_job_selection_runs_only_configured_jobs(self):
        with patch.dict(
            os.environ,
            {"CONNECTORS_SCHEDULER_SECRET": "connector-secret"},
            clear=True,
        ):
            self.assertEqual(
                [job.name for job in selected_jobs()],
                ["connectors"],
            )

    def test_explicit_job_selection_is_preserved(self):
        with patch.dict(
            os.environ,
            {"SCHEDULED_JOBS": "connectors,alerts"},
            clear=True,
        ):
            self.assertEqual(
                [job.name for job in selected_jobs()],
                ["connectors", "alerts"],
            )

    def test_no_configured_jobs_returns_empty_selection(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(selected_jobs(), [])


if __name__ == "__main__":
    unittest.main()
