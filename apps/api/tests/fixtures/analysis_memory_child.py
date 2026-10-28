"""Bounded process fixture for the resident-memory watchdog tests."""

import mmap
import os
import time


if os.environ["DECISIONATE_TEST_MEMORY_MODE"] == "resident":
    allocation = bytearray(160 * 1024 * 1024)
    time.sleep(10)
else:
    reservation = mmap.mmap(-1, 3 * 1024**3, prot=0)
    time.sleep(1.5)
