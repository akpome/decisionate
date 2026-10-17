"""Documented X-Series shapes with synthetic values, not live store responses."""

from copy import deepcopy
from contextlib import ExitStack
import json
import os
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch

import pandas as pd

from app.modules.datasets import router
from app.modules.datasets.services import connectors
from app.modules.datasets.services.metric_policy import CONNECTOR_SCHEMA_VERSION, POLICY_VERSION
from app.modules.datasets.services.metric_recommendations import recommended_columns, resolve_metric_recommendations
from app.modules.datasets.services.metric_selection import build_metric_selection_profile, get_effective_dataset_metric_columns
from app.modules.datasets.services.receipt_metrics import receipt_projection
from app.modules.oauth.service import OAUTH_PROVIDERS, get_provider_scopes


NESTED_SALE = {
    "id": "sale-1", "date": "2026-10-01T12:00:00Z", "state": "closed",
    "invoice_number": "INV-1", "receipt_number": "1",
    "totals": {"price": 23, "tax": 2.99, "price_incl_tax": 25.99, "loyalty": 1, "surcharge": 0},
    "line_items": [
        {"id": "line-1", "product": {"id": "product-1"}, "quantity": 2,
         "pricing": {"price": 10, "total": 18, "discount": 1, "discount_total": 2,
                     "cost": 8, "cost_total": 16, "loyalty_amount": .5, "loyalty_amount_total": 1},
         "tax": {"id": "tax-1", "amount": 1.17, "total": 2.34}},
        {"id": "line-2", "product": {"id": "product-2"}, "quantity": 1,
         "pricing": {"price": 5, "total": 5, "discount": 0, "discount_total": 0, "cost": 3},
         "tax": {"id": "tax-1", "amount": .65, "total": .65}},
    ],
}
EXPECTED = {"quantity", "unit_price", "line_total", "line__tax__total",
            "line__pricing__discount_total", "total", "total_tax", "grand_total"}


class LightspeedXReceiptDefaultTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, {
            "LIGHTSPEED_X_API_BASE_URL_TEMPLATE": "https://{domain_prefix}.retail.lightspeed.app/api/{version}",
            "LIGHTSPEED_X_API_VERSION": "2026-07",
            "CURATED_METRIC_DEFAULTS_BACKEND": "true",
            "CURATED_METRIC_DEFAULTS_UI": "true",
            "CURATED_METRIC_DEFAULTS_ROLLOUT": "all",
            "CURATED_METRIC_DEFAULTS_DIAGNOSTICS": "false",
        })
        self.environment.start()
        self.addCleanup(self.environment.stop)

    def import_sales(self, sales=None, *, retailer=None, retailer_error=None):
        sales = deepcopy(sales if sales is not None else [NESTED_SALE])
        retailer = retailer if retailer is not None else {"data": {"currency": {"code": "CAD"}}}

        def request(url, headers):
            self.assertEqual(headers, {"Authorization": "Bearer test-token"})
            if url.endswith("/retailer"):
                if retailer_error:
                    raise retailer_error
                return retailer
            self.assertIn("/sales?", url)
            return {"data": sales, "version": {"max": None}}

        connection = SimpleNamespace(source_type="lightspeed_x", connection_config=json.dumps({"domain_prefix": "test-store", "resource_types": ["sales"]}))
        with patch.object(connectors, "get_oauth_access_token", return_value="test-token"), patch.object(
            connectors, "connector_json_request", side_effect=request,
        ) as requested:
            frame, report = connectors.load_lightspeed_x_dataframe(None, connection)
        return frame, report, requested

    def dataset(self, report=None, **config):
        return SimpleNamespace(id=1, user_id="test-user", source_type="lightspeed_x", source_config=json.dumps({
            **(report or {}), "resource": "sales", "api_version": "2026-07",
            "connector_schema_version": CONNECTOR_SCHEMA_VERSION, "curated_metric_selection": True,
            "selected_metric_columns": ["quantity"],
            "metric_selection_provenance": {"source": "recommended", "policy_version": "2026-10-16.1"},
            **config,
        }))

    def test_nested_sales_without_currency_select_receipt_amounts_end_to_end(self):
        self.assertNotIn("currency", NESTED_SALE)
        frame, report, requested = self.import_sales()
        self.assertEqual(sum(call.args[0].endswith("/retailer") for call in requested.call_args_list), 1)
        self.assertEqual(frame["currency"].tolist(), ["CAD", "CAD"])
        self.assertEqual(report["retailer_currency"], "CAD")
        self.assertEqual(report["currency_source"], "retailer.currency.code")
        item = self.dataset(report)
        before = item.source_config
        self.assertEqual(set(get_effective_dataset_metric_columns(item, frame)), EXPECTED)
        self.assertEqual(item.source_config, before)
        result = resolve_metric_recommendations(item, frame)
        self.assertEqual(result["policyVersion"], POLICY_VERSION)
        self.assertEqual(result["skipped"], [])
        self.assertTrue(all(entry["currency"] == "CAD" for entry in result["recommended"] if entry["unit"] == "currency"))

    def test_totals_are_recorded_once_and_returns_keep_their_sign(self):
        returned = deepcopy(NESTED_SALE)
        returned.update(id="return-1", totals={"price": -18, "tax": -2.34, "price_incl_tax": -20.34})
        returned["line_items"] = [deepcopy(returned["line_items"][0])]
        returned["line_items"][0].update(id="return-line-1", quantity=-2)
        returned["line_items"][0]["pricing"].update(total=-18, discount_total=-2)
        returned["line_items"][0]["tax"]["total"] = -2.34
        frame, report, _ = self.import_sales([NESTED_SALE, returned])
        self.assertEqual(len(frame), 3)
        self.assertEqual(frame["line_total"].tolist(), [18, 5, -18])
        for column in ("total", "total_tax", "grand_total", "totals__price", "totals__tax", "totals__price_incl_tax"):
            self.assertTrue(pd.isna(frame[column].iloc[1]), column)
            self.assertEqual(frame[column].notna().sum(), 2, column)
        from app.modules.datasets.services.metric_selection import filter_dataframe_to_selected_metrics
        from app.modules.datasets.services.curated_metric_analytics import curated_metrics
        analytical = filter_dataframe_to_selected_metrics(self.dataset(report), frame)
        metrics = {entry["column"]: entry for entry in curated_metrics(analytical)}
        self.assertAlmostEqual(metrics["grand_total"]["total"], 5.65)
        self.assertAlmostEqual(metrics["line__pricing__discount_total"]["total"], 0)
        self.assertNotIn("line__pricing__cost", analytical)

    def test_existing_vertical_rows_use_nested_raw_alternatives(self):
        frame, report, _ = self.import_sales()
        raw = frame.drop(columns=["unit_price", "line_total", "total", "total_tax", "grand_total"])
        expected = {"quantity", "line__pricing__price", "line__pricing__total", "line__tax__total",
                    "line__pricing__discount_total", "totals__price", "totals__tax", "totals__price_incl_tax"}
        self.assertEqual(set(get_effective_dataset_metric_columns(self.dataset(report), raw)), expected)
        raw["unit_price"] = None
        raw["line_total"] = None
        self.assertEqual(set(get_effective_dataset_metric_columns(self.dataset(report), raw)), expected)

    def test_verified_retailer_metadata_covers_old_rows_without_currency(self):
        frame, report, _ = self.import_sales()
        frame = frame.drop(columns="currency")
        self.assertEqual(set(get_effective_dataset_metric_columns(self.dataset(report), frame)), EXPECTED)
        for config in ({}, {"retailer_currency": "CAD"}, {"retailer_currency": "ZZZ", "currency_source": "retailer.currency.code"}):
            with self.subTest(config=config):
                self.assertEqual(get_effective_dataset_metric_columns(self.dataset(**config), frame), ["quantity"])

    def test_quiet_sync_preserves_verified_context_only_for_the_same_retailer(self):
        for domain, expected in (("test-store", "CAD"), ("different-store", None)):
            with self.subTest(domain=domain):
                frame, report, _ = self.import_sales()
                item = self.dataset(report)
                item.workspace_id = "test-workspace"
                item.file_path = "/tmp/x-receipt-test-partitions"
                item.file_name = "sales.parquet"
                item.storage_provider = None
                storage = MagicMock(is_remote=False)
                storage.is_directory_reference.return_value = True
                storage.put_directory.return_value = item.file_path
                stored = {"partition_dir": item.file_path, "historical_partition_paths": [],
                          "hot_row_count": len(frame), "historical_summary_row_count": 0,
                          "date_column": "created_at", "hot_partition_count": 1,
                          "historical_partition_count": 0, "column_count": len(frame.columns)}
                connection = SimpleNamespace(id=7, user_id=item.user_id, workspace_id=item.workspace_id,
                                             source_type="lightspeed_x", connection_config="{}")
                with ExitStack() as stack:
                    for name, value in (("find_connector_dataset", item), ("get_object_storage", storage),
                                        ("load_connector_raw_dataframe", frame),
                                        ("load_connector_summary_dataframe", pd.DataFrame()),
                                        ("write_connector_monthly_partitions", stored)):
                        stack.enter_context(patch.object(router, name, return_value=value))
                    result, *_ = router.persist_connector_dataframe(
                        MagicMock(), connection, pd.DataFrame(), {"resource": "sales", "domain_prefix": domain},
                    )
                config = json.loads(result.source_config)
                self.assertEqual(config.get("retailer_currency"), expected)
                self.assertEqual(config.get("currency_source"), "retailer.currency.code" if expected else None)

    def test_currency_context_cannot_override_mixed_or_invalid_row_currencies(self):
        frame, report, _ = self.import_sales()
        for values in (["CAD", "USD"], ["CAD", "not-a-currency"]):
            with self.subTest(values=values):
                frame["currency"] = values
                result = resolve_metric_recommendations(self.dataset(report), frame)
                self.assertNotIn("unit_price", recommended_columns(result))
                self.assertIn({"semanticKey": "unit_price", "reasonCode": "currency_unresolved_or_mixed"}, result["skipped"])

    def test_verified_currency_fills_missing_context_not_monetary_values(self):
        frame, report, _ = self.import_sales()
        frame["currency"] = ["CAD", None]
        self.assertEqual(set(get_effective_dataset_metric_columns(self.dataset(report), frame)), EXPECTED)
        frame["unit_price"] = None
        frame["line__pricing__price"] = None
        self.assertNotIn("unit_price", get_effective_dataset_metric_columns(self.dataset(report), frame))

    def test_zero_decimal_currency_does_not_change_provider_major_unit_amounts(self):
        frame, report, _ = self.import_sales(retailer={"data": {"currency": {"code": "JPY"}}})
        result = resolve_metric_recommendations(self.dataset(report), frame)
        price = next(entry for entry in result["recommended"] if entry["semanticKey"] == "unit_price")
        self.assertEqual(price["currency"], "JPY")
        self.assertEqual(price["multiplier"], 1)
        self.assertEqual(frame["unit_price"].tolist(), [10, 5])

    def test_unavailable_retailer_permissions_do_not_guess_a_currency(self):
        with self.assertRaisesRegex(connectors.ConnectorUnavailable, "retailer:read and payment_types:read"):
            self.import_sales(retailer_error=connectors.ConnectorUnavailable("HTTP 403"))

    def test_retailer_authentication_errors_keep_the_token_retry_signal(self):
        with self.assertRaises(connectors.ConnectorUnavailable) as raised:
            self.import_sales(retailer_error=connectors.ConnectorUnavailable("Connector request failed with HTTP 401"))
        self.assertTrue(connectors.connector_requires_reauthorization("lightspeed_x", raised.exception))

    def test_currency_lookup_is_reused_across_sale_pages(self):
        returned = deepcopy(NESTED_SALE)
        returned["id"] = "sale-2"
        returned["line_items"] = [deepcopy(returned["line_items"][0])]
        returned["line_items"][0]["id"] = "sale-2-line-1"
        connection = SimpleNamespace(connection_config=json.dumps({"domain_prefix": "test-store", "resource_types": ["sales"]}))

        def request(url, headers):
            if url.endswith("/retailer"):
                return {"data": {"currency": {"code": "CAD"}}}
            if "after=2" in url:
                return {"data": [], "version": {"max": 2}}
            if "after=1" in url:
                return {"data": [returned], "version": {"max": 2}}
            return {"data": [deepcopy(NESTED_SALE)], "version": {"max": 1}}

        with patch.object(connectors, "get_oauth_access_token", return_value="test-token"), patch.object(
            connectors, "connector_json_request", side_effect=request,
        ) as requested:
            frame, _ = connectors.load_lightspeed_x_dataframe(None, connection)
        self.assertEqual(frame["currency"].tolist(), ["CAD"] * 3)
        self.assertEqual(sum(call.args[0].endswith("/retailer") for call in requested.call_args_list), 1)

    def test_malformed_retailer_currency_is_rejected(self):
        for retailer in ({"data": []}, {"data": {}}, {"data": {"currency": "CAD"}},
                         {"data": {"currency": {"code": ""}}}, {"data": {"currency": {"code": "$"}}}):
            with self.subTest(retailer=retailer), self.assertRaisesRegex(connectors.ConnectorUnavailable, "valid retailer currency"):
                self.import_sales(retailer=retailer)

    def test_empty_sales_do_not_fetch_retailer_currency(self):
        frame, _, requested = self.import_sales([])
        self.assertTrue(frame.empty)
        self.assertEqual(requested.call_count, 1)

    def test_manual_selections_keep_the_previous_policy_and_opt_out(self):
        frame, report, _ = self.import_sales()
        for selected in ([], ["quantity"], ["unit_price"]):
            with self.subTest(selected=selected):
                item = self.dataset(report, selected_metric_columns=selected,
                                    metric_selection_provenance={"source": "user", "policy_version": "2026-10-16.1"})
                self.assertEqual(get_effective_dataset_metric_columns(item, frame), selected)
                self.assertEqual(resolve_metric_recommendations(item, frame, selection_policy=True)["policyVersion"], "2026-10-16.1")

    def test_empty_automatic_selection_refreshes_but_explicit_empty_does_not(self):
        frame, report, _ = self.import_sales()
        self.assertEqual(set(get_effective_dataset_metric_columns(self.dataset(report, selected_metric_columns=[]), frame)), EXPECTED)

    def test_legacy_manual_cost_selection_is_not_rewritten(self):
        frame, report, _ = self.import_sales()
        item = self.dataset(report, curated_metric_selection=False, selected_metric_columns=["line__pricing__cost"],
                            metric_selection_provenance={"source": "user"})
        self.assertEqual(get_effective_dataset_metric_columns(item, frame), ["line__pricing__cost"])

    def test_objective_changes_use_new_receipt_defaults_without_costs(self):
        frame, report, _ = self.import_sales()
        item = self.dataset(report)
        revenue = build_metric_selection_profile(item, frame, "increase_revenue")["recommended_metric_columns"]
        self.assertTrue({"quantity", "unit_price", "line_total", "total", "grand_total"} <= set(revenue))
        self.assertEqual(build_metric_selection_profile(item, frame, "reduce_expenses")["recommended_metric_columns"], [])

    def test_projection_keeps_only_reviewed_nested_receipt_amounts(self):
        frame, report, _ = self.import_sales()
        schema = {column: "DOUBLE" if pd.api.types.is_numeric_dtype(frame[column]) else "VARCHAR" for column in frame}
        projected = receipt_projection("lightspeed_x", report, schema)
        self.assertTrue(EXPECTED <= set(projected))
        self.assertNotIn("line__pricing__cost", projected)
        self.assertNotIn("line__pricing__loyalty_amount", projected)

    def test_legacy_indexed_nested_prices_repair_to_vertical_lines(self):
        frame = pd.DataFrame([{"sale_id": "sale-1", "currency": "CAD", "totals__price_incl_tax": 25.99,
                               "line_items__0__id": "line-1", "line_items__0__quantity": 2,
                               "line_items__0__pricing__price": 10, "line_items__0__pricing__total": 18,
                               "line_items__1__id": "line-2", "line_items__1__quantity": 1,
                               "line_items__1__pricing__price": 5, "line_items__1__pricing__total": 5}])
        repaired = connectors.normalize_connector_row_schema(frame, "lightspeed_x", "sales")
        self.assertEqual(repaired["line_total"].tolist(), [18, 5])
        self.assertEqual(repaired["totals__price_incl_tax"].notna().sum(), 1)
        self.assertIn("totals__price_incl_tax", get_effective_dataset_metric_columns(self.dataset(), repaired))

    def test_existing_repeated_nested_totals_are_counted_once_without_changing_source(self):
        frame, report, _ = self.import_sales()
        frame = frame.drop(columns=["total", "total_tax", "grand_total"])
        columns = ["totals__price", "totals__tax", "totals__price_incl_tax"]
        frame.loc[1, columns] = frame.loc[0, columns]
        original = frame.copy(deep=True)
        repaired = connectors.normalize_connector_row_schema(frame, "lightspeed_x", "sales")
        self.assertEqual(repaired["totals__price"].sum(), 23)
        self.assertEqual(repaired["totals__price_incl_tax"].sum(), 25.99)
        self.assertTrue(repaired.loc[1, columns].isna().all())
        self.assertIn("totals__price_incl_tax", get_effective_dataset_metric_columns(self.dataset(report), repaired))
        pd.testing.assert_frame_equal(frame, original)
        pd.testing.assert_frame_equal(connectors.normalize_connector_row_schema(repaired, "lightspeed_x", "sales"), repaired)

    def test_summary_rows_and_unidentified_sales_are_not_deduplicated(self):
        frame = pd.DataFrame({"sale_id": ["one", "one", None, None],
                              "sale_line_id": ["a", "b", "c", "d"],
                              "totals__price_incl_tax": [10, 20, 30, 40],
                              "__decisionate_summary__": [True, True, False, False]})
        result = connectors.normalize_connector_row_schema(frame, "lightspeed_x", "sales")
        pd.testing.assert_frame_equal(result, frame)

    def test_oauth_adds_currency_read_permissions_to_existing_scope_settings(self):
        with patch.dict(os.environ, {"LIGHTSPEED_X_OAUTH_SCOPES": "sales:read customers:read products:read"}):
            scopes = get_provider_scopes(OAUTH_PROVIDERS["lightspeed_x"])
        self.assertEqual(scopes, ("sales:read", "customers:read", "products:read", "retailer:read", "payment_types:read"))
