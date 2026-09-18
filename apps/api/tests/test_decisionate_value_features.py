import unittest
from datetime import datetime
from types import SimpleNamespace

import pandas as pd

from app.modules.ai.recommendation_ranking import prioritize_recommendations
from app.modules.datasets.services.deduplication import (
    deduplicate_insights,
    deduplicate_text_items,
)
from app.modules.datasets.services.entity_resolution import build_entity_resolution
from app.modules.decisions.outcome_measurement import measure_decision_metric


class DecisionateValueFeatureTests(unittest.TestCase):
    def test_customer_rows_are_matched_across_sources_by_normalized_email(self):
        first = SimpleNamespace(
            id=1,
            source_type="csv",
            file_name="crm.csv",
        )
        second = SimpleNamespace(
            id=2,
            source_type="stripe",
            file_name="billing.csv",
        )
        result = build_entity_resolution(
            [
                (first, pd.DataFrame({
                    "email": ["Ada@Example.com", "unmatched@example.com"],
                    "name": ["Ada Lovelace", "Unmatched"],
                })),
                (second, pd.DataFrame({
                    "customer_email": [" ada@example.com "],
                    "customer_name": ["Ada Lovelace"],
                })),
            ],
            "customer",
        )

        self.assertEqual(result["matched_group_count"], 2)
        self.assertEqual(result["matched_row_count"], 2)
        self.assertEqual(result["unmatched_row_count"], 1)
        matched = next(
            entity
            for entity in result["entities"]
            if entity["source_count"] == 2
        )
        self.assertEqual(matched["match_count"], 2)
        self.assertEqual(matched["confidence"], 1.0)

    def test_product_rows_can_be_matched_by_sku(self):
        result = build_entity_resolution(
            [
                (
                    SimpleNamespace(id=1, source_type="csv", file_name="a.csv"),
                    pd.DataFrame({"sku": ["SKU-1"], "product_name": ["Widget"]}),
                ),
                (
                    SimpleNamespace(id=2, source_type="csv", file_name="b.csv"),
                    pd.DataFrame({"product_code": [" sku-1 "], "name": ["Widget"]}),
                ),
            ],
            "product",
        )

        self.assertEqual(result["matched_group_count"], 1)
        self.assertEqual(result["entities"][0]["source_count"], 2)

    def test_recommendations_are_prioritized_and_explained(self):
        ranked = prioritize_recommendations(
            [
                "Monitor the weekly target.",
                "Investigate the declining revenue risk immediately.",
                "Keep the account context documented.",
            ],
            "high",
        )

        self.assertEqual(ranked[0]["priority"], "high")
        self.assertIn("risk", ranked[0]["reason"])
        self.assertEqual(ranked[-1]["priority"], "low")

    def test_overlapping_insights_are_collapsed(self):
        insights = deduplicate_insights([
            {
                "type": "risk",
                "column": "revenue",
                "title": "Revenue Risk",
                "description": "Review the revenue decline and investigate the cause.",
            },
            {
                "type": "risk",
                "column": "revenue",
                "title": "Revenue Risk Duplicate",
                "description": "Review the revenue decline and investigate the cause.",
            },
        ])

        self.assertEqual(len(insights), 1)

    def test_overlapping_alert_recommendations_are_collapsed(self):
        recommendations = deduplicate_text_items([
            "Review revenue from CRM: 100.00.",
            "Review revenue from CRM: 100.00.",
            "Add at least one recipient before sending.",
        ])

        self.assertEqual(
            recommendations,
            [
                "Review revenue from CRM: 100.00.",
                "Add at least one recipient before sending.",
            ],
        )

    def test_outcome_measurement_compares_three_period_baselines(self):
        decision = SimpleNamespace(
            metric_column="revenue",
            created_at=datetime(2025, 1, 4),
            review_date=None,
        )
        result = measure_decision_metric(
            decision,
            pd.DataFrame({
                "date": pd.date_range("2025-01-01", periods=7, freq="D"),
                "revenue": [100, 110, 90, 120, 130, 140, 150],
            }),
        )

        self.assertEqual(result["baseline_value"], 100.0)
        self.assertEqual(result["measured_value"], 140.0)
        self.assertEqual(result["delta_percent"], 40.0)


if __name__ == "__main__":
    unittest.main()
