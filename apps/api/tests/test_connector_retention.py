import unittest
from datetime import date

import pandas as pd

from app.modules.datasets.services.retention import (
    connector_retention_cutoff_month,
    filter_connector_dataframe_by_retention,
    filter_connector_summary_by_retention,
)


class ConnectorRetentionTests(unittest.TestCase):
    def test_five_year_window_removes_months_older_than_cutoff(self):
        as_of = date(2026, 8, 14)
        self.assertEqual(
            connector_retention_cutoff_month(as_of),
            "2021-09",
        )

        dataframe = pd.DataFrame({
            "source_date": ["2021-08-31", "2021-09-01", "2026-08-14"],
            "revenue": [1, 2, 3],
        })
        retained = filter_connector_dataframe_by_retention(
            dataframe,
            "source_date",
            as_of,
        )
        self.assertEqual(retained["revenue"].tolist(), [2, 3])

    def test_summary_months_use_the_same_cutoff(self):
        dataframe = pd.DataFrame({
            "__decisionate_summary_month__": ["2021-08", "2021-09"],
            "revenue": [1, 2],
        })
        retained = filter_connector_summary_by_retention(
            dataframe,
            "__decisionate_summary_month__",
            date(2026, 8, 14),
        )
        self.assertEqual(retained["revenue"].tolist(), [2])


if __name__ == "__main__":
    unittest.main()
