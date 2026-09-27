import json
import os
import unittest
from unittest.mock import patch

from scripts.run_scheduled_jobs import (
    ScheduledJob,
    run_job,
    selected_jobs,
)


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return json.dumps(self.payload).encode("utf-8")


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

    def test_api_reported_connector_failures_are_nonfatal_warnings(self):
        job = ScheduledJob(
            name="connectors",
            path="/datasets/source-connections/sync-due",
            secret_name="CONNECTORS_SCHEDULER_SECRET",
            header_name="X-Connectors-Scheduler-Secret",
        )
        with patch(
            "urllib.request.urlopen",
            return_value=FakeResponse({
                "processed_count": 1,
                "synced_count": 0,
                "failed_count": 1,
                "results": [{
                    "connection_id": 26,
                    "status": "failed",
                }],
            }),
        ):
            with patch.dict(
                os.environ,
                {"CONNECTORS_SCHEDULER_SECRET": "connector-secret"},
                clear=True,
            ):
                result = run_job(
                    "https://api.example.com",
                    job,
                    60,
                )

        self.assertEqual(result["status"], "succeeded")
        self.assertEqual(result["result"]["failed_count"], 1)

    def test_api_without_reported_failures_succeeds(self):
        job = ScheduledJob(
            name="connectors",
            path="/datasets/source-connections/sync-due",
            secret_name="CONNECTORS_SCHEDULER_SECRET",
            header_name="X-Connectors-Scheduler-Secret",
        )
        with patch(
            "urllib.request.urlopen",
            return_value=FakeResponse({
                "processed_count": 0,
                "synced_count": 0,
                "failed_count": 0,
                "results": [],
            }),
        ):
            with patch.dict(
                os.environ,
                {"CONNECTORS_SCHEDULER_SECRET": "connector-secret"},
                clear=True,
            ):
                result = run_job(
                    "https://api.example.com",
                    job,
                    60,
                )

        self.assertEqual(result["status"], "succeeded")

    def test_main_only_fails_when_the_scheduler_request_fails(self):
        from scripts import run_scheduled_jobs

        with patch.object(
            run_scheduled_jobs,
            "selected_jobs",
            return_value=[
                ScheduledJob(
                    name="connectors",
                    path="/datasets/source-connections/sync-due",
                    secret_name="CONNECTORS_SCHEDULER_SECRET",
                    header_name="X-Connectors-Scheduler-Secret",
                )
            ],
        ), patch.object(
            run_scheduled_jobs,
            "run_job",
            return_value={
                "job": "connectors",
                "status": "succeeded",
                "result": {"failed_count": 1},
            },
        ), patch.dict(
            os.environ,
            {
                "DECISIONATE_API_URL": "https://api.example.com",
                "CONNECTORS_SCHEDULER_SECRET": "connector-secret",
            },
            clear=True,
        ):
            self.assertEqual(run_scheduled_jobs.main(), 0)


if __name__ == "__main__":
    unittest.main()
