import unittest
from types import SimpleNamespace
from unittest.mock import patch

import pandas as pd

from app.modules.datasets.services.joins import (
    build_join_dataset_metadata,
)
from app.modules.datasets.services.numeric import (
    coerce_numeric_series,
    get_numeric_columns,
)


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
