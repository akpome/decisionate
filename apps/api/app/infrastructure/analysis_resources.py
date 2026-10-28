"""Keep native reservations separate from the analysis child's resident memory."""

import os
from pathlib import Path


NATIVE_ENVIRONMENT = {
    "OPENBLAS_NUM_THREADS": "1", "OMP_NUM_THREADS": "1", "OMP_THREAD_LIMIT": "1", "MKL_NUM_THREADS": "1",
    "BLIS_NUM_THREADS": "1", "NUMEXPR_NUM_THREADS": "1", "NUMEXPR_MAX_THREADS": "2",
    "ARROW_IO_THREADS": "2", "MALLOC_ARENA_MAX": "2",
}


def child_environment():
    # Allocator settings must be present before exec, not after libc starts.
    return {**os.environ, **NATIVE_ENVIRONMENT}


def memory_budget_bytes():
    return max(64, int(os.getenv("ANALYSIS_JOB_MEMORY_MB", "2048"))) * 1024 * 1024


def process_memory(pid):
    try:
        fields = {}
        for line in Path(f"/proc/{pid}/status").read_text().splitlines():
            key, _, value = line.partition(":")
            if key in {"VmRSS", "VmSize", "Threads"}:
                fields[key] = int(value.split()[0])
        return {"rss_bytes": fields["VmRSS"] * 1024, "virtual_bytes": fields["VmSize"] * 1024,
                "threads": fields.get("Threads", 0)}
    except (OSError, ValueError, KeyError, IndexError):
        return None  # The child can exit between poll() and reading /proc.
