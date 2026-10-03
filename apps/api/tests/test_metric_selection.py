import json
import unittest
from types import SimpleNamespace

import pandas as pd

from app.modules.datasets.services.metric_selection import (
    build_metric_selection_profile,
    filter_dataframe_to_selected_metrics,
    get_effective_dataset_metric_columns,
    get_selectable_numeric_columns,
    normalize_selected_metric_columns,
)
from app.modules.datasets.services.metrics import (
    generate_metrics,
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
            ["revenue", "visits", "numeric_text"],
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

    def test_legacy_dataset_defaults_to_recommended_numeric_columns(self):
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
            [
                "date",
                "revenue",
                "visits",
                "is_returning",
                "customer_email",
                "revenue__sum",
            ],
        )

    def test_default_metric_recommendations_are_limited_to_six(self):
        dataframe = pd.DataFrame({
            **{
                f"metric_{index}": [
                    index + offset
                    for offset in range(6)
                ]
                for index in range(1, 9)
            },
        })
        dataset = SimpleNamespace(
            source_type="csv",
            source_config=None,
        )

        profile = build_metric_selection_profile(
            dataset,
            dataframe,
        )

        self.assertEqual(
            len(profile["recommended_metric_columns"]),
            6,
        )
        self.assertEqual(
            get_effective_dataset_metric_columns(
                dataset,
                dataframe,
            ),
            profile["recommended_metric_columns"],
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

    def test_identifier_named_numeric_columns_are_not_selectable_metrics(self):
        dataframe = pd.DataFrame({
            "date": ["2026-01-01", "2026-01-02"],
            "customer_id": [101, 102],
            "api_key": [201, 202],
            "product_code": [301, 302],
            "RevenueCode": [401, 402],
            "order_number": [501, 502],
            "invoice_no": [601, 602],
            "customerNumber": [701, 702],
            "api_version": [801, 802],
            "revenue": [100, 125],
        })

        self.assertEqual(
            get_selectable_numeric_columns(dataframe),
            ["revenue"],
        )
        self.assertEqual(
            [
                metric["column"]
                for metric in generate_metrics(dataframe)
            ],
            ["revenue"],
        )

    def test_generate_metrics_can_limit_output_to_selected_columns(self):
        self.assertEqual(
            [
                metric["column"]
                for metric in generate_metrics(
                    self.dataframe,
                    ["revenue"],
                )
            ],
            ["revenue"],
        )

    def test_explicit_selection_can_include_non_recommended_columns(self):
        dataframe = pd.DataFrame({
            "customer_id": [101, 102],
            "revenue": [100, 125],
            "category": ["a", "b"],
        })
        dataset = SimpleNamespace(
            source_config=json.dumps({
                "selected_metric_columns": [
                    "customer_id",
                    "category",
                ],
            })
        )

        self.assertEqual(
            get_effective_dataset_metric_columns(
                dataset,
                dataframe,
            ),
            ["customer_id", "category"],
        )
        self.assertEqual(
            [
                metric["column"]
                for metric in generate_metrics(
                    dataframe,
                    ["customer_id", "category"],
                )
            ],
            ["customer_id"],
        )

    def test_normalization_accepts_metric_and_dimension_columns(self):
        available_columns, selected_columns = normalize_selected_metric_columns(
            self.dataframe,
            ["customer_email", "revenue"],
        )

        self.assertEqual(
            available_columns,
            [
                "revenue",
                "visits",
                "numeric_text",
            ],
        )
        self.assertEqual(
            selected_columns,
            ["revenue", "customer_email"],
        )

    def test_profile_classifies_and_excludes_unsuitable_columns(self):
        dataframe = pd.DataFrame({
            "date": [f"2026-01-0{index}" for index in range(1, 7)],
            "revenue": [100, 125, 90, 140, 110, 130],
            "customer_id": [1, 2, 3, 4, 5, 6],
            "row_sequence": [1, 2, 3, 4, 5, 6],
            "constant_value": [1, 1, 1, 1, 1, 1],
            "revenue_copy": [100, 125, 90, 140, 110, 130],
            "channel": ["web", "store", "web", "store", "web", "store"],
            "notes": ["a", "b", "c", "d", "e", "f"],
        })
        dataset = SimpleNamespace(
            source_type="quickbooks",
            source_config=None,
        )

        profile = build_metric_selection_profile(
            dataset,
            dataframe,
        )
        fields = {
            field["column"]: field
            for field in profile["fields"]
        }

        self.assertIn("revenue", profile["recommended_metric_columns"])
        self.assertEqual(fields["date"]["role"], "time")
        self.assertEqual(fields["customer_id"]["role"], "identifier")
        self.assertEqual(fields["row_sequence"]["role"], "identifier")
        self.assertEqual(fields["constant_value"]["status"], "excluded")
        self.assertEqual(fields["revenue_copy"]["status"], "excluded")
        self.assertEqual(fields["channel"]["role"], "dimension")
        self.assertNotIn("customer_id", profile["available_metric_columns"])

    def test_connector_registry_adds_semantic_metadata(self):
        dataframe = pd.DataFrame({
            "invoice_date": ["2026-01-01", "2026-01-02"],
            "total_amount": [100, 125],
            "balance": [25, 0],
        })
        dataset = SimpleNamespace(
            source_type="quickbooks",
            source_config=None,
        )

        profile = build_metric_selection_profile(
            dataset,
            dataframe,
        )
        fields = {
            field["column"]: field
            for field in profile["fields"]
        }

        self.assertEqual(
            fields["total_amount"]["registry"]["canonical_name"],
            "revenue",
        )
        self.assertEqual(
            fields["total_amount"]["registry"]["aggregation"],
            "sum",
        )

    def test_normalization_rejects_unknown_columns(self):
        with self.assertRaisesRegex(
            ValueError,
            "was not found",
        ):
            normalize_selected_metric_columns(
                self.dataframe,
                ["missing"],
            )


if __name__ == "__main__":
    unittest.main()
