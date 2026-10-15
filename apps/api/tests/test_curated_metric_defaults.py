import asyncio
from contextlib import ExitStack
from dataclasses import replace
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch

import pandas as pd
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.models import Dataset, DatasetAnalysis
from app.modules.datasets import router
from app.modules.datasets.schemas import DatasetMetricSelectionUpdate
from app.modules.datasets.services.curated_metric_analytics import aggregate_curated_dataframe
from app.modules.datasets.services.metric_policy import (
    CONNECTOR_SCHEMA_VERSION, CURATED_SELECTION_KEY, POLICIES, POLICY_VERSION,
    SCHEMA_VERSION_KEY, SELECTION_PROVENANCE_KEY, validate_policies,
)
from app.modules.datasets.services.metric_recommendations import (
    config_for, initialize_curated_selection, metric_default_flags,
    recommended_columns, resolve_metric_recommendations,
)
from app.modules.datasets.services.metric_selection import (
    build_metric_selection_profile, filter_dataframe_to_selected_metrics,
    get_dataset_selected_metric_columns,
)
from app.modules.datasets.services.metrics import generate_metrics
from app.modules.forecasting.services import prepare_forecast_dataframe


FLAGS = {
    "CURATED_METRIC_DEFAULTS_BACKEND": "true",
    "CURATED_METRIC_DEFAULTS_UI": "true",
    "CURATED_METRIC_DEFAULTS_INTERNAL_USERS": "internal-user",
    "CURATED_METRIC_DEFAULTS_ROLLOUT": "internal",
    "CURATED_METRIC_DEFAULTS_NEW_DATASETS": "true",
    "CURATED_METRIC_DEFAULTS_EXISTING_PROMPT": "false",
    "CURATED_METRIC_DEFAULTS_DIAGNOSTICS": "false",
}


def dataset(source="google_search_console", resource="search_analytics", **config):
    if source in {"google_ads", "salesforce"}:
        config.setdefault("api_version", "v22" if source == "google_ads" else "v65.0")
    return SimpleNamespace(id=1, user_id="internal-user", workspace_id="workspace-1", source_type=source, source_config=json.dumps({"resource": resource, SCHEMA_VERSION_KEY: CONNECTOR_SCHEMA_VERSION, **config}))


def search_frame():
    return pd.DataFrame({"date": ["2026-10-01", "2026-10-02"], "clicks": [1, 30], "impressions": [10, 100], "ctr": [.1, .3], "position": [2, 4], "account_id": [123, 123], "unknown_numeric": [10, 20]})


class CuratedMetricDefaultTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict("os.environ", FLAGS)
        self.env.start()
        self.addCleanup(self.env.stop)

    def analytical_frame(self, item, frame, selection=None):
        initialize_curated_selection(item, frame)
        if selection is not None:
            config = config_for(item)
            config["selected_metric_columns"] = selection
            item.source_config = json.dumps(config)
        return filter_dataframe_to_selected_metrics(item, frame)

    def test_only_exact_verified_fields_are_recommended_even_in_one_row(self):
        frame = search_frame().iloc[:1].copy()
        frame["api_version"] = 7
        frame["postal_code"] = 12345
        frame["campaign_code"] = 123
        result = resolve_metric_recommendations(dataset(), frame)
        self.assertEqual([metric["columnKey"] for metric in result["recommended"]], ["clicks", "impressions"])
        self.assertEqual([metric["columnKey"] for metric in result["derived"]], ["ctr", "weighted_position"])
        self.assertNotIn("unknown_numeric", recommended_columns(result))

    def test_unknown_dataset_version_and_unversioned_schema_fail_closed(self):
        for item in (dataset(resource="future_report"), dataset(**{SCHEMA_VERSION_KEY: "v99"}), dataset(**{SCHEMA_VERSION_KEY: None}), dataset(source="csv", resource="upload")):
            with self.subTest(item=item.source_config):
                result = resolve_metric_recommendations(item, search_frame())
                self.assertEqual(recommended_columns(result), [])
                self.assertEqual(result["skipped"][0]["reasonCode"], "unknown_dataset_or_schema_version")

    def test_new_columns_are_not_selected_without_reviewed_emitted_fixture(self):
        item = dataset("google_analytics", "report", dimensions=["date"])
        result = resolve_metric_recommendations(item, pd.DataFrame({"date": ["2026-10-01"], "sessions": [2], "newUsers": [1]}))
        self.assertNotIn("newUsers", recommended_columns(result))
        self.assertIn({"semanticKey": "newUsers", "reasonCode": "field_fixture_review_pending"}, result["skipped"])

    def test_provider_api_upgrade_does_not_guess_compatibility(self):
        result = resolve_metric_recommendations(dataset("google_ads", "campaign_performance", api_version="v999"), pd.DataFrame({"clicks": [1], "impressions": [10]}))
        self.assertEqual(recommended_columns(result), [])
        self.assertEqual(result["skipped"][0]["reasonCode"], "unreviewed_provider_api_version")

    def test_saved_selection_is_not_changed_by_a_read_or_new_policy(self):
        item = dataset(selected_metric_columns=["unknown_numeric", "account_id", "clicks"])
        before = item.source_config
        resolve_metric_recommendations(item, search_frame())
        initialize_curated_selection(item, search_frame())
        self.assertEqual(item.source_config, before)
        self.assertEqual(get_dataset_selected_metric_columns(item), ["unknown_numeric", "account_id", "clicks"])

    def test_connector_resync_preserves_choices_and_policy_provenance(self):
        frame = search_frame()
        storage = MagicMock(is_remote=False)
        storage.is_directory_reference.return_value = True
        storage.put_directory.return_value = "/tmp/curated-test-partitions"
        stored = {
            "partition_dir": "/tmp/curated-test-partitions",
            "historical_partition_paths": [],
            "hot_row_count": len(frame),
            "historical_summary_row_count": 0,
            "date_column": "date",
            "hot_partition_count": 1,
            "historical_partition_count": 0,
            "column_count": len(frame.columns),
        }
        for selected in ([], ["position"]):
            with self.subTest(selected=selected):
                item = dataset()
                initialize_curated_selection(item, frame)
                config = config_for(item)
                config["selected_metric_columns"] = selected
                item.source_config = json.dumps(config)
                item.file_path = stored["partition_dir"]
                item.file_name = "search.parquet"
                item.storage_provider = None
                connection = SimpleNamespace(
                    id=7, user_id=item.user_id, workspace_id=item.workspace_id,
                    source_type=item.source_type, connection_config="{}",
                )
                with ExitStack() as stack:
                    for name, value in (
                        ("find_connector_dataset", item),
                        ("get_object_storage", storage),
                        ("load_connector_raw_dataframe", frame),
                        ("load_connector_summary_dataframe", pd.DataFrame()),
                        ("write_connector_monthly_partitions", stored),
                    ):
                        stack.enter_context(patch.object(router, name, return_value=value))
                    result, *_ = router.persist_connector_dataframe(
                        MagicMock(), connection, frame, {"resource": "search_analytics"},
                    )
                updated = config_for(result)
                self.assertEqual(updated["selected_metric_columns"], selected)
                for key in (SELECTION_PROVENANCE_KEY, SCHEMA_VERSION_KEY, CURATED_SELECTION_KEY):
                    self.assertEqual(updated[key], config[key])

    def test_new_dataset_persists_defaults_and_provenance_once(self):
        item = dataset()
        initialize_curated_selection(item, search_frame())
        config = config_for(item)
        self.assertEqual(config["selected_metric_columns"], ["clicks", "impressions", "ctr", "weighted_position"])
        evidence = config[SELECTION_PROVENANCE_KEY]
        self.assertEqual(evidence["source"], "recommended")
        self.assertEqual(evidence["selected_by"], "internal-user")
        self.assertEqual(evidence["policy_version"], POLICY_VERSION)
        self.assertTrue(evidence["selected_at"])
        config["selected_metric_columns"] = []
        item.source_config = json.dumps(config)
        before = item.source_config
        initialize_curated_selection(item, search_frame())
        self.assertEqual(item.source_config, before)
        self.assertEqual(generate_metrics(filter_dataframe_to_selected_metrics(item, search_frame())), [])

    def test_internal_rollout_does_not_enable_other_users(self):
        item = dataset()
        item.user_id = "a-real-customer"
        before = item.source_config
        initialize_curated_selection(item, search_frame())
        self.assertEqual(item.source_config, before)
        self.assertFalse(metric_default_flags(item)["backend"])

    def test_new_dataset_flag_off_leaves_selection_unmanaged(self):
        with patch.dict("os.environ", {"CURATED_METRIC_DEFAULTS_NEW_DATASETS": "false"}):
            item = dataset()
            initialize_curated_selection(item, search_frame())
            self.assertNotIn("selected_metric_columns", config_for(item))

    def test_feature_rollback_does_not_remove_saved_selection_or_provenance(self):
        item = dataset()
        self.analytical_frame(item, search_frame())
        before = item.source_config
        with patch.dict("os.environ", {"CURATED_METRIC_DEFAULTS_BACKEND": "false"}):
            build_metric_selection_profile(item, search_frame())
            filter_dataframe_to_selected_metrics(item, search_frame())
        self.assertEqual(item.source_config, before)

    def test_unavailable_saved_policy_never_silently_changes_semantics(self):
        item = dataset()
        initialize_curated_selection(item, search_frame())
        config = config_for(item)
        config[SELECTION_PROVENANCE_KEY]["policy_version"] = "a-future-or-removed-policy"
        item.source_config = json.dumps(config)
        before = item.source_config
        self.assertEqual(generate_metrics(filter_dataframe_to_selected_metrics(item, search_frame())), [])
        self.assertEqual(item.source_config, before)

    def test_derived_ratios_and_position_recompute_after_aggregation(self):
        frame = self.analytical_frame(dataset(), search_frame())
        self.assertNotIn("unknown_numeric", frame.columns)
        result = {metric["column"]: metric["total"] for metric in generate_metrics(frame)}
        self.assertAlmostEqual(result["ctr"], 31 / 110)
        self.assertAlmostEqual(result["weighted_position"], 420 / 110)
        monthly = prepare_forecast_dataframe(frame, "date", aggregation="monthly", aggregation_type="sum")
        self.assertAlmostEqual(monthly.iloc[0]["ctr"], 31 / 110)
        self.assertAlmostEqual(monthly.iloc[0]["weighted_position"], 420 / 110)
        self.assertAlmostEqual({m["column"]: m["total"] for m in generate_metrics(monthly)}["ctr"], 31 / 110)

    def test_weighted_position_can_be_selected_without_summing_positions(self):
        frame = self.analytical_frame(dataset(), search_frame(), ["position"])
        self.assertAlmostEqual(generate_metrics(frame)[0]["total"], 420 / 110)
        monthly = aggregate_curated_dataframe(frame, "date", "monthly")
        self.assertAlmostEqual(generate_metrics(monthly)[0]["total"], 420 / 110)

    def test_zero_denominator_returns_null(self):
        frame = search_frame()
        frame["impressions"] = 0
        frame = self.analytical_frame(dataset(), frame)
        metrics = {metric["column"]: metric for metric in generate_metrics(frame)}
        self.assertIsNone(metrics["ctr"]["total"])
        self.assertIsNone(metrics["weighted_position"]["total"])

    def test_missing_components_do_not_produce_derived_metrics(self):
        result = resolve_metric_recommendations(dataset(), search_frame().drop(columns=["impressions"]))
        self.assertEqual(result["derived"], [])

    def test_historical_summaries_allow_ctr_but_not_guessed_weighted_positions(self):
        raw = search_frame().iloc[:1].copy()
        raw["__decisionate_summary__"] = True
        for key, total in (("clicks", 31), ("impressions", 110)):
            raw[key] = total
            raw[f"{key}__sum"] = total
            raw[f"{key}__count"] = 2
        item = dataset()
        result = resolve_metric_recommendations(item, raw)
        self.assertEqual([entry["columnKey"] for entry in result["derived"]], ["ctr"])
        frame = self.analytical_frame(item, raw)
        self.assertAlmostEqual({m["column"]: m["total"] for m in generate_metrics(frame)}["ctr"], 31 / 110)

    def test_ambiguous_and_mixed_currencies_are_not_recommended(self):
        for currencies in (["CAD", "USD"], ["CAD", None], ["FOO", "FOO"]):
            frame = pd.DataFrame({"quantity": [1, 2], "line_total": [5, 10], "currency": currencies})
            result = resolve_metric_recommendations(dataset("shopify", "orders"), frame)
            self.assertEqual([entry["columnKey"] for entry in result["recommended"]], ["quantity"])
            self.assertIn({"semanticKey": "line_total", "reasonCode": "currency_unresolved_or_mixed"}, result["skipped"])

    def test_unknown_and_malformed_numeric_values_are_not_recommended(self):
        for values in (["not-a-number", "3"], [float("inf"), 3], [True, False], [None, None]):
            frame = pd.DataFrame({"clicks": values, "impressions": [10, 20]})
            result = resolve_metric_recommendations(dataset(), frame)
            self.assertNotIn("clicks", [entry["columnKey"] for entry in result["recommended"]])

    def test_stripe_currency_minor_units_are_specific_and_idempotent(self):
        for currency, amount, expected in (("usd", 1234, 12.34), ("jpy", 1234, 1234), ("kwd", 1234, 1.234)):
            item = dataset("stripe", "charges")
            raw = pd.DataFrame({"amount": [amount], "amount_major": [amount / 100], "amount_refunded": [100], "currency": [currency], "paid": [True], "status": ["succeeded"]})
            frame = self.analytical_frame(item, raw)
            result = {m["column"]: m["total"] for m in generate_metrics(frame)}
            self.assertAlmostEqual(result["amount"], expected)
            # The old connector fixtures do not certify the refund field yet.
            self.assertNotIn("amount_refunded", result)
            self.assertNotIn("amount_major", result)
            self.assertEqual(generate_metrics(filter_dataframe_to_selected_metrics(item, frame)), generate_metrics(frame))
            self.assertEqual(raw.iloc[0]["amount"], amount)

    def test_reversal_normalization_is_negative_and_does_not_flip_existing_negatives(self):
        from app.modules.datasets.services.curated_metric_analytics import prepare_curated_dataframe
        entry = {"columnKey": "refund", "semanticKey": "refund", "reason": "Refund", "unit": "currency", "aggregation": "SUM", "multiplier": .01, "sign": -1}
        recommendations = {"recommended": [entry], "optional": [], "derived": [], "policyVersion": POLICY_VERSION}
        raw = pd.DataFrame({"refund": [100, -200]})
        frame = prepare_curated_dataframe(raw, recommendations, ["refund"])
        self.assertEqual(frame["refund"].tolist(), [-1, -2])
        self.assertEqual(raw["refund"].tolist(), [100, -200])

    def test_google_ads_cost_is_not_converted_twice(self):
        item = dataset("google_ads", "campaign_performance")
        raw = pd.DataFrame({"cost": [2.5, 7.5], "cost_micros": [2500000, 7500000], "currency": ["USD", "USD"], "clicks": [1, 3], "impressions": [10, 30], "conversions": [1, 2], "conversions_value": [8, 12]})
        metrics = {m["column"]: m["total"] for m in generate_metrics(self.analytical_frame(item, raw))}
        self.assertEqual(metrics["cost"], 10)
        self.assertEqual(metrics["cpc"], 2.5)
        self.assertEqual(metrics["roas"], 2)
        self.assertNotIn("cost_micros", metrics)

    def test_unfiltered_failed_charges_and_canceled_square_orders_are_skipped(self):
        stripe = pd.DataFrame({"amount": [1000], "currency": ["USD"], "status": ["failed"], "paid": [False]})
        square = pd.DataFrame({"line_total": [10], "quantity": [1], "currency": ["USD"], "state": ["CANCELED"]})
        self.assertEqual(recommended_columns(resolve_metric_recommendations(dataset("stripe", "charges"), stripe)), [])
        self.assertNotIn("line_total", recommended_columns(resolve_metric_recommendations(dataset("square", "orders"), square)))

    def test_order_header_and_lines_are_not_recommended_together(self):
        item = dataset("shopify", "orders")
        raw = pd.DataFrame({"order_id": [1, 1], "quantity": [1, 2], "line_total": [10, 20], "total_price": [30, None], "currency": ["CAD", "CAD"], "unit_price": [10, 10]})
        result = resolve_metric_recommendations(item, raw)
        self.assertEqual([entry["columnKey"] for entry in result["recommended"]], ["quantity", "line_total"])
        metrics = {m["column"]: m["total"] for m in generate_metrics(self.analytical_frame(item, raw))}
        self.assertEqual(metrics["line_total"], 30)
        self.assertEqual(metrics["quantity"], 3)
        self.assertNotIn("total_price", metrics)

    def test_optional_unit_prices_use_average_not_sum(self):
        item = dataset("shopify", "orders")
        raw = pd.DataFrame({"date": ["2026-10-01", "2026-10-02"], "unit_price": [10, 20], "currency": ["CAD", "CAD"]})
        frame = self.analytical_frame(item, raw, ["unit_price"])
        self.assertEqual(generate_metrics(frame)[0]["total"], 15)
        self.assertEqual(generate_metrics(aggregate_curated_dataframe(frame, "date", "monthly"))[0]["total"], 15)

    def test_ga4_unique_users_are_not_summed_across_dates(self):
        item = dataset("google_analytics", "report", dimensions=["date"])
        raw = pd.DataFrame({"date": ["2026-10-01", "2026-10-02"], "activeUsers": [5, 5], "sessions": [8, 9], "totalRevenue": [10, 20]})
        result = resolve_metric_recommendations(item, raw)
        self.assertEqual([entry["columnKey"] for entry in result["recommended"]], ["sessions"])
        self.assertNotIn("activeUsers", recommended_columns(result))

    def test_entity_record_counts_never_use_numeric_ids_as_measures(self):
        item = dataset("hubspot", "deals")
        raw = pd.DataFrame({"date": ["2026-10-01", "2026-11-01", "2026-11-02"], "record_id": [100, 100, 200], "amount": [10, 10, 20], "annual_revenue": [999, 999, 500]})
        frame = self.analytical_frame(item, raw)
        self.assertEqual(generate_metrics(frame)[0]["total"], 2)
        self.assertEqual(generate_metrics(aggregate_curated_dataframe(frame, "date", "monthly"))[0]["total"], 2)

    def test_skip_diagnostics_do_not_include_values(self):
        frame = pd.DataFrame({"clicks": ["secret-token"], "impressions": [5]})
        with self.assertLogs("app.modules.datasets.services.metric_recommendations", level="INFO") as logs:
            resolve_metric_recommendations(dataset(), frame, diagnostics=True)
        self.assertNotIn("secret-token", " ".join(logs.output))
        self.assertIn("incompatible_logical_type", [record.reason_code for record in logs.records])

    def test_missing_saved_fields_are_reported_without_mutation(self):
        item = dataset(selected_metric_columns=["clicks", "removed_field"])
        before = item.source_config
        result = resolve_metric_recommendations(item, search_frame())
        self.assertEqual(result["missingSelectedColumns"], ["removed_field"])
        self.assertEqual(item.source_config, before)

    def test_policy_validation_rejects_missing_evidence_and_unsafe_aggregations(self):
        base = POLICIES[0]
        with self.assertRaises(ValueError):
            validate_policies([replace(base, evidence_url="")])
        with self.assertRaises(ValueError):
            validate_policies([replace(base, metrics=(replace(base.metrics[0], unit="inventory"),))])
        with self.assertRaises(ValueError):
            validate_policies([base, base])

    def test_golden_schema_inventory_contains_each_implemented_core_field(self):
        inventory = json.loads((Path(__file__).parent / "fixtures/metric_schema_inventory.json").read_text())
        emitted = {}
        for schema in inventory["schemas"]:
            metadata = schema["metadata"]
            connector = metadata.get("connector") or ("google_analytics" if schema["loader"] == "load_google_analytics_report" else "")
            resource = metadata.get("resource") or metadata.get("resource_type") or metadata.get("object_type") or "report"
            emitted.setdefault((connector, resource), set()).update(schema["columns"])
        # Missing fields must be documented as unresolved, never invented.
        for policy in POLICIES:
            actual = emitted.get((policy.connector_key, policy.dataset_key), set())
            for entry in policy.metrics:
                if any(path in actual for path in entry.source_paths):
                    self.assertTrue(policy.fixture)
                    self.assertTrue(policy.evidence_url.startswith("https://"))
                else:
                    self.assertEqual(recommended_columns(resolve_metric_recommendations(dataset(policy.connector_key, policy.dataset_key), pd.DataFrame({"unverified": [1]}))), [])

    def test_runtime_schema_evidence_is_generated_from_connector_contract_inventory(self):
        from scripts.export_metric_schema_inventory import compact_inventory
        from app.modules.datasets.services.metric_policy import POLICY_SCHEMAS
        inventory = json.loads((Path(__file__).parent / "fixtures/metric_schema_inventory.json").read_text())
        self.assertEqual(POLICY_SCHEMAS, compact_inventory(inventory["schemas"]))

    def test_browser_chart_payload_includes_policy_and_hides_internal_member_state(self):
        from app.modules.datasets.services.charts import generate_chart_data
        frame = self.analytical_frame(dataset(), search_frame())
        chart = generate_chart_data(aggregate_curated_dataframe(frame, "date", "monthly"))
        row = chart["data"][0]
        self.assertEqual(json.loads(row["__decisionate_metric_policy__"])["ctr"]["operation"], "ratio")
        self.assertFalse(any(key.startswith("__curated_") for key in row))

    def test_chart_preserves_valid_weights_when_position_is_missing(self):
        from app.modules.datasets.services.charts import generate_chart_data
        raw = search_frame()
        raw.loc[1, "position"] = None
        frame = self.analytical_frame(dataset(), raw)
        grouped = aggregate_curated_dataframe(frame, "date", "monthly")
        row = generate_chart_data(grouped)["data"][0]
        self.assertEqual(row["__decisionate_metric_weighted_sum__weighted_position"], 20)
        self.assertEqual(row["__decisionate_metric_weight__weighted_position"], 10)
        self.assertEqual(row["impressions"], 110)

    def test_multi_metric_analysis_and_relationships_use_weighted_rates(self):
        from app.modules.datasets.services.multi_metric_analysis import _aggregate_metric, _build_metric_frame, _metric_summary
        from app.modules.datasets.services.relationships import _build_metric_series
        item = dataset()
        item.file_name = "Search performance"
        frame = self.analytical_frame(item, search_frame())
        selection = {"dataset_id": 1, "date_column": "date", "metric_column": "ctr", "aggregation": "sum"}
        prepared = _build_metric_frame(item, frame, selection, "monthly", 2026)
        grouped = _aggregate_metric(prepared, "sum")
        self.assertAlmostEqual(grouped.iloc[0]["value"], 31 / 110)
        self.assertAlmostEqual(_metric_summary(item, selection, grouped)["total"], 31 / 110)
        relationship = _build_metric_series(item, frame, selection, "monthly", "sum", 2026)
        self.assertAlmostEqual(relationship.iloc[0]["value"], 31 / 110)


class MetricRecommendationApiTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict("os.environ", FLAGS)
        self.env.start()
        self.addCleanup(self.env.stop)
        self.engine = create_engine("sqlite:///:memory:")
        Dataset.__table__.create(self.engine)
        DatasetAnalysis.__table__.create(self.engine)
        self.Session = sessionmaker(bind=self.engine)
        self.addCleanup(self.engine.dispose)
        item = dataset()
        with self.Session() as db:
            db.add(Dataset(id=1, user_id=item.user_id, workspace_id=item.workspace_id, source_type=item.source_type, source_config=item.source_config, file_name="search.parquet", file_path="unused", row_count=2, column_count=7))
            db.commit()
        for target, replacement in (("SessionLocal", self.Session), ("get_user_id", lambda request: "internal-user"), ("get_workspace_id", lambda request, user: "workspace-1"), ("require_workspace_data_manager", lambda request: None), ("load_dataframe_from_dataset", lambda item, *args: search_frame())):
            patcher = patch.object(router, target, replacement)
            patcher.start()
            self.addCleanup(patcher.stop)

    def save(self, columns=(), **kwargs):
        return asyncio.run(router.update_dataset_metric_selection(SimpleNamespace(), 1, DatasetMetricSelectionUpdate(selected_metric_columns=list(columns), use_curated_recommendations=True, policy_version=POLICY_VERSION, **kwargs)))

    def test_read_endpoint_preserves_existing_source_config(self):
        with self.Session() as db:
            before = db.get(Dataset, 1).source_config
        result = asyncio.run(router.dataset_metric_recommendations(SimpleNamespace(), 1))
        self.assertEqual(recommended_columns(result), ["clicks", "impressions", "ctr", "weighted_position"])
        with self.Session() as db:
            self.assertEqual(db.get(Dataset, 1).source_config, before)

    def test_manual_deselection_optional_selection_and_empty_list_survive_reloads(self):
        for columns in (["clicks", "position"], ["impressions"], []):
            self.save(columns)
            with self.Session() as db:
                saved = config_for(db.get(Dataset, 1))
                self.assertEqual(saved["selected_metric_columns"], columns)
                self.assertEqual(saved[SELECTION_PROVENANCE_KEY]["source"], "user")
                self.assertEqual(saved[SELECTION_PROVENANCE_KEY]["selected_by"], "internal-user")

    def test_only_explicit_restore_reapplies_recommendations(self):
        self.save([])
        self.save(select_recommended_metric_columns=True)
        with self.Session() as db:
            config = config_for(db.get(Dataset, 1))
            self.assertEqual(config["selected_metric_columns"], ["clicks", "impressions", "ctr", "weighted_position"])
            self.assertEqual(config[SELECTION_PROVENANCE_KEY]["source"], "recommended")

    def test_unknown_metric_cannot_be_saved_as_a_curated_metric(self):
        with self.assertRaises(HTTPException) as caught:
            self.save(["account_id"])
        self.assertEqual(caught.exception.status_code, 400)

    def test_stale_policy_is_rejected_without_changing_selection(self):
        with self.assertRaises(HTTPException) as caught:
            asyncio.run(router.update_dataset_metric_selection(SimpleNamespace(), 1, DatasetMetricSelectionUpdate(selected_metric_columns=["clicks"], use_curated_recommendations=True, policy_version="old")))
        self.assertEqual(caught.exception.status_code, 400)
        with self.Session() as db:
            self.assertNotIn("selected_metric_columns", config_for(db.get(Dataset, 1)))

    def test_another_workspace_cannot_read_schema_or_edit_selection(self):
        with patch.object(router, "get_workspace_id", return_value="another-tenant"), patch.object(router, "load_dataframe_from_dataset") as load:
            for action in (lambda: asyncio.run(router.dataset_metric_recommendations(SimpleNamespace(), 1)), lambda: self.save(["clicks"])):
                with self.assertRaises(HTTPException) as caught:
                    action()
                self.assertEqual(caught.exception.status_code, 403)
            load.assert_not_called()

    def test_disabled_backend_hides_recommendations(self):
        with patch.dict("os.environ", {"CURATED_METRIC_DEFAULTS_BACKEND": "false"}):
            with self.assertRaises(HTTPException) as caught:
                asyncio.run(router.dataset_metric_recommendations(SimpleNamespace(), 1))
            self.assertEqual(caught.exception.status_code, 404)

    def test_legacy_client_can_save_during_rollback(self):
        self.save(["clicks"])
        with patch.dict("os.environ", {"CURATED_METRIC_DEFAULTS_BACKEND": "false"}):
            asyncio.run(router.update_dataset_metric_selection(SimpleNamespace(), 1, DatasetMetricSelectionUpdate(selected_metric_columns=["unknown_numeric"])))
        with self.Session() as db:
            config = config_for(db.get(Dataset, 1))
            self.assertEqual(config["selected_metric_columns"], ["unknown_numeric"])
            self.assertFalse(config[CURATED_SELECTION_KEY])


if __name__ == "__main__":
    unittest.main()
