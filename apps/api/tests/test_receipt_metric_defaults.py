import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch

import pandas as pd

from app.modules.datasets.services import analytics_adapters, dataset_loader
from app.modules.datasets.services.analytics_adapters import DuckDBAnalyticsAdapter, BigQueryAnalyticsAdapter
from app.modules.datasets.services.analytics_engine import AnalyticsEngineConfig
from app.modules.datasets.services.metric_policy import CONNECTOR_SCHEMA_VERSION, SCHEMA_VERSION_KEY
from app.modules.datasets.services.metric_recommendations import initialize_curated_selection, recommended_columns, resolve_metric_recommendations
from app.modules.datasets.services.metric_selection import (
    build_metric_selection_profile, filter_dataframe_to_selected_metrics,
    get_effective_dataset_metric_columns,
)
from app.modules.datasets.services.metrics import generate_metrics
from app.modules.datasets.services.receipt_metrics import receipt_metric_columns, receipt_projection


def dataset(source="quickbooks", resource="invoices", **config):
    return SimpleNamespace(source_type=source, source_config=json.dumps({"resource": resource, **config}))


class ReceiptMetricDefaultTests(unittest.TestCase):
    def test_transaction_defaults_use_exact_receipt_fields_across_available_sources(self):
        resources = {
            "quickbooks": "invoices", "freshbooks": "invoices", "sage": "sales_invoices",
            "xero": "invoices", "zoho_books": "invoices", "shopify": "orders",
            "woocommerce": "orders", "square": "orders", "lightspeed_x": "sales",
        }
        for source, resource in resources.items():
            for row_count in (1, 20):
                with self.subTest(source=source, row_count=row_count):
                    frame = pd.DataFrame({
                        "quantity": [2] * row_count, "unit_price": [12.5] * row_count,
                        "line_total": [25] * row_count, "exchange_rate": [1.5] * row_count,
                        "raw_metric": [7] * row_count, "links__count": [3] * row_count,
                        "line__quantity": [2] * row_count, "line__unit_price": [12.5] * row_count,
                        "line__internal_cost": [8] * row_count, "tax_calculation_method": [1] * row_count,
                    })
                    profile = build_metric_selection_profile(dataset(source, resource), frame)
                    self.assertEqual(set(profile["recommended_metric_columns"]), {"quantity", "unit_price", "line_total"})

    def test_receipt_header_fields_use_one_representation_per_measure(self):
        frame = pd.DataFrame({"total_amount": [30], "TotalAmt": [30], "Balance": [5], "balance": [5],
                              "TxnTaxDetail__TotalTax": [2], "HomeTotalAmt": [45], "ExchangeRate": [1.5]})
        profile = build_metric_selection_profile(dataset(), frame)
        self.assertEqual(set(profile["recommended_metric_columns"]), {"total_amount", "balance", "TxnTaxDetail__TotalTax"})

    def test_raw_aliases_cannot_shadow_the_canonical_receipt_measure(self):
        frame = pd.DataFrame({"line__SalesItemLineDetail__Qty": [2], "line__Amount": [25],
                              "line__SalesItemLineDetail__UnitPrice": [12.5],
                              "quantity": [2], "line_total": [25], "unit_price": [12.5]})
        self.assertEqual(set(build_metric_selection_profile(dataset(), frame)["recommended_metric_columns"]), {"quantity", "line_total", "unit_price"})

    def test_non_transaction_resources_and_unknown_resources_have_no_defaults(self):
        for source in ("quickbooks", "freshbooks", "sage", "xero", "zoho_books", "lightspeed_x"):
            for resource in ("customers", "items", "accounts", "future_resource"):
                with self.subTest(source=source, resource=resource):
                    item = dataset(source, resource)
                    frame = pd.DataFrame({"balance": [10], "quantity_on_hand": [4], "total_amount": [50]})
                    self.assertEqual(build_metric_selection_profile(item, frame)["recommended_metric_columns"], [])
                    self.assertEqual(generate_metrics(filter_dataframe_to_selected_metrics(item, frame)), [])

    def test_no_defaults_are_guessed_for_planned_restaurant_schemas(self):
        for source in ("lightspeed_k", "lightspeed_o"):
            self.assertEqual(receipt_metric_columns(source, {"resource": "sales"}, ["quantity", "total"]), [])

    def test_non_financial_sources_keep_their_previous_recommendations(self):
        frame = pd.DataFrame({"raw_metric": [7]})
        for source in ("csv", "postgresql", "google_analytics", "meta_ads", "hubspot"):
            with self.subTest(source=source):
                self.assertEqual(build_metric_selection_profile(dataset(source, "report"), frame)["recommended_metric_columns"], ["raw_metric"])

    def test_saved_choices_and_explicit_empty_selection_are_not_rewritten(self):
        frame = pd.DataFrame({"quantity": [2], "exchange_rate": [1.5], "record_id": [9]})
        for selected in ([], ["exchange_rate"], ["record_id"]):
            item = dataset(selected_metric_columns=selected)
            before = item.source_config
            self.assertEqual(get_effective_dataset_metric_columns(item, frame), selected)
            result = filter_dataframe_to_selected_metrics(item, frame)
            self.assertEqual(item.source_config, before)
            self.assertEqual([metric["column"] for metric in generate_metrics(result, selected)], selected)

    def test_unselected_numeric_helpers_are_removed_from_analytics_not_source(self):
        frame = pd.DataFrame({"quantity": [2, 3], "exchange_rate": [1.5, 1.5], "all_null": [float("nan")] * 2,
                              "links__count": [3, 4], "row_sequence": [1, 2], "date": ["2026-10-01", "2026-10-02"],
                              "notes": ["a", "b"], "hidden_numeric_text": ["8", "9"], "paid": [True, False]})
        before = frame.copy(deep=True)
        result = filter_dataframe_to_selected_metrics(dataset(), frame)
        self.assertEqual(set(result), {"quantity", "row_sequence", "date", "notes", "paid"})
        self.assertEqual(result["paid"].tolist(), ["True", "False"])
        self.assertEqual([metric["column"] for metric in generate_metrics(result)], ["quantity"])
        pd.testing.assert_frame_equal(before, frame)

    def test_objective_changes_cannot_reintroduce_non_receipt_metrics(self):
        frame = pd.DataFrame({"quantity": [2], "line_total": [25], "unit_price": [12.5], "profit": [10], "exchange_rate": [1.5]})
        for objective in ("general_business", "increase_revenue", "profitability", "cash_flow"):
            profile = build_metric_selection_profile(dataset(), frame, objective)
            self.assertLessEqual(set(profile["recommended_metric_columns"]), {"quantity", "line_total", "unit_price"})

    def test_curated_entity_counts_stay_available_but_are_not_automatic_defaults(self):
        item = dataset("xero", "contacts", **{SCHEMA_VERSION_KEY: CONNECTOR_SCHEMA_VERSION})
        result = resolve_metric_recommendations(item, pd.DataFrame({"record_id": ["1", "2"]}))
        self.assertEqual(recommended_columns(result), [])
        self.assertEqual(result["derived"][0]["columnKey"], "__metric_record_count")
        self.assertFalse(result["derived"][0]["defaultSelected"])

    def test_curated_payment_keeps_its_reviewed_amount_path_not_a_duplicate_alias(self):
        item = dataset("quickbooks", "payments", **{SCHEMA_VERSION_KEY: CONNECTOR_SCHEMA_VERSION})
        frame = pd.DataFrame({"TotalAmt": [25], "total_amount": [25], "currency": ["CAD"]})
        self.assertEqual(recommended_columns(resolve_metric_recommendations(item, frame)), ["TotalAmt"])
        with patch.dict(os.environ, {"CURATED_METRIC_DEFAULTS_BACKEND": "true", "CURATED_METRIC_DEFAULTS_NEW_DATASETS": "true", "CURATED_METRIC_DEFAULTS_ROLLOUT": "all"}):
            initialize_curated_selection(item, frame)
            profile = build_metric_selection_profile(item, frame)
            self.assertEqual(profile["recommended_metric_columns"], ["TotalAmt"])
            self.assertEqual(get_effective_dataset_metric_columns(item, frame, profile), ["TotalAmt"])

    def test_payment_amount_not_related_invoice_or_bank_amount_is_selected(self):
        columns = ["Amount", "Total", "BankAmount", "CurrencyRate", "Invoice__AmountDue"]
        self.assertEqual(receipt_metric_columns("xero", {"resource": "payments"}, columns), ["Amount"])

    def test_projection_excludes_numeric_noise_and_retains_grouping_and_currency(self):
        schema = {"quantity": "BIGINT", "unit_price": "DECIMAL(18,3)", "line_total": "DOUBLE",
                  "currency": "VARCHAR", "status": "VARCHAR", "date": "DATE", "customer_id": "BIGINT",
                  "exchange_rate": "DECIMAL(18,6)", "internal_count": "INT64", "notes": "VARCHAR"}
        for config, expected in (({}, {"quantity", "unit_price", "line_total"}),
                                 ({"selected_metric_columns": ["exchange_rate"]}, {"exchange_rate"}),
                                 ({"selected_metric_columns": []}, set())):
            with self.subTest(config=config):
                columns = receipt_projection("quickbooks", {"resource": "invoices", **config}, schema)
                self.assertEqual(set(columns), expected | {"currency", "status", "date", "customer_id", "notes"})

    def test_legacy_repair_bypasses_projection_instead_of_losing_items(self):
        for column in ("Line__0__Amount", "LineItems__1__Quantity", "LineItems", "invoice_lines__quantity", "payments__0__amount"):
            schema = {"total_amount": "DOUBLE", column: "VARCHAR"}
            with self.subTest(column=column):
                self.assertIsNone(receipt_projection("quickbooks" if column.startswith("Line__") else "xero" if column.startswith("LineItems") else "sage", {}, schema))

    def test_projection_keeps_selected_summary_state_and_discards_unselected_state(self):
        schema = {"quantity": "BIGINT", "quantity__sum": "DOUBLE", "quantity__count": "BIGINT",
                  "exchange_rate__sum": "DOUBLE", "__decisionate_summary__": "BOOLEAN"}
        self.assertEqual(receipt_projection("quickbooks", {}, schema), ["quantity", "quantity__sum", "quantity__count", "__decisionate_summary__"])

    def test_projection_does_not_mistake_numeric_collections_for_scalar_metrics(self):
        schema = {"quantity": "BIGINT", "tags": "INTEGER[]", "discount_parts": "DECIMAL(18,2)[]", "duration": "INTERVAL"}
        self.assertEqual(receipt_projection("quickbooks", {}, schema), list(schema))

    def test_loader_uses_projection_only_for_selected_financial_analytics(self):
        frame = pd.DataFrame({"quantity": [2]})
        for source, apply in (("quickbooks", True), ("quickbooks", False), ("csv", True)):
            with self.subTest(source=source, apply=apply), patch.object(dataset_loader, "load_dataset_dataframe", return_value=frame) as load:
                dataset_loader.load_dataframe_from_dataset(dataset(source), apply)
                self.assertEqual("column_selector" in load.call_args.kwargs, source == "quickbooks" and apply)

    def test_duckdb_projection_is_executed_before_fetching_and_quotes_columns(self):
        config = AnalyticsEngineConfig("duckdb", ":memory:", "/tmp/receipt-tests", "parquet", None, None, None)
        with TemporaryDirectory() as directory:
            path = Path(directory) / "rows.parquet"
            pd.DataFrame({"quantity": [2], 'odd"name': [3], "exchange_rate": [1.5]}).to_parquet(path)
            item = dataset(selected_metric_columns=['odd"name'])
            item.file_path, item.file_name = str(path), path.name
            adapter = DuckDBAnalyticsAdapter(config)
            result = adapter.load_dataframe(item, column_selector=lambda schema: receipt_projection(item.source_type, json.loads(item.source_config), schema))
            self.assertEqual(list(result), ['odd"name'])
            self.assertEqual(result.iloc[0, 0], 3)
            empty = adapter.load_dataframe(item, column_selector=lambda schema: [])
            self.assertEqual(empty.shape, (1, 0))

    def test_wide_parquet_numeric_payload_is_not_materialized_for_default_analysis(self):
        config = AnalyticsEngineConfig("duckdb", ":memory:", "/tmp/receipt-tests", "parquet", None, None, None)
        frame = pd.DataFrame({"quantity": range(1000), **{f"internal_metric_{index}": range(1000) for index in range(40)}})
        with TemporaryDirectory() as directory:
            path = Path(directory) / "wide.parquet"
            frame.to_parquet(path)
            item = dataset()
            item.file_path, item.file_name = str(path), path.name
            adapter = DuckDBAnalyticsAdapter(config)
            result = adapter.load_dataframe(item, column_selector=lambda schema: receipt_projection(item.source_type, json.loads(item.source_config), schema))
            self.assertEqual(result.shape, (1000, 1))
            self.assertLess(result.memory_usage(deep=True).sum(), frame.memory_usage(deep=True).sum() / 20)

    def test_legacy_parquet_items_are_repaired_before_receipt_selection(self):
        config = AnalyticsEngineConfig("duckdb", ":memory:", "/tmp/receipt-tests", "parquet", None, None, None)
        frame = pd.DataFrame({"Id": ["invoice-1"], "TotalAmt": [30], "total_amount": [30],
                              "Line__0__Amount": [10], "Line__1__Amount": [20],
                              "Line__0__SalesItemLineDetail__Qty": [1], "Line__1__SalesItemLineDetail__Qty": [2]})
        with TemporaryDirectory() as directory:
            path = Path(directory) / "legacy.parquet"
            frame.to_parquet(path)
            item = dataset()
            item.file_path, item.file_name = str(path), path.name
            with patch.object(analytics_adapters, "get_analytics_adapter", return_value=DuckDBAnalyticsAdapter(config)):
                result = dataset_loader.load_dataframe_from_dataset(item)
            self.assertEqual(result["quantity"].tolist(), [1, 2])
            self.assertEqual(result["line_total"].tolist(), [10, 20])
            self.assertEqual(result["total_amount"].sum(), 30)
            self.assertFalse(any("__0__" in column or "__1__" in column for column in result))

    def test_bigquery_projects_before_to_dataframe(self):
        config = AnalyticsEngineConfig("bigquery", ":memory:", "/tmp/receipt-tests", "parquet", "project", "analytics", "US")
        client = MagicMock()
        client.get_table.return_value.schema = [SimpleNamespace(name="quantity", field_type="INTEGER"),
                                                SimpleNamespace(name="noise", field_type="NUMERIC")]
        client.query.return_value.result.return_value.to_dataframe.return_value = pd.DataFrame({"quantity": [2]})
        module = SimpleNamespace(Client=MagicMock(return_value=client))
        with patch("app.modules.datasets.services.analytics_adapters.build_bigquery_table_id", return_value="project.analytics.rows"), patch("app.modules.datasets.services.analytics_adapters.importlib.import_module", return_value=module):
            result = BigQueryAnalyticsAdapter(config).load_dataframe(dataset(), column_selector=lambda schema: receipt_projection("quickbooks", {}, schema))
        client.query.assert_called_once_with("SELECT `quantity` FROM `project.analytics.rows`", location="US")
        self.assertEqual(list(result), ["quantity"])


if __name__ == "__main__":
    unittest.main()
