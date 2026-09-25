import os
import tempfile
import unittest
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

import pandas as pd

from app.modules.datasets.router import (
    merge_connector_dataframes,
    normalize_connector_dataframe_for_parquet,
    normalize_connector_partition_month,
    write_connector_monthly_partitions,
)


class ConnectorStorageTests(unittest.TestCase):
    def test_mixed_connector_values_write_to_parquet(self):
        dataframe = pd.DataFrame({
            "id": ["001", "002"],
            "amount": [Decimal("1.20"), 2.3],
            "metadata": [{"channel": "web"}, "legacy"],
            "tags": [["new"], "legacy"],
            "date": ["2026-09-24", "2026-09-24"],
        })
        connection = SimpleNamespace(
            id=1,
            user_id="user-1",
            workspace_id="workspace-1",
            source_type="shopify",
        )

        with tempfile.TemporaryDirectory() as directory:
            partition_dir = os.path.join(directory, "partition")
            with patch(
                "app.modules.datasets.router.build_connector_partition_dir",
                return_value=partition_dir,
            ):
                result = write_connector_monthly_partitions(
                    dataframe,
                    connection,
                    {"date_column": "date"},
                    existing_summary=pd.DataFrame(),
                )

            self.assertEqual(result["hot_partition_count"], 1)
            stored = pd.read_parquet(
                os.path.join(
                    partition_dir,
                    "hot",
                    "month=2026-09.parquet",
                )
            )

        self.assertEqual(stored["id"].tolist(), ["001", "002"])
        self.assertEqual(stored["amount"].tolist(), [1.2, 2.3])
        self.assertEqual(stored["metadata"].tolist(), [
            '{"channel": "web"}',
            "legacy",
        ])
        self.assertEqual(stored["tags"].tolist(), [
            '["new"]',
            "legacy",
        ])

    def test_empty_dataframes_remain_empty(self):
        dataframe = pd.DataFrame()

        normalized = normalize_connector_dataframe_for_parquet(dataframe)

        self.assertTrue(normalized.empty)
        self.assertEqual(list(normalized.columns), [])

    def test_duplicate_dynamic_columns_are_made_unique(self):
        dataframe = pd.DataFrame(
            [[1, "legacy"]],
            columns=["value", "value"],
        )

        normalized = normalize_connector_dataframe_for_parquet(dataframe)

        self.assertEqual(
            list(normalized.columns),
            ["value", "value__duplicate_2"],
        )
        with tempfile.TemporaryDirectory() as directory:
            normalized.to_parquet(
                os.path.join(directory, "duplicate.parquet"),
                index=False,
            )

    def test_connector_merge_hashes_dynamic_identity_values_after_normalization(self):
        incoming = pd.DataFrame({
            "record_id": [{"id": "invoice-1"}],
            "total_amount": [12.5],
        })

        merged = merge_connector_dataframes(
            pd.DataFrame(),
            normalize_connector_dataframe_for_parquet(incoming),
            "sage",
            {},
        )

        self.assertEqual(
            merged.iloc[0]["record_id"],
            '{"id": "invoice-1"}',
        )

    def test_partition_month_normalizes_float_and_date_values(self):
        self.assertEqual(
            normalize_connector_partition_month(
                float("nan"),
                "2026-09",
            ),
            "2026-09",
        )
        self.assertEqual(
            normalize_connector_partition_month(
                "2026-09-24",
                "2026-09",
            ),
            "2026-09",
        )
        self.assertEqual(
            normalize_connector_partition_month(
                2026.0,
                "2026-09",
            ),
            "2026-09",
        )


if __name__ == "__main__":
    unittest.main()
