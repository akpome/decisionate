import json
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import pandas as pd

from app.modules.datasets import router
from app.modules.datasets.services import connectors, sources
from app.modules.datasets.services.connector_schema import connector_schema_needs_repair, normalize_connector_row_schema
from app.modules.datasets.services.metric_selection import build_metric_selection_profile, get_effective_dataset_metric_columns
from app.modules.datasets.services.metric_policy import CONNECTOR_SCHEMA_VERSION, METRIC_POLICIES, POLICY_SCHEMAS
from app.modules.datasets.services.metric_recommendations import resolve_metric_recommendations
from app.modules.datasets.services.receipt_metrics import (
    RECEIPT_CONNECTOR_POLICIES, RECEIPT_SOURCE_CATEGORIES,
    receipt_document_columns, receipt_metric_columns, receipt_projection,
    register_receipt_connector,
)


def dataset(source, resource, **config):
    return SimpleNamespace(source_type=source, source_config=json.dumps({"resource": resource, **config}))


class ReceiptConnectorContractTests(unittest.TestCase):
    def setUp(self):
        self.registry = patch.dict(RECEIPT_CONNECTOR_POLICIES)
        self.registry.start()
        self.addCleanup(self.registry.stop)

    def register_future_connector(self):
        register_receipt_connector(
            "future_receipts", default_resource="receipts",
            resources={"receipts": (("quantity",), ("unit_price", "charged_each"), ("line_total",), ("charged",))},
            item_resources=("receipts",), line_roots=("entries",),
            document_fields={"receipts": ("charged",)},
            evidence_urls=("https://example.test/reviewed-receipt-contract",),
        )

    def test_every_current_financial_catalog_entry_has_a_receipt_contract(self):
        financial = {entry["type"] for entry in sources.DATASET_SOURCES if entry["category"] in RECEIPT_SOURCE_CATEGORIES}
        self.assertEqual(financial, set(RECEIPT_CONNECTOR_POLICIES))
        self.assertTrue(all(policy.evidence_urls for policy in RECEIPT_CONNECTOR_POLICIES.values()))

    def test_adapter_item_resources_and_shared_contract_do_not_drift(self):
        for source, resources in (
            ("quickbooks", connectors.QUICKBOOKS_LINE_ITEM_RESOURCES),
            ("freshbooks", connectors.FRESHBOOKS_LINE_ITEM_RESOURCES),
            ("sage", connectors.SAGE_LINE_ITEM_RESOURCES),
            ("xero", connectors.XERO_LINE_ITEM_RESOURCES),
            ("zoho_books", connectors.ZOHO_BOOKS_LINE_ITEM_RESOURCES),
        ):
            with self.subTest(source=source):
                self.assertEqual(set(RECEIPT_CONNECTOR_POLICIES[source].item_resources), set(resources))

    def test_all_reviewed_receipt_fields_remain_defaults_on_long_documents(self):
        for source, policy in RECEIPT_CONNECTOR_POLICIES.items():
            for resource, groups in policy.resources.items():
                with self.subTest(source=source, resource=resource):
                    headers = set(receipt_document_columns(source, {"resource": resource}))
                    frame = pd.DataFrame({group[0]: [10] + [None] * 19 if group[0] in headers else [2] * 20 for group in groups})
                    frame["internal_noise"] = range(20)
                    profile = build_metric_selection_profile(dataset(source, resource), frame)
                    self.assertEqual(set(profile["recommended_metric_columns"]), {group[0] for group in groups})

    def test_every_reviewed_alias_can_replace_a_missing_or_invalid_primary(self):
        for source, policy in RECEIPT_CONNECTOR_POLICIES.items():
            for resource, groups in policy.resources.items():
                for group in groups:
                    for alias in group[1:]:
                        with self.subTest(source=source, resource=resource, alias=alias):
                            frame = pd.DataFrame({group[0]: [None, "not numeric"], alias: [0, -10]})
                            self.assertEqual(build_metric_selection_profile(dataset(source, resource), frame)["recommended_metric_columns"], [alias])
                            projection = receipt_projection(source, {"resource": resource}, {group[0]: "DOUBLE", alias: "DOUBLE", "internal_noise": "DOUBLE"})
                            if projection is None:
                                self.assertTrue(connector_schema_needs_repair(frame.columns, source))
                            else:
                                self.assertEqual(set(projection), {group[0], alias})

    def test_every_connector_keeps_each_document_amount_on_one_item_only(self):
        for source, policy in RECEIPT_CONNECTOR_POLICIES.items():
            for resource, columns in policy.document_fields.items():
                with self.subTest(source=source, resource=resource):
                    parent = {**{column: 12 for column in columns}, "currency": "CAD", "record_id": "one"}
                    first = connectors._parent_values_for_item_row(parent, 0, source, resource)
                    second = connectors._parent_values_for_item_row(parent, 1, source, resource)
                    self.assertEqual(first, parent)
                    self.assertTrue(all(second[column] is None for column in columns))
                    self.assertEqual(second["currency"], "CAD")
                    self.assertEqual(second["record_id"], "one")

    def test_curated_policies_share_reviewed_alias_fallbacks_without_guessing_new_schema(self):
        exercised = set()
        for (source, resource, version), policy in METRIC_POLICIES.items():
            receipt = RECEIPT_CONNECTOR_POLICIES.get(source)
            if receipt is None:
                continue
            schema = POLICY_SCHEMAS.get(f"{source}/{resource}/{version}", {})
            for entry in policy.metrics:
                for group in receipt.resources.get(resource, ()):
                    if not set(group) & set(entry.source_paths):
                        continue
                    for alias in group[1:]:
                        if alias not in schema.get("columns", ()):
                            continue
                        with self.subTest(source=source, resource=resource, alias=alias):
                            frame = pd.DataFrame({"currency": ["CAD", "CAD"], "state": ["COMPLETED"] * 2,
                                                  **{path: [None, None] for path in entry.source_paths}, alias: [0, -10]})
                            versions = schema.get("api_versions") or [None]
                            item = dataset(source, resource, connector_schema_version=CONNECTOR_SCHEMA_VERSION, api_version=versions[0])
                            result = resolve_metric_recommendations(item, frame)
                            self.assertIn(alias, {descriptor["columnKey"] for category in ("recommended", "optional") for descriptor in result[category]})
                            exercised.add(source)
        self.assertTrue({"quickbooks", "xero", "shopify", "woocommerce"} <= exercised)

    def test_manual_choices_and_opt_outs_remain_unchanged_for_every_connector(self):
        frame = pd.DataFrame({"quantity": [2], "internal_cost": [9]})
        for source, policy in RECEIPT_CONNECTOR_POLICIES.items():
            for selected in ([], ["quantity"], ["internal_cost"]):
                item = dataset(source, policy.default_resource, selected_metric_columns=selected, metric_selection_provenance={"source": "user"})
                with self.subTest(source=source, selected=selected):
                    self.assertEqual(get_effective_dataset_metric_columns(item, frame), selected)

    def test_new_financial_catalog_entries_fail_closed_until_fields_are_reviewed(self):
        catalog = sources.DATASET_SOURCES + [{"type": "unreviewed_finance", "category": "accounting"}]
        with patch.object(sources, "DATASET_SOURCES", catalog):
            item = dataset("unreviewed_finance", "receipts", receipt_metric_columns=["internal_cost"])
            frame = pd.DataFrame({"quantity": [2], "total": [10], "internal_cost": [9]})
            self.assertEqual(get_effective_dataset_metric_columns(item, frame), [])
            self.assertEqual(receipt_projection(item.source_type, {"resource": "receipts"}, {column: "DOUBLE" for column in frame}), [])
            item.source_config = json.dumps({"resource": "receipts", "selected_metric_columns": ["total"], "metric_selection_provenance": {"source": "user"}})
            self.assertEqual(get_effective_dataset_metric_columns(item, frame), ["total"])

    def test_nonfinancial_connectors_keep_their_domain_defaults(self):
        frame = pd.DataFrame({"clicks": [2], "impressions": [10]})
        financial = set(RECEIPT_CONNECTOR_POLICIES)
        for source in sources.IMPLEMENTED_CONNECTOR_TYPES - financial:
            with self.subTest(source=source):
                self.assertIsNone(receipt_metric_columns(source, {}, frame))
                self.assertEqual(set(get_effective_dataset_metric_columns(dataset(source, "report"), frame)), set(frame))

    def test_future_registered_connector_uses_the_same_alias_and_objective_rules(self):
        self.register_future_connector()
        frame = pd.DataFrame({"unit_price": [None], "charged_each": [10], "internal_cost": [4]})
        item = dataset("future_receipts", "receipts")
        self.assertEqual(get_effective_dataset_metric_columns(item, frame), ["charged_each"])
        self.assertEqual(build_metric_selection_profile(item, frame, "increase_revenue")["recommended_metric_columns"], ["charged_each"])
        self.assertEqual(build_metric_selection_profile(item, frame, "reduce_expenses")["recommended_metric_columns"], [])

    def test_future_registered_connector_repairs_vertical_items_and_preserves_totals(self):
        self.register_future_connector()
        frame = pd.DataFrame([{"record_id": "receipt-1", "charged": 30,
                               "entries__0__id": "one", "entries__0__quantity": 1,
                               "entries__1__id": "two", "entries__1__quantity": 2}])
        result = normalize_connector_row_schema(frame, "future_receipts", "receipts")
        self.assertEqual(result["quantity"].tolist(), [1, 2])
        self.assertEqual(result["charged"].sum(), 30)
        self.assertFalse(any("entries__" in column for column in result))
        self.assertIsNone(receipt_projection("future_receipts", {"resource": "receipts"}, {column: "DOUBLE" for column in frame}))

    def test_new_contracts_require_evidence_and_unambiguous_resource_aliases(self):
        for overrides in (
            {"evidence_urls": ()}, {"evidence_urls": ("http://example.test",)},
            {"resources": {"receipts": (("total",), ("total",))}},
            {"resources": {"receipts": ((),)}},
            {"default_resource": "unknown"},
            {"document_fields": {"receipts": ("unreviewed",)}},
            {"item_resources": ("receipts",)},
        ):
            args = {"resources": {"receipts": (("total",),)}, "evidence_urls": ("https://example.test/evidence",), **overrides}
            with self.subTest(overrides=overrides), self.assertRaises(ValueError):
                register_receipt_connector("invalid", **args)

    def test_registered_contracts_cannot_be_mutated_after_review(self):
        self.register_future_connector()
        with self.assertRaises(TypeError):
            RECEIPT_CONNECTOR_POLICIES["future_receipts"].resources["receipts"] = (("internal_cost",),)

    def test_complete_document_replacement_is_shared_by_current_and_future_connectors(self):
        self.register_future_connector()
        for source, policy in RECEIPT_CONNECTOR_POLICIES.items():
            if not policy.item_resources:
                continue
            with self.subTest(source=source):
                old = pd.DataFrame({"record_id": ["updated", "updated", "untouched"], "line_item_id": ["summary", "removed", "other"], "total": [30, None, 5]})
                incoming = pd.DataFrame({"record_id": ["updated"], "line_item_id": ["new"], "total": [20]})
                for frame in (old, incoming):
                    frame["sale_id"] = frame["record_id"]
                    frame["sale_line_id"] = frame["line_item_id"]
                report = {"resource": policy.item_resources[0], "complete_document_items": True, "line_item_key": "line_item_id", "line_item_parent_keys": ["record_id"], "dedup_keys": ["line_item_id"]}
                result = router.merge_connector_dataframes(old, incoming, source, report)
                self.assertEqual(set(result["line_item_id"]), {"new", "other"})
                self.assertEqual(result["total"].sum(), 25)

    def test_document_replacement_uses_the_full_composite_parent_identity(self):
        old = pd.DataFrame({"tenant_id": ["a", "b"], "record_id": ["one", "one"], "line_item_id": ["a-old", "b-old"]})
        new = pd.DataFrame({"tenant_id": ["a"], "record_id": ["one"], "line_item_id": ["a-new"]})
        report = {"complete_document_items": True, "line_item_key": "line_item_id", "line_item_parent_keys": ["tenant_id", "record_id"], "dedup_keys": ["line_item_id"]}
        result = router.merge_connector_dataframes(old, new, "future_receipts", report)
        self.assertEqual(set(result["line_item_id"]), {"a-new", "b-old"})

    def test_partial_responses_and_missing_parent_ids_do_not_remove_previous_items(self):
        old = pd.DataFrame({"record_id": ["one"], "line_item_id": ["old"]})
        for complete, parent in ((False, "one"), (None, "one"), (True, None), (True, "")):
            new = pd.DataFrame({"record_id": [parent], "line_item_id": ["new"]})
            report = {"complete_document_items": complete, "line_item_key": "line_item_id", "line_item_parent_keys": ["record_id"], "dedup_keys": ["line_item_id"]}
            with self.subTest(complete=complete, parent=parent):
                result = router.merge_connector_dataframes(old, new, "future_receipts", report)
                self.assertIn("old", set(result["line_item_id"]))

    def test_summary_and_malformed_collections_cannot_claim_to_be_complete(self):
        for collection, expected in ((None, False), ("summary", False), ([None], False), ([], True), ([{"quantity": 1}], True), ({"count": 2}, False), ({"nodes": [{"quantity": 1}]}, True)):
            with self.subTest(collection=collection):
                self.assertEqual(connectors.connector_has_item_collection({"lines": collection}, "lines"), expected)

    def test_incomplete_line_identity_metadata_cannot_replace_saved_documents(self):
        old = pd.DataFrame({"record_id": ["one"], "line_item_id": ["old"]})
        for new in (pd.DataFrame({"record_id": ["one"]}), pd.DataFrame({"record_id": ["one"], "line_item_id": [None]})):
            report = {"complete_document_items": True, "line_item_key": "line_item_id", "line_item_parent_keys": ["record_id"], "dedup_keys": ["line_item_id"]}
            result = router.merge_connector_dataframes(old, new, "future_receipts", report)
            self.assertIn("old", set(result["line_item_id"]))


if __name__ == "__main__":
    unittest.main()
