#!/usr/bin/env python3
"""Run the durable Reports analysis queue in its own service."""

import argparse
import ctypes
from importlib import import_module
import logging
import os
from pathlib import Path
import signal
import subprocess
import sys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--once", action="store_true")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--job-id", help=argparse.SUPPRESS)
    mode.add_argument("--bootstrap", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--parent-pid", type=int, help=argparse.SUPPRESS)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from app.infrastructure.analysis_resources import NATIVE_ENVIRONMENT, child_environment
    os.environ.update(NATIVE_ENVIRONMENT)
    if args.job_id or args.bootstrap:
        if not sys.platform.startswith("linux") or not args.parent_pid:
            raise RuntimeError("Isolated analysis jobs require the Linux supervisor.")
        if ctypes.CDLL(None).prctl(1, signal.SIGKILL) != 0:
            raise RuntimeError("Could not configure analysis worker parent-death protection.")
        if os.getppid() != args.parent_pid:
            return
    if args.bootstrap:
        import_module("app.main")
        return
    if args.job_id:
        from app.security.config import validate_production_security_configuration
        from app.infrastructure.monitoring import configure_error_monitoring
        validate_production_security_configuration()
        configure_error_monitoring()
        from app.infrastructure.analysis_worker import execute_job
        execute_job(args.job_id)
    else:
        from app.db.database import engine
        if engine.dialect.name != "postgresql":
            raise RuntimeError("The durable analysis worker requires PostgreSQL.")
        # Release the API/bootstrap imports before starting the persistent supervisor.
        subprocess.run([sys.executable, "-B", str(Path(__file__).resolve()), "--bootstrap",
                        "--parent-pid", str(os.getpid())], check=True, env=child_environment())
        from app.infrastructure.monitoring import configure_error_monitoring
        configure_error_monitoring()
        from app.infrastructure.analysis_worker import run_worker
        run_worker(str(Path(__file__).resolve()), once=args.once)


if __name__ == "__main__":
    main()
