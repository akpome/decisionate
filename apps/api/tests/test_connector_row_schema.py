import json
import re
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import pandas as pd

from app.modules.datasets import router
from app.modules.datasets.services import connectors, dataset_loader
from app.modules.datasets.services.connector_schema import COLUMN_MAPPING_ATTR, remap_connector_metric_config
from app.modules.datasets.services.metric_selection import get_effective_dataset_metric_columns


LINE_PREFIXES = {
    "shopify": "lineItems__nodes",
    "square": "line_items",
    "woocommerce": "line_items",
    "lightspeed": "SaleLines__SaleLine",
    "lightspeed_x": "line_items",
    "lightspeed_k": "salesLines",
    "lightspeed_o": "items",
    "quickbooks": "Line",
    "freshbooks": "lines",
    "sage": "invoice_lines",
    "xero": "LineItems",
    "zoho_books": "line_items",
}


def legacy_frame(prefix, item_count=2):
    return pd.DataFrame([{
        "record_id": "transaction-1", "order_id": "transaction-1",
        "sale_id": "transaction-1", "created_at": "2026-10-01",
        "total": 30.0,
        f"{prefix}__count": item_count,
        **{
            f"{prefix}__{index}__{field}": value
            for index in range(item_count)
            for field, value in {
                "id": f"item-{index}", "description": f"Product {index}",
                "quantity": index + 1, "unit_price": 10.0,
            }.items()
        },
    }])


