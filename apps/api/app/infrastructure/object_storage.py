from __future__ import annotations

import hashlib
import json
import os
import shutil
import tempfile
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

from app.configuration import get_runtime_configuration


class ObjectStorageUnavailable(RuntimeError):
    """Raised when the configured object-storage provider cannot be used."""


REMOTE_PROVIDERS = frozenset({"r2", "s3", "gcs", "azure"})
REFERENCE_SCHEMES = frozenset(
    {"r2", "s3", "gs", "gcs", "azure", "az"}
)


@dataclass(frozen=True)
class ObjectStorageConfig:
    provider: str
    local_root: str
    bucket: str
    endpoint_url: str
    access_key: str
    secret_key: str
    region: str
    project: str = ""
    credentials_file: str = ""
    credentials_json: str = ""
    connection_string: str = ""
    account_url: str = ""
    account_name: str = ""
    account_key: str = ""
    sas_token: str = ""


def _storage_config_from_values(
    values: dict[str, str],
) -> ObjectStorageConfig:
    provider = str(values.get("provider", "local") or "local").strip().lower()
    if provider not in (REMOTE_PROVIDERS | {"local"}):
        raise ValueError(f"Unsupported object storage provider: {provider}")

    return ObjectStorageConfig(
        provider=provider,
        local_root=str(values.get("local_root", "uploads") or "uploads"),
        bucket=str(values.get("bucket", "") or "").strip(),
        endpoint_url=str(values.get("endpoint_url", "") or "").strip(),
        access_key=str(values.get("access_key", "") or "").strip(),
        secret_key=str(values.get("secret_key", "") or "").strip(),
        region=str(values.get("region", "") or "").strip(),
        project=str(values.get("project", "") or "").strip(),
        credentials_file=str(
            values.get("credentials_file", "") or ""
        ).strip(),
        credentials_json=str(
            values.get("credentials_json", "") or ""
        ).strip(),
        connection_string=str(
            values.get("connection_string", "") or ""
        ).strip(),
        account_url=str(values.get("account_url", "") or "").strip(),
        account_name=str(values.get("account_name", "") or "").strip(),
        account_key=str(values.get("account_key", "") or "").strip(),
        sas_token=str(values.get("sas_token", "") or "").strip(),
    )


def get_object_storage_config() -> ObjectStorageConfig:
    runtime = get_runtime_configuration()
    return _storage_config_from_values(
        {
            "provider": runtime.object_storage_provider,
            "local_root": runtime.dataset_upload_dir,
            "bucket": runtime.object_storage_bucket,
            "endpoint_url": runtime.object_storage_endpoint,
            "access_key": runtime.object_storage_access_key,
            "secret_key": runtime.object_storage_secret_key,
            "region": runtime.object_storage_region,
            "project": runtime.object_storage_project,
            "credentials_file": runtime.object_storage_credentials_file,
            "credentials_json": runtime.object_storage_credentials_json,
            "connection_string": runtime.object_storage_connection_string,
            "account_url": runtime.object_storage_account_url,
            "account_name": runtime.object_storage_account_name,
            "account_key": runtime.object_storage_account_key,
            "sas_token": runtime.object_storage_sas_token,
        }
    )


def get_migration_object_storage_config(
    prefix: str,
) -> ObjectStorageConfig:
    """Build a source or target config from prefixed migration variables."""
    clean_prefix = str(prefix or "").strip().upper().rstrip("_") + "_"

    def value(name: str, default: str = "") -> str:
        return str(os.getenv(f"{clean_prefix}{name}", default) or "").strip()

    return _storage_config_from_values(
        {
            "provider": value("PROVIDER", "local").lower(),
            "local_root": value("LOCAL_ROOT", "uploads"),
            "bucket": value("BUCKET"),
            "endpoint_url": value("ENDPOINT"),
            "access_key": value("ACCESS_KEY"),
            "secret_key": value("SECRET_KEY"),
            "region": value("REGION", "auto"),
            "project": value("PROJECT"),
            "credentials_file": value("CREDENTIALS_FILE"),
            "credentials_json": value("CREDENTIALS_JSON"),
            "connection_string": value("CONNECTION_STRING"),
            "account_url": value("ACCOUNT_URL"),
            "account_name": value("ACCOUNT_NAME"),
            "account_key": value("ACCOUNT_KEY"),
            "sas_token": value("SAS_TOKEN"),
        }
    )


