#!/usr/bin/env python3
"""Run the durable Reports analysis queue in its own service."""

import argparse
import ctypes
import logging
import os
from pathlib import Path
import resource
import signal
import sys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--job-id", help=argparse.SUPPRESS)
    parser.add_argument("--parent-pid", type=int, help=argparse.SUPPRESS)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    if args.job_id:
        if not sys.platform.startswith("linux") or not args.parent_pid:
            raise RuntimeError("Isolated analysis jobs require the Linux supervisor.")
        if ctypes.CDLL(None).prctl(1, signal.SIGKILL) != 0:
            raise RuntimeError("Could not configure analysis worker parent-death protection.")
        if os.getppid() != args.parent_pid:
            return
        os.environ["OPENBLAS_NUM_THREADS"] = "1"
        os.environ["OMP_NUM_THREADS"] = "1"
        os.environ["NUMEXPR_MAX_THREADS"] = "2"
        memory = max(1024, int(os.getenv("ANALYSIS_JOB_MEMORY_MB", "2048"))) * 1024 * 1024
        resource.setrlimit(resource.RLIMIT_AS, (memory, memory))
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
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
        from app import main as application  # Same serialized schema bootstrap as the API.
        from app.infrastructure.analysis_worker import run_worker
        run_worker(str(Path(__file__).resolve()), once=args.once)


if __name__ == "__main__":
    main()
