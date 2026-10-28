import os
import unittest
from unittest.mock import patch

from app.infrastructure.analysis_resources import child_environment, memory_budget_bytes, process_memory


class AnalysisResourceTests(unittest.TestCase):
    def test_native_limits_are_set_before_exec_without_mutating_supervisor_environment(self):
        with patch.dict(os.environ, {"OPENBLAS_NUM_THREADS": "32", "MALLOC_ARENA_MAX": "16"}):
            environment = child_environment()
            self.assertEqual(environment["OPENBLAS_NUM_THREADS"], "1")
            self.assertEqual(environment["OMP_THREAD_LIMIT"], "1")
            self.assertEqual(environment["ARROW_IO_THREADS"], "2")
            self.assertEqual(environment["MALLOC_ARENA_MAX"], "2")
            self.assertEqual(os.environ["MALLOC_ARENA_MAX"], "16")

    def test_resident_budget_honors_small_service_budgets_without_a_virtual_memory_floor(self):
        for value, expected in (("2048", 2048), ("128", 128), ("0", 64)):
            with patch.dict(os.environ, {"ANALYSIS_JOB_MEMORY_MB": value}):
                self.assertEqual(memory_budget_bytes(), expected * 1024 * 1024)

    def test_proc_status_keeps_resident_and_virtual_memory_distinct(self):
        with patch("app.infrastructure.analysis_resources.Path.read_text", return_value=
                   "Name:\tpython\nVmSize:\t4194304 kB\nVmRSS:\t65536 kB\nThreads:\t3\n"):
            self.assertEqual(process_memory(123), {"rss_bytes": 64 * 1024 * 1024,
                "virtual_bytes": 4 * 1024 * 1024 * 1024, "threads": 3})

    def test_exited_children_or_unavailable_status_do_not_break_recovery(self):
        with patch("app.infrastructure.analysis_resources.Path.read_text", side_effect=FileNotFoundError):
            self.assertIsNone(process_memory(123))
        for value in ("", "VmRSS: unknown kB\n", "VmSize: 1024 kB\n"):
            with patch("app.infrastructure.analysis_resources.Path.read_text", return_value=value):
                self.assertIsNone(process_memory(123))