def _reference_scheme(reference: str) -> str:
    return urlparse(reference).scheme.lower()


def _reference_parts(reference: str) -> tuple[str, str]:
    parsed = urlparse(reference)
    if parsed.scheme.lower() not in REFERENCE_SCHEMES or not parsed.netloc:
        raise ValueError(f"Invalid object storage reference: {reference}")
    return parsed.netloc, parsed.path.lstrip("/")


def _reference_for_config(
    config: ObjectStorageConfig,
    key: str,
    bucket: str | None = None,
) -> str:
    clean_bucket = str(bucket or config.bucket).strip()
    clean_key = str(key or "").lstrip("/")
    if config.provider == "r2":
        return f"r2://{clean_bucket}/{clean_key}"
    if config.provider == "s3":
        return f"s3://{clean_bucket}/{clean_key}"
    if config.provider == "gcs":
        return f"gs://{clean_bucket}/{clean_key}"
    if config.provider == "azure":
        return f"azure://{clean_bucket}/{clean_key}"
    return clean_key


def _env_first(*names: str, default: str = "") -> str:
    for name in names:
        value = str(os.getenv(name, "") or "").strip()
        if value:
            return value
    return default


def _provider_config_from_env(provider: str) -> ObjectStorageConfig:
    """Build a provider config for references that differ from the active one.

    Provider-specific variables keep old and new object stores available during
    a migration. The active provider continues to use the generic settings.
    """
    clean_provider = str(provider or "").strip().lower()
    if clean_provider == "r2":
        return _storage_config_from_values(
            {
                "provider": "r2",
                "bucket": _env_first(
                    "R2_BUCKET",
                    "OBJECT_STORAGE_R2_BUCKET",
                ),
                "endpoint_url": _env_first(
                    "R2_ENDPOINT",
                    "OBJECT_STORAGE_R2_ENDPOINT",
                ),
                "access_key": _env_first(
                    "R2_ACCESS_KEY_ID",
                    "R2_ACCESS_KEY",
                    "OBJECT_STORAGE_R2_ACCESS_KEY",
                ),
                "secret_key": _env_first(
                    "R2_SECRET_ACCESS_KEY",
                    "R2_SECRET_KEY",
                    "OBJECT_STORAGE_R2_SECRET_KEY",
                ),
                "region": _env_first(
                    "R2_REGION",
                    "OBJECT_STORAGE_R2_REGION",
                    default="auto",
                ),
            }
        )
    if clean_provider == "s3":
        return _storage_config_from_values(
            {
                "provider": "s3",
                "bucket": _env_first(
                    "S3_BUCKET",
                    "OBJECT_STORAGE_S3_BUCKET",
                ),
                "endpoint_url": _env_first(
                    "S3_ENDPOINT",
                    "OBJECT_STORAGE_S3_ENDPOINT",
                ),
                "access_key": _env_first(
                    "S3_ACCESS_KEY_ID",
                    "S3_ACCESS_KEY",
                    "AWS_ACCESS_KEY_ID",
                    "OBJECT_STORAGE_S3_ACCESS_KEY",
                ),
                "secret_key": _env_first(
                    "S3_SECRET_ACCESS_KEY",
                    "S3_SECRET_KEY",
                    "AWS_SECRET_ACCESS_KEY",
                    "OBJECT_STORAGE_S3_SECRET_KEY",
                ),
                "region": _env_first(
                    "S3_REGION",
                    "AWS_REGION",
                    "OBJECT_STORAGE_S3_REGION",
                ),
            }
        )
    if clean_provider == "gcs":
        return _storage_config_from_values(
            {
                "provider": "gcs",
                "bucket": _env_first(
                    "GCS_BUCKET",
                    "OBJECT_STORAGE_GCS_BUCKET",
                ),
                "project": _env_first(
                    "GCS_PROJECT",
                    "OBJECT_STORAGE_GCS_PROJECT",
                ),
                "credentials_file": _env_first(
                    "GCS_CREDENTIALS_FILE",
                    "OBJECT_STORAGE_GCS_CREDENTIALS_FILE",
                ),
                "credentials_json": _env_first(
                    "GCS_CREDENTIALS_JSON",
                    "OBJECT_STORAGE_GCS_CREDENTIALS_JSON",
                ),
            }
        )
    if clean_provider == "azure":
        return _storage_config_from_values(
            {
                "provider": "azure",
                "bucket": _env_first(
                    "AZURE_STORAGE_CONTAINER",
                    "AZURE_CONTAINER",
                    "OBJECT_STORAGE_AZURE_CONTAINER",
                ),
                "connection_string": _env_first(
                    "AZURE_STORAGE_CONNECTION_STRING",
                    "OBJECT_STORAGE_AZURE_CONNECTION_STRING",
                ),
                "account_url": _env_first(
                    "AZURE_STORAGE_ACCOUNT_URL",
                    "OBJECT_STORAGE_AZURE_ACCOUNT_URL",
                ),
                "account_name": _env_first(
                    "AZURE_STORAGE_ACCOUNT_NAME",
                    "OBJECT_STORAGE_AZURE_ACCOUNT_NAME",
                ),
                "account_key": _env_first(
                    "AZURE_STORAGE_ACCOUNT_KEY",
                    "OBJECT_STORAGE_AZURE_ACCOUNT_KEY",
                ),
                "sas_token": _env_first(
                    "AZURE_STORAGE_SAS_TOKEN",
                    "OBJECT_STORAGE_AZURE_SAS_TOKEN",
                ),
            }
        )
    raise ObjectStorageUnavailable(
        f"No object-storage adapter is registered for provider {provider}"
    )


