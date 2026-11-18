import unittest
from types import SimpleNamespace
from unittest.mock import patch

import pandas as pd

from app.modules.datasets.services.joins import (
    build_join_dataset_metadata,
    build_joined_dataset,
)
from app.modules.datasets.schemas import DatasetJoinRequest
from app.modules.datasets.services.join_cache import build_join_definition
from pydantic import ValidationError
from app.modules.datasets.services.numeric import (
    coerce_numeric_series,
    get_numeric_columns,
)


class DatasetJoinDateRangeTests(unittest.TestCase):
    def setUp(self):
        dates = ["2026-05-17T23:59:00Z", "2026-05-18T00:00:00Z", "2026-05-18T23:59:00Z", "2026-05-19T00:00:00Z", "2026-05-20T00:00:00Z"]
        self.frames = []
        self.selections = []
        for identity in [1, 2]:
            frame = pd.DataFrame({"date": dates, "revenue": [999, 10, 20, 30, 999]})
            dataset = SimpleNamespace(id=identity, file_name=f"sales-{identity}.csv", row_count=len(frame))
            self.frames.append((dataset, frame, build_join_dataset_metadata(dataset, frame)))
            self.selections.append({"dataset_id": identity, "date_column": "date", "metric_columns": ["revenue"]})

    def test_explicit_dates_exclude_both_outside_boundaries_before_joining(self):
        result = build_joined_dataset(self.frames, self.selections, "2026-05-18", end_date="2026-05-19")
        self.assertEqual(result["matched_period_count"], 1)
        self.assertEqual([row["period"] for row in result["rows"]], ["2026-05-01"])
        for metric in result["datasets"]:
            self.assertEqual([row[metric["label"]] for row in result["rows"]], [60])
        self.assertEqual(result["end_date"], "2026-05-19")

    def test_one_day_and_end_only_ranges_include_the_entire_end_day(self):
        for start, expected in [("2026-05-18", 30), (None, 1029)]:
            result = build_joined_dataset(self.frames, self.selections, start, end_date="2026-05-18")
            self.assertEqual(result["matched_period_count"], 1)
            for metric in result["datasets"]:
                self.assertEqual(result["rows"][0][metric["label"]], expected)

    def test_cached_definition_preserves_the_end_date_for_recalculation(self):
        definition = build_join_definition(self.selections, "2026-05-18", "all", "monthly", "sum", end_date="2026-05-19")
        self.assertEqual(definition["end_date"], "2026-05-19")
        self.assertNotIn("end_date", build_join_definition(self.selections, None, "all", "monthly", "sum"))

    def test_request_rejects_invalid_or_reversed_dates(self):
        for end in ["2026-05-17", "not-a-date", "2026-02-30"]:
            with self.assertRaises(ValidationError):
                DatasetJoinRequest(selections=self.selections, start_date="2026-05-18", end_date=end)
        payload = DatasetJoinRequest(selections=self.selections, start_date="2026-05-18", end_date="2026-05-18")
        self.assertEqual(str(payload.end_date), "2026-05-18")


class DatasetJoinMetadataTests(unittest.TestCase):
    def test_metadata_skips_date_inference_assertion(self):
        dataframe = pd.DataFrame({
            "event_date": ["2026-01-01", "2026-01-02"],
            "revenue": [100, 125],
        })
        dataset = SimpleNamespace(
            id=1708,
            file_name="dataset.csv",
            row_count=2,
        )

        with patch(
            "app.modules.datasets.services.joins._parse_dates",
            side_effect=AssertionError(
                "Something has gone wrong, please report a bug"
            ),
        ):
            metadata = build_join_dataset_metadata(
                dataset,
                dataframe,
            )

        self.assertEqual(metadata["date_columns"], [])
        self.assertEqual(metadata["numeric_columns"], ["revenue"])
        self.assertEqual(
            metadata["date_range"],
            {"start": None, "end": None},
        )

    def test_numeric_inference_skips_only_failing_column(self):
        dataframe = pd.DataFrame({
            "bad_metric": [1, 2],
            "revenue": [100, 125],
        })
        original_coerce = coerce_numeric_series

        def coerce_with_one_failure(series):
            if series.name == "bad_metric":
                raise AssertionError(
                    "Something has gone wrong, please report a bug"
                )
            return original_coerce(series)

        with patch(
            "app.modules.datasets.services.numeric.coerce_numeric_series",
            side_effect=coerce_with_one_failure,
        ):
            numeric_columns = get_numeric_columns(dataframe)

        self.assertEqual(
            [column for column, _series in numeric_columns],
            ["revenue"],
        )


if __name__ == "__main__":
    unittest.main()
