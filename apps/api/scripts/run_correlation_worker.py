#!/usr/bin/env python3
"""Dedicated relationship queue, isolated from ingestion and its restart policy."""

import argparse
import ctypes
import logging
import os
from pathlib import Path
import resource
import signal
import subprocess
import sys
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--run-id")
    parser.add_argument("--token")
    parser.add_argument("--parent-pid", type=int)
    args = parser.parse_args()
    os.environ["OPENBLAS_NUM_THREADS"] = "1"
    os.environ["OMP_NUM_THREADS"] = "1"
    os.environ["NUMEXPR_MAX_THREADS"] = "1"
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    if args.run_id:
        if not args.parent_pid or not sys.platform.startswith("linux"):
            raise RuntimeError("A supervised Linux worker is required")
        if ctypes.CDLL(None).prctl(1, signal.SIGKILL) or os.getppid() != args.parent_pid:
            return
        os.nice(10)
        memory = max(1024, min(4096, int(os.getenv("CORRELATION_JOB_MEMORY_MB", "1536")))) * 1024 * 1024
        resource.setrlimit(resource.RLIMIT_AS, (memory, memory))
        from app.modules.correlation.worker import process_run
        process_run(args.run_id, args.token)
        return
    from app import main as application
    from sqlalchemy import text
    from app.db.database import engine, SessionLocal
    from app.db.models import utc_now
    from app.modules.correlation.models import CorrelationRun
    from app.modules.correlation.worker import claim_next
    if engine.dialect.name != "postgresql":
        raise RuntimeError("The correlation supervisor requires PostgreSQL")
    with engine.connect() as connection:
        while not connection.execute(text("SELECT pg_try_advisory_lock(59831, 3)")).scalar():
            connection.commit()
            if args.once:
                return
            time.sleep(5)
        connection.commit()
        try:
            while True:
                enabled = os.getenv("CORRELATION_WORKER_ENABLED", "false").lower() == "true"
                job = claim_next() if enabled else None
                if job:
                    identity, token = job
                    child = subprocess.Popen([sys.executable, "-B", str(Path(__file__).resolve()), "--run-id", identity, "--token", token, "--parent-pid", str(os.getpid())], start_new_session=True)
                    deadline = time.monotonic() + min(1800, max(30, int(os.getenv("CORRELATION_JOB_TIMEOUT_SECONDS", "300"))))
                    try:
                        while child.poll() is None:
                            connection.execute(text("SELECT 1"))
                            connection.commit()
                            with SessionLocal() as db:
                                run = db.get(CorrelationRun, identity)
                                if run and run.worker_token == token:
                                    run.heartbeat_at = utc_now()
                                    db.commit()
                            if time.monotonic() > deadline:
                                raise TimeoutError("Correlation deadline exceeded")
                            time.sleep(1)
                    finally:
                        if child.poll() is None:
                            os.killpg(child.pid, signal.SIGKILL)
                        child.wait()
                        with SessionLocal() as db:
                            run = db.get(CorrelationRun, identity)
                            if run and run.status == "running" and run.worker_token == token:
                                run.status, run.phase, run.error_code, run.completed_at = "failed", "failed", "worker_interrupted", utc_now()
                                db.commit()
                if args.once:
                    return
                time.sleep(2)
        finally:
            connection.execute(text("SELECT pg_advisory_unlock(59831, 3)"))
            connection.commit()


if __name__ == "__main__":
    main()
