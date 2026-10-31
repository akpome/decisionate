import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pandas as pd
from fastapi import HTTPException

from app.modules.correlation.catalog import metric_catalog, prepare_series
from app.modules.datasets.services.curated_metric_analytics import aggregate_curated_dataframe, aggregate_metric
from app.modules.datasets.services.dataset_loader import load_dataframe_from_dataset
from app.modules.datasets.services.entity_history import build_linked_entity_history, summarize_linked_entities
from app.modules.datasets.services.entity_resolution import build_entity_resolution
from app.modules.datasets.services.entity_resolution import _row_candidates
from app.modules.datasets.services.metric_policy import FRAME_POLICY_KEY
from app.modules.datasets.services.metric_selection import filter_dataframe_to_selected_metrics


def dataset(identifier, config=None):
    return SimpleNamespace(id=identifier, file_name=f"source-{identifier}.csv", source_type="csv", source_config=json.dumps(config or {}))


class EntityHistoryTests(unittest.TestCase):
    def test_identity_scan_preserves_large_integer_ids_without_reading_metrics(self):
        identity = 9007199254740993
        frame = pd.DataFrame({"customer_id": [identity, identity + 1], "revenue": [1.5, 2.5]})
        with patch.object(pd.DataFrame, "iterrows", side_effect=AssertionError("Full rows should not be scanned")):
            rows, unmatched = _row_candidates(frame, "customer")
        self.assertEqual([row["primary"]["value"] for row in rows], [str(identity), str(identity + 1)])
        self.assertEqual(unmatched, [])

    def test_no_identity_columns_keeps_all_unmatched_row_positions(self):
        rows, unmatched = _row_candidates(pd.DataFrame({"revenue": [1, 2, 3]}), "customer")
        self.assertEqual(rows, [])
        self.assertEqual(unmatched, [{"row_number": 0}, {"row_number": 1}, {"row_number": 2}])

    def frames(self):
        return [(dataset(1), pd.DataFrame({"email": ["a@b.com", "a@b.com", None],
                                         "date": ["2025-01-01", "2025-01-02", "2025-01-03"],
                                         "revenue": [10., 20., 30.], "region": ["East"] * 3})),
                (dataset(2), pd.DataFrame({"email": ["A@b.com", "A@b.com"],
                                         "date": ["2025-01-01", "2025-01-03"], "revenue": [100., 300.]}))]

    def history(self, frames=None):
        frames = frames or self.frames()
        resolution = build_entity_resolution(frames, "customer", approved_match_keys=[])
        return build_linked_entity_history(frames, resolution,
                                          {entity["canonical_key"]: index for index, entity in enumerate(resolution["entities"])},
                                          {"1": ["revenue"], "2": ["revenue"]}, {"1": "date", "2": "date"})

    def test_preserves_all_records_dates_dimensions_and_original_frames(self):
        frames = self.frames()
        originals = [frame.copy(deep=True) for _, frame in frames]
        history, contract, _ = self.history(frames)
        self.assertEqual(len(history), 5)
        self.assertEqual(history["record_date"].dt.strftime("%Y-%m-%d").tolist(),
                         ["2025-01-01", "2025-01-02", "2025-01-03", "2025-01-01", "2025-01-03"])
        self.assertEqual(history.loc[2, "match_status"], "Unlinked")
        self.assertTrue(pd.isna(history.loc[2, "canonical_entity_key"]))
        self.assertEqual(history.loc[0, "source_1__region"], "East")
        self.assertEqual(contract["policy"]["selected"], ["metric_1__revenue", "metric_2__revenue"])
        for (_, frame), original in zip(frames, originals):
            pd.testing.assert_frame_equal(frame, original)

    def test_report_catalog_and_time_series_keep_source_totals_and_gaps(self):
        history, contract, _ = self.history()
        linked = SimpleNamespace(id=9, file_name="linked-customers.parquet", source_type="entity_matching",
                                 source_config=json.dumps({"entity_history": contract, "selected_metric_columns": contract["policy"]["selected"]}))
        catalog = metric_catalog(linked, history)
        self.assertEqual(catalog["date_columns"], ["record_date"])
        self.assertEqual([metric["label"] for metric in catalog["metrics"]], ["source-1.csv (#1) / revenue", "source-2.csv (#2) / revenue"])
        refs = [{**metric, "date_column": "record_date"} for metric in catalog["metrics"]]
        series, _ = prepare_series({9: (linked, history)}, refs,
                                   {"date_range": {"start": "2025-01-01", "end": "2025-01-03"}, "grain": "daily"})
        self.assertEqual(series["9:metric_1__revenue"].value.tolist(), [10, 20, 30])
        self.assertTrue(pd.isna(series["9:metric_2__revenue"].value.iloc[1]))
        self.assertEqual(series["9:metric_2__revenue"].value.sum(), 400)

    def test_optional_summary_never_adds_same_named_source_metrics(self):
        history, _, _ = self.history()
        summary = summarize_linked_entities(history)
        self.assertEqual(len(summary), 1)
        self.assertEqual([metric["value"] for metric in summary[0]["metrics"]], [30, 400])
        self.assertEqual(len(history), 5)

    def test_basic_aggregation_contracts_do_not_fall_back_to_summing(self):
        frame = pd.DataFrame({"value": [3., 7., None]})
        for aggregation, expected in (("MIN", 3.), ("MAX", 7.), ("AVG", 5.), ("COUNT", 2.), ("LAST", 7.)):
            with self.subTest(aggregation=aggregation):
                self.assertEqual(aggregate_metric(frame, {"columnKey": "value", "aggregation": aggregation}), expected)

    def test_persisted_contract_restores_selection_without_exposing_raw_numeric_fields(self):
        history, contract, _ = self.history()
        linked = SimpleNamespace(source_type="entity_matching", source_config=json.dumps({"entity_history": contract,
                                 "selected_metric_columns": ["metric_1__revenue"]}))
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "linked.parquet"
            history.to_parquet(path, index=False)
            restored = pd.read_parquet(path)
        restored.attrs = {}
        filtered = filter_dataframe_to_selected_metrics(linked, restored)
        self.assertNotIn("source_1__revenue", filtered)
        self.assertNotIn("metric_2__revenue", filtered)
        self.assertIn("source_1__region", filtered)
        self.assertEqual(filtered.attrs[FRAME_POLICY_KEY]["selected"], ["metric_1__revenue"])

    def test_legacy_summary_cannot_be_used_as_dated_history_but_raw_inspection_works(self):
        legacy = SimpleNamespace(id=9, file_name="unified.parquet", source_type="entity_matching", source_config="{}")
        frame = pd.DataFrame({"date": ["2025-01-01"], "revenue": [999]})
        self.assertEqual(metric_catalog(legacy, frame)["metrics"], [])
        with self.assertRaises(HTTPException) as error:
            load_dataframe_from_dataset(legacy)
        self.assertEqual(error.exception.status_code, 422)
        with patch("app.modules.datasets.services.dataset_loader.load_dataset_dataframe", return_value=frame):
            pd.testing.assert_frame_equal(load_dataframe_from_dataset(legacy, apply_metric_selection=False), frame)

    def test_invalid_date_column_is_rejected(self):
        frames = self.frames()
        resolution = build_entity_resolution(frames, "customer")
        with self.assertRaisesRegex(ValueError, "valid date column"):
            build_linked_entity_history(frames, resolution, {}, {"1": ["revenue"]}, {"1": "revenue"})

    def test_name_bridge_does_not_inherit_email_confidence_or_merge_without_review(self):
        frames = [(dataset(1), pd.DataFrame({"email": ["a@b.com", "c@d.com"], "name": ["Sam", "Sam"]})),
                  (dataset(2), pd.DataFrame({"email": ["a@b.com"], "name": ["Sam"]}))]
        preview = build_entity_resolution(frames, "customer")
        self.assertEqual(preview["review_group_count"], 1)
        self.assertEqual(preview["entities"][0]["confidence"], 0.75)
        saved = build_entity_resolution(frames, "customer", approved_match_keys=[])
        self.assertEqual(len(saved["entities"]), 2)
        self.assertEqual(saved["matched_row_count"], 2)
        confirmed = build_entity_resolution(frames, "customer", approved_match_keys=[preview["review_groups"][0]["review_key"]])
        self.assertEqual(confirmed["matched_row_count"], 3)

    def test_appending_records_keeps_identity_but_invalidates_weak_approval(self):
        frames = [(dataset(i), pd.DataFrame({"name": ["Sam"]})) for i in (1, 2)]
        first = build_entity_resolution(frames, "customer")
        frames[0] = (frames[0][0], pd.DataFrame({"name": ["Sam", "Sam"]}))
        latest = build_entity_resolution(frames, "customer")
        self.assertEqual(first["entities"][0]["canonical_key"], latest["entities"][0]["canonical_key"])
        self.assertNotEqual(first["review_groups"][0]["review_key"], latest["review_groups"][0]["review_key"])
        saved = build_entity_resolution(frames, "customer", approved_match_keys=[first["review_groups"][0]["review_key"]])
        self.assertEqual(saved["matched_row_count"], 0)
        self.assertEqual(len({entity["canonical_key"] for entity in saved["entities"]}), 3)

    def test_aggregated_inputs_cannot_masquerade_as_transaction_records(self):
        frames = self.frames()
        frames[0][1]["__decisionate_summary__"] = True
        with self.assertRaisesRegex(ValueError, "aggregated history"):
            self.history(frames)

    def test_source_local_ids_require_review(self):
        frames = [(dataset(i), pd.DataFrame({"customer_id": [1]})) for i in (1, 2)]
        self.assertEqual(build_entity_resolution(frames, "customer")["review_group_count"], 1)
        self.assertEqual(build_entity_resolution(frames, "customer", approved_match_keys=[])["matched_row_count"], 0)

    def test_curated_ratio_and_distinct_counts_survive_source_namespacing(self):
        frames = self.frames()
        frame = frames[0][1]
        frame["orders"] = [1, 4, 3]
        frame["order_id"] = ["one", "one", "two"]
        frame["aov"] = frame.revenue / frame.orders
        frame["order_count"] = [1., 0., 1.]
        descriptors = {key: {"columnKey": key, "aggregation": "SUM", "unit": "number", "components": [], "reason": "Test"}
                       for key in ("revenue", "orders", "aov", "order_count")}
        descriptors["aov"].update(operation="ratio", components=["revenue", "orders"])
        descriptors["order_count"].update(operation="count_distinct", components=["order_id"])
        frame.attrs[FRAME_POLICY_KEY] = {"descriptors": descriptors, "selected": ["aov", "order_count"], "policy_version": 1}
        resolution = build_entity_resolution(frames, "customer", approved_match_keys=[])
        history, contract, _ = build_linked_entity_history(frames, resolution,
                            {entity["canonical_key"]: index for index, entity in enumerate(resolution["entities"])},
                            {"1": ["aov", "order_count"], "2": ["revenue"]}, {"1": "date", "2": "date"})
        policy = contract["policy"]
        self.assertEqual(aggregate_metric(history, policy["descriptors"]["metric_1__aov"]), 7.5)
        self.assertEqual(aggregate_metric(history, policy["descriptors"]["metric_1__order_count"]), 2)
        grouped = aggregate_curated_dataframe(history, "record_date", "monthly")
        self.assertEqual(grouped["metric_1__aov"].iloc[0], 7.5)


if __name__ == "__main__":
    unittest.main()
