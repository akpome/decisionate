#!/usr/bin/env python3
"""Run the durable ingestion queue as a separately supervised service."""

import argparse
import ctypes
import os
from pathlib import Path
import signal
import resource
import sys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--job-id", type=int, help=argparse.SUPPRESS)
    parser.add_argument("--parent-pid", type=int, help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.job_id is not None:
        if not sys.platform.startswith("linux") or not args.parent_pid:
            raise RuntimeError("Isolated ingestion jobs require the Linux supervisor.")
        # Do not leave an importing child alive after its supervisor loses
        # the database lock or its container is terminated.
        if ctypes.CDLL(None).prctl(1, signal.SIGKILL) != 0:
            raise RuntimeError("Could not configure worker parent-death protection.")
        if os.getppid() != args.parent_pid:
            return
        os.environ["OPENBLAS_NUM_THREADS"] = "1"
        os.environ["OMP_NUM_THREADS"] = "1"
        os.environ["NUMEXPR_MAX_THREADS"] = "2"
        memory_bytes = max(1024, int(os.getenv("INGESTION_JOB_MEMORY_MB", "2048"))) * 1024 * 1024
        resource.setrlimit(resource.RLIMIT_AS, (memory_bytes, memory_bytes))
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    os.environ["INGESTION_EXECUTION_MODE"] = "worker"
    from app.infrastructure.ingestion_worker import execute_job, run_worker

    if args.job_id is not None:
        from app.security.config import validate_production_security_configuration
        from app.infrastructure.monitoring import configure_error_monitoring
        validate_production_security_configuration()
        configure_error_monitoring()
        execute_job(args.job_id)
    else:
        from app import main as application  # Initializes the schema once, not for every job.
        run_worker(str(Path(__file__).resolve()), once=args.once)


if __name__ == "__main__":
    main()
