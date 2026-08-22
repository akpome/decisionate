import os
import unittest
from unittest.mock import patch

from app.infrastructure.object_storage import (
    ObjectStorage,
    ObjectStorageConfig,
    _reference_for_config,
)


def storage_config(provider: str) -> ObjectStorageConfig:
    return ObjectStorageConfig(
        provider=provider,
        local_root="uploads",
        bucket="active-bucket",
        endpoint_url="",
        access_key="active-access",
        secret_key="active-secret",
        region="auto",
    )


class ObjectStorageReferenceTests(unittest.TestCase):
    def test_new_r2_references_are_unambiguous(self):
        self.assertEqual(
            _reference_for_config(storage_config("r2"), "datasets/1/data.parquet"),
            "r2://active-bucket/datasets/1/data.parquet",
        )

    def test_reference_resolver_selects_provider_from_uri(self):
        storage = ObjectStorage(storage_config("gcs"))
        with patch.dict(
            os.environ,
            {
                "R2_BUCKET": "old-r2-bucket",
                "R2_ENDPOINT": "https://r2.example",
                "R2_ACCESS_KEY_ID": "old-access",
                "R2_SECRET_ACCESS_KEY": "old-secret",
            },
            clear=False,
        ):
            resolved = storage._storage_for_reference(
                "r2://old-r2-bucket/datasets/1/data.parquet"
            )

        self.assertEqual(resolved.config.provider, "r2")
        self.assertEqual(resolved.config.bucket, "old-r2-bucket")

    def test_legacy_s3_reference_can_resolve_to_r2_during_cutover(self):
        storage = ObjectStorage(storage_config("azure"))
        with patch.dict(
            os.environ,
            {
                "OBJECT_STORAGE_LEGACY_S3_PROVIDER": "r2",
                "R2_BUCKET": "old-r2-bucket",
                "R2_ACCESS_KEY_ID": "old-access",
                "R2_SECRET_ACCESS_KEY": "old-secret",
            },
            clear=False,
        ):
            resolved = storage._storage_for_reference(
                "s3://old-r2-bucket/datasets/1/data.parquet"
            )

        self.assertEqual(resolved.config.provider, "r2")
        self.assertEqual(resolved.config.bucket, "old-r2-bucket")

    def test_provider_neutral_key_resolves_using_stored_provider(self):
        storage = ObjectStorage(storage_config("gcs"))
        with patch.dict(
            os.environ,
            {
                "R2_BUCKET": "old-r2-bucket",
                "R2_ENDPOINT": "https://r2.example",
                "R2_ACCESS_KEY_ID": "old-access",
                "R2_SECRET_ACCESS_KEY": "old-secret",
            },
            clear=False,
        ):
            self.assertEqual(
                storage.reference_for_stored_value(
                    "datasets/workspace=abc/dataset-1.parquet",
                    "r2",
                ),
                "r2://old-r2-bucket/datasets/workspace=abc/dataset-1.parquet",
            )

    def test_legacy_full_reference_remains_unchanged(self):
        storage = ObjectStorage(storage_config("gcs"))
        reference = "r2://old-r2-bucket/datasets/1/data.parquet"
        self.assertEqual(
            storage.reference_for_stored_value(reference, "r2"),
            reference,
        )


if __name__ == "__main__":
    unittest.main()
