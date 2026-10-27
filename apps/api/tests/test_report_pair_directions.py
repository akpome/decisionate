from copy import deepcopy
from itertools import combinations
import random
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import pandas as pd
from pydantic import ValidationError

from app.db.models import Dataset
from app.modules.correlation import engine
from app.modules.reports import router
from app.modules.reports.relationships import compute_report_pair, direction_lookup, report_test_count
from app.modules.reports.schemas import ReportDefinition
from app.modules.reports.service import build_report
from app.modules.alerts.router import build_weekly_cross_dataset_report
from app.modules.alerts.schemas import WeeklyReportPreferenceResponse
from tests import test_business_reports as fixtures


def key(identity, metric):
    return {"dataset_id": identity, "metric_key": metric}


def policy(left, right, direction):
    return {"metric_a": key(*left), "metric_b": key(*right), "direction": direction}


def excluded(left, right):
    return {"metric_a": key(*left), "metric_b": key(*right)}


A, B, C = (1, "spend"), (2, "net_sales"), (4, "clicks")


def definition(**updates):
    metrics = fixtures.definition()["metrics"] + [{**key(*C), "date_column": "date", "aggregation": "sum"}]
    return fixtures.definition(metrics=metrics, lag={"enabled": True, "minimum": 0, "maximum": 3, "direction": "a_leads_b"}, pair_directions=[
        policy(A, B, "a_leads_b"), policy(B, C, "b_leads_a"), policy(A, C, "a_leads_b"),
    ], **updates)


def frames():
    rng = random.Random(70)
    values = [float(rng.randrange(10, 10000)) for _ in range(90)]
    result = fixtures.fixture()
    result[1][1]["spend"] = values
    result[2][1]["net_sales"] = [1., 2., *values[:-2]]
    result[4] = SimpleNamespace(id=4, source_type="csv", file_name="Search.csv", source_config='{"selected_metric_columns":["clicks"]}'), pd.DataFrame({
        "date": pd.date_range("2026-01-01", periods=90), "clicks": [2., *values[:-1]], "currency": "CAD",
    })
    return result


