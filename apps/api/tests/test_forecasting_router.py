import math
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException
import pandas as pd
from sqlalchemy.dialects import sqlite

from app.modules.datasets.services.serialization import (
    dataframe_to_json_records,
)
from app.modules.decisions.schemas import (
    HIGH_DECISION_CONFIDENCE,
    LOW_DECISION_CONFIDENCE,
    MEDIUM_DECISION_CONFIDENCE,
    VALID_DECISION_CONFIDENCE_SCORES,
)
from app.modules.forecasting.router import (
    build_forecast_dataset_metadata,
    filter_forecast_dataset_for_workspace,
    load_forecast_dataframe,
)
from app.modules.forecasting.services import (
    build_recommendation,
    build_forecast_period_labels,
    build_forecast_summary,
    generate_forecast,
    generate_recommendation,
)


class ForecastingRouterTests(unittest.TestCase):
    def test_forecast_dataset_filter_scopes_by_workspace_or_legacy_owner(self):
        expression = filter_forecast_dataset_for_workspace(
            7,
            "user-1",
            "workspace-1",
        )

        sql = str(
            expression.compile(
                dialect=sqlite.dialect(),
                compile_kwargs={
                    "literal_binds": True,
                },
            )
        )

        self.assertIn(
            "datasets.id = 7",
            sql,
        )
        self.assertIn(
            "datasets.workspace_id = 'workspace-1'",
            sql,
        )
        self.assertIn(
            "datasets.user_id = 'user-1'",
            sql,
        )

    def test_forecast_dataset_filter_trims_identity_values(self):
        expression = filter_forecast_dataset_for_workspace(
            7,
            " user-1 ",
            " workspace-1 ",
        )

        sql = str(
            expression.compile(
                dialect=sqlite.dialect(),
                compile_kwargs={
                    "literal_binds": True,
                },
            )
        )

        self.assertIn(
            "datasets.workspace_id = 'workspace-1'",
            sql,
        )
        self.assertIn(
            "datasets.user_id = 'user-1'",
            sql,
        )

    def test_load_forecast_dataframe_raises_404_for_missing_file(self):
        dataset = SimpleNamespace(
            file_path="missing.csv",
        )

        with patch(
            "app.modules.forecasting.router.load_dataframe_from_dataset",
            side_effect=FileNotFoundError(),
        ):
            with self.assertRaises(HTTPException) as context:
                load_forecast_dataframe(
                    dataset,
                )

        self.assertEqual(
            context.exception.status_code,
            404,
        )
        self.assertEqual(
            context.exception.detail,
            "Dataset file not found",
        )

    def test_load_forecast_dataframe_uses_shared_dataset_loader(self):
        dataset = SimpleNamespace(
            file_path="sales.json",
        )
        dataframe = pd.DataFrame({
            "month": [
                "2024-01",
            ],
            "revenue": [
                100,
            ],
        })

        with patch(
            "app.modules.forecasting.router.load_dataframe_from_dataset",
            return_value=dataframe,
        ) as load_dataframe:
            result = load_forecast_dataframe(
                dataset,
            )

        load_dataframe.assert_called_once_with(
            dataset,
        )
        self.assertIs(
            result,
            dataframe,
        )

    def test_forecast_dataset_metadata_includes_source_label(self):
        dataset = SimpleNamespace(
            id=3,
            file_name="orders.json",
            source_type="json",
            source_config='{"ingestion_mode": "upload"}',
        )

        self.assertEqual(
            build_forecast_dataset_metadata(
                dataset,
            ),
            {
                "dataset_id": 3,
                "file_name": "orders.json",
                "source_type": "json",
                "source_label": "JSON",
                "source_config": '{"ingestion_mode": "upload"}',
            },
        )

    def test_forecast_historical_rows_are_json_safe(self):
        dataframe = pd.DataFrame(
            {
                "month": [
                    "2024-01",
                    "2024-02",
                ],
                "revenue": [
                    100.0,
                    math.nan,
                ],
            }
        )

        rows = dataframe_to_json_records(
            dataframe[
                [
                    "month",
                    "revenue",
                ]
            ].tail(12)
        )

        self.assertEqual(
            rows,
            [
                {
                    "month": "2024-01",
                    "revenue": 100.0,
                },
                {
                    "month": "2024-02",
                    "revenue": None,
                },
            ],
        )

    def test_generate_forecast_rejects_missing_metric(self):
        forecast = generate_forecast(
            pd.DataFrame(
                {
                    "month": [
                        "2024-01",
                        "2024-02",
                    ],
                    "revenue": [
                        100,
                        120,
                    ],
                }
            ),
            "profit",
        )

        self.assertEqual(
            forecast,
            {
                "error": "Metric 'profit' not found",
            },
        )

    def test_generate_forecast_rejects_non_dataframe_input(self):
        forecast = generate_forecast(
            [
                {
                    "month": "2024-01",
                    "revenue": 100,
                },
            ],
        )

        self.assertEqual(
            forecast,
            {
                "error": "Forecast data must be tabular",
            },
        )

    def test_generate_forecast_coerces_non_string_metric(self):
        forecast = generate_forecast(
            pd.DataFrame(
                {
                    "month": [
                        "2024-01",
                        "2024-02",
                    ],
                    "revenue": [
                        100,
                        120,
                    ],
                }
            ),
            123,
        )

        self.assertEqual(
            forecast,
            {
                "error": "Metric '123' not found",
            },
        )

    def test_generate_forecast_rejects_non_numeric_metric(self):
        forecast = generate_forecast(
            pd.DataFrame(
                {
                    "month": [
                        "2024-01",
                        "2024-02",
                    ],
                    "region": [
                        "East",
                        "West",
                    ],
                    "revenue": [
                        100,
                        120,
                    ],
                }
            ),
            "region",
        )

        self.assertEqual(
            forecast,
            {
                "error": "Metric 'region' is not numeric",
            },
        )

    def test_generate_forecast_trims_metric_name(self):
        forecast = generate_forecast(
            pd.DataFrame(
                {
                    "month": [
                        "2024-01",
                        "2024-02",
                    ],
                    "revenue": [
                        100,
                        120,
                    ],
                    "profit": [
                        10,
                        15,
                    ],
                }
            ),
            " profit ",
        )

        self.assertEqual(
            forecast["value_column"],
            "profit",
        )

    def test_generate_forecast_treats_blank_metric_as_default(self):
        forecast = generate_forecast(
            pd.DataFrame(
                {
                    "month": [
                        "2024-01",
                        "2024-02",
                    ],
                    "revenue": [
                        100,
                        120,
                    ],
                }
            ),
            "   ",
        )

        self.assertEqual(
            forecast["value_column"],
            "revenue",
        )

    def test_generate_forecast_handles_non_string_column_labels(self):
        class DateLikeColumn:
            def __str__(self):
                return "month"

        date_column = DateLikeColumn()
        forecast = generate_forecast(
            pd.DataFrame(
                [
                    [
                        "2024-01",
                        100,
                    ],
                    [
                        "2024-02",
                        120,
                    ],
                ],
                columns=[
                    date_column,
                    "revenue",
                ],
            )
        )

        self.assertEqual(
            forecast["date_column"],
            date_column,
        )
        self.assertEqual(
            forecast["value_column"],
            "revenue",
        )

    def test_generate_forecast_returns_error_without_date_column(self):
        forecast = generate_forecast(
            pd.DataFrame(
                {
                    "region": [
                        "East",
                        "West",
                    ],
                    "revenue": [
                        100,
                        120,
                    ],
                }
            )
        )

        self.assertEqual(
            forecast,
            {
                "error": "No date column found",
            },
        )

    def test_generate_forecast_drops_nonfinite_values_before_fitting(self):
        forecast = generate_forecast(
            pd.DataFrame(
                {
                    "month": [
                        "2024-01",
                        "2024-02",
                        "2024-03",
                        "2024-04",
                    ],
                    "revenue": [
                        100.0,
                        math.inf,
                        math.nan,
                        130.0,
                    ],
                }
            )
        )

        self.assertEqual(
            forecast["forecast"],
            [
                160.0,
                190.0,
                220.0,
            ],
        )

    def test_generate_forecast_includes_projected_period_labels(self):
        forecast = generate_forecast(
            pd.DataFrame(
                {
                    "month": [
                        "2024-01-01",
                        "2024-02-01",
                        "2024-03-01",
                    ],
                    "revenue": [
                        100,
                        120,
                        140,
                    ],
                }
            )
        )

        self.assertEqual(
            forecast["forecast_periods"],
            [
                "2024-04-01",
                "2024-05-01",
                "2024-06-01",
            ],
        )

    def test_generate_forecast_includes_summary(self):
        forecast = generate_forecast(
            pd.DataFrame(
                {
                    "month": [
                        "2024-01-01",
                        "2024-02-01",
                        "2024-03-01",
                    ],
                    "revenue": [
                        100,
                        120,
                        140,
                    ],
                }
            )
        )

        self.assertEqual(
            forecast["summary"],
            {
                "current_value": 140.0,
                "forecast_value": 200.0,
                "absolute_change": 60.0,
                "percent_change": 42.86,
                "direction": "increase",
                "forecast_period": "2024-06-01",
            },
        )

    def test_forecast_summary_handles_zero_baseline(self):
        self.assertEqual(
            build_forecast_summary(
                [
                    0,
                ],
                [
                    10,
                ],
                [
                    "F1",
                ],
            ),
            {
                "current_value": 0.0,
                "forecast_value": 10.0,
                "absolute_change": 10.0,
                "percent_change": 0.0,
                "direction": "stable",
                "forecast_period": "F1",
            },
        )

    def test_forecast_period_labels_fall_back_for_unparseable_periods(self):
        self.assertEqual(
            build_forecast_period_labels(
                [
                    "Launch",
                    "Expansion",
                ],
                3,
            ),
            [
                "F1",
                "F2",
                "F3",
            ],
        )

    def test_generate_recommendation_ignores_nonfinite_values(self):
        recommendation = generate_recommendation(
            [
                math.nan,
                100,
                math.inf,
                120,
            ]
        )

        self.assertEqual(
            recommendation["confidence"],
            MEDIUM_DECISION_CONFIDENCE,
        )

    def test_generate_recommendation_uses_decision_confidence_vocabulary(self):
        expected_confidences = [
            (
                [
                    100,
                ],
                LOW_DECISION_CONFIDENCE,
            ),
            (
                [
                    100,
                    120,
                    140,
                ],
                MEDIUM_DECISION_CONFIDENCE,
            ),
            (
                [
                    100,
                    102,
                    104,
                ],
                MEDIUM_DECISION_CONFIDENCE,
            ),
            (
                [
                    100,
                    85,
                    70,
                ],
                HIGH_DECISION_CONFIDENCE,
            ),
            (
                [
                    100,
                    100,
                    100,
                ],
                LOW_DECISION_CONFIDENCE,
            ),
        ]

        for forecasts, expected_confidence in expected_confidences:
            recommendation = generate_recommendation(
                forecasts,
            )

            self.assertIn(
                recommendation["confidence"],
                VALID_DECISION_CONFIDENCE_SCORES,
            )
            self.assertEqual(
                recommendation["confidence"],
                expected_confidence,
            )

    def test_build_recommendation_rejects_unknown_confidence(self):
        with self.assertRaises(
            ValueError,
        ):
            build_recommendation(
                title="Demo",
                message="Demo",
                reason="Demo",
                confidence="certain",
            )


if __name__ == "__main__":
    unittest.main()
