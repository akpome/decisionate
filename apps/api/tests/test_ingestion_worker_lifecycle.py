import importlib.util
import os
from pathlib import Path
import subprocess
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import ANY, MagicMock, patch

from app.infrastructure import analysis_worker, ingestion_worker, monitoring
from app.modules.marketing import config, worker


class WorkerBootstrapTests(unittest.TestCase):
    def analysis_script(self):
        script = Path(__file__).resolve().parents[1] / "scripts" / "run_analysis_worker.py"
        spec = importlib.util.spec_from_file_location("run_analysis_worker", script)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return script, module

    def test_supervisors_keep_schema_bootstrap_without_an_unused_module_binding(self):
        for script_name, worker_module in (
            ("run_ingestion_worker", ingestion_worker),
            ("run_analysis_worker", analysis_worker),
        ):
            with self.subTest(script=script_name):
                script = Path(__file__).resolve().parents[1] / "scripts" / f"{script_name}.py"
                spec = importlib.util.spec_from_file_location(script_name, script)
                module = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(module)
                with patch.object(module, "import_module") as bootstrap, patch.object(subprocess, "run") as bootstrap_child, patch.object(
                    worker_module, "run_worker"
                ) as run, patch(
                    "app.db.database.engine", SimpleNamespace(dialect=SimpleNamespace(name="postgresql"))
                ), patch.object(sys, "argv", [str(script), "--once"]), patch.object(
                    sys, "path", sys.path.copy()
                ), patch.dict(
                    os.environ, {}, clear=False
                ), patch.object(module.logging, "basicConfig"), patch.object(monitoring, "configure_error_monitoring") as configure_monitoring:
                    module.main()
                if script_name == "run_analysis_worker":
                    bootstrap.assert_not_called()
                    bootstrap_child.assert_called_once_with(
                        [sys.executable, "-B", str(script), "--bootstrap", "--parent-pid", str(os.getpid())], check=True, env=ANY)
                    self.assertEqual(bootstrap_child.call_args.kwargs["env"]["MALLOC_ARENA_MAX"], "2")
                    self.assertEqual(bootstrap_child.call_args.kwargs["env"]["OMP_THREAD_LIMIT"], "1")
                    configure_monitoring.assert_called_once_with()
                else:
                    bootstrap.assert_called_once_with("app.main")
                    bootstrap_child.assert_not_called()
                    configure_monitoring.assert_not_called()
                run.assert_called_once_with(str(script), once=True)

    def test_analysis_queue_does_not_start_after_failed_schema_bootstrap(self):
        script, module = self.analysis_script()
        with patch.object(subprocess, "run", side_effect=subprocess.CalledProcessError(1, "bootstrap")), \
             patch.object(analysis_worker, "run_worker") as run, \
             patch("app.db.database.engine", SimpleNamespace(dialect=SimpleNamespace(name="postgresql"))), \
             patch.object(sys, "argv", [str(script), "--once"]), patch.object(sys, "path", sys.path.copy()), \
             patch.dict(os.environ, {}, clear=False), patch.object(module.logging, "basicConfig"), \
             patch.object(monitoring, "configure_error_monitoring") as configure_monitoring:
            with self.assertRaises(subprocess.CalledProcessError):
                module.main()
        run.assert_not_called()
        configure_monitoring.assert_not_called()

    def test_bootstrap_child_initializes_api_schema_without_running_queue_or_job(self):
        script, module = self.analysis_script()
        with patch.object(module, "import_module") as bootstrap, patch.object(analysis_worker, "run_worker") as run, \
             patch.object(analysis_worker, "execute_job") as execute, \
             patch.object(module.ctypes, "CDLL") as library, patch.object(module.os, "getppid", return_value=123), \
             patch("resource.setrlimit") as limit, patch.object(sys, "platform", "linux"), \
             patch.object(sys, "argv", [str(script), "--bootstrap", "--parent-pid", "123"]), \
             patch.object(sys, "path", sys.path.copy()), patch.dict(os.environ, {}, clear=False), \
             patch.object(module.logging, "basicConfig"):
            library.return_value.prctl.return_value = 0
            module.main()
        bootstrap.assert_called_once_with("app.main")
        run.assert_not_called()
        execute.assert_not_called()
        limit.assert_not_called()


class WorkerLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.engine = MagicMock()
        self.engine.dialect.name = "postgresql"
        self.connection = self.engine.connect.return_value.__enter__.return_value
        self.connection.execute.return_value.scalar.return_value = True
        self.mocks = {}
        for name, replacement in (
            ("engine", self.engine),
            ("fail_interrupted_jobs", None),
            ("cleanup_terminal_file_jobs", None),
            ("record_heartbeat", None),
            ("next_queued_job", None),
        ):
            option = {"new": replacement} if replacement is not None else {"return_value": None}
            item = patch.object(ingestion_worker, name, **option)
            self.addCleanup(item.stop)
            self.mocks[name] = item.start()
        for owner, name, value in (
            (ingestion_worker.time, "monotonic", 20),
            (config, "settings", {"enabled": True, "sending": False, "test_mode": True}),
            (worker, "process_batch", {"status": "processed", "processed": 1, "failed_count": 0}),
        ):
            item = patch.object(owner, name, return_value=value)
            self.addCleanup(item.stop)
            self.mocks[name] = item.start()
        item = patch.object(ingestion_worker.time, "sleep")
        self.addCleanup(item.stop)
        self.sleep = item.start()

    def statements(self):
        return [str(call.args[0]) for call in self.connection.execute.call_args_list]

    def test_available_lock_is_acquired_without_waiting(self):
        ingestion_worker.acquire_worker_lock(self.connection)
        self.assertEqual(self.statements(), [ingestion_worker.WORKER_LOCK])
        self.connection.commit.assert_called_once()
        self.sleep.assert_not_called()

    def test_persistent_worker_retries_without_cleanup_or_readiness_updates(self):
        self.connection.execute.return_value.scalar.side_effect = [False, False, True]
        def waiting(_):
            for name in ("fail_interrupted_jobs", "cleanup_terminal_file_jobs", "record_heartbeat", "process_batch"):
                self.mocks[name].assert_not_called()
        self.sleep.side_effect = waiting
        with self.assertLogs(ingestion_worker.logger, level="WARNING") as logs:
            ingestion_worker.acquire_worker_lock(self.connection)
        self.assertEqual(len(logs.records), 1)
        self.assertEqual(self.connection.commit.call_count, 3)
        self.assertEqual(self.sleep.call_count, 2)
        self.sleep.assert_called_with(5)

    def test_waiting_warning_is_rate_limited(self):
        self.connection.execute.return_value.scalar.side_effect = [False, False, False, True]
        self.mocks["monotonic"].side_effect = [0, 5, 60]
        with self.assertLogs(ingestion_worker.logger, level="WARNING") as logs:
            ingestion_worker.acquire_worker_lock(self.connection)
        self.assertEqual(len(logs.records), 2)

    def test_once_mode_still_rejects_a_competing_worker(self):
        self.connection.execute.return_value.scalar.return_value = False
        with self.assertRaisesRegex(RuntimeError, "Another ingestion worker"):
            ingestion_worker.run_worker("worker.py", once=True)
        self.sleep.assert_not_called()
        self.mocks["settings"].assert_not_called()
        self.mocks["fail_interrupted_jobs"].assert_not_called()
        self.mocks["record_heartbeat"].assert_not_called()
        self.assertNotIn("SELECT pg_advisory_unlock(59831, 1)", self.statements())

    def test_stopping_a_waiting_worker_never_unlocks_the_other_owner(self):
        self.connection.execute.return_value.scalar.return_value = False
        self.sleep.side_effect = KeyboardInterrupt
        with self.assertLogs(ingestion_worker.logger, level="WARNING"):
            with self.assertRaises(KeyboardInterrupt):
                ingestion_worker.run_worker("worker.py")
        self.mocks["fail_interrupted_jobs"].assert_not_called()
        self.mocks["record_heartbeat"].assert_not_called()
        self.mocks["process_batch"].assert_not_called()
        self.assertNotIn("SELECT pg_advisory_unlock(59831, 1)", self.statements())

    def test_handover_starts_processing_only_after_acquiring_the_lock(self):
        self.connection.execute.return_value.scalar.side_effect = [False, True]
        def sleep(seconds):
            if seconds == ingestion_worker.WORKER_LOCK_RETRY_SECONDS:
                self.mocks["fail_interrupted_jobs"].assert_not_called()
                self.mocks["record_heartbeat"].assert_not_called()
                self.mocks["process_batch"].assert_not_called()
            else:
                raise KeyboardInterrupt
        self.sleep.side_effect = sleep
        with self.assertLogs(ingestion_worker.logger, level="INFO") as logs:
            with self.assertRaises(KeyboardInterrupt):
                ingestion_worker.run_worker("worker.py")
        self.mocks["fail_interrupted_jobs"].assert_called_once_with()
        self.mocks["record_heartbeat"].assert_called_once_with()
        self.mocks["process_batch"].assert_called_once()
        self.assertEqual(self.statements()[-1], "SELECT pg_advisory_unlock(59831, 1)")
        self.assertTrue(any("marketing sync=True, sending=False, test_mode=True" in record.getMessage() for record in logs.records))
        self.assertTrue(any("processed=1, failed=0" in record.getMessage() for record in logs.records))

    def test_processing_error_releases_the_owned_lock(self):
        self.mocks["next_queued_job"].side_effect = RuntimeError("test queue error")
        with self.assertRaisesRegex(RuntimeError, "test queue error"):
            ingestion_worker.run_worker("worker.py", once=True)
        self.assertEqual(self.statements()[-1], "SELECT pg_advisory_unlock(59831, 1)")

    def test_database_error_is_not_misreported_as_a_busy_queue(self):
        self.connection.execute.side_effect = RuntimeError("test database unavailable")
        with self.assertRaisesRegex(RuntimeError, "test database unavailable"):
            ingestion_worker.run_worker("worker.py")
        self.sleep.assert_not_called()
        self.mocks["record_heartbeat"].assert_not_called()

    def test_non_postgresql_worker_is_still_rejected(self):
        self.engine.dialect.name = "sqlite"
        with self.assertRaisesRegex(RuntimeError, "requires PostgreSQL"):
            ingestion_worker.run_worker("worker.py")
        self.engine.connect.assert_not_called()


if __name__ == "__main__":
    unittest.main()
