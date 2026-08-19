from __future__ import annotations

import shutil
import tempfile
import hashlib
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

from app.configuration import get_runtime_configuration


class ObjectStorageUnavailable(RuntimeError):
    """Raised when the configured object-storage provider cannot be used."""


@dataclass(frozen=True)
class ObjectStorageConfig:
    provider: str
    local_root: str
    bucket: str
    endpoint_url: str
    access_key: str
    secret_key: str
    region: str


def get_object_storage_config() -> ObjectStorageConfig:
    runtime = get_runtime_configuration()
    provider = runtime.object_storage_provider
    if provider not in {"local", "r2", "s3"}:
        raise ValueError(f"Unsupported object storage provider: {provider}")

    return ObjectStorageConfig(
        provider=provider,
        local_root=runtime.dataset_upload_dir,
        bucket=runtime.object_storage_bucket,
        endpoint_url=runtime.object_storage_endpoint,
        access_key=runtime.object_storage_access_key,
        secret_key=runtime.object_storage_secret_key,
        region=runtime.object_storage_region,
    )


def _storage_reference(bucket: str, key: str) -> str:
    return f"s3://{bucket}/{key.lstrip('/')}"


class ObjectStorage:
    """Small S3-compatible adapter with a local filesystem development mode.

    Dataset.file_path stores either a local path or an s3:// reference. The
    application does not need to know whether that reference points to R2 or
    another S3-compatible provider.
    """

    def __init__(self, config: ObjectStorageConfig):
        self.config = config

    @property
    def is_remote(self) -> bool:
        return self.config.provider in {"r2", "s3"}

    def is_reference(self, value: str | None) -> bool:
        return str(value or "").strip().startswith("s3://")

    def is_directory_reference(self, value: str | None) -> bool:
        clean_value = str(value or "").strip()
        return clean_value.endswith("/") or (
            bool(clean_value)
            and not self.is_reference(clean_value)
            and Path(clean_value).is_dir()
        )

    def _client(self):
        try:
            import boto3
        except ModuleNotFoundError as error:
            raise ObjectStorageUnavailable(
                "S3-compatible object storage requires boto3"
            ) from error

        if not self.config.bucket:
            raise ObjectStorageUnavailable(
                "OBJECT_STORAGE_BUCKET is required for object storage"
            )
        if not self.config.access_key or not self.config.secret_key:
            raise ObjectStorageUnavailable(
                "Object storage credentials are not configured"
            )

        return boto3.client(
            "s3",
            endpoint_url=self.config.endpoint_url or None,
            aws_access_key_id=self.config.access_key,
            aws_secret_access_key=self.config.secret_key,
            region_name=self.config.region,
        )

    def _parse_reference(self, reference: str) -> tuple[str, str]:
        parsed = urlparse(reference)
        if parsed.scheme != "s3" or not parsed.netloc:
            raise ValueError(f"Invalid object storage reference: {reference}")
        return parsed.netloc, parsed.path.lstrip("/")

    def _local_path(self, reference: str) -> Path:
        return Path(reference)

    def put_file(self, local_path: str, key: str | None = None) -> str:
        if not self.is_remote:
            return local_path

        clean_key = key or Path(local_path).name
        self._client().upload_file(
            local_path,
            self.config.bucket,
            clean_key.lstrip("/"),
        )
        return _storage_reference(self.config.bucket, clean_key)

    def put_directory(self, local_directory: str, key_prefix: str) -> str:
        if not self.is_remote:
            return local_directory

        clean_prefix = key_prefix.strip("/")
        client = self._client()
        root = Path(local_directory)
        for path in root.rglob("*"):
            if path.is_file():
                relative_path = path.relative_to(root).as_posix()
                client.upload_file(
                    str(path),
                    self.config.bucket,
                    f"{clean_prefix}/{relative_path}",
                )
        return _storage_reference(self.config.bucket, f"{clean_prefix}/")

    def delete(self, reference: str | None) -> None:
        clean_reference = str(reference or "").strip()
        if not clean_reference:
            return

        if not self.is_reference(clean_reference):
            path = self._local_path(clean_reference)
            try:
                if path.is_dir():
                    shutil.rmtree(path)
                else:
                    path.unlink()
            except FileNotFoundError:
                return
            return

        bucket, key = self._parse_reference(clean_reference)
        client = self._client()
        if clean_reference.endswith("/"):
            continuation = None
            while True:
                parameters = {
                    "Bucket": bucket,
                    "Prefix": key,
                }
                if continuation:
                    parameters["ContinuationToken"] = continuation
                page = client.list_objects_v2(**parameters)
                objects = [
                    {"Key": item["Key"]}
                    for item in page.get("Contents", [])
                ]
                if objects:
                    client.delete_objects(
                        Bucket=bucket,
                        Delete={"Objects": objects},
                    )
                if not page.get("IsTruncated"):
                    break
                continuation = page.get("NextContinuationToken")
        else:
            client.delete_object(Bucket=bucket, Key=key)

    def fingerprint(self, reference: str | None) -> dict[str, str | int] | None:
        """Return stable source metadata for cache invalidation."""
        clean_reference = str(reference or "").strip()
        if not clean_reference:
            return None
        if not self.is_reference(clean_reference):
            try:
                stat = Path(clean_reference).stat()
            except OSError:
                return None
            return {
                "file_size": stat.st_size,
                "file_mtime_ns": stat.st_mtime_ns,
            }

        bucket, key = self._parse_reference(clean_reference)
        client = self._client()
        if not clean_reference.endswith("/"):
            metadata = client.head_object(Bucket=bucket, Key=key)
            return {
                "file_size": int(metadata.get("ContentLength", 0)),
                "etag": str(metadata.get("ETag", "")),
            }

        entries: list[str] = []
        continuation = None
        while True:
            parameters = {"Bucket": bucket, "Prefix": key}
            if continuation:
                parameters["ContinuationToken"] = continuation
            page = client.list_objects_v2(**parameters)
            entries.extend(
                f"{item.get('Key')}:{item.get('ETag')}:{item.get('Size')}"
                for item in page.get("Contents", [])
            )
            if not page.get("IsTruncated"):
                break
            continuation = page.get("NextContinuationToken")
        digest = hashlib.sha256("|".join(sorted(entries)).encode()).hexdigest()
        return {"object_count": len(entries), "etag": digest}

    @contextmanager
    def materialize(self, reference: str):
        """Yield a local path for a local path or an R2/S3 reference."""
        clean_reference = str(reference or "").strip()
        if not self.is_reference(clean_reference):
            yield clean_reference
            return

        bucket, key = self._parse_reference(clean_reference)
        temporary_directory = tempfile.mkdtemp(prefix="decisionate-storage-")
        target = Path(temporary_directory) / (Path(key.rstrip("/")).name or "dataset")
        client = self._client()
        try:
            if clean_reference.endswith("/"):
                target.mkdir(parents=True, exist_ok=True)
                continuation = None
                while True:
                    parameters = {
                        "Bucket": bucket,
                        "Prefix": key,
                    }
                    if continuation:
                        parameters["ContinuationToken"] = continuation
                    page = client.list_objects_v2(**parameters)
                    for item in page.get("Contents", []):
                        object_key = item["Key"]
                        relative = object_key[len(key):].lstrip("/")
                        if not relative:
                            continue
                        destination = target / relative
                        destination.parent.mkdir(parents=True, exist_ok=True)
                        client.download_file(bucket, object_key, str(destination))
                    if not page.get("IsTruncated"):
                        break
                    continuation = page.get("NextContinuationToken")
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                client.download_file(bucket, key, str(target))
            yield str(target)
        finally:
            shutil.rmtree(temporary_directory, ignore_errors=True)


_storage: ObjectStorage | None = None
_storage_signature: tuple[str, ...] | None = None


def get_object_storage() -> ObjectStorage:
    global _storage, _storage_signature
    config = get_object_storage_config()
    signature = (
        config.provider,
        config.local_root,
        config.bucket,
        config.endpoint_url,
        config.access_key,
        config.secret_key,
        config.region,
    )
    if _storage is None or _storage_signature != signature:
        _storage = ObjectStorage(config)
        _storage_signature = signature
    return _storage


def build_storage_status() -> dict:
    config = get_object_storage_config()
    configured = (
        config.provider == "local"
        or bool(config.bucket and config.access_key and config.secret_key)
    )
    return {
        "provider": config.provider,
        "configured": configured,
        "bucket_configured": bool(config.bucket),
        "endpoint_configured": bool(config.endpoint_url),
        "portable": config.provider in {"r2", "s3"},
    }
