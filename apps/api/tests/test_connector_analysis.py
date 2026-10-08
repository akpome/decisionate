import unittest
from types import SimpleNamespace
from unittest.mock import patch

import pandas as pd

from app.modules.datasets import router as datasets_router


class ConnectorAnalysisTests(unittest.TestCase):
    def test_analysis_payload_is_only_available_when_complete(self):
        pending = SimpleNamespace(
            status=datasets_router.CONNECTOR_ANALYSIS_RUNNING,
            result_payload='{"ai_analysis": {}}',
        )
        complete = SimpleNamespace(
            status=datasets_router.CONNECTOR_ANALYSIS_COMPLETE,
            result_payload='{"ai_analysis": {"summary": "ready"}}',
        )

        self.assertIsNone(
            datasets_router.parse_dataset_analysis_payload(pending)
        )
        self.assertEqual(
            datasets_router.parse_dataset_analysis_payload(complete),
            {"ai_analysis": {"summary": "ready"}},
        )

    def test_connector_analysis_records_history_window(self):
        dataframe = pd.DataFrame({
            "date": pd.date_range("2025-01-01", periods=6),
            "revenue": [10, 12, 11, 14, 13, 15],
        })
        dataset = SimpleNamespace(
            id=42,
            source_type="sage",
        )
        connection = SimpleNamespace(
            id=7,
            user_id="user-1",
            workspace_id="workspace-1",
            source_type="sage",
        )

        with patch.object(
            datasets_router,
            "load_dataframe_from_dataset",
            return_value=dataframe,
        ), patch.object(
            datasets_router,
            "build_workspace_decision_learning_context",
            return_value=None,
        ), patch.object(
            datasets_router,
            "generate_dataset_ai_analysis",
            return_value={"summary": "ready"},
        ), patch.object(
            datasets_router,
            "generate_insights",
            return_value=[],
        ), patch.object(
            datasets_router,
            "detect_dataset_anomalies",
            return_value={"status": "ready"},
        ):
            result = datasets_router._build_connector_dataset_analysis(
                None,
                dataset,
                connection,
            )

        self.assertEqual(result["dataset_id"], 42)
        self.assertEqual(
            result["history_window"]["initial_sync_days"],
            90,
        )
        self.assertEqual(
            result["history_window"]["backfill_months"],
            21,
        )
        self.assertEqual(
            result["ai_analysis"]["summary"],
            "ready",
        )


if __name__ == "__main__":
    unittest.main()