class ObjectStorage:
    """Provider-neutral object storage for dataset files and partitions."""

    def __init__(self, config: ObjectStorageConfig):
        self.config = config

    @property
    def is_remote(self) -> bool:
        return self.config.provider in REMOTE_PROVIDERS

    def is_reference(self, value: str | None) -> bool:
        return _reference_scheme(str(value or "").strip()) in REFERENCE_SCHEMES

    def is_directory_reference(self, value: str | None) -> bool:
        clean_value = str(value or "").strip()
        return clean_value.endswith("/") or (
            bool(clean_value)
            and not self.is_reference(clean_value)
            and Path(clean_value).is_dir()
        )

    def reference_key(self, reference: str) -> str:
        return _reference_parts(str(reference).strip())[1]

    def reference_for_key(
        self,
        key: str,
        provider: str | None = None,
    ) -> str:
        clean_key = str(key or "").strip()
        clean_provider = str(provider or self.config.provider).strip().lower()
        if clean_provider == "local":
            return clean_key
        config = (
            self.config
            if clean_provider == self.config.provider
            else _provider_config_from_env(clean_provider)
        )
        return _reference_for_config(config, clean_key)

    def reference_for_stored_value(
        self,
        value: str | None,
        provider: str | None = None,
    ) -> str:
        """Resolve a legacy URI or a provider-neutral stored object key."""
        clean_value = str(value or "").strip()
        if not clean_value or self.is_reference(clean_value):
            return clean_value
        if provider and str(provider).strip().lower() != "local":
            return self.reference_for_key(clean_value, provider)
        return clean_value

    def _storage_for_reference(self, reference: str) -> "ObjectStorage":
        """Resolve a stored URI to the client that owns that URI.

        A legacy ``s3://`` reference created by an older R2 deployment is
        resolved through the configured legacy provider while new R2 uploads
        use the unambiguous ``r2://`` scheme.
        """
        scheme = _reference_scheme(str(reference or "").strip())
        if scheme not in REFERENCE_SCHEMES:
            return self

        if scheme == "r2":
            provider = "r2"
        elif scheme == "s3":
            if self.config.provider in {"r2", "s3"}:
                return self
            provider = _env_first(
                "OBJECT_STORAGE_LEGACY_S3_PROVIDER",
                default="r2",
            ).lower()
        elif scheme in {"gs", "gcs"}:
            provider = "gcs"
        else:
            provider = "azure"

        if provider == self.config.provider:
            return self

        resolved = _provider_config_from_env(provider)
        if not resolved.bucket:
            raise ObjectStorageUnavailable(
                f"Credentials for stored {provider} object references are not configured"
            )
        return ObjectStorage(resolved)

    def _require_bucket(self) -> str:
        if not self.config.bucket:
            raise ObjectStorageUnavailable(
                "OBJECT_STORAGE_BUCKET is required for object storage"
            )
        return self.config.bucket

    def _s3_client(self):
        try:
            import boto3
        except ModuleNotFoundError as error:
            raise ObjectStorageUnavailable(
                "S3-compatible object storage requires boto3"
            ) from error

        if not self.config.access_key or not self.config.secret_key:
            raise ObjectStorageUnavailable(
                "S3-compatible object storage credentials are not configured"
            )

        return boto3.client(
            "s3",
            endpoint_url=self.config.endpoint_url or None,
            aws_access_key_id=self.config.access_key,
            aws_secret_access_key=self.config.secret_key,
            region_name=self.config.region or None,
        )

    def _gcs_client(self):
        try:
            from google.cloud import storage
        except ModuleNotFoundError as error:
            raise ObjectStorageUnavailable(
                "GCS object storage requires google-cloud-storage"
            ) from error

        credentials = None
        if self.config.credentials_json:
            try:
                from google.oauth2 import service_account

                credentials = service_account.Credentials.from_service_account_info(
                    json.loads(self.config.credentials_json)
                )
            except (TypeError, ValueError, json.JSONDecodeError) as error:
                raise ObjectStorageUnavailable(
                    "GCS credentials JSON is invalid"
                ) from error
        elif self.config.credentials_file:
            try:
                from google.oauth2 import service_account

                credentials = service_account.Credentials.from_service_account_file(
                    self.config.credentials_file
                )
            except (OSError, ValueError) as error:
                raise ObjectStorageUnavailable(
                    "GCS credentials file could not be loaded"
                ) from error

        return storage.Client(
            project=self.config.project or None,
            credentials=credentials,
        )

    def _azure_service_client(self):
        try:
            from azure.storage.blob import BlobServiceClient
        except ModuleNotFoundError as error:
            raise ObjectStorageUnavailable(
                "Azure Blob Storage requires azure-storage-blob"
            ) from error

        if self.config.connection_string:
            return BlobServiceClient.from_connection_string(
                self.config.connection_string
            )

        account_url = self.config.account_url
        if not account_url and self.config.account_name:
            account_url = (
                f"https://{self.config.account_name}.blob.core.windows.net"
            )
        credential = self.config.account_key or self.config.sas_token
        if not account_url or not credential:
            raise ObjectStorageUnavailable(
                "Azure Blob Storage account URL and credential are required"
            )
        return BlobServiceClient(
            account_url=account_url,
            credential=credential,
        )

    def put_file(self, local_path: str, key: str | None = None) -> str:
        clean_key = str(key or Path(local_path).name).lstrip("/")
        if not self.is_remote:
            if key:
                destination = Path(self.config.local_root) / clean_key
                destination.parent.mkdir(parents=True, exist_ok=True)
                if Path(local_path).resolve() != destination.resolve():
                    shutil.copy2(local_path, destination)
                return str(destination)
            return local_path

        bucket = self._require_bucket()
        if self.config.provider in {"r2", "s3"}:
            self._s3_client().upload_file(local_path, bucket, clean_key)
        elif self.config.provider == "gcs":
            blob = self._gcs_client().bucket(bucket).blob(clean_key)
            blob.upload_from_filename(local_path)
        else:
            blob = self._azure_service_client().get_blob_client(
                container=bucket,
                blob=clean_key,
            )
            with open(local_path, "rb") as source:
                blob.upload_blob(source, overwrite=True)

        return _reference_for_config(self.config, clean_key, bucket)

    def put_directory(self, local_directory: str, key_prefix: str) -> str:
        clean_prefix = key_prefix.strip("/")
        root = Path(local_directory)
        for path in root.rglob("*"):
            if path.is_file():
                relative_path = path.relative_to(root).as_posix()
                self.put_file(
                    str(path),
                    key=f"{clean_prefix}/{relative_path}",
                )

        if self.is_remote:
            return _reference_for_config(self.config, f"{clean_prefix}/")
        return str(Path(self.config.local_root) / clean_prefix)

    def _delete_remote(self, bucket: str, key: str) -> None:
        if self.config.provider in {"r2", "s3"}:
            client = self._s3_client()
            if key.endswith("/"):
                continuation = None
                while True:
                    parameters = {"Bucket": bucket, "Prefix": key}
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
                return
            client.delete_object(Bucket=bucket, Key=key)
            return

        if self.config.provider == "gcs":
            bucket_client = self._gcs_client().bucket(bucket)
            if key.endswith("/"):
                for blob in bucket_client.list_blobs(prefix=key):
                    blob.delete()
            else:
                bucket_client.blob(key).delete()
            return

        container_client = self._azure_service_client().get_container_client(
            bucket
        )
        if key.endswith("/"):
            for blob in container_client.list_blobs(name_starts_with=key):
                container_client.delete_blob(
                    blob.name,
                    delete_snapshots="include",
                )
        else:
            container_client.delete_blob(
                key,
                delete_snapshots="include",
            )

    def delete(self, reference: str | None) -> None:
        clean_reference = str(reference or "").strip()
        if not clean_reference or clean_reference == "manual_upload":
            return

        if not self.is_reference(clean_reference):
            path = Path(clean_reference)
            try:
                if path.is_dir():
                    shutil.rmtree(path)
                else:
                    path.unlink()
            except FileNotFoundError:
                return
            return

        storage = self._storage_for_reference(clean_reference)
        if storage is not self:
            storage.delete(clean_reference)
            return

        bucket, key = _reference_parts(clean_reference)
        if self.config.provider not in REMOTE_PROVIDERS:
            raise ObjectStorageUnavailable(
                "A remote provider is required for a remote object reference"
            )
        self._delete_remote(bucket, key)

    def _remote_fingerprint(
        self,
        bucket: str,
        key: str,
    ) -> dict[str, str | int]:
        if self.config.provider in {"r2", "s3"}:
            client = self._s3_client()
            if not key.endswith("/"):
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
            return {
                "object_count": len(entries),
                "etag": hashlib.sha256(
                    "|".join(sorted(entries)).encode()
                ).hexdigest(),
            }

        if self.config.provider == "gcs":
            bucket_client = self._gcs_client().bucket(bucket)
            if not key.endswith("/"):
                blob = bucket_client.blob(key)
                blob.reload()
                return {
                    "file_size": int(blob.size or 0),
                    "etag": str(blob.etag or ""),
                }
            entries = [
                f"{blob.name}:{blob.etag}:{blob.size}"
                for blob in bucket_client.list_blobs(prefix=key)
            ]
            return {
                "object_count": len(entries),
                "etag": hashlib.sha256(
                    "|".join(sorted(entries)).encode()
                ).hexdigest(),
            }

        container_client = self._azure_service_client().get_container_client(
            bucket
        )
        if not key.endswith("/"):
            properties = container_client.get_blob_client(key).get_blob_properties()
            return {
                "file_size": int(properties.size or 0),
                "etag": str(properties.etag or ""),
            }
        entries = [
            f"{blob.name}:{blob.etag}:{blob.size}"
            for blob in container_client.list_blobs(name_starts_with=key)
        ]
        return {
            "object_count": len(entries),
            "etag": hashlib.sha256(
                "|".join(sorted(entries)).encode()
            ).hexdigest(),
        }

    def fingerprint(self, reference: str | None) -> dict[str, str | int] | None:
        """Return stable source metadata for cache invalidation and migration."""
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

        storage = self._storage_for_reference(clean_reference)
        if storage is not self:
            return storage.fingerprint(clean_reference)

        bucket, key = _reference_parts(clean_reference)
        if self.config.provider not in REMOTE_PROVIDERS:
            raise ObjectStorageUnavailable(
                "A remote provider is required for a remote object reference"
            )
        return self._remote_fingerprint(bucket, key)

    def _download_file(
        self,
        bucket: str,
        key: str,
        destination: str,
    ) -> None:
        if self.config.provider in {"r2", "s3"}:
            self._s3_client().download_file(bucket, key, destination)
            return
        if self.config.provider == "gcs":
            self._gcs_client().bucket(bucket).blob(key).download_to_filename(
                destination
            )
            return
        downloader = self._azure_service_client().get_blob_client(
            container=bucket,
            blob=key,
        ).download_blob()
        with open(destination, "wb") as target:
            target.write(downloader.readall())

    def _download_directory(
        self,
        bucket: str,
        key: str,
        target: Path,
    ) -> None:
        target.mkdir(parents=True, exist_ok=True)
        if self.config.provider in {"r2", "s3"}:
            client = self._s3_client()
            continuation = None
            while True:
                parameters = {"Bucket": bucket, "Prefix": key}
                if continuation:
                    parameters["ContinuationToken"] = continuation
                page = client.list_objects_v2(**parameters)
                for item in page.get("Contents", []):
                    object_key = item["Key"]
                    relative = object_key[len(key):].lstrip("/")
                    if relative:
                        destination = target / relative
                        destination.parent.mkdir(parents=True, exist_ok=True)
                        self._download_file(bucket, object_key, str(destination))
                if not page.get("IsTruncated"):
                    return
                continuation = page.get("NextContinuationToken")

        if self.config.provider == "gcs":
            blobs = self._gcs_client().bucket(bucket).list_blobs(prefix=key)
            for blob in blobs:
                relative = blob.name[len(key):].lstrip("/")
                if relative:
                    destination = target / relative
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    blob.download_to_filename(str(destination))
            return

        container_client = self._azure_service_client().get_container_client(
            bucket
        )
        for blob in container_client.list_blobs(name_starts_with=key):
            relative = blob.name[len(key):].lstrip("/")
            if relative:
                destination = target / relative
                destination.parent.mkdir(parents=True, exist_ok=True)
                self._download_file(bucket, blob.name, str(destination))

    @contextmanager
    def materialize(self, reference: str):
        """Yield a local path for a local path or remote object reference."""
        clean_reference = str(reference or "").strip()
        if not self.is_reference(clean_reference):
            yield clean_reference
            return

        storage = self._storage_for_reference(clean_reference)
        if storage is not self:
            with storage.materialize(clean_reference) as materialized_path:
                yield materialized_path
            return

        bucket, key = _reference_parts(clean_reference)
        if self.config.provider not in REMOTE_PROVIDERS:
            raise ObjectStorageUnavailable(
                "A remote provider is required for a remote object reference"
            )
        temporary_directory = tempfile.mkdtemp(prefix="decisionate-storage-")
        target = Path(temporary_directory) / (
            Path(key.rstrip("/")).name or "dataset"
        )
        try:
            if clean_reference.endswith("/"):
                self._download_directory(bucket, key, target)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                self._download_file(bucket, key, str(target))
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
        config.project,
        config.credentials_file,
        config.credentials_json,
        config.connection_string,
        config.account_url,
        config.account_name,
        config.account_key,
        config.sas_token,
    )
    if _storage is None or _storage_signature != signature:
        _storage = ObjectStorage(config)
        _storage_signature = signature
    return _storage


