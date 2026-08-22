import tempfile
import unittest
import json
from pathlib import Path

from scripts.migrate_object_storage import (
    _find_local_recovery_reference,
    _local_manifest,
    _reference_matches_provider,
    _target_reference_exists,
    _target_key,
)


class ObjectStorageMigrationTests(unittest.TestCase):
    def test_already_migrated_reference_matches_target_provider(self):
        self.assertTrue(
            _reference_matches_provider(
                "r2://bucket/datasets/1/data.parquet",
                "r2",
            )
        )
        self.assertFalse(
            _reference_matches_provider(
                "gs://bucket/datasets/1/data.parquet",
                "r2",
            )
        )

    def test_single_file_manifest_ignores_migration_rename(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "upload-uuid.parquet"
            target = Path(directory) / "revenue-demo.parquet"
            source.write_bytes(b"parquet-content")
            target.write_bytes(source.read_bytes())

            self.assertEqual(
                _local_manifest(str(source)),
                _local_manifest(str(target)),
            )

    def test_stored_parquet_metadata_is_detected(self):
        class DatasetStub:
            source_config = json.dumps({"stored_file_format": "parquet"})

        from scripts.migrate_object_storage import _dataset_stored_as_parquet

        self.assertTrue(_dataset_stored_as_parquet(DatasetStub()))

    def test_target_key_preserves_converted_source_suffix(self):
        class DatasetStub:
            id = 1
            file_name = "revenue-demo.csv"
            workspace_id = "workspace-123"
            source_config = json.dumps({"stored_file_format": "parquet"})

        class StorageStub:
            def is_reference(self, value):
                return False

            def is_directory_reference(self, value):
                return False

        self.assertEqual(
            _target_key(
                StorageStub(),
                DatasetStub(),
                "uploads/revenue-demo.parquet",
            ),
            "datasets/workspace=workspace_123/dataset-1.parquet",
        )

    def test_target_key_preserves_remote_object_key(self):
        class DatasetStub:
            id = 1
            file_name = "revenue-demo.csv"
            workspace_id = "workspace-123"
            source_config = json.dumps({"stored_file_format": "parquet"})

        class StorageStub:
            def is_reference(self, value):
                return True

            def is_directory_reference(self, value):
                return False

            def reference_key(self, value):
                return "datasets/workspace=abc/dataset-legacy.parquet"

        self.assertEqual(
            _target_key(
                StorageStub(),
                DatasetStub(),
                "r2://bucket/datasets/workspace=abc/dataset-legacy.parquet",
            ),
            "datasets/workspace=abc/dataset-legacy.parquet",
        )

    def test_local_recovery_finds_unique_matching_parquet(self):
        class DatasetStub:
            file_name = "revenue-demo.csv"

        class StorageStub:
            config = type("Config", (), {"provider": "local"})()

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "upload-uuid-revenue-demo.parquet"
            source.write_bytes(b"parquet-content")
            StorageStub.config.local_root = str(root)

            self.assertEqual(
                _find_local_recovery_reference(StorageStub(), DatasetStub()),
                str(source),
            )

    def test_target_reference_exists_checks_fingerprint(self):
        class StorageStub:
            def is_directory_reference(self, value):
                return False

            def fingerprint(self, value):
                return {"file_size": 10, "etag": "etag"}

        self.assertTrue(
            _target_reference_exists(
                StorageStub(),
                "r2://bucket/dataset.parquet",
            )
        )

    def test_neutral_dataset_key_resolves_for_migration_source(self):
        from scripts.migrate_object_storage import _dataset_reference_for_storage

        class DatasetStub:
            id = 1
            file_path = "datasets/workspace=abc/dataset-1.parquet"
            storage_provider = "r2"

        class StorageStub:
            config = type("Config", (), {"provider": "r2"})()

            def is_reference(self, value):
                return False

            def reference_for_key(self, value, provider):
                return f"r2://bucket/{value}"

        self.assertEqual(
            _dataset_reference_for_storage(DatasetStub(), StorageStub()),
            "r2://bucket/datasets/workspace=abc/dataset-1.parquet",
        )


if __name__ == "__main__":
    unittest.main()
