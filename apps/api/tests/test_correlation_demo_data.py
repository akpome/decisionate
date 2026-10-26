import csv
from datetime import date, timedelta
from decimal import Decimal
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from zipfile import ZipFile

import pandas as pd

from demo_data.connectors.generate_correlation_demo_data import (
    DEFAULT_SEED, META_METRICS, SCENARIO, SHOPIFY_METRICS, build_datasets,
    measured_correlations, measured_economics, write_demo,
)
from app.modules.correlation.catalog import metric_catalog, prepare_series
from app.modules.correlation.engine import compute_pair
from app.modules.correlation.schemas import AnalysisCreate


class CorrelationDemoDataTests(unittest.TestCase):
    def setUp(self):
        self.meta, self.shopify = build_datasets()

    def read_csv_frames(self):
        with TemporaryDirectory() as directory:
            manifest, _ = write_demo(directory)
            return [pd.read_csv(Path(directory) / entry["file"]) for entry in manifest["datasets"]]

    def test_both_datasets_cover_the_same_full_calendar_year_without_gaps(self):
        expected = [(date(2025, 1, 1) + timedelta(days=i)).isoformat() for i in range(365)]
        for rows in (self.meta, self.shopify):
            self.assertEqual([row["date"] for row in rows], expected)
            self.assertTrue(all(row["data_origin"] == "synthetic" and row["currency"] == "CAD" for row in rows))
            self.assertTrue(all(value is not None and value != "" for row in rows for value in row.values()))

    def test_leap_year_and_random_seed_are_handled_reproducibly(self):
        self.assertEqual(build_datasets(), (self.meta, self.shopify))
        self.assertNotEqual(build_datasets(seed=DEFAULT_SEED + 1), (self.meta, self.shopify))
        meta, shopify = build_datasets(year=2024)
        self.assertEqual(len(meta), 366)
        self.assertEqual(len(shopify), 366)
        self.assertIn("2024-02-29", [row["date"] for row in meta])

    def test_counts_and_daily_monetary_arithmetic_are_consistent(self):
        for meta, store in zip(self.meta, self.shopify):
            self.assertTrue(0 <= meta["leads"] <= meta["clicks"] <= meta["impressions"])
            self.assertLessEqual(meta["attributed_orders"], store["orders"])
            self.assertEqual(store["orders"], store["non_ad_orders"] + meta["attributed_orders"])
            self.assertGreaterEqual(store["quantity"], store["orders"])
            self.assertLessEqual(store["quantity"], 3 * store["orders"])
            self.assertGreaterEqual(Decimal(store["gross_sales"]), Decimal(str(min(SCENARIO["item_prices_cad"]))) * store["quantity"])
            self.assertLessEqual(Decimal(store["gross_sales"]), Decimal(str(max(SCENARIO["item_prices_cad"]))) * store["quantity"])
            self.assertGreaterEqual(Decimal(meta["attributed_revenue"]), 0)
            self.assertLessEqual(Decimal(meta["attributed_revenue"]), Decimal(store["gross_sales"]) - Decimal(store["discounts"]))
            self.assertEqual(meta["attributed_orders"] == 0, Decimal(meta["attributed_revenue"]) == 0)
            for key in ("gross_sales", "discounts", "refund_amount", "net_sales"):
                value = Decimal(store[key])
                self.assertGreaterEqual(value, 0)
                self.assertEqual(value.as_tuple().exponent, -2)
            self.assertEqual(Decimal(store["net_sales"]), Decimal(store["gross_sales"]) - Decimal(store["discounts"]) - Decimal(store["refund_amount"]))

    def test_summary_uses_period_totals_instead_of_summed_or_averaged_daily_ratios(self):
        summary = measured_economics(self.meta, self.shopify)
        totals, daily, ratios = (summary[key] for key in ("period_totals", "daily_averages", "weighted_unit_economics"))
        spend = sum(Decimal(row["spend"]) for row in self.meta)
        revenue = sum(Decimal(row["attributed_revenue"]) for row in self.meta)
        gross_less_discounts = sum(Decimal(row["gross_sales"]) - Decimal(row["discounts"]) for row in self.shopify)
        net = sum(Decimal(row["net_sales"]) for row in self.shopify)
        orders = sum(row["orders"] for row in self.shopify)
        attributed_orders = sum(row["attributed_orders"] for row in self.meta)
        self.assertEqual(Decimal(totals["ad_spend_cad"]), spend)
        self.assertEqual(Decimal(totals["attributed_revenue_cad"]), revenue)
        self.assertEqual(Decimal(totals["net_sales_cad"]), net)
        self.assertEqual(totals["orders"], orders)
        self.assertEqual(totals["attributed_orders"], attributed_orders)
        self.assertEqual(totals["non_ad_orders"], sum(row["non_ad_orders"] for row in self.shopify))
        self.assertEqual(summary["days_order_count_exceeds_ad_spend_numeric_value"], 365)
        self.assertEqual(daily["ad_spend_cad"], f"{spend / len(self.meta):.2f}")
        self.assertEqual(daily["net_sales_cad"], f"{net / len(self.shopify):.2f}")
        self.assertEqual(ratios["average_order_value_cad"], f"{gross_less_discounts / orders:.2f}")
        self.assertEqual(ratios["media_cost_per_attributed_order_cad"], f"{spend / attributed_orders:.2f}")
        self.assertEqual(ratios["media_only_attributed_roas"], round(float(revenue / spend), 4))
        self.assertEqual(ratios["blended_net_sales_to_ad_spend_ratio"], round(float(net / spend), 4))
        self.assertGreater(ratios["blended_net_sales_to_ad_spend_ratio"], ratios["media_only_attributed_roas"])
        self.assertEqual(ratios["attributed_order_share_percent"], round(100 * attributed_orders / orders, 2))

    def test_every_day_has_more_orders_than_the_numerical_ad_spend_without_inflating_paid_orders(self):
        for meta, store in zip(self.meta, self.shopify):
            self.assertLessEqual(Decimal(meta["spend"]), SCENARIO["maximum_daily_ad_budget_cad"])
            self.assertGreaterEqual(store["non_ad_orders"], SCENARIO["minimum_daily_non_ad_orders"])
            self.assertGreater(Decimal(store["orders"]), Decimal(meta["spend"]))
        self.assertTrue(any(row["attributed_orders"] == 0 for row in self.meta))
        self.assertGreater(sum(row["non_ad_orders"] for row in self.shopify),
                           20 * sum(row["attributed_orders"] for row in self.meta))

    def test_default_scenario_has_documented_economics_and_variable_daily_results(self):
        ratios = measured_economics(self.meta, self.shopify)["weighted_unit_economics"]
        # These bounds protect the fictional scenario, not industry benchmarks.
        self.assertTrue(Decimal("70") < Decimal(ratios["average_order_value_cad"]) < Decimal("110"))
        self.assertTrue(Decimal("20") < Decimal(ratios["media_cost_per_attributed_order_cad"]) < Decimal("40"))
        self.assertTrue(2 < ratios["media_only_attributed_roas"] < 4)
        self.assertTrue(any(Decimal(row["attributed_revenue"]) < Decimal(row["spend"]) for row in self.meta))
        self.assertTrue(any(Decimal(row["attributed_revenue"]) > Decimal(row["spend"]) for row in self.meta))
        self.assertTrue(any(Decimal(row["refund_amount"]) == 0 for row in self.shopify))
        self.assertTrue(any(Decimal(row["refund_amount"]) > 0 for row in self.shopify))

    def test_refunds_are_processed_after_purchase_instead_of_deducted_on_purchase_day(self):
        with patch("demo_data.connectors.generate_correlation_demo_data.WARMUP_DAYS", 0):
            with patch.dict(SCENARIO, {"order_refund_probability": 1, "refund_delay_days": [7, 7]}):
                _, stores = build_datasets()
        self.assertTrue(all(Decimal(row["refund_amount"]) == 0 for row in stores[:7]))
        self.assertTrue(all(Decimal(row["refund_amount"]) > 0 for row in stores[7:]))

    def test_archive_contains_both_uploadable_csvs_and_matches_reported_measurements(self):
        with TemporaryDirectory() as directory:
            manifest, archive_path = write_demo(directory)
            with ZipFile(archive_path) as archive:
                self.assertIsNone(archive.testzip())
                self.assertEqual(set(archive.namelist()), {"meta_ads_daily_2025.csv", "shopify_daily_2025.csv", "manifest.json", "README.txt"})
                self.assertEqual(json.loads(archive.read("manifest.json")), manifest)
                for entry in manifest["datasets"]:
                    path = Path(directory) / entry["file"]
                    with path.open(newline="", encoding="utf-8") as handle:
                        rows = list(csv.DictReader(handle))
                    self.assertEqual(len(rows), entry["rows"])
                    self.assertTrue(set(entry["recommended_metrics"]) <= set(rows[0]))
                    self.assertEqual(archive.read(entry["file"]), path.read_bytes())
            self.assertEqual(manifest["measured_pearson_correlations"], measured_correlations(self.meta, self.shopify))
            original = archive_path.read_bytes()
            _, repeated = write_demo(directory)
            self.assertEqual(repeated.read_bytes(), original)

    def test_recommended_metrics_are_available_in_the_actual_csv_correlation_catalog(self):
        meta, shopify = self.read_csv_frames()
        with patch.dict("os.environ", {"CURATED_METRIC_DEFAULTS_BACKEND": "false", "CURATED_METRIC_DEFAULTS_DIAGNOSTICS": "false"}):
            for identity, frame, metrics in ((1, meta, META_METRICS), (2, shopify, SHOPIFY_METRICS)):
                item = SimpleNamespace(id=identity, user_id="demo", source_type="csv", file_name=f"Synthetic demo {identity}",
                                       source_config=json.dumps({"selected_metric_columns": list(metrics)}))
                catalog = metric_catalog(item, frame)
                self.assertEqual(catalog["date_columns"], ["date"])
                self.assertEqual({entry["metric_key"] for entry in catalog["metrics"]}, set(metrics))
                self.assertTrue(all(not entry["constant"] and entry["missing_fraction"] == 0 for entry in catalog["metrics"]))

    def test_actual_correlation_engine_matches_measured_order_count_comparisons(self):
        references = [{"dataset_id": 1, "metric_key": "spend", "date_column": "date", "aggregation": "sum"},
                      {"dataset_id": 2, "metric_key": "orders", "date_column": "date", "aggregation": "sum"}]
        definition = AnalysisCreate(name="Synthetic Meta Ads and Shopify", metrics=references, method="pearson", grain="daily",
                                    date_range={"start": "2025-01-01", "end": "2025-12-31"},
                                    lag={"enabled": True, "minimum": 0, "maximum": 7, "direction": "a_leads_b"}).model_dump(mode="json")
        meta, shopify = self.read_csv_frames()
        frames = {1: (SimpleNamespace(id=1, file_name="Meta Ads synthetic"), meta),
                  2: (SimpleNamespace(id=2, file_name="Shopify synthetic"), shopify)}
        series, _ = prepare_series(frames, references, definition)
        results = compute_pair(*references, series, definition)
        selected = next(result for result in results if result["selected"])
        self.assertEqual(selected["observations"], 365 - selected["lag"])
        self.assertGreater(selected["coefficient"], 0)
        self.assertLess(selected["coefficient"], 0.99)
        for measurement in measured_correlations(self.meta, self.shopify):
            if measurement["meta_ads_metric"] == "spend" and measurement["shopify_metric"] == "orders":
                result = next(row for row in results if row["lag"] == measurement["meta_ads_leads_by_days"])
                self.assertAlmostEqual(result["coefficient"], measurement["pearson_coefficient"], places=12)


if __name__ == "__main__":
    unittest.main()
