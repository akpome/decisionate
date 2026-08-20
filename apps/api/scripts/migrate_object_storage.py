#!/usr/bin/env python3
"""Copy Decisionate dataset objects to another provider and update references."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any

sys.path.insert(
    0,
    str(Path(__file__).resolve().parents[1]),
)

from app.db.database import SessionLocal
from app.db.models import Dataset
from app.infrastructure.object_storage import (
    ObjectStorage,
    get_migration_object_storage_config,
)


def _safe_filename(value: str | None) -> str:
    clean_value = re.sub(
        r"[^A-Za-z0-9._-]+",
        "-",
        str(value or "dataset.parquet").strip(),
    ).strip(".-")
    return clean_value or "dataset.parquet"


def _hash_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _local_manifest(path: str) -> list[tuple[str, int, str]]:
    root = Path(path)
    if root.is_dir():
        return [
            (
                candidate.relative_to(root).as_posix(),
                candidate.stat().st_size,
                _hash_file(candidate),
            )
            for candidate in sorted(root.rglob("*"))
            if candidate.is_file()
        ]
    return [(root.name, root.stat().st_size, _hash_file(root))]


def _target_key(
    source: ObjectStorage,
    dataset: Dataset,
    reference: str,
) -> str:
    if source.is_reference(reference):
        key = source.reference_key(reference)
        return key + ("/" if reference.endswith("/") and not key.endswith("/") else "")

    filename = _safe_filename(dataset.file_name)
    if source.is_directory_reference(reference):
        return f"datasets/migrated/dataset-{dataset.id}/"
    return f"datasets/migrated/dataset-{dataset.id}/{filename}"


def _copy_and_verify(
    source: ObjectStorage,
    target: ObjectStorage,
    dataset: Dataset,
    reference: str,
    verify: bool,
) -> str:
    key = _target_key(source, dataset, reference)
    is_directory = source.is_directory_reference(reference)

    with source.materialize(reference) as local_source:
        source_manifest = _local_manifest(local_source)
        if is_directory:
            target_reference = target.put_directory(
                local_source,
                key.rstrip("/"),
            )
        else:
            target_reference = target.put_file(
                local_source,
                key=key,
            )

    if not verify:
        return target_reference

    with target.materialize(target_reference) as local_target:
        target_manifest = _local_manifest(local_target)

    if source_manifest != target_manifest:
        raise RuntimeError(
            f"Verification failed for dataset {dataset.id}: "
            "source and target object contents differ"
        )

    return target_reference


def migrate(
    *,
    dry_run: bool,
    verify: bool,
    delete_source: bool,
) -> dict[str, Any]:
    source = ObjectStorage(
        get_migration_object_storage_config(
            "STORAGE_MIGRATION_SOURCE"
        )
    )
    target = ObjectStorage(
        get_migration_object_storage_config(
            "STORAGE_MIGRATION_TARGET"
        )
    )

    if source.config.provider == target.config.provider and (
        source.config.bucket == target.config.bucket
        and source.config.local_root == target.config.local_root
    ):
        raise ValueError("Migration source and target are identical")

    db = SessionLocal()
    mapping: dict[str, str] = {}
    copied: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    try:
        datasets = db.query(Dataset).order_by(Dataset.id.asc()).all()
        for dataset in datasets:
            reference = str(dataset.file_path or "").strip()
            if not reference or reference == "manual_upload":
                skipped.append(
                    {
                        "dataset_id": dataset.id,
                        "reason": "no persisted object reference",
                    }
                )
                continue

            if reference in mapping:
                target_reference = mapping[reference]
            elif dry_run:
                target_reference = "not-copied"
            else:
                target_reference = _copy_and_verify(
                    source,
                    target,
                    dataset,
                    reference,
                    verify,
                )
                mapping[reference] = target_reference

            copied.append(
                {
                    "dataset_id": dataset.id,
                    "source_reference": reference,
                    "target_reference": target_reference,
                }
            )

        if not dry_run:
            for dataset in datasets:
                reference = str(dataset.file_path or "").strip()
                target_reference = mapping.get(reference)
                if target_reference:
                    dataset.file_path = target_reference
            db.commit()

        if delete_source and not dry_run:
            for reference, target_reference in mapping.items():
                if reference != target_reference:
                    source.delete(reference)
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

    return {
        "dry_run": dry_run,
        "verified": verify and not dry_run,
        "source_provider": source.config.provider,
        "target_provider": target.config.provider,
        "dataset_count": len(copied),
        "copied_object_count": len(mapping),
        "skipped": skipped,
        "datasets": copied,
        "source_deleted": delete_source and not dry_run,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Migrate Decisionate dataset objects between storage providers.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="List dataset references without copying or changing the database.",
    )
    parser.add_argument(
        "--no-verify",
        action="store_true",
        help="Skip byte-level verification after copying.",
    )
    parser.add_argument(
        "--delete-source",
        action="store_true",
        help="Delete source objects only after the database update succeeds.",
    )
    parser.add_argument(
        "--report",
        type=Path,
        help="Write the migration summary as JSON to this path.",
    )
    return parser


def main() -> int:
    args = build_parser().parse_args()
    result = migrate(
        dry_run=args.dry_run,
        verify=not args.no_verify,
        delete_source=args.delete_source,
    )
    payload = json.dumps(result, indent=2, sort_keys=True)
    print(payload)
    if args.report:
        args.report.write_text(payload + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