class ConnectorRowSchemaTests(unittest.TestCase):
    def assert_no_indexed_columns(self, frame):
        self.assertFalse(any(re.search(r"__\d+(?:__|$)", str(column)) for column in frame.columns))

    def test_collection_lengths_do_not_change_dynamic_column_names(self):
        for count in (0, 1, 3):
            with self.subTest(count=count):
                row = connectors.build_dynamic_connector_row({
                    "links": [{"rel": "alternate", "href": f"https://example.test/{index}"} for index in range(count)],
                    "metadata": {"tags": ["one"] * count},
                }, {}, flatten_lists=True)
                self.assertEqual(set(row), {"links", "links__count", "metadata__tags", "metadata__tags__count"})
                self.assertEqual(len(json.loads(row["links"])), count)

    def test_legacy_transaction_items_are_vertical_for_every_transaction_connector(self):
        for source_type, prefix in LINE_PREFIXES.items():
            with self.subTest(source_type=source_type):
                frame = legacy_frame(prefix)
                before = frame.copy(deep=True)
                normalized = connectors.normalize_connector_row_schema(frame, source_type)
                self.assertEqual(len(normalized), 2)
                self.assertEqual(normalized["line_item_id"].tolist(), ["item-0", "item-1"])
                self.assertEqual(normalized["quantity"].tolist(), [1, 2])
                self.assertEqual(normalized["item_description"].tolist(), ["Product 0", "Product 1"])
                self.assertEqual(normalized["order_id"].tolist(), ["transaction-1"] * 2)
                self.assertEqual(normalized["total"].sum(), 30)
                self.assert_no_indexed_columns(normalized)
                pd.testing.assert_frame_equal(frame, before)
                pd.testing.assert_frame_equal(connectors.normalize_connector_row_schema(normalized, source_type), normalized)
                single = connectors.normalize_connector_row_schema(legacy_frame(prefix, 1), source_type)
                self.assertEqual(list(single.columns), list(normalized.columns))

    def test_repair_preserves_nested_item_properties_and_unrelated_arrays(self):
        frame = pd.DataFrame([{
            "record_id": "invoice-1", "total_amount": 30,
            "Line__0__Id": "line-1", "Line__0__Amount": 10,
            "Line__0__SalesItemLineDetail__Qty": 2,
            "Line__0__SalesItemLineDetail__ItemRef__value": "product-1",
            "Line__0__SalesItemLineDetail__UnitPrice": 5,
            "Line__1__Id": "line-2", "Line__1__Amount": 20,
            "Line__1__SalesItemLineDetail__Qty": 4,
            "Line__1__SalesItemLineDetail__UnitPrice": 5,
            "links__0__rel": "self", "links__1__rel": "next",
        }])
        normalized = connectors.normalize_connector_row_schema(frame, "quickbooks")
        self.assertEqual(len(normalized), 2, "Unrelated collections must not create a Cartesian product")
        self.assertEqual(normalized["line_total"].sum(), 30)
        self.assertEqual(normalized["quantity"].sum(), 6)
        self.assertEqual(normalized["item_id"].iloc[0], "product-1")
        self.assertEqual(normalized["line__SalesItemLineDetail__Qty"].tolist(), [2, 4])
        self.assertEqual(json.loads(normalized["links"].iloc[0]), [{"rel": "self"}, {"rel": "next"}])
        self.assert_no_indexed_columns(normalized)

    def test_nested_item_arrays_remain_collections_instead_of_recreating_numbered_columns(self):
        frame = legacy_frame("Line", 1)
        frame["Line__0__taxes__count"] = 2
        frame["Line__0__taxes__0__amount"] = 1
        frame["Line__0__taxes__1__amount"] = 2
        result = connectors.normalize_connector_row_schema(frame, "quickbooks")
        self.assertEqual(json.loads(result["line__taxes"].iloc[0]), [{"amount": 1}, {"amount": 2}])
        self.assert_no_indexed_columns(result)

    def test_malformed_item_arrays_are_preserved_without_duplicating_transaction_totals(self):
        frame = pd.DataFrame({"record_id": ["invoice-1"], "total": [30], "Line__0": ["unknown"], "Line__1": ["shape"]})
        result = connectors.normalize_connector_row_schema(frame, "quickbooks")
        self.assertEqual(len(result), 1)
        self.assertEqual(result["total"].sum(), 30)
        self.assertEqual(json.loads(result["Line"].iloc[0]), ["unknown", "shape"])
        nested = pd.DataFrame({"record_id": ["invoice-1"], "total": [30], "Line__0__0": ["nested"]})
        repaired = connectors.normalize_connector_row_schema(nested, "quickbooks")
        self.assertEqual(json.loads(repaired["Line"].iloc[0]), [["nested"]])

    def test_blank_line_identifiers_do_not_prevent_legacy_item_expansion(self):
        frame = legacy_frame("Line")
        frame["line_item_id"] = ""
        self.assertEqual(len(connectors.normalize_connector_row_schema(frame, "quickbooks")), 2)

    def test_singleton_object_and_multiple_items_have_the_same_schema(self):
        single = pd.DataFrame([{
            "sale_id": "sale-1", "total": 10,
            "SaleLines__SaleLine__saleLineID": "line-1",
            "SaleLines__SaleLine__unitQuantity": 1,
            "SaleLines__SaleLine__unitPrice": 10,
        }])
        multiple = pd.DataFrame([{
            "sale_id": "sale-1", "total": 30,
            **{
                f"SaleLines__SaleLine__{index}__{key}": value
                for index in range(2)
                for key, value in {"saleLineID": f"line-{index + 1}", "unitQuantity": index + 1, "unitPrice": 10}.items()
            },
        }])
        first = connectors.normalize_connector_row_schema(single, "lightspeed")
        second = connectors.normalize_connector_row_schema(multiple, "lightspeed")
        self.assertEqual(list(first.columns), list(second.columns))
        self.assertEqual(first["sale_line_id"].tolist(), ["line-1"])
        self.assertEqual(second["sale_line_id"].tolist(), ["line-1", "line-2"])
        mixed = pd.concat([single, pd.DataFrame([{
            "sale_id": "sale-2", "sale_line_id": "line-3", "line_item_id": "line-3",
            "line_index": 0, "line__unitQuantity": 3,
        }])], ignore_index=True)
        repaired = connectors.normalize_connector_row_schema(mixed, "lightspeed")
        self.assertEqual(len(repaired), 2)
        self.assertFalse(any(str(column).startswith("SaleLines__") for column in repaired.columns))

    def test_serialized_legacy_items_are_repaired_without_inventing_a_parent_id(self):
        frame = pd.DataFrame({"Line": [json.dumps([
            {"Amount": 10, "SalesItemLineDetail": {"Qty": 1}},
            {"Amount": 20, "SalesItemLineDetail": {"Qty": 2}},
        ])]})
        normalized = connectors.normalize_connector_row_schema(frame, "quickbooks")
        self.assertEqual(len(normalized), 2)
        self.assertEqual(normalized["line_total"].sum(), 30)
        self.assertNotIn("line_item_id", normalized.columns)
        self.assert_no_indexed_columns(normalized)
        pd.testing.assert_frame_equal(connectors.normalize_connector_row_schema(normalized, "quickbooks"), normalized)

    def test_independent_transactions_keep_their_own_totals_and_zero_values(self):
        frame = pd.DataFrame([
            {"record_id": "first", "total": 0, "Line__0__Id": "first-line", "Line__0__Amount": 0, "Line__0__SalesItemLineDetail__Qty": 0},
            {"record_id": "second", "total": 30, "Line__0__Id": "second-line", "Line__0__Amount": 30},
        ])
        normalized = connectors.normalize_connector_row_schema(frame, "quickbooks")
        self.assertEqual(normalized["line_total"].tolist(), [0, 30])
        self.assertEqual(normalized["total"].sum(), 30)
        self.assertEqual(normalized["quantity"].iloc[0], 0)

    def test_historical_aggregates_are_never_fabricated_into_transaction_items(self):
        frame = legacy_frame("Line")
        frame["__decisionate_summary__"] = True
        normalized = connectors.normalize_connector_row_schema(frame, "quickbooks")
        pd.testing.assert_frame_equal(normalized, frame)

    def test_nontransaction_resources_do_not_expand_unrelated_line_collections(self):
        frame = legacy_frame("LineItems")
        normalized = connectors.normalize_connector_row_schema(frame, "xero", "contacts")
        self.assertEqual(len(normalized), 1)
        self.assertEqual(len(json.loads(normalized["LineItems"].iloc[0])), 2)
        self.assertNotIn("line_item_id", normalized.columns)
        self.assert_no_indexed_columns(normalized)

    def test_saved_indexed_metrics_follow_the_repaired_columns_without_changing_other_settings(self):
        item = SimpleNamespace(source_type="quickbooks", source_config=json.dumps({
            "selected_metric_columns": ["Line__0__unit_price", "Line__1__unit_price", "total"],
            "business_objective": "increase_revenue", "connector": "quickbooks",
            "metric_selection_provenance": {"source": "user"},
        }))
        frame = connectors.normalize_connector_row_schema(legacy_frame("Line"), "quickbooks")
        self.assertEqual(get_effective_dataset_metric_columns(item, frame), ["total", "line__unit_price"])
        config = remap_connector_metric_config(json.loads(item.source_config), frame.attrs[COLUMN_MAPPING_ATTR])
        self.assertEqual(config["selected_metric_columns"], ["line__unit_price", "total"])
        self.assertEqual(config["business_objective"], "increase_revenue")
        self.assertEqual(config["connector"], "quickbooks")

    def test_merge_repairs_history_and_does_not_restore_obsolete_columns(self):
        existing = legacy_frame("Line")
        incoming = pd.DataFrame([{
            "record_id": "transaction-1", "order_id": "transaction-1",
            "line_item_id": "item-0", "quantity": 3, "total": 30,
        }])
        merged = router.merge_connector_dataframes(existing, incoming, "quickbooks", {
            "resource": "invoices", "line_item_key": "line_item_id",
            "line_item_parent_keys": ["record_id"], "dedup_keys": ["line_item_id"],
        })
        self.assertEqual(len(merged), 2)
        self.assertEqual(dict(zip(merged["line_item_id"], merged["quantity"])), {"item-0": 3, "item-1": 2})
        self.assertEqual(merged["total"].sum(), 30)
        self.assert_no_indexed_columns(merged)
        historical = router.merge_connector_dataframes(existing, pd.DataFrame(), "quickbooks", {})
        self.assertEqual(len(historical), 2)
        self.assert_no_indexed_columns(historical)

    def test_empty_legacy_columns_are_removed_without_creating_phantom_items(self):
        frame = pd.DataFrame({"line_item_id": ["line-1"], "quantity": [2], "Line__0__Amount": [None]})
        normalized = connectors.normalize_connector_row_schema(frame, "quickbooks")
        self.assertEqual(len(normalized), 1)
        self.assertEqual(normalized["line_item_id"].tolist(), ["line-1"])
        self.assert_no_indexed_columns(normalized)

    def test_existing_vertical_rows_are_not_expanded_twice(self):
        frame = legacy_frame("Line")
        frame["line_item_id"] = "item-0"
        normalized = connectors.normalize_connector_row_schema(frame, "quickbooks")
        self.assertEqual(len(normalized), 1)
        self.assertEqual(len(json.loads(normalized["Line"].iloc[0])), 2)
        self.assert_no_indexed_columns(normalized)

    def test_old_datasets_are_repaired_before_metric_selection(self):
        item = SimpleNamespace(source_type="quickbooks", source_config="{}")
        with patch.object(dataset_loader, "load_dataset_dataframe", return_value=legacy_frame("Line")), patch.object(
            dataset_loader, "filter_dataframe_to_selected_metrics", side_effect=lambda dataset, frame: frame,
        ) as filter_metrics:
            result = dataset_loader.load_dataframe_from_dataset(item)
        self.assertEqual(len(result), 2)
        self.assertEqual(len(filter_metrics.call_args.args[1]), 2)
        self.assert_no_indexed_columns(result)

    def test_dataset_details_report_the_repaired_item_counts_and_columns(self):
        from app.db.models import Dataset

        item = Dataset(id=1, user_id="owner", workspace_id="workspace-1", source_type="quickbooks",
                       source_config="{}", file_name="invoices.parquet", file_path="unused", row_count=1, column_count=10)
        frame = connectors.normalize_connector_row_schema(legacy_frame("Line"), "quickbooks")
        details = router.build_dataset_details_response(item, frame, include_ai_analysis=False)
        self.assertEqual(details["row_count"], 2)
        self.assertEqual(details["column_count"], len(frame.columns))
        self.assertEqual(len(details["preview"]), 2)

    def test_file_uploads_and_database_query_columns_are_not_reinterpreted(self):
        for source_type in ("csv", "postgresql", "mysql", "sql_server"):
            with self.subTest(source_type=source_type):
                frame = legacy_frame("Line")
                result = connectors.normalize_connector_row_schema(frame, source_type)
                pd.testing.assert_frame_equal(result, frame)


if __name__ == "__main__":
    unittest.main()
