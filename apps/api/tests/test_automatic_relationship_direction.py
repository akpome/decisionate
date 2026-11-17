import unittest
from unittest.mock import patch
from types import SimpleNamespace

import numpy as np
import pandas as pd

from app.modules.correlation.direction import resolve_direction
from app.modules.datasets.services.relationships import build_dataset_relationship
from app.modules.reports.relationships import compute_report_pair, direction_lookup
from tests.test_business_reports import definition, fixture
from app.modules.reports.service import build_report


class AutomaticDirectionTests(unittest.TestCase):
    def aligned(self, size=400):
        rng = np.random.default_rng(71)
        leader = rng.normal(size=size)
        follower = np.r_[0, 0, leader[:-2]] + rng.normal(scale=.12, size=size)
        return pd.DataFrame({"period": pd.date_range("2025-01-01", periods=size), "left_value": leader, "right_value": follower})

    def detect(self, points, left=None, right=None, **options):
        return resolve_direction(left or {}, right or {}, points, maximum_lag=options.get("maximum_lag", 5), minimum_observations=30)

    def test_marketing_leads_sales_regardless_of_selection_order(self):
        marketing = {"connector": "meta_ads", "dataset_label": "Account 1"}
        sales = {"connector": "shopify", "dataset_label": "Account 2"}
        for left, right, expected in ((marketing, sales, "a_leads_b"), (sales, marketing, "b_leads_a")):
            result = self.detect(pd.DataFrame(), left, right)
            self.assertEqual((result["direction"], result["source"]), (expected, "business_context"))
        for provider in ("meta_ads_daily.csv", "google_ads_daily.csv"):
            self.assertEqual(self.detect(pd.DataFrame(), {"connector": "csv", "dataset_label": provider}, {"connector": "csv", "dataset_label": "shopify_daily.csv"})["direction"], "a_leads_b")

    def test_unknown_sources_require_stable_predictive_timing(self):
        points = self.aligned()
        self.assertEqual(self.detect(points)["direction"], "a_leads_b")
        reverse = points.rename(columns={"left_value": "right_value", "right_value": "left_value"})
        self.assertEqual(self.detect(reverse)["direction"], "b_leads_a")

    def test_no_signal_trends_constants_short_history_and_zero_lag_do_not_invent_a_leader(self):
        points = self.aligned()
        rng = np.random.default_rng(91)
        unrelated = points.assign(right_value=rng.normal(size=len(points)))
        trend = points.assign(left_value=np.arange(len(points)), right_value=np.arange(len(points)) * 2)
        for frame in (unrelated, trend, points.assign(left_value=1), points.head(30)):
            with self.subTest(size=len(frame)):
                self.assertIsNone(self.detect(frame)["direction"])
        self.assertIsNone(self.detect(points, maximum_lag=0)["direction"])

    def test_gaps_do_not_become_contiguous_observations(self):
        points = self.aligned(100)
        points.loc[::20, "left_value"] = np.nan
        self.assertIsNone(self.detect(points)["direction"])

    def test_explicit_report_direction_bypasses_detection(self):
        points = self.aligned()
        left = {"dataset_id": 1, "metric_key": "spend"}
        right = {"dataset_id": 2, "metric_key": "net_sales"}
        payload = definition(lag={"enabled": True, "minimum": 0, "maximum": 3, "direction": "a_leads_b"},
                             pair_directions=[{"metric_a": left, "metric_b": right, "direction": "b_leads_a"}])
        series = {"1:spend": points[["period", "left_value"]].rename(columns={"left_value": "value"}),
                  "2:net_sales": points[["period", "right_value"]].rename(columns={"right_value": "value"})}
        with patch("app.modules.reports.relationships.resolve_direction") as detector:
            rows = compute_report_pair(left, right, series, payload, direction_lookup(payload))
        detector.assert_not_called()
        self.assertTrue(all(row["lead_metric"] == "2:net_sales" for row in rows))

    def test_disabled_correlation_does_not_run_direction_or_correlation(self):
        payload = definition(include_relationships=False)
        with patch("app.modules.reports.relationships.resolve_direction") as detector, patch("app.modules.reports.relationships.compute_pair") as compute:
            result = build_report(fixture(), payload)
        detector.assert_not_called()
        compute.assert_not_called()
        self.assertFalse(result["findings"])
        self.assertTrue(result["metrics"])

    def test_unknown_direction_does_not_become_zero_delay_guidance_for_impact(self):
        sources = fixture()
        for identity, column in ((1, "spend"), (2, "net_sales")):
            sources[identity][0].file_name = f"Source {identity}.csv"
            sources[identity][1][column] = np.arange(len(sources[identity][1])) * identity
        payload = definition(grain="daily", lag={"enabled": True, "minimum": 0, "maximum": 5, "direction": "a_leads_b"}, pair_directions=[])
        result = build_report(sources, payload)
        finding = result["findings"][0]
        self.assertIsNone(finding["direction_suggestion"]["direction"])
        self.assertIn("lead_direction_not_established", finding["warnings"])
        self.assertEqual(finding["timing_validation"]["status"], "unavailable")

    def test_relationship_monitor_and_reports_share_business_direction(self):
        points = self.aligned(100)
        sources = [(SimpleNamespace(id=1, file_name="Shopify", source_type="shopify"), points[["period", "left_value"]].rename(columns={"period": "date", "left_value": "value"})),
                   (SimpleNamespace(id=2, file_name="Meta Ads", source_type="meta_ads"), points[["period", "right_value"]].rename(columns={"period": "date", "right_value": "value"}))]
        result = build_dataset_relationship(sources, {"left": {"dataset_id": 1, "date_column": "date", "metric_column": "value"},
            "right": {"dataset_id": 2, "date_column": "date", "metric_column": "value"}, "lag_direction": "auto"})
        self.assertEqual(result["minimum_observations"], 30)
        self.assertEqual(result["direction_setting"], "auto")
        self.assertEqual(result["lag_direction"], "b_leads_a")
        self.assertEqual(result["direction_suggestion"]["source"], "business_context")
