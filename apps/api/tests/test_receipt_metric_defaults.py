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
from app.modules.datasets.services.receipt_metrics import receipt_metric_columns, receipt_projection, uses_receipt_defaults


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
                    expected = {"quantity", "unit_price"} if source == "sage" else {"quantity", "unit_price", "line_total"}
                    self.assertEqual(set(profile["recommended_metric_columns"]), expected)

    def test_invoice_only_balances_are_not_defaults_for_other_documents(self):
        frame = pd.DataFrame({"quantity": [2], "unit_price": [10], "line_total": [20],
                              "balance": [3], "Balance": [3], "AmountPaid": [10], "AmountDue": [3]})
        for source, resources in (("quickbooks", ("sales_receipts", "purchases", "estimates")),
                                  ("xero", ("credit_notes", "purchase_orders", "quotes"))):
            for resource in resources:
                with self.subTest(source=source, resource=resource):
                    profile = build_metric_selection_profile(dataset(source, resource), frame)
                    self.assertEqual(set(profile["recommended_metric_columns"]), {"quantity", "unit_price", "line_total"})

    def test_freshbooks_documented_unit_cost_is_a_sale_price_not_an_internal_cost(self):
        frame = pd.DataFrame({"quantity": [2, 3], "unit_price": ['{"amount":"10","code":"CAD"}'] * 2,
                              "line__unit_cost__amount": [10, 12], "line_total": [20, 36],
                              "line__taxAmount1": [13, 13], "line__taxAmount2": [5, 5],
                              "amount": [22.6, 40.68], "outstanding": [22.6, 10], "markup_percent": [25, 30]})
        profile = build_metric_selection_profile(dataset("freshbooks"), frame, "increase_revenue")
        self.assertIn("line__unit_cost__amount", profile["recommended_metric_columns"])
        self.assertNotIn("line__unit_cost__amount", build_metric_selection_profile(dataset("freshbooks"), frame, "reduce_expenses")["recommended_metric_columns"])
        self.assertLessEqual(set(profile["recommended_metric_columns"]), {"quantity", "line__unit_cost__amount", "line_total", "amount", "outstanding"})
        projection = receipt_projection("freshbooks", {"resource": "invoices"}, {column: "VARCHAR" if column == "unit_price" else "DOUBLE" for column in frame})
        self.assertIn("line__unit_cost__amount", projection)
        self.assertNotIn("line__taxAmount1", projection)

    def test_freshbooks_expense_tax_money_is_not_assumed_on_invoice_resources(self):
        frame = pd.DataFrame({"amount": [113], "taxAmount1__amount": [13], "taxAmount2__amount": [0],
                              "taxPercent1": [13], "taxPercent2": [0], "quantity": [2], "unit_price": [50],
                              "line_total": [100], "outstanding": [20], "markup_percent": [20]})
        expense = build_metric_selection_profile(dataset("freshbooks", "expenses"), frame)
        self.assertEqual(set(expense["recommended_metric_columns"]), {"amount", "taxAmount1__amount", "taxAmount2__amount"})
        invoice = build_metric_selection_profile(dataset("freshbooks", "invoices"), frame)
        self.assertFalse({"taxAmount1__amount", "taxAmount2__amount", "taxPercent1", "taxPercent2"} & set(invoice["recommended_metric_columns"]))

    def test_zoho_expenses_do_not_inherit_invoice_fields_or_base_currency_amounts(self):
        frame = pd.DataFrame({"total": [113], "amount": [110], "sub_total": [100], "tax_amount": [13],
                              "bcy_total": [150], "bcy_amount": [155], "exchange_rate": [1.3],
                              "quantity": [2], "unit_price": [50], "line_total": [100], "shipping_charge": [4],
                              "tax_total": [13], "discount_amount": [5]})
        profile = build_metric_selection_profile(dataset("zoho_books", "expenses"), frame)
        self.assertEqual(set(profile["recommended_metric_columns"]), {"total", "sub_total", "tax_amount"})

    def test_zoho_credit_notes_do_not_inherit_unverified_invoice_footer_fields(self):
        frame = pd.DataFrame({"quantity": [2], "unit_price": [10], "line_total": [20], "total": [20],
                              "sub_total": [20], "tax_total": [2], "shipping_charge": [3], "discount_amount": [4]})
        profile = build_metric_selection_profile(dataset("zoho_books", "credit_notes"), frame)
        self.assertEqual(set(profile["recommended_metric_columns"]), {"quantity", "unit_price", "line_total", "total"})

    def test_ambiguous_sage_total_fallbacks_do_not_become_receipt_defaults(self):
        frame = pd.DataFrame({"quantity": [2], "unit_price": [10], "line_total": [20],
                              "total_amount": [20], "net_amount": [20], "tax_amount": [2.6]})
        for resource in ("sales_invoices", "purchase_invoices", "sales_credit_notes", "purchase_credit_notes"):
            with self.subTest(resource=resource):
                self.assertEqual(set(build_metric_selection_profile(dataset("sage", resource), frame)["recommended_metric_columns"]), {"quantity", "unit_price"})

    def test_lightspeed_tip_defaults_use_the_documented_payment_tip_total(self):
        columns = ["tip", "calcTips", "normal_unit_price", "calcAvgCost", "calcFIFOCost"]
        self.assertEqual(receipt_metric_columns("lightspeed", {"resource": "sales"}, columns), ["calcTips"])

    def test_nonnumeric_or_empty_preferred_alias_does_not_hide_a_documented_amount(self):
        for primary in (None, "not an amount"):
            frame = pd.DataFrame({"total": [primary], "Total": [20], "CurrencyRate": [1.3]})
            profile = build_metric_selection_profile(dataset("xero"), frame)
            self.assertEqual(profile["recommended_metric_columns"], ["Total"])
            self.assertEqual(receipt_projection("xero", {"resource": "invoices"}, {"total": "DOUBLE", "Total": "DOUBLE", "CurrencyRate": "DOUBLE"}), ["total", "Total"])

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
            item = dataset(selected_metric_columns=selected, metric_selection_provenance={"source": "user"})
            before = item.source_config
            self.assertEqual(get_effective_dataset_metric_columns(item, frame), selected)
            result = filter_dataframe_to_selected_metrics(item, frame)
            self.assertEqual(item.source_config, before)
            self.assertEqual([metric["column"] for metric in generate_metrics(result, selected)], selected)

    def test_old_broad_saved_lists_are_replaced_by_effective_receipt_defaults_for_every_source(self):
        cases = {"quickbooks": "invoices", "freshbooks": "invoices", "sage": "sales_invoices",
                 "xero": "invoices", "zoho_books": "invoices", "shopify": "orders",
                 "woocommerce": "orders", "square": "orders", "lightspeed": "sales", "lightspeed_x": "sales"}
        frame = pd.DataFrame({"quantity": [2, 3], "unit_price": [10, 12],
                              **{f"internal_metric_{index}": [index, index + 1] for index in range(40)}})
        for source, resource in cases.items():
            for provenance in (None, {"source": "recommended"}):
                with self.subTest(source=source, provenance=provenance):
                    config = {"selected_metric_columns": list(frame)}
                    if provenance:
                        config["metric_selection_provenance"] = provenance
                    item = dataset(source, resource, **config)
                    before = item.source_config
                    self.assertEqual(set(get_effective_dataset_metric_columns(item, frame)), {"quantity", "unit_price"})
                    filtered = filter_dataframe_to_selected_metrics(item, frame)
                    self.assertEqual(set(filtered), {"quantity", "unit_price"})
                    self.assertEqual(item.source_config, before)
                    projection = receipt_projection(source, json.loads(before), {column: "DOUBLE" for column in frame})
                    self.assertEqual(set(projection), {"quantity", "unit_price"})

    def test_old_non_transaction_lists_do_not_bypass_receipt_defaults(self):
        frame = pd.DataFrame({"balance": [10], "quantity_on_hand": [4], "internal_count": [50]})
        for source in ("quickbooks", "freshbooks", "sage", "xero", "zoho_books", "lightspeed_x"):
            item = dataset(source, "accounts", selected_metric_columns=list(frame))
            with self.subTest(source=source):
                self.assertEqual(get_effective_dataset_metric_columns(item, frame), [])
                self.assertEqual(generate_metrics(filter_dataframe_to_selected_metrics(item, frame)), [])

    def test_explicit_legacy_opt_out_is_not_treated_as_an_automatic_selection(self):
        item = dataset(selected_metric_columns=[])
        self.assertFalse(uses_receipt_defaults(item.source_type, json.loads(item.source_config)))
        self.assertEqual(get_effective_dataset_metric_columns(item, pd.DataFrame({"quantity": [2]})), [])

    def test_old_curated_automatic_entity_counts_are_not_selected(self):
        item = dataset("xero", "contacts", selected_metric_columns=["__metric_record_count"],
                       curated_metric_selection=True, connector_schema_version=CONNECTOR_SCHEMA_VERSION,
                       metric_selection_provenance={"source": "recommended", "policy_version": "2026-10-14.1"})
        frame = pd.DataFrame({"record_id": ["one", "two"]})
        with patch.dict(os.environ, {"CURATED_METRIC_DEFAULTS_BACKEND": "true", "CURATED_METRIC_DEFAULTS_ROLLOUT": "all"}):
            self.assertEqual(get_effective_dataset_metric_columns(item, frame), [])
            self.assertEqual(generate_metrics(filter_dataframe_to_selected_metrics(item, frame)), [])
            self.assertIsNone(resolve_metric_recommendations(item, frame)["savedSelection"])

    def test_documented_lightspeed_totals_do_not_select_internal_costs(self):
        frame = pd.DataFrame({"quantity": [2] * 20, "unit_price": [10] * 20,
                              "line__calcTotal": [23] * 20, "total": [23] * 20, "calcTotal": [23] * 20,
                              "calcTax1": [3] * 20, "calcTax2": [0] * 20,
                              "calcAvgCost": [4] * 20, "calcFIFOCost": [4] * 20, "line__avgCost": [2] * 20})
        result = get_effective_dataset_metric_columns(dataset("lightspeed", "sales", selected_metric_columns=list(frame)), frame)
        self.assertEqual(set(result), {"quantity", "unit_price", "line__calcTotal", "total", "calcTax1", "calcTax2"})

    def test_payment_resources_cannot_select_invoice_or_inventory_fields_by_default(self):
        frame = pd.DataFrame({"amount": [20], "TotalAmt": [20], "total_amount": [20],
                              "quantity": [3], "unit_price": [10], "balance": [5], "quantity_on_hand": [30]})
        for source, resource, expected in (("quickbooks", "payments", {"total_amount"}),
                                           ("freshbooks", "payments", {"amount"}),
                                           ("zoho_books", "customer_payments", {"amount"})):
            with self.subTest(source=source):
                item = dataset(source, resource, selected_metric_columns=list(frame))
                self.assertEqual(set(get_effective_dataset_metric_columns(item, frame)), expected)

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
                                 ({"selected_metric_columns": ["exchange_rate"], "metric_selection_provenance": {"source": "user"}}, {"exchange_rate"}),
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
            item = dataset(selected_metric_columns=['odd"name'], metric_selection_provenance={"source": "user"})
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
