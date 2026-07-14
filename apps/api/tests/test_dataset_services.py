import unittest
from datetime import date
from datetime import datetime

import pandas as pd

from app.modules.datasets.services.charts import (
    generate_chart_data,
)
from app.modules.datasets.services.insights import (
    generate_insights,
)
from app.modules.datasets.services.metrics import (
    generate_metrics,
)
from app.modules.datasets.services.preview import (
    generate_preview,
)
from app.modules.datasets.services.serialization import (
    dataframe_to_json_records,
    to_json_number,
)


class DatasetServiceSerializationTests(unittest.TestCase):
    def setUp(self):
        self.dataframe = pd.DataFrame({
            "month": [
                "Jan",
                None,
            ],
            "revenue": [
                1.0,
                float("nan"),
            ],
            "empty": [
                float("nan"),
                float("nan"),
            ],
        })

    def test_preview_converts_missing_values_to_none(self):
        preview = generate_preview(
            self.dataframe,
        )

        self.assertEqual(
            preview[1]["month"],
            None,
        )
        self.assertEqual(
            preview[1]["revenue"],
            None,
        )
        self.assertEqual(
            preview[0]["empty"],
            None,
        )

    def test_dataset_helpers_handle_non_tabular_input(self):
        rows = [
            {
                "month": "Jan",
                "revenue": 100,
            },
        ]

        self.assertEqual(
            generate_preview(
                rows,
            ),
            [],
        )
        self.assertIsNone(
            generate_chart_data(
                rows,
            )
        )
        self.assertEqual(
            generate_metrics(
                rows,
            ),
            [],
        )

    def test_dataframe_to_json_records_preserves_original_dataframe(self):
        dataframe = self.dataframe.copy()

        records = dataframe_to_json_records(
            dataframe,
        )

        self.assertEqual(
            records[1]["revenue"],
            None,
        )
        self.assertTrue(
            pd.isna(
                dataframe.loc[1, "revenue"]
            )
        )

    def test_dataframe_to_json_records_serializes_date_values(self):
        records = dataframe_to_json_records(
            pd.DataFrame({
                "timestamp": [
                    pd.Timestamp(
                        "2024-01-01 12:30:00"
                    ),
                ],
                "datetime": [
                    datetime(
                        2024,
                        1,
                        2,
                        8,
                        15,
                    ),
                ],
                "date": [
                    date(
                        2024,
                        1,
                        3,
                    ),
                ],
            })
        )

        self.assertEqual(
            records,
            [
                {
                    "timestamp": "2024-01-01T12:30:00",
                    "datetime": "2024-01-02T08:15:00",
                    "date": "2024-01-03",
                },
            ],
        )

    def test_dataframe_to_json_records_stringifies_column_labels(self):
        records = dataframe_to_json_records(
            pd.DataFrame(
                [
                    [
                        10,
                    ],
                ],
                columns=[
                    2026,
                ],
            )
        )

        self.assertEqual(
            records,
            [
                {
                    "2026": 10,
                },
            ],
        )

    def test_to_json_number_returns_float_for_missing_values(self):
        self.assertEqual(
            to_json_number(float("nan")),
            0.0,
        )
        self.assertEqual(
            to_json_number(12),
            12.0,
        )

    def test_to_json_number_returns_float_for_invalid_values(self):
        self.assertEqual(
            to_json_number(float("inf")),
            0.0,
        )
        self.assertEqual(
            to_json_number(float("-inf")),
            0.0,
        )
        self.assertEqual(
            to_json_number("not-a-number"),
            0.0,
        )

    def test_chart_data_includes_numeric_series_and_json_nulls(self):
        chart = generate_chart_data(
            self.dataframe,
        )

        self.assertIsNotNone(chart)
        self.assertEqual(
            chart["x_key"],
            "month",
        )
        self.assertEqual(
            chart["y_key"],
            "revenue",
        )
        self.assertEqual(
            chart["data"][1]["revenue"],
            None,
        )
        self.assertIn(
            "empty",
            chart["data"][0],
        )

    def test_chart_data_uses_most_recent_50_rows(self):
        dataframe = pd.DataFrame({
            "month": [
                f"Month {index}"
                for index in range(60)
            ],
            "revenue": list(
                range(60)
            ),
            "profit": [
                index * 2
                for index in range(60)
            ],
        })

        chart = generate_chart_data(
            dataframe,
        )

        self.assertEqual(
            len(chart["data"]),
            50,
        )
        self.assertEqual(
            chart["data"][0]["month"],
            "Month 10",
        )
        self.assertEqual(
            chart["data"][-1]["month"],
            "Month 59",
        )
        self.assertIn(
            "profit",
            chart["data"][0],
        )

    def test_chart_data_returns_none_without_numeric_columns(self):
        dataframe = pd.DataFrame({
            "month": [
                "Jan",
                "Feb",
            ],
            "segment": [
                "Retail",
                "Enterprise",
            ],
        })

        self.assertIsNone(
            generate_chart_data(
                dataframe,
            )
        )

    def test_dataset_analytics_outputs_stringify_column_labels(self):
        dataframe = pd.DataFrame(
            [
                [
                    "Jan",
                    100,
                ],
                [
                    "Feb",
                    120,
                ],
            ],
            columns=[
                "month",
                2026,
            ],
        )

        chart = generate_chart_data(
            dataframe,
        )
        metrics = generate_metrics(
            dataframe,
        )
        insights = generate_insights(
            dataframe,
        )

        self.assertEqual(
            chart["y_key"],
            "2026",
        )
        self.assertEqual(
            chart["data"][0]["2026"],
            100,
        )
        self.assertEqual(
            metrics[0]["column"],
            "2026",
        )
        self.assertEqual(
            insights[0]["column"],
            "2026",
        )
        self.assertIn(
            "2026",
            insights[0]["title"],
        )

    def test_metrics_do_not_return_nan_for_empty_numeric_columns(self):
        metrics = {
            metric["column"]: metric
            for metric in generate_metrics(
                self.dataframe,
            )
        }

        self.assertEqual(
            metrics["empty"]["total"],
            0.0,
        )
        self.assertEqual(
            metrics["empty"]["average"],
            0.0,
        )
        self.assertEqual(
            metrics["empty"]["min"],
            0.0,
        )
        self.assertEqual(
            metrics["empty"]["max"],
            0.0,
        )

    def test_insights_do_not_render_nan(self):
        insights = generate_insights(
            self.dataframe,
        )

        descriptions = " ".join(
            insight["description"]
            for insight in insights
        )

        self.assertNotIn(
            "nan",
            descriptions.lower(),
        )


if __name__ == "__main__":
    unittest.main()
