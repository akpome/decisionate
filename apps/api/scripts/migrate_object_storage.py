#!/usr/bin/env python3
"""Copy Decisionate dataset objects to another provider and update references."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path, PurePosixPath
from typing import Any
from urllib.parse import urlparse

from sqlalchemy import inspect, text

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
from app.modules.datasets.services.analytics_storage import (
    normalize_analytics_identifier,
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
    # A single file may be renamed during migration, for example from an
    # upload UUID to the dataset's display filename. Verify its bytes rather
    # than treating that intentional rename as a content mismatch.
    return [("__single_file__", root.stat().st_size, _hash_file(root))]


def _target_key(
    source: ObjectStorage,
    dataset: Dataset,
    reference: str,
) -> str:
    if source.is_reference(reference):
        return source.reference_key(reference)

    workspace_key = normalize_analytics_identifier(
        dataset.workspace_id,
        "workspace",
    )
    base = f"datasets/workspace={workspace_key}/dataset-{dataset.id}"
    if source.is_directory_reference(reference):
        return f"{base}/"

    # The stored path reflects the converted format. The original upload name
    # can still end in .csv even when the persisted file is Parquet.
    if _dataset_stored_as_parquet(dataset):
        suffix = ".parquet"
    else:
        suffix = PurePosixPath(Path(reference).name).suffix.lower()
        if not suffix:
            suffix = PurePosixPath(Path(dataset.file_name).name).suffix.lower()
        suffix = suffix or ".data"
    return f"{base}{suffix}"


def _reference_matches_provider(
    reference: str,
    provider: str,
) -> bool:
    """Return whether a reference is already stored by the target provider."""
    scheme = urlparse(str(reference or "").strip()).scheme.lower()
    clean_provider = str(provider or "").strip().lower()
    if clean_provider == "r2":
        return scheme == "r2"
    if clean_provider == "s3":
        return scheme == "s3"
    if clean_provider == "gcs":
        return scheme in {"gs", "gcs"}
    if clean_provider == "azure":
        return scheme in {"azure", "az"}
    return False


def _dataset_stored_as_parquet(dataset: Dataset) -> bool:
    try:
        report_config = json.loads(str(dataset.source_config or "{}"))
    except (TypeError, ValueError, json.JSONDecodeError):
        return False
    return str(report_config.get("stored_file_format", "")).lower() in {
        "parquet",
        "pq",
    }


def _repair_target_reference(
    target: ObjectStorage,
    dataset: Dataset,
    reference: str,
    verify: bool,
) -> str | None:
    """Move an existing target object into the canonical workspace key."""
    current_key = target.reference_key(reference)
    target_key = _target_key(target, dataset, reference)
    if current_key.rstrip("/") == target_key.rstrip("/"):
        return None

    is_directory = target.is_directory_reference(reference)
    with target.materialize(reference) as local_source:
        source_manifest = _local_manifest(local_source)
        if is_directory:
            repaired_reference = target.put_directory(
                local_source,
                target_key.rstrip("/"),
            )
        else:
            repaired_reference = target.put_file(
                local_source,
                key=target_key,
            )

    if verify:
        with target.materialize(repaired_reference) as local_target:
            target_manifest = _local_manifest(local_target)
        if source_manifest != target_manifest:
            raise RuntimeError(
                f"Verification failed for dataset {dataset.id}: "
                "canonical key migration changed object contents"
            )

    return repaired_reference


def _find_local_recovery_reference(
    source: ObjectStorage,
    dataset: Dataset,
) -> str | None:
    """Find a unique original local Parquet file for a missing target object."""
    if source.config.provider != "local":
        return None

    root = Path(source.config.local_root)
    if not root.is_dir():
        return None

    stem = Path(str(dataset.file_name or "")).stem
    if not stem:
        return None

    candidates = sorted(
        path
        for path in root.rglob("*.parquet")
        if path.is_file() and path.stem.endswith(stem)
    )
    if len(candidates) != 1:
        return None
    return str(candidates[0])


def _is_missing_object_error(error: Exception) -> bool:
    response = getattr(error, "response", {})
    error_code = str(response.get("Error", {}).get("Code", ""))
    return error_code in {"404", "NoSuchKey", "NotFound"}


def _target_reference_exists(
    target: ObjectStorage,
    reference: str,
) -> bool:
    try:
        fingerprint = target.fingerprint(reference)
    except Exception as error:
        if _is_missing_object_error(error):
            return False
        raise

    if target.is_directory_reference(reference):
        return int(fingerprint.get("object_count", 0)) > 0
    return fingerprint is not None


def _dataset_reference_for_storage(
    dataset: Dataset,
    storage: ObjectStorage,
) -> str:
    """Resolve a legacy URI or neutral key for a migration storage config."""
    stored_value = str(dataset.file_path or "").strip()
    if not stored_value or storage.is_reference(stored_value):
        return stored_value

    provider = str(getattr(dataset, "storage_provider", "") or "").strip().lower()
    if provider == storage.config.provider:
        return storage.reference_for_key(stored_value, provider)
    if provider == "local" or not provider:
        return stored_value
    raise RuntimeError(
        f"Dataset {dataset.id} uses provider {provider}, but the migration "
        f"source is configured as {storage.config.provider}"
    )


def _ensure_dataset_storage_provider_column(db) -> None:
    """Allow the standalone tool to read databases created before this field."""
    bind = db.get_bind()
    column_names = {
        str(column["name"])
        for column in inspect(bind).get_columns("datasets")
    }
    if "storage_provider" not in column_names:
        db.execute(
            text(
                "ALTER TABLE datasets "
                "ADD COLUMN storage_provider VARCHAR"
            )
        )
        db.commit()


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
        _ensure_dataset_storage_provider_column(db)
        datasets = db.query(Dataset).order_by(Dataset.id.asc()).all()
        if not datasets:
            raise RuntimeError(
                "No dataset rows were found in the database configured by "
                "DATABASE_URL. Object-storage migration uses the PostgreSQL "
                "dataset catalog; verify that DATABASE_URL points to the "
                "application database before continuing."
            )
        for dataset in datasets:
            stored_value = str(dataset.file_path or "").strip()
            stored_provider = str(
                getattr(dataset, "storage_provider", "") or ""
            ).strip().lower()
            reference = (
                target.reference_for_key(stored_value)
                if (
                    stored_provider == target.config.provider
                    and not source.is_reference(stored_value)
                )
                else _dataset_reference_for_storage(dataset, source)
            )
            if not reference or reference == "manual_upload":
                skipped.append(
                    {
                        "dataset_id": dataset.id,
                        "reason": "no persisted object reference",
                    }
                )
                continue

            already_in_target = (
                stored_provider == target.config.provider
                or _reference_matches_provider(
                    reference,
                    target.config.provider,
                )
            )
            if already_in_target:
                if not _reference_matches_provider(
                    reference,
                    target.config.provider,
                ) and stored_provider == target.config.provider:
                    reference = target.reference_for_key(stored_value)

            if already_in_target:
                if dry_run:
                    skipped.append(
                        {
                            "dataset_id": dataset.id,
                            "reference": reference,
                            "reason": (
                                "already in target provider; "
                                "Parquet key repair will be applied"
                            ),
                        }
                    )
                    continue

                if not _target_reference_exists(target, reference):
                    recovery_reference = _find_local_recovery_reference(
                        source,
                        dataset,
                    )
                    if not recovery_reference:
                        raise RuntimeError(
                            f"Target object is missing for dataset {dataset.id} "
                            f"and no unique local Parquet source was found: {reference}"
                        )
                    repaired_reference = _copy_and_verify(
                        source,
                        target,
                        dataset,
                        recovery_reference,
                        verify,
                    )
                    mapping[reference] = repaired_reference
                    copied.append(
                        {
                            "dataset_id": dataset.id,
                            "source_reference": recovery_reference,
                            "target_reference": repaired_reference,
                            "reason": (
                                "recovered from local source after "
                                "missing target object"
                            ),
                        }
                    )
                    continue

                try:
                    repaired_reference = _repair_target_reference(
                        target,
                        dataset,
                        reference,
                        verify,
                    )
                except Exception as error:
                    recovery_reference = (
                        _find_local_recovery_reference(source, dataset)
                        if _is_missing_object_error(error)
                        else None
                    )
                    if not recovery_reference:
                        raise
                    repaired_reference = _copy_and_verify(
                        source,
                        target,
                        dataset,
                        recovery_reference,
                        verify,
                    )
                    mapping[reference] = repaired_reference
                    copied.append(
                        {
                            "dataset_id": dataset.id,
                            "source_reference": recovery_reference,
                            "target_reference": repaired_reference,
                            "reason": (
                                "recovered from local source after "
                                "missing target object"
                            ),
                        }
                    )
                    continue
                if repaired_reference:
                    mapping[reference] = repaired_reference
                    copied.append(
                        {
                            "dataset_id": dataset.id,
                            "source_reference": reference,
                            "target_reference": repaired_reference,
                            "reason": "repaired Parquet object reference",
                        }
                    )
                    continue
                skipped.append(
                    {
                        "dataset_id": dataset.id,
                        "reference": reference,
                        "reason": "already in target provider",
                    }
                )
                mapping[reference] = reference
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
                reference = _dataset_reference_for_storage(dataset, source)
                target_reference = mapping.get(reference)
                if target_reference:
                    dataset.file_path = (
                        target.reference_key(target_reference)
                        if target.is_reference(target_reference)
                        else target_reference
                    )
                    dataset.storage_provider = (
                        target.config.provider
                        if target.is_remote
                        else None
                    )
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
        "dataset_count": len(datasets),
        "copied_dataset_count": len(copied),
        "copied_object_count": len(mapping),
        "skipped_count": len(skipped),
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
