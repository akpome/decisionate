import json
import unittest
from itertools import product
from pathlib import Path
from types import SimpleNamespace

import pandas as pd

from app.modules.datasets.services.metric_registry import (
    get_metric_definition,
)
from app.modules.datasets.services.metric_selection import (
    build_metric_selection_profile,
    filter_dataframe_to_selected_metrics,
    get_effective_dataset_metric_columns,
    get_selectable_numeric_columns,
    normalize_selected_metric_columns,
)
from app.modules.datasets.services.metrics import (
    generate_metrics,
)
from app.modules.datasets.services.sources import IMPLEMENTED_CONNECTOR_TYPES


class DatasetMetricSelectionTests(unittest.TestCase):
    def setUp(self):
        self.dataframe = pd.DataFrame({
            "date": ["2026-01-01", "2026-01-02"],
            "revenue": [100, 125],
            "visits": [40, 52],
            "is_returning": [True, False],
            "numeric_text": ["100", "125"],
            "customer_email": [
                "first@example.com",
                "second@example.com",
            ],
            "revenue__sum": [100, 125],
        })

    def test_numeric_columns_are_available_and_selected_columns_are_filtered(self):
        dataset = SimpleNamespace(
            source_config=json.dumps({
                "selected_metric_columns": ["revenue"],
            })
        )

        self.assertEqual(
            get_selectable_numeric_columns(self.dataframe),
            ["revenue", "visits", "numeric_text"],
        )
        self.assertEqual(
            get_effective_dataset_metric_columns(
                dataset,
                self.dataframe,
            ),
            ["revenue"],
        )
        self.assertEqual(
            list(
                filter_dataframe_to_selected_metrics(
                    dataset,
                    self.dataframe,
                ).columns
            ),
            [
                "date",
                "revenue",
                "is_returning",
                "customer_email",
                "revenue__sum",
            ],
        )

    def test_legacy_dataset_defaults_to_recommended_numeric_columns(self):
        dataset = SimpleNamespace(source_config=None)

        self.assertEqual(
            get_effective_dataset_metric_columns(
                dataset,
                self.dataframe,
            ),
            ["revenue", "visits", "numeric_text"],
        )
        self.assertEqual(
            list(
                filter_dataframe_to_selected_metrics(
                    dataset,
                    self.dataframe,
                ).columns
            ),
            [
                "date",
                "revenue",
                "visits",
                "is_returning",
                "numeric_text",
                "customer_email",
                "revenue__sum",
            ],
        )

    def test_profile_handles_legacy_list_valued_dimensions(self):
        dataframe = pd.DataFrame({
            "date": ["2026-01-01", "2026-01-02"],
            "actions": [
                [{"action_type": "lead", "value": 1}],
                [{"action_type": "purchase", "value": 2}],
            ],
            "spend": [10.0, 20.0],
        })

        profile = build_metric_selection_profile(
            SimpleNamespace(
                source_type="meta_ads",
                source_config=None,
            ),
            dataframe,
        )

        fields = {
            field["column"]: field
            for field in profile["fields"]
        }
        self.assertIn("actions", fields)
        self.assertIn("spend", profile["available_metric_columns"])

    def test_all_connectors_handle_matching_empty_numeric_fields(self):
        empty_columns = (
            "tax_calculation_method", "line_tax_amount", "tax_total",
            "unitquantity", "quantity", "cost", "expenses",
            "empty_metric", "empty_metric_copy",
        )
        for source_type, dtype, row_count in product(
            sorted(IMPLEMENTED_CONNECTOR_TYPES),
            ("float64", "Float64", "Int64", "UInt32"),
            (0, 1, 2, 16),
        ):
            with self.subTest(source_type=source_type, dtype=dtype, rows=row_count):
                dataframe = pd.DataFrame({
                    **{
                        column: pd.Series([None] * row_count, dtype=dtype)
                        for column in empty_columns
                    },
                    "total_paid": pd.Series(range(25, 25 + row_count), dtype="float64"),
                    "unit_price": pd.Series(range(15, 15 + row_count), dtype="float64"),
                    "links__count": pd.Series([2] * row_count, dtype="int64"),
                    "links__0__rel": pd.Series(["alternate"] * row_count, dtype="str"),
                })
                profile = build_metric_selection_profile(
                    SimpleNamespace(source_type=source_type, source_config=None),
                    dataframe,
                    "increase_revenue",
                )
                fields = {field["column"]: field for field in profile["fields"]}
                self.assertEqual(set(fields), set(dataframe.columns))
                for column in empty_columns:
                    self.assertEqual(fields[column]["status"], "excluded")
                    self.assertNotIn(column, profile["available_metric_columns"])
                if row_count:
                    self.assertEqual(fields["total_paid"]["registry"]["canonical_name"], "revenue")
                    financial = source_type in {"stripe", "shopify", "square", "woocommerce", "lightspeed", "lightspeed_x", "lightspeed_k", "lightspeed_o", "quickbooks", "freshbooks", "sage", "xero", "zoho_books"}
                    self.assertEqual("total_paid" in profile["recommended_metric_columns"], not financial)
                    self.assertEqual("unit_price" in profile["recommended_metric_columns"], source_type not in {"stripe", "lightspeed_k", "lightspeed_o"})
                else:
                    self.assertEqual(profile["available_metric_columns"], [])

    def test_all_connectors_handle_nonfinite_duplicate_numeric_fields(self):
        for source_type in sorted(IMPLEMENTED_CONNECTOR_TYPES):
            with self.subTest(source_type=source_type):
                dataframe = pd.DataFrame({
                    "cost": [float("inf"), float("-inf")],
                    "expenses": [float("inf"), float("-inf")],
                    "revenue": [100.0, 125.0],
                })
                profile = build_metric_selection_profile(
                    SimpleNamespace(source_type=source_type, source_config=None),
                    dataframe,
                )
                self.assertEqual(profile["available_metric_columns"], ["revenue"])
                financial = source_type in {"stripe", "shopify", "square", "woocommerce", "lightspeed", "lightspeed_x", "lightspeed_k", "lightspeed_o", "quickbooks", "freshbooks", "sage", "xero", "zoho_books"}
                self.assertEqual(profile["recommended_metric_columns"], [] if financial else ["revenue"])

    def test_empty_connector_resource_schemas_can_be_profiled(self):
        inventory = json.loads(
            (Path(__file__).parent / "fixtures/metric_schema_inventory.json").read_text()
        )
        covered_connectors = set()
        for schema in inventory["schemas"]:
            metadata = schema["metadata"]
            source_type = metadata.get("connector") or "google_analytics"
            covered_connectors.add(source_type)
            with self.subTest(loader=schema["loader"], metadata=metadata):
                dataframe = pd.DataFrame({
                    column: pd.Series(dtype=dtype)
                    for column, dtype in schema["columns"].items()
                })
                profile = build_metric_selection_profile(
                    SimpleNamespace(source_type=source_type, source_config=json.dumps(metadata)),
                    dataframe,
                )
                self.assertEqual(
                    [field["column"] for field in profile["fields"]],
                    list(dataframe.columns),
                )
                self.assertEqual(profile["available_metric_columns"], [])
        self.assertEqual(covered_connectors, IMPLEMENTED_CONNECTOR_TYPES)

    def test_objective_defaults_only_include_relevant_metrics_for_all_connectors(self):
        expectations = {
            "general_business": {"revenue", "spend", "unit_price", "balance", "tax", "customers", "payment_amount", "repeat_purchase_value", "custom_amount"},
            "increase_revenue": {"revenue", "unit_price", "customers"},
            "profitability": {"revenue", "spend", "unit_price", "balance", "tax"},
            "reduce_expenses": {"spend"},
            "cash_flow": {"revenue", "spend", "balance", "tax", "payment_amount"},
            "qualified_leads": set(),
            "retention": {"customers", "repeat_purchase_value"},
            "marketing_return": {"revenue", "spend", "unit_price"},
        }
        for source_type, row_count in product(sorted(IMPLEMENTED_CONNECTOR_TYPES), (2, 16)):
            dataframe = pd.DataFrame({
                column: range(index + 1, index + row_count + 1)
                for index, column in enumerate(sorted(expectations["general_business"]))
            })
            item = SimpleNamespace(source_type=source_type, source_config=json.dumps({
                "business_objective": "general_business",
                "selected_metric_columns": list(dataframe.columns),
                "metric_decisions": {column: "metric" for column in dataframe.columns},
            }))
            for objective, expected in expectations.items():
                with self.subTest(source_type=source_type, rows=row_count, objective=objective):
                    if source_type in {"stripe", "lightspeed_k", "lightspeed_o"}:
                        expected = set()
                    elif source_type in {"quickbooks", "zoho_books"}:
                        expected = expected & {"unit_price", "balance"}
                    elif source_type in {"shopify", "square", "woocommerce", "lightspeed", "lightspeed_x", "freshbooks", "sage", "xero"}:
                        expected = expected & {"unit_price"}
                    profile = build_metric_selection_profile(item, dataframe, objective)
                    self.assertEqual(set(profile["recommended_metric_columns"]), expected)
                    self.assertEqual(set(profile["available_metric_columns"]), set(dataframe.columns))
                    for field in profile["fields"]:
                        if field["column"] not in expected:
                            self.assertNotEqual(field["status"], "recommended")

    def test_objective_defaults_do_not_replace_explicit_choices_on_read(self):
        dataframe = pd.DataFrame({"revenue": [100, 125], "spend": [20, 25]})
        item = SimpleNamespace(source_type="csv", source_config=json.dumps({
            "business_objective": "reduce_expenses",
            "selected_metric_columns": ["revenue"],
            "metric_decisions": {"revenue": "metric"},
        }))
        before = item.source_config
        profile = build_metric_selection_profile(item, dataframe)
        self.assertEqual(profile["recommended_metric_columns"], ["spend"])
        self.assertEqual(get_effective_dataset_metric_columns(item, dataframe, profile), ["revenue"])
        self.assertEqual(item.source_config, before)

    def test_objective_without_relevant_fields_has_no_automatic_selection(self):
        dataframe = pd.DataFrame({"revenue": [100, 125], "unit_price": [15, 20]})
        profile = build_metric_selection_profile(
            SimpleNamespace(source_type="csv", source_config=None),
            dataframe,
            "reduce_expenses",
        )
        self.assertEqual(profile["recommended_metric_columns"], [])
        self.assertEqual(set(profile["available_metric_columns"]), set(dataframe.columns))

    def test_unrecognized_numeric_columns_require_confirmation(self):
        dataframe = pd.DataFrame({
            **{
                f"metric_{index}": [
                    index + (row % 4)
                    for row in range(16)
                ]
                for index in range(1, 9)
            },
        })
        dataset = SimpleNamespace(
            source_type="csv",
            source_config=None,
        )

        profile = build_metric_selection_profile(
            dataset,
            dataframe,
        )

        self.assertEqual(profile["recommended_metric_columns"], [])
        self.assertEqual(
            profile["ambiguous_metric_columns"],
            list(dataframe.columns),
        )
        self.assertEqual(
            get_effective_dataset_metric_columns(
                dataset,
                dataframe,
            ),
            [],
        )

    def test_semantic_metric_columns_are_not_truncated(self):
        dataframe = pd.DataFrame({
            f"amount_{index}": range(1, 17)
            for index in range(1, 8)
        })
        dataset = SimpleNamespace(
            source_type="csv",
            source_config=None,
        )

        profile = build_metric_selection_profile(
            dataset,
            dataframe,
        )

        self.assertEqual(
            profile["recommended_metric_columns"],
            list(dataframe.columns),
        )

    def test_connector_suffix_metric_is_filtered_like_other_numeric_columns(self):
        dataframe = pd.DataFrame({
            "date": ["2026-01-01", "2026-01-02"],
            "revenue": [100, 125],
            "Line__count": [2, 3],
            "visits": [40, 52],
        })
        dataset = SimpleNamespace(
            source_config=json.dumps({
                "selected_metric_columns": ["revenue"],
            })
        )

        self.assertEqual(
            get_selectable_numeric_columns(dataframe),
            ["revenue", "Line__count", "visits"],
        )
        self.assertEqual(
            list(
                filter_dataframe_to_selected_metrics(
                    dataset,
                    dataframe,
                ).columns
            ),
            ["date", "revenue"],
        )

    def test_identifier_named_numeric_columns_are_not_selectable_metrics(self):
        dataframe = pd.DataFrame({
            "date": ["2026-01-01", "2026-01-02"],
            "customer_id": [101, 102],
            "api_key": [201, 202],
            "product_code": [301, 302],
            "RevenueCode": [401, 402],
            "order_number": [501, 502],
            "invoice_no": [601, 602],
            "customerNumber": [701, 702],
            "api_version": [801, 802],
            "revenue": [100, 125],
        })

        self.assertEqual(
            get_selectable_numeric_columns(dataframe),
            ["revenue"],
        )
        self.assertEqual(
            [
                metric["column"]
                for metric in generate_metrics(dataframe)
            ],
            ["revenue"],
        )

    def test_quantity_is_recommended_over_numeric_sku(self):
        dataframe = pd.DataFrame({
            "sku": [1001, 1002, 1003, 1004, 1005, 1006],
            "unitquantity": [1, 2, 1, 3, 2, 4],
            "quantity": [1, 2, 1, 3, 2, 4],
            "unit_price": [12.5, 15.0, 12.5, 20.0, 15.0, 18.0],
            "line_total": [25.0, 15.0, 50.0, 60.0, 30.0, 90.0],
        })
        dataset = SimpleNamespace(
            source_type="shopify",
            source_config=None,
        )

        profile = build_metric_selection_profile(
            dataset,
            dataframe,
        )
        fields = {
            field["column"]: field
            for field in profile["fields"]
        }

        self.assertEqual(fields["sku"]["role"], "identifier")
        self.assertEqual(fields["sku"]["status"], "excluded")
        self.assertEqual(
            fields["unitquantity"]["registry"]["canonical_name"],
            "quantity",
        )
        self.assertEqual(
            fields["quantity"]["registry"]["canonical_name"],
            "quantity",
        )
        self.assertEqual(fields["quantity"]["status"], "recommended")
        self.assertNotIn("unitquantity", profile["recommended_metric_columns"])
        self.assertEqual(
            fields["unit_price"]["registry"]["canonical_name"],
            "unit_price",
        )
        self.assertEqual(
            fields["line_total"]["registry"]["canonical_name"],
            "revenue",
        )
        self.assertIn("quantity", profile["recommended_metric_columns"])
        self.assertIn("unit_price", profile["recommended_metric_columns"])
        self.assertIn("line_total", profile["recommended_metric_columns"])
        self.assertNotIn("sku", profile["recommended_metric_columns"])

    def test_known_metrics_are_detected_in_single_row_datasets(self):
        dataframe = pd.DataFrame({
            "order_id": [1001],
            "amount": [25.0],
            "quantity": [2],
            "unit_price": [12.5],
            "line_total": [25.0],
            "raw_metric": [7],
            "unclassified_number": [7],
        })
        dataset = SimpleNamespace(
            source_type="shopify",
            source_config=None,
        )

        profile = build_metric_selection_profile(
            dataset,
            dataframe,
        )
        fields = {
            field["column"]: field
            for field in profile["fields"]
        }

        self.assertNotIn("amount", profile["recommended_metric_columns"])
        self.assertIn(
            "quantity",
            profile["recommended_metric_columns"],
        )
        self.assertIn(
            "unit_price",
            profile["recommended_metric_columns"],
        )
        self.assertIn(
            "line_total",
            profile["recommended_metric_columns"],
        )
        self.assertEqual(fields["quantity"]["status"], "recommended")
        self.assertEqual(fields["amount"]["status"], "advanced")
        self.assertEqual(fields["unit_price"]["status"], "recommended")
        self.assertEqual(fields["line_total"]["status"], "recommended")
        self.assertEqual(fields["raw_metric"]["status"], "advanced")
        self.assertEqual(fields["order_id"]["role"], "identifier")
        self.assertEqual(fields["order_id"]["status"], "excluded")
        self.assertEqual(
            fields["unclassified_number"]["status"],
            "excluded",
        )

    def test_line_quantity_aliases_map_to_quantity(self):
        for column in (
            "linequantity",
            "line-quantity",
            "line_quantity",
            "unit-quantity",
        ):
            definition = get_metric_definition(
                column,
                "lightspeed",
            )
            self.assertIsNotNone(definition)
            self.assertEqual(definition.canonical_name, "quantity")

    def test_generate_metrics_can_limit_output_to_selected_columns(self):
        self.assertEqual(
            [
                metric["column"]
                for metric in generate_metrics(
                    self.dataframe,
                    ["revenue"],
                )
            ],
            ["revenue"],
        )

    def test_explicit_selection_can_include_non_recommended_columns(self):
        dataframe = pd.DataFrame({
            "customer_id": [101, 102],
            "revenue": [100, 125],
            "category": ["a", "b"],
        })
        dataset = SimpleNamespace(
            source_config=json.dumps({
                "selected_metric_columns": [
                    "customer_id",
                    "category",
                ],
            })
        )

        self.assertEqual(
            get_effective_dataset_metric_columns(
                dataset,
                dataframe,
            ),
            ["customer_id", "category"],
        )
        self.assertEqual(
            [
                metric["column"]
                for metric in generate_metrics(
                    dataframe,
                    ["customer_id", "category"],
                )
            ],
            ["customer_id"],
        )

    def test_normalization_accepts_metric_and_dimension_columns(self):
        available_columns, selected_columns = normalize_selected_metric_columns(
            self.dataframe,
            ["customer_email", "revenue"],
        )

        self.assertEqual(
            available_columns,
            [
                "revenue",
                "visits",
                "numeric_text",
            ],
        )
        self.assertEqual(
            selected_columns,
            ["revenue", "customer_email"],
        )

    def test_profile_classifies_and_excludes_unsuitable_columns(self):
        dataframe = pd.DataFrame({
            "date": [f"2026-01-0{index}" for index in range(1, 7)],
            "revenue": [100, 125, 90, 140, 110, 130],
            "customer_id": [1, 2, 3, 4, 5, 6],
            "row_sequence": [1, 2, 3, 4, 5, 6],
            "constant_value": [1, 1, 1, 1, 1, 1],
            "revenue_copy": [100, 125, 90, 140, 110, 130],
            "channel": ["web", "store", "web", "store", "web", "store"],
            "notes": ["a", "b", "c", "d", "e", "f"],
        })
        dataset = SimpleNamespace(
            source_type="quickbooks",
            source_config=None,
        )

        profile = build_metric_selection_profile(
            dataset,
            dataframe,
        )
        fields = {
            field["column"]: field
            for field in profile["fields"]
        }

        self.assertNotIn("revenue", profile["recommended_metric_columns"])
        self.assertEqual(fields["date"]["role"], "time")
        self.assertEqual(fields["customer_id"]["role"], "identifier")
        self.assertEqual(fields["row_sequence"]["role"], "identifier")
        self.assertEqual(fields["constant_value"]["status"], "advanced")
        self.assertEqual(fields["revenue_copy"]["status"], "excluded")
        self.assertEqual(fields["channel"]["role"], "dimension")
        self.assertNotIn("customer_id", profile["available_metric_columns"])

    def test_connector_registry_adds_semantic_metadata(self):
        dataframe = pd.DataFrame({
            "invoice_date": ["2026-01-01", "2026-01-02"],
            "total_amount": [100, 125],
            "balance": [25, 0],
        })
        dataset = SimpleNamespace(
            source_type="quickbooks",
            source_config=None,
        )

        profile = build_metric_selection_profile(
            dataset,
            dataframe,
        )
        fields = {
            field["column"]: field
            for field in profile["fields"]
        }

        self.assertEqual(
            fields["total_amount"]["registry"]["canonical_name"],
            "revenue",
        )
        self.assertEqual(
            fields["total_amount"]["registry"]["aggregation"],
            "sum",
        )

    def test_normalization_rejects_unknown_columns(self):
        with self.assertRaisesRegex(
            ValueError,
            "was not found",
        ):
            normalize_selected_metric_columns(
                self.dataframe,
                ["missing"],
            )


if __name__ == "__main__":
    unittest.main()
