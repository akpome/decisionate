import json
import unittest
from types import SimpleNamespace

import pandas as pd

from app.modules.datasets.services.metric_selection import (
    filter_dataframe_to_selected_metrics,
    get_effective_dataset_metric_columns,
    get_selectable_numeric_columns,
    normalize_selected_metric_columns,
)


class DatasetMetricSelectionTests(unittest.TestCase):
    def setUp(self):
        self.dataframe = pd.DataFrame({
            "date": ["2026-01-01", "2026-01-02"],
            "revenue": [100, 125],
            "visits": [40, 52],
            "is_returning": [True, False],
            "numeric_text": ["100", "125"],
            "customer_email": [
                "first@example.com",
                "second@example.com",
            ],
            "revenue__sum": [100, 125],
        })

    def test_numeric_columns_are_available_and_selected_columns_are_filtered(self):
        dataset = SimpleNamespace(
            source_config=json.dumps({
                "selected_metric_columns": ["revenue"],
            })
        )

        self.assertEqual(
            get_selectable_numeric_columns(self.dataframe),
            ["revenue", "visits"],
        )
        self.assertEqual(
            get_effective_dataset_metric_columns(
                dataset,
                self.dataframe,
            ),
            ["revenue"],
        )
        self.assertEqual(
            list(
                filter_dataframe_to_selected_metrics(
                    dataset,
                    self.dataframe,
                ).columns
            ),
            [
                "date",
                "revenue",
                "is_returning",
                "customer_email",
                "revenue__sum",
            ],
        )

    def test_legacy_dataset_defaults_to_all_numeric_columns(self):
        dataset = SimpleNamespace(source_config=None)

        self.assertEqual(
            get_effective_dataset_metric_columns(
                dataset,
                self.dataframe,
            ),
            ["revenue", "visits"],
        )
        self.assertEqual(
            list(
                filter_dataframe_to_selected_metrics(
                    dataset,
                    self.dataframe,
                ).columns
            ),
            list(self.dataframe.columns),
        )

    def test_connector_suffix_metric_is_filtered_like_other_numeric_columns(self):
        dataframe = pd.DataFrame({
            "date": ["2026-01-01", "2026-01-02"],
            "revenue": [100, 125],
            "Line__count": [2, 3],
            "visits": [40, 52],
        })
        dataset = SimpleNamespace(
            source_config=json.dumps({
                "selected_metric_columns": ["revenue"],
            })
        )

        self.assertEqual(
            get_selectable_numeric_columns(dataframe),
            ["revenue", "Line__count", "visits"],
        )
        self.assertEqual(
            list(
                filter_dataframe_to_selected_metrics(
                    dataset,
                    dataframe,
                ).columns
            ),
            ["date", "revenue"],
        )

    def test_normalization_rejects_unknown_columns(self):
        with self.assertRaisesRegex(
            ValueError,
            "not numeric or was not found",
        ):
            normalize_selected_metric_columns(
                self.dataframe,
                ["customer_email"],
            )


if __name__ == "__main__":
    unittest.main()