class ReportPairDirectionTests(unittest.TestCase):
    def setUp(self):
        flag = patch.dict("os.environ", fixtures.FLAGS)
        flag.start(); self.addCleanup(flag.stop)

    def test_middle_metric_can_follow_both_other_metrics(self):
        report = build_report(frames(), definition())
        results = {frozenset((item["metric_a"]["dataset_id"], item["metric_b"]["dataset_id"])): item for item in report["findings"]}
        for pair, lead, lag in ((frozenset((1, 2)), "1:spend", 2), (frozenset((2, 4)), "4:clicks", 1), (frozenset((1, 4)), "1:spend", 1)):
            self.assertEqual(results[pair]["lead_metric"], lead)
            self.assertEqual(results[pair]["lag"], lag)
            self.assertAlmostEqual(results[pair]["coefficient"], 1, places=10)
        self.assertEqual(len(results), 3)

    def test_removed_pairs_are_not_computed_or_included_in_significance_correction(self):
        payload = definition(excluded_pairs=[excluded(B, A), excluded(B, C)])
        original = deepcopy(payload)
        with (patch("app.modules.reports.relationships.compute_pair", wraps=engine.compute_pair) as compute,
              patch("app.modules.reports.service.adjust_bh", wraps=engine.adjust_bh) as adjust):
            report = build_report(frames(), payload)
        self.assertEqual(report_test_count(payload), 4)
        self.assertEqual(compute.call_count, 1)
        self.assertEqual(len(adjust.call_args.args[0]), 4)
        self.assertEqual(len(report["findings"]), 1)
        self.assertEqual({item["dataset_id"] for item in (report["findings"][0]["metric_a"], report["findings"][0]["metric_b"])}, {1, 4})
        self.assertEqual(len(report["metrics"]), 3)
        self.assertEqual(len(report["anomaly_analysis"]["metrics"]), 3)
        self.assertEqual(payload, original)

    def test_all_pairs_can_be_removed_without_losing_metric_or_anomaly_results(self):
        payload = definition(excluded_pairs=[excluded(A, B), excluded(A, C), excluded(B, C)])
        with patch("app.modules.reports.relationships.compute_pair") as compute:
            report = build_report(frames(), payload)
        compute.assert_not_called()
        self.assertEqual(report_test_count(payload), 0)
        self.assertEqual(report["findings"], [])
        self.assertEqual(report["included_findings"], [])
        self.assertEqual(report["contrasts"], [])
        self.assertEqual(len(report["metrics"]), 3)
        self.assertEqual(len(report["anomaly_analysis"]["metrics"]), 3)

    def test_direction_is_retained_when_timing_is_off(self):
        payload = definition(excluded_pairs=[excluded(A, B)])
        payload["lag"]["enabled"] = False
        with patch.object(engine, "_calculate_lag_result", wraps=engine._calculate_lag_result) as calculate:
            report = build_report(frames(), payload)
        self.assertEqual(calculate.call_count, 2)
        self.assertEqual(report_test_count(payload), 2)
        self.assertTrue(all(item["lag"] == 0 for item in report["findings"]))
        self.assertEqual(report["definition"]["pair_directions"], payload["pair_directions"])

    def test_removed_pairs_do_not_reappear_in_combined_movement_contrasts(self):
        sources = fixtures.fixture()
        self.assertEqual(len(build_report(sources, fixtures.definition())["contrasts"]), 1)
        report = build_report(sources, fixtures.definition(excluded_pairs=[excluded(A, B)]))
        self.assertEqual(report["contrasts"], [])
        self.assertEqual(len(report["observations"]), 2)

    def test_exclusion_identity_uses_both_dataset_and_metric(self):
        payload = definition(excluded_pairs=[excluded(A, B)])
        payload["metrics"].append({**key(1, "orders"), "date_column": "date", "aggregation": "sum"})
        self.assertEqual(report_test_count(payload), 10)

    def test_schema_rejects_unknown_same_dataset_and_duplicate_exclusions(self):
        for policies in ([excluded(A, (99, "spend"))], [excluded(A, A)], [excluded(A, B), excluded(B, A)]):
            with self.subTest(policies=policies), self.assertRaises(ValidationError):
                ReportDefinition(**definition(excluded_pairs=policies))

    def test_schema_rejects_null_exclusions_and_defaults_legacy_reports_to_no_exclusions(self):
        payload = definition()
        del payload["excluded_pairs"]
        self.assertEqual(ReportDefinition(**payload).excluded_pairs, [])
        payload["excluded_pairs"] = None
        with self.assertRaises(ValidationError):
            ReportDefinition(**payload)

    def test_pair_choices_survive_reordered_selected_metrics_and_reversed_policy_endpoints(self):
        payload = definition()
        payload["metrics"].reverse()
        payload["pair_directions"][1] = policy(C, B, "a_leads_b")
        report = build_report(frames(), payload)
        result = next(item for item in report["findings"] if {item["metric_a"]["dataset_id"], item["metric_b"]["dataset_id"]} == {2, 4})
        self.assertEqual(result["lead_metric"], "4:clicks")
        self.assertEqual(result["lag"], 1)
        self.assertAlmostEqual(result["coefficient"], 1, places=10)

    def test_old_bidirectional_settings_run_only_same_period_without_mutating_the_snapshot(self):
        payload = definition()
        payload["metrics"] = payload["metrics"][1:]
        payload["pair_directions"] = [policy(B, C, "both")]
        original = deepcopy(payload)
        with patch.object(engine, "_calculate_lag_result", wraps=engine._calculate_lag_result) as calculate:
            report = build_report(frames(), payload)
        self.assertEqual(report_test_count(payload), 1)
        self.assertEqual(calculate.call_count, 1)
        self.assertEqual([call.args[2] for call in calculate.call_args_list].count(0), 1)
        self.assertEqual(len(report["findings"]), 1)
        self.assertEqual(report["findings"][0]["lag"], 0)
        self.assertEqual(report["definition"]["pair_directions"], [policy(B, C, "same_period")])
        self.assertEqual(payload, original)

    def test_new_pairs_default_to_one_same_period_test_even_when_timing_is_enabled(self):
        payload = definition()
        payload["pair_directions"] = []
        payload["lag"]["maximum"] = 12
        with patch.object(engine, "_calculate_lag_result", wraps=engine._calculate_lag_result) as calculate:
            report = build_report(frames(), payload)
        self.assertEqual(report_test_count(payload), 3)
        self.assertEqual(calculate.call_count, 3)
        self.assertTrue(all(item["lag"] == 0 for item in report["findings"]))

    def test_explicit_leader_tests_zero_through_maximum_in_only_that_direction(self):
        payload = definition()
        payload["metrics"] = payload["metrics"][:2]
        payload["pair_directions"] = [policy(A, B, "a_leads_b")]
        with patch("app.modules.reports.relationships.compute_pair", wraps=engine.compute_pair) as compute:
            with patch.object(engine, "_calculate_lag_result", wraps=engine._calculate_lag_result) as calculate:
                report = build_report(frames(), payload)
        self.assertEqual(compute.call_count, 1)
        self.assertEqual([call.args[2] for call in calculate.call_args_list], [0, 1, 2, 3])
        self.assertEqual(report["findings"][0]["lead_metric"], "1:spend")
        self.assertEqual(report["findings"][0]["lag"], 2)

    def test_mixed_modes_adjust_significance_over_all_unique_tests(self):
        payload = definition()
        payload["pair_directions"] = [policy(A, B, "a_leads_b"), policy(B, C, "b_leads_a"), policy(A, C, "same_period")]
        with patch("app.modules.reports.service.adjust_bh", wraps=engine.adjust_bh) as adjust:
            report = build_report(frames(), payload)
        self.assertEqual(report_test_count(payload), 9)
        self.assertEqual(len(adjust.call_args.args[0]), 9)
        same = next(item for item in report["findings"] if {item["metric_a"]["dataset_id"], item["metric_b"]["dataset_id"]} == {1, 4})
        self.assertEqual(same["lag"], 0)

    def test_timing_off_and_maximum_zero_do_not_duplicate_same_period_results(self):
        for enabled, maximum in ((False, 3), (True, 0)):
            payload = definition()
            payload["pair_directions"] = []
            payload["lag"].update(enabled=enabled, maximum=maximum)
            with patch.object(engine, "_calculate_lag_result", wraps=engine._calculate_lag_result) as calculate:
                report = build_report(frames(), payload)
            self.assertEqual(report_test_count(payload), 3)
            self.assertEqual(calculate.call_count, 3)
            self.assertTrue(all(item["lag"] == 0 for item in report["findings"]))

    def test_explicit_leader_is_independent_of_metric_selection_order(self):
        payload = definition()
        payload["metrics"] = payload["metrics"][:2]
        payload["pair_directions"] = [policy(A, B, "a_leads_b")]
        payload["lag"]["maximum"] = 1
        periods = pd.date_range("2026-01-01", periods=89)
        series = {
            "1:spend": pd.DataFrame({"period": periods, "value": [float((-1) ** (index // 2)) if index % 2 == 0 else float("nan") for index in range(89)]}),
            "2:net_sales": pd.DataFrame({"period": periods, "value": [float((-1) ** (index // 2)) if index % 2 == 1 else float("nan") for index in range(89)]}),
        }
        left, right = ({**key(*pair), "id": f"{pair[0]}:{pair[1]}"} for pair in (A, B))
        selected = []
        for first, second in ((left, right), (right, left)):
            rows = compute_report_pair(first, second, series, payload, direction_lookup(payload))
            winner = next(item for item in rows if item["selected"])
            self.assertEqual(winner["lag"], 1)
            self.assertEqual(winner["observations"], 44)
            selected.append(winner["lead_metric"])
        self.assertEqual(selected, ["1:spend", "1:spend"])

    def test_positive_minimum_lag_still_includes_zero_once(self):
        payload = definition()
        payload["lag"]["minimum"] = 2
        self.assertEqual(report_test_count(payload), 9)
        with patch.object(engine, "_calculate_lag_result", wraps=engine._calculate_lag_result) as calculate:
            build_report(frames(), payload)
        self.assertEqual(calculate.call_count, 9)
        self.assertEqual([call.args[2] for call in calculate.call_args_list].count(0), 3)

    def test_legacy_report_definitions_preserve_the_original_global_direction(self):
        old = fixtures.definition(lag={"enabled": True, "minimum": 0, "maximum": 3, "direction": "b_leads_a"})
        self.assertIsNone(old["pair_directions"])
        self.assertEqual(report_test_count(old), 4)
        report = build_report(frames(), old)
        self.assertEqual(report["findings"][0]["lead_metric"], "2:net_sales")

    def test_missing_calendar_dates_do_not_compress_reverse_lag(self):
        sources = frames()
        dataset, frame = sources[4]
        sources[4] = dataset, frame.loc[frame.date != "2026-02-14"].copy()
        result = next(item for item in build_report(sources, definition())["findings"] if item["lead_metric"] == "4:clicks")
        self.assertEqual(result["lag"], 1)
        self.assertAlmostEqual(result["coefficient"], 1, places=10)
        self.assertIn("incomplete_shared_history", result["warnings"])

    def test_schema_rejects_unknown_same_dataset_duplicate_and_invalid_direction_policies(self):
        invalid = [
            [policy(A, (99, "spend"), "both")], [policy(A, A, "both")],
            [policy(A, B, "a_leads_b"), policy(B, A, "b_leads_a")], [policy(A, B, "invented")],
        ]
        for configured in invalid:
            payload = definition()
            payload["pair_directions"] = configured
            with self.assertRaises(ValidationError):
                ReportDefinition(**payload)

    def test_schema_normalizes_old_both_settings_but_only_advertises_supported_directions(self):
        payload = definition()
        payload["pair_directions"] = [policy(B, C, "both")]
        self.assertEqual(ReportDefinition(**payload).model_dump()["pair_directions"], [policy(B, C, "same_period")])
        directions = ReportDefinition.model_json_schema()["$defs"]["ReportPairDirection"]["properties"]["direction"]["enum"]
        self.assertEqual(set(directions), {"a_leads_b", "b_leads_a", "same_period"})

    def test_weekly_template_reuses_pair_directions_and_drops_only_missing_source_pairs(self):
        preference = WeeklyReportPreferenceResponse(enabled=False, cadence="weekly", delivery_day="monday", recipient_emails=[], metric_focus=[], include_recommendations=True)
        template = definition(grain="weekly")
        sources = frames()
        for _, frame in sources.values():
            frame["date"] = pd.date_range(end="2026-03-23", periods=len(frame), freq="W-MON")
        with patch("app.modules.alerts.router.complete_week", return_value=template["date_range"]):
            report = build_weekly_cross_dataset_report(sources, preference, template)
            partial = build_weekly_cross_dataset_report({key: value for key, value in sources.items() if key != 4}, preference, template)
        self.assertEqual(report["definition"]["pair_directions"], template["pair_directions"])
        self.assertTrue(any(item["lead_metric"] == "4:clicks" and item["lag"] == 1 for item in report["findings"]))
        self.assertEqual(partial["definition"]["pair_directions"], [policy(A, B, "a_leads_b")])
        ReportDefinition(**partial["definition"])

    def test_weekly_template_preserves_exclusions_even_when_all_remaining_pairs_are_removed(self):
        preference = WeeklyReportPreferenceResponse(enabled=False, cadence="weekly", delivery_day="monday", recipient_emails=[], metric_focus=[], include_recommendations=True)
        template = definition(excluded_pairs=[excluded(A, B), excluded(B, C)])
        original = deepcopy(template)
        with patch("app.modules.alerts.router.complete_week", return_value=template["date_range"]):
            report = build_weekly_cross_dataset_report(frames(), preference, template)
            partial = build_weekly_cross_dataset_report({key: value for key, value in frames().items() if key != 4}, preference, template)
        self.assertEqual(report["definition"]["excluded_pairs"], template["excluded_pairs"])
        self.assertEqual(len(report["findings"]), 1)
        self.assertEqual(partial["definition"]["excluded_pairs"], [excluded(A, B)])
        self.assertEqual(partial["findings"], [])
        ReportDefinition(**partial["definition"])
        self.assertEqual(template, original)

    def test_weekly_report_defaults_old_bidirectional_pairs_to_same_period(self):
        preference = WeeklyReportPreferenceResponse(enabled=False, cadence="weekly", delivery_day="monday", recipient_emails=[], metric_focus=[], include_recommendations=True)
        template = definition()
        template["pair_directions"] = [policy(A, B, "both")]
        original = deepcopy(template)
        with patch("app.modules.alerts.router.complete_week", return_value=template["date_range"]):
            with patch.object(engine, "_calculate_lag_result", wraps=engine._calculate_lag_result) as calculate:
                report = build_weekly_cross_dataset_report(frames(), preference, template)
        self.assertEqual(calculate.call_count, 3)
        self.assertTrue(all(item["lag"] == 0 for item in report["findings"]))
        self.assertEqual(report["definition"]["pair_directions"], [policy(A, B, "same_period")])
        self.assertEqual(template, original)


class ReportPairDirectionRouteTests(unittest.TestCase):
    def setUp(self):
        fixtures.BusinessReportWorkflowTests.setUp(self)
        self.frames = frames()
        with self.Session() as db:
            dataset, frame = self.frames[4]
            db.add(Dataset(id=4, user_id="owner", workspace_id="owner", file_name=dataset.file_name, file_path="unused.csv",
                           source_type="csv", source_config=dataset.source_config, row_count=len(frame), column_count=len(frame.columns)))
            db.commit()

    def test_preview_save_and_reopen_retain_all_independent_pair_choices(self):
        payload = definition(excluded_pairs=[excluded(B, A)])
        for path in ("/api/v2/business-reports/preview", "/api/v2/business-reports"):
            response = self.client.post(path, json=payload)
            self.assertIn(response.status_code, (200, 201), response.text)
            self.assertEqual(response.json()["definition"]["pair_directions"], payload["pair_directions"])
            self.assertEqual(response.json()["definition"]["excluded_pairs"], payload["excluded_pairs"])
            self.assertEqual(len(response.json()["findings"]), 2)
        saved = response.json()
        reopened = self.client.get(f"/api/v2/business-reports/{saved['report_id']}")
        self.assertEqual(reopened.status_code, 200)
        self.assertEqual(reopened.json()["definition"]["pair_directions"], payload["pair_directions"])
        self.assertEqual(reopened.json()["definition"]["excluded_pairs"], payload["excluded_pairs"])

    def test_invalid_pair_exclusion_is_rejected_before_any_source_file_reads(self):
        payload = definition()
        payload["excluded_pairs"] = [excluded(A, (3, "private"))]
        with patch.object(router, "load_dataframe_from_dataset") as load:
            response = self.client.post("/api/v2/business-reports/preview", json=payload)
        self.assertEqual(response.status_code, 422, response.text)
        load.assert_not_called()

    def test_invalid_pair_policy_is_rejected_before_any_source_file_reads(self):
        payload = definition()
        payload["pair_directions"] = [policy(A, (3, "private"), "both")]
        with patch.object(router, "load_dataframe_from_dataset") as load:
            response = self.client.post("/api/v2/business-reports/preview", json=payload)
        self.assertEqual(response.status_code, 422, response.text)
        load.assert_not_called()

    def test_preview_and_save_normalize_old_both_settings_before_running(self):
        payload = definition()
        payload["pair_directions"] = [policy(A, B, "both")]
        for path in ("/api/v2/business-reports/preview", "/api/v2/business-reports"):
            with patch.object(engine, "_calculate_lag_result", wraps=engine._calculate_lag_result) as calculate:
                response = self.client.post(path, json=payload)
            self.assertIn(response.status_code, (200, 201), response.text)
            self.assertEqual(response.json()["definition"]["pair_directions"], [policy(A, B, "same_period")])
            self.assertEqual(calculate.call_count, 3)
            self.assertTrue(all(item["lag"] == 0 for item in response.json()["findings"]))

    def test_explicit_direction_resource_budget_is_enforced_before_source_reads(self):
        payload = definition()
        payload["metrics"] = [{"dataset_id": index, "metric_key": "spend", "date_column": "date", "aggregation": "sum"} for index in range(1, 26)]
        payload["lag"]["maximum"] = 12
        payload["pair_directions"] = [policy((left, "spend"), (right, "spend"), "a_leads_b") for left, right in combinations(range(1, 26), 2)]
        self.assertEqual(report_test_count(payload), 3900)
        with patch.object(router, "load_dataframe_from_dataset") as load:
            response = self.client.post("/api/v2/business-reports/preview", json=payload)
        self.assertEqual(response.status_code, 400, response.text)
        self.assertIn("1,000", response.json()["detail"])
        load.assert_not_called()
        with self.assertRaises(ValueError):
            build_report({}, payload)

    def test_same_dataset_metrics_do_not_add_a_pair(self):
        payload = definition()
        payload["metrics"].append({"dataset_id": 1, "metric_key": "orders", "date_column": "date", "aggregation": "sum"})
        payload["pair_directions"] = []
        self.assertEqual(report_test_count(payload), 5)


if __name__ == "__main__":
    unittest.main()
