#!/usr/bin/env python3
"""Export cacheable sample assets; rerun when demo data or its schema changes.

From the repository root: apps/api/.venv/bin/python apps/api/scripts/export_public_demo.py
"""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import Response
from app.modules.demo_dashboard import DEMO_DATASET_DEFINITIONS, get_demo_dashboard


def export_public_demo(web_root: Path) -> list[dict]:
    output = web_root / "public" / "demo-data"
    output.mkdir(parents=True, exist_ok=True)
    entries = []
    for key in DEMO_DATASET_DEFINITIONS:
        payload = get_demo_dashboard(Response(), dataset=key, dashboard=None)
        encoded = json.dumps(payload, separators=(",", ":"), allow_nan=False).encode()
        digest = hashlib.sha256(encoded).hexdigest()[:12]
        filename = f"{key}.{digest}.json"
        (output / filename).write_bytes(encoded)
        entries.append({"key": key, "asset": f"/demo-data/{filename}"})

    catalog = web_root / "features" / "demo" / "data" / "catalog.json"
    catalog.parent.mkdir(parents=True, exist_ok=True)
    catalog.write_text(json.dumps(entries, indent=2) + "\n", encoding="utf-8")
    return entries


if __name__ == "__main__":
    web_root = Path(__file__).resolve().parents[2] / "web"
    entries = export_public_demo(web_root)
    print(f"Exported {len(entries)} public sample datasets to {web_root / 'public/demo-data'}")