def get_dataset_storage_reference(dataset) -> str:
    """Resolve a Dataset row to a usable local path or provider URI."""
    return get_object_storage().reference_for_stored_value(
        getattr(dataset, "file_path", None),
        getattr(dataset, "storage_provider", None),
    )


def build_storage_status() -> dict:
    config = get_object_storage_config()
    if config.provider == "local":
        configured = True
    elif config.provider in {"r2", "s3"}:
        configured = bool(
            config.bucket
            and config.access_key
            and config.secret_key
        )
    elif config.provider == "gcs":
        configured = bool(
            config.bucket
            and (
                config.project
                or config.credentials_file
                or config.credentials_json
            )
        )
    else:
        configured = bool(
            config.bucket
            and (
                config.connection_string
                or (
                    config.account_url or config.account_name
                )
                and (
                    config.account_key or config.sas_token
                )
            )
        )

    return {
        "provider": config.provider,
        "configured": configured,
        "bucket_configured": bool(config.bucket),
        "endpoint_configured": bool(
            config.endpoint_url
            or config.account_url
            or config.account_name
        ),
        "portable": config.provider in REMOTE_PROVIDERS,
        "reference_scheme": (
            "s3"
            if config.provider in {"r2", "s3"}
            else "gs"
            if config.provider == "gcs"
            else "azure"
            if config.provider == "azure"
            else "local"
        ),
    }
