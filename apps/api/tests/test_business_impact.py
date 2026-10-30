import copy
import json
import unittest
from datetime import date, timedelta
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np
import pandas as pd
from pydantic import ValidationError

from app.modules.reports.impact import evaluate_impact, impact_facts
from app.modules.reports.schemas import ReportDefinition
from app.modules.reports.service import build_report, report_analysis_facts, report_summary
from app.modules.reports.relationships import report_pairs, report_test_count


def experiment(effect=30., seed=42, seasonal=False, periods=156, before=110):
    rng = np.random.default_rng(seed)
    dates = pd.date_range("2023-01-02", periods=periods, freq="W-MON")
    t = np.arange(periods)
    control = 100 + rng.normal(0, 20, periods)
    noise = rng.normal(0, 2, periods)
    for i in range(1, periods):
        noise[i] += .3 * noise[i - 1]
    y = 200 + .2 * t + .8 * control + noise + effect * (t >= before)
    if seasonal:
        y += 25 * np.sin(2 * np.pi * t * 7 / 365.2425)
    metrics = [{"dataset_id": identity, "metric_key": key, "date_column": "date", "aggregation": "sum"}
               for identity, key in ((1, "orders"), (2, "comparison_orders"))]
    definition = ReportDefinition(
        name="Store staffing change", business_question="Did extra staff improve completed orders?", metrics=metrics,
        grain="weekly", seasonal_business=seasonal,
        date_range={"start": str(dates[0].date()), "end": str((dates[-1] + pd.Timedelta(days=6)).date())},
        impact={"change": "Added an extra staff member", "change_date": str(dates[before].date()),
                "outcome": {"dataset_id": 1, "metric_key": "orders"}, "comparison": {"dataset_id": 2, "metric_key": "comparison_orders"},
                "comparison_reason": "A separate store kept its staffing and service unchanged.", "comparison_unaffected": True,
                "other_changes": "none_known"},
    ).model_dump(mode="json")
    metadata = {f"{ref['dataset_id']}:{ref['metric_key']}": {**ref, "id": f"{ref['dataset_id']}:{ref['metric_key']}",
                "label": ref["metric_key"], "dataset_label": f"Store {ref['dataset_id']}", "unit": "count", "currency": None}
                for ref in metrics}
    series = {"1:orders": pd.DataFrame({"period": dates, "value": y}), "2:comparison_orders": pd.DataFrame({"period": dates, "value": control})}
    return definition, metadata, series


def source_frames(definition, series):
    frames = {}
    for reference in definition["metrics"]:
        identity, key = reference["dataset_id"], reference["metric_key"]
        source = SimpleNamespace(id=identity, source_type="csv", file_name=f"Store {identity}",
                                 source_config=json.dumps({"selected_metric_columns": [key]}))
        frame = series[f"{identity}:{key}"].rename(columns={"period": "date", "value": key})
        frame["region"] = "East"
        frames[identity] = source, frame
    return frames


class BusinessImpactTests(unittest.TestCase):
    def evaluate(self, effect=30, **kwargs):
        definition, metadata, series = experiment(effect, **kwargs)
        return evaluate_impact(series, definition, metadata)

    def test_known_positive_negative_and_zero_effects(self):
        for effect, verdict in ((30, "helped"), (-30, "hurt"), (0, "unclear")):
            with self.subTest(effect=effect):
                result = self.evaluate(effect)
                self.assertEqual(result["status"], "estimated", result)
                self.assertEqual(result["estimate"]["verdict"], verdict)
                self.assertAlmostEqual(result["estimate"]["per_period_effect"], effect, delta=2)
                self.assertLessEqual(result["estimate"]["lower"], effect * result["after_periods"])
                self.assertGreaterEqual(result["estimate"]["upper"], effect * result["after_periods"])
                self.assertNotIn("proof", result["headline"])
                self.assertNotIn("trend", impact_facts(result))
                json.dumps(result, allow_nan=False)

    def test_no_effect_is_not_labeled_a_failed_business_change(self):
        result = self.evaluate(0)
        self.assertIn("not clear", result["headline"])
        self.assertIn("includes no effect", result["summary"])

    def test_direction_and_worthwhile_target_are_business_inputs(self):
        definition, metadata, series = experiment(-30)
        definition["impact"].update(desired_direction="decrease", worthwhile_change=10)
        result = evaluate_impact(series, definition, metadata)
        self.assertEqual(result["estimate"]["verdict"], "helped")
        self.assertEqual(result["estimate"]["worthwhile_result"], "likely")
        definition["impact"]["worthwhile_change"] = 100000
        result = evaluate_impact(series, definition, metadata)
        self.assertEqual(result["estimate"]["worthwhile_result"], "unlikely")

    def test_rates_are_not_added_up_as_if_they_were_orders(self):
        definition, metadata, series = experiment()
        metadata["1:orders"].update(aggregation="avg", additive=False)
        result = evaluate_impact(series, definition, metadata)
        self.assertFalse(result["estimate"]["is_total"])
        self.assertAlmostEqual(result["estimate"]["effect"], 30, delta=2)
        self.assertIn("per measured period", result["summary"])

    def test_yearly_adjustment_is_automatic_and_requires_supported_earlier_history(self):
        result = self.evaluate(seasonal=True)
        self.assertEqual(result["status"], "estimated", result)
        self.assertAlmostEqual(result["estimate"]["per_period_effect"], 30, delta=3)
        self.assertTrue(result["baseline"]["annual_adjustment"])
        short = self.evaluate(seasonal=True, before=60)
        self.assertIsNone(short["estimate"])
        self.assertFalse(short["baseline"]["annual_history_available"])
        self.assertFalse(short["baseline"]["annual_adjustment"])
        self.assertTrue(any("two years" in item for item in short["limitations"]))

    def test_legacy_checkbox_neither_forces_nor_disables_the_comparison_baseline(self):
        for seasonal in (False, True):
            definition, metadata, series = experiment(seasonal=seasonal)
            definition["seasonal_business"] = False
            automatic = evaluate_impact(series, definition, metadata)
            definition["seasonal_business"] = True
            self.assertEqual(evaluate_impact(series, definition, metadata), automatic)
            self.assertEqual(automatic["status"], "estimated", automatic)
            self.assertEqual(automatic["baseline"]["annual_adjustment"], seasonal)
        definition, metadata, series = experiment(before=60)
        definition["seasonal_business"] = True
        result = evaluate_impact(series, definition, metadata)
        self.assertEqual(result["status"], "estimated", result)
        self.assertFalse(result["baseline"]["annual_adjustment"])

    def test_shared_seasons_are_carried_by_the_comparison_without_a_forced_equal_baseline(self):
        for effect in (0, 30, -30):
            definition, metadata, series = experiment(effect)
            cycle = 40 * np.sin(2 * np.pi * np.arange(156) * 7 / 365.2425)
            series["2:comparison_orders"]["value"] += cycle
            series["1:orders"]["value"] += .8 * cycle
            result = evaluate_impact(series, definition, metadata)
            self.assertEqual(result["status"], "estimated", result)
            self.assertEqual(result["baseline"]["kind"], "comparison")
            self.assertAlmostEqual(result["estimate"]["per_period_effect"], effect, delta=2)
            self.assertLessEqual(result["estimate"]["lower"], effect * result["after_periods"])
            self.assertGreaterEqual(result["estimate"]["upper"], effect * result["after_periods"])

    def test_baseline_selection_cannot_see_the_action_or_its_reserved_pre_action_holdout(self):
        from app.modules.reports.impact import _baseline

        definition, metadata, series = experiment(seasonal=True)
        periods = pd.DatetimeIndex(series["1:orders"].period)
        control = series["2:comparison_orders"].value.to_numpy()
        values = series["1:orders"].value.to_numpy()
        before = periods < pd.Timestamp(definition["impact"]["change_date"])
        original = _baseline(periods, control, values, before, "weekly", 88)
        changed = values.copy(); changed[88:] += 10000
        replacement = _baseline(periods, control, changed, before, "weekly", 88)
        self.assertEqual(original[1:], replacement[1:])
        self.assertLess(original[2]["selection_end"], str(periods[88].date()))
        changed_control = control.copy(); changed_control[110:] += 10000
        replacement = _baseline(periods, changed_control, changed, before, "weekly", 88)
        self.assertEqual(original[1:], replacement[1:])
        self.assertTrue(original[1]["annual_adjustment"])

    def test_yearly_adjustment_cannot_make_an_unhelpful_comparison_pass(self):
        definition, metadata, series = experiment(seasonal=True)
        series["1:orders"]["value"] -= .8 * series["2:comparison_orders"].value
        result = evaluate_impact(series, definition, metadata)
        self.assertIsNone(result["estimate"])
        check = next(item for item in result["checks"] if item["key"] == "earlier_prediction")
        self.assertFalse(check["passed"])
        self.assertIn("without_comparison_error", check["details"])

    def test_calendar_yearly_baselines_for_daily_and_monthly_studies_do_not_bypass_reliability_checks(self):
        for grain, frequency, count, before_count in (("daily", "D", 1000, 750), ("monthly", "MS", 36, 27)):
            with self.subTest(grain=grain):
                rng = np.random.default_rng(42)
                definition, metadata, _ = experiment()
                dates = pd.date_range("2023-01-01", periods=count, freq=frequency)
                elapsed = (dates - dates[0]).days.to_numpy()
                control = 100 + rng.normal(0, 20, count)
                values = 200 + .02 * elapsed + .8 * control + 25 * np.sin(2 * np.pi * elapsed / 365.2425) + rng.normal(0, 2, count)
                values[before_count:] += 30
                end = dates[-1] if grain == "daily" else dates[-1] + pd.offsets.MonthEnd(0)
                definition.update(grain=grain, seasonal_business=False, date_range={"start": str(dates[0].date()), "end": str(end.date())})
                definition["impact"]["change_date"] = str(dates[before_count].date())
                result = evaluate_impact({"1:orders": pd.DataFrame({"period": dates, "value": values}),
                    "2:comparison_orders": pd.DataFrame({"period": dates, "value": control})}, definition, metadata)
                self.assertTrue(result["baseline"]["annual_adjustment"])
                if grain == "daily":
                    self.assertEqual(result["status"], "estimated", result)
                    self.assertAlmostEqual(result["estimate"]["per_period_effect"], 30, delta=3)
                else:
                    self.assertIsNone(result["estimate"])
                    self.assertFalse(next(check for check in result["checks"] if check["key"] == "earlier_false_alarms")["passed"])

    def test_repeated_shared_and_different_seasons_include_null_and_negative_interventions(self):
        for shared in (False, True):
            for effect in (0, 30, -30):
                accepted, covered, false_direction = 0, 0, 0
                for seed in range(20):
                    definition, metadata, series = experiment(effect, seed=seed, seasonal=not shared)
                    definition["seasonal_business"] = False
                    if shared:
                        cycle = 40 * np.sin(2 * np.pi * np.arange(156) * 7 / 365.2425)
                        series["2:comparison_orders"]["value"] += cycle
                        series["1:orders"]["value"] += .8 * cycle
                    result = evaluate_impact(series, definition, metadata)
                    estimate = result["estimate"]
                    if estimate is None:
                        continue
                    accepted += 1
                    covered += estimate["lower"] <= effect * result["after_periods"] <= estimate["upper"]
                    false_direction += estimate["verdict"] != ("unclear" if effect == 0 else "helped" if effect > 0 else "hurt")
                self.assertGreaterEqual(accepted, 12, (shared, effect, accepted))
                self.assertGreaterEqual(covered / accepted, .8, (shared, effect, accepted, covered))
                self.assertLessEqual(false_direction, 3, (shared, effect, accepted, false_direction))

    def test_context_checks_cannot_be_bypassed_by_a_strong_numeric_pattern(self):
        for changes in ({"comparison_unaffected": False}, {"other_changes": "yes"}, {"other_changes": "not_sure"}):
            definition, metadata, series = experiment(500)
            definition["impact"].update(changes)
            result = evaluate_impact(series, definition, metadata)
            self.assertIsNone(result["estimate"])
            self.assertEqual(result["evidence_grade"], "not_established")

    def test_missing_periods_unavailable_sources_and_constant_comparison_withhold_estimate(self):
        definition, metadata, series = experiment()
        for change in ("gap", "missing", "constant", "infinity"):
            points = copy.deepcopy(series)
            if change == "gap":
                points["2:comparison_orders"] = points["2:comparison_orders"].drop(index=90)
            elif change == "missing":
                del points["2:comparison_orders"]
            elif change == "constant":
                points["2:comparison_orders"]["value"] = 1
            else:
                points["2:comparison_orders"].loc[90, "value"] = float("inf")
            self.assertIsNone(evaluate_impact(points, definition, metadata)["estimate"], change)

    def test_not_enough_before_or_after_history_has_a_useful_next_step(self):
        for before in (20, 150):
            result = self.evaluate(before=before)
            self.assertIsNone(result["estimate"])
            self.assertIn("52 complete weekly", result["summary"])
            self.assertTrue(result["next_steps"])

    def test_partial_and_straddling_weeks_do_not_mix_before_and_after(self):
        definition, metadata, series = experiment()
        definition["date_range"]["start"] = "2023-01-03"
        change = date.fromisoformat(definition["impact"]["change_date"])
        definition["impact"]["change_date"] = str(change + timedelta(days=2))
        definition["date_range"]["end"] = str(date.fromisoformat(definition["date_range"]["end"]) - timedelta(days=1))
        result = evaluate_impact(series, definition, metadata)
        self.assertEqual(result["before_periods"], 109)
        self.assertEqual(result["after_periods"], 44)
        self.assertFalse(any(row["period"] == str(change) for row in result["trend"]))

    def test_bad_historical_fit_and_post_comparison_break_are_rejected(self):
        definition, metadata, series = experiment()
        rng = np.random.default_rng(5)
        unrelated = copy.deepcopy(series)
        unrelated["1:orders"]["value"] = rng.normal(100, 100, 156)
        result = evaluate_impact(unrelated, definition, metadata)
        self.assertIsNone(result["estimate"])
        self.assertIn("before your change", result["summary"].lower())
        series["2:comparison_orders"].loc[110:, "value"] += 1000
        result = evaluate_impact(series, definition, metadata)
        self.assertIsNone(result["estimate"])
        self.assertIn("comparison changed too much", result["summary"])

    def test_false_alarm_and_history_sensitivity_checks_withhold_the_amount(self):
        from app.modules.reports import impact
        definition, metadata, series = experiment()
        original = impact._step_fit

        def false_alarm(values, design, after, grain):
            fit, matrix = original(values, design, after, grain)
            if len(values) == 110:
                fit.conf_int = lambda alpha: pd.DataFrame({0: [10.], 1: [20.]}, index=["change"])
            return fit, matrix

        with patch.object(impact, "_step_fit", side_effect=false_alarm):
            result = evaluate_impact(series, definition, metadata)
        self.assertIsNone(result["estimate"])
        self.assertIn("earlier dates", result["summary"])

        def unstable(values, design, after, grain):
            fit, matrix = original(values, design, after, grain)
            if len(values) == 129:
                parameters = fit.params.copy()
                parameters["change"] += 1000
                fit = SimpleNamespace(params=parameters)
            return fit, matrix

        with patch.object(impact, "_step_fit", side_effect=unstable):
            result = evaluate_impact(series, definition, metadata)
        self.assertIsNone(result["estimate"])
        self.assertIn("depends too heavily", result["summary"])

    def test_unknown_currency_and_unexpected_calculation_errors_do_not_leak_a_number_or_traceback(self):
        definition, metadata, series = experiment()
        metadata["1:orders"]["currency_unresolved"] = True
        result = evaluate_impact(series, definition, metadata)
        self.assertIsNone(result["estimate"])
        self.assertIn("currencies", result["summary"])
        metadata["1:orders"]["currency_unresolved"] = False
        with patch("app.modules.reports.impact._fit", side_effect=ValueError("sensitive technical details")):
            result = evaluate_impact(series, definition, metadata)
        self.assertNotIn("sensitive", result["summary"])
        self.assertIsNone(result["estimate"])

    def test_repeated_known_effect_simulations_include_null_cases_not_just_success_examples(self):
        for effect in (0, 30, -30):
            accepted, covered, false_direction = 0, 0, 0
            for seed in range(20):
                result = self.evaluate(effect, seed=seed)
                estimate = result["estimate"]
                if estimate is None:
                    continue
                accepted += 1
                covered += estimate["lower"] <= effect * result["after_periods"] <= estimate["upper"]
                false_direction += estimate["verdict"] != ("unclear" if effect == 0 else "helped" if effect > 0 else "hurt")
            self.assertGreaterEqual(accepted, 12, (effect, accepted))
            self.assertGreaterEqual(covered / accepted, .8, (effect, accepted, covered))
            self.assertLessEqual(false_direction, 3, (effect, accepted, false_direction))

    def test_committed_demo_has_known_effects_and_is_reproducible(self):
        import importlib.util
        from pathlib import Path
        import tempfile
        root = Path(__file__).resolve().parents[3]
        spec = importlib.util.spec_from_file_location("impact_demo", root / "apps/api/demo_data/generate_impact_demo.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as folder:
            manifest = module.generate(folder)
            for name in ("changed_store.csv", "unchanged_store.csv", "manifest.json"):
                self.assertEqual((Path(folder) / name).read_bytes(), (root / "sample-data/business-impact" / name).read_bytes())
        changed = pd.read_csv(root / "sample-data/business-impact/changed_store.csv")
        control = pd.read_csv(root / "sample-data/business-impact/unchanged_store.csv")
        dates = pd.to_datetime(changed.week)
        for key, effect in manifest["effects_per_week"].items():
            definition, metadata, _ = experiment()
            definition["date_range"] = {"start": manifest["start"], "end": manifest["end"]}
            definition["impact"]["change_date"] = manifest["change_date"]
            definition["seasonal_business"] = True
            result = evaluate_impact({"1:orders": pd.DataFrame({"period": dates, "value": changed[key]}),
                                     "2:comparison_orders": pd.DataFrame({"period": dates, "value": control.comparison_orders})}, definition, metadata)
            self.assertEqual(result["status"], "estimated", result)
            self.assertAlmostEqual(result["estimate"]["per_period_effect"], effect, delta=3)

    def test_schema_rejects_wrong_roles_single_scope_and_invalid_dates(self):
        definition, _, _ = experiment()
        changes = [lambda item: item.update(scope="single"), lambda item: item.update(grain="quarterly"),
                   lambda item: item["impact"].update(change_date="2020-01-01"),
                   lambda item: item["impact"].update(comparison={"dataset_id": 1, "metric_key": "orders"}),
                   lambda item: item["impact"].update(outcome={"dataset_id": 10, "metric_key": "orders"}),
                   lambda item: item["impact"].update(worthwhile_change=float("nan"))]
        for change in changes:
            invalid = copy.deepcopy(definition)
            change(invalid)
            with self.assertRaises(ValidationError):
                ReportDefinition.model_validate(invalid)
        legacy = {key: value for key, value in definition.items() if key != "impact"}
        self.assertIsNone(ReportDefinition.model_validate(legacy).impact)

    def test_report_integration_is_selected_filtered_worker_evidence_and_does_not_need_ai(self):
        definition, _, series = experiment()
        frames = source_frames(definition, series)
        with patch.dict("os.environ", {"CURATED_METRIC_DEFAULTS_BACKEND": "false", "CORRELATION_REPORTING_TIMEZONE": "UTC"}):
            result = build_report(frames, definition)
            self.assertEqual(result["impact_analysis"]["status"], "estimated", result["impact_analysis"])
            self.assertEqual(report_summary(result), result["impact_analysis"]["headline"] + " " + result["impact_analysis"]["summary"])
            self.assertNotIn("trend", report_analysis_facts(result)["impact_analysis"])
            self.assertEqual(result["decisions"], [])
            definition["dimension_filters"] = [{"dataset_id": 1, "column": "region", "values": ["West"]}]
            filtered = build_report(frames, definition)
            self.assertIsNone(filtered["impact_analysis"]["estimate"])

    def test_impact_reports_skip_correlation_and_keep_the_impact_and_anomaly_results(self):
        definition, metadata, series = experiment()
        original = copy.deepcopy(definition)
        expected = evaluate_impact(series, definition, metadata)
        definition.update(included_findings=["old-correlation-finding"], pair_directions=[{
            "metric_a": definition["impact"]["outcome"], "metric_b": definition["impact"]["comparison"], "direction": "a_leads_b"}])
        definition["lag"].update(enabled=True, maximum=60)
        with patch.dict("os.environ", {"CURATED_METRIC_DEFAULTS_BACKEND": "false", "CORRELATION_REPORTING_TIMEZONE": "UTC"}), \
             patch("app.modules.reports.service.compute_report_pair", side_effect=AssertionError("Impact must not run correlations")) as correlate, \
             patch("app.modules.reports.service.adjust_bh", side_effect=AssertionError("No correlation tests to adjust")):
            report = build_report(source_frames(definition, series), definition)
        correlate.assert_not_called()
        self.assertEqual(report["impact_analysis"]["estimate"], expected["estimate"])
        self.assertTrue(report["impact_analysis"]["checks"])
        self.assertTrue(report["impact_analysis"]["trend"])
        self.assertEqual(len(report["metrics"]), 2)
        self.assertEqual(len(report["anomaly_analysis"]["metrics"]), 2)
        for key in ("findings", "included_findings"):
            self.assertEqual(report[key], [])
        self.assertEqual(report["definition"]["included_findings"], [])
        self.assertEqual(report["limitations"], report["impact_analysis"]["limitations"])
        self.assertTrue(any("does not by itself prevent the business impact assessment" in item for item in report["warnings"]))
        self.assertEqual(definition["included_findings"], ["old-correlation-finding"])
        self.assertEqual(report_pairs(definition), [])
        self.assertEqual(report_test_count(definition), 0)
        correlation = {**original, "impact": None}
        with patch.dict("os.environ", {"CURATED_METRIC_DEFAULTS_BACKEND": "false", "CORRELATION_REPORTING_TIMEZONE": "UTC"}):
            self.assertTrue(build_report(source_frames(correlation, series), correlation)["findings"])

    def test_unused_correlation_test_budget_does_not_block_impact_reports(self):
        definition, _, _ = experiment()
        definition["metrics"] = [{"dataset_id": index, "metric_key": "orders", "date_column": "date", "aggregation": "sum"}
                                 for index in range(1, 26)]
        definition["lag"].update(enabled=True, maximum=12)
        definition["pair_directions"] = None
        self.assertEqual(report_test_count({**definition, "impact": None}), 3900)
        self.assertEqual(report_test_count(definition), 0)

    def test_old_impact_snapshot_correlations_are_not_used_as_interpretation_or_decision_evidence(self):
        from app.modules.reports.router import report_decision_evidence

        definition, _, series = experiment()
        with patch.dict("os.environ", {"CURATED_METRIC_DEFAULTS_BACKEND": "false", "CORRELATION_REPORTING_TIMEZONE": "UTC"}):
            report = build_report(source_frames(definition, series), definition)
        report["findings"] = [{"id": "old-correlation", "metric_a": report["metrics"][0], "metric_b": report["metrics"][1],
                               "interpretation": "Old exploratory correlation", "evidence": {"raw": "not for reuse"}}]
        report["included_findings"] = ["old-correlation"]
        report["definition"]["included_findings"] = ["old-correlation"]
        report["limitations"] = ["Old correlation-only caution"]
        before = copy.deepcopy(report)
        facts = report_analysis_facts(report)
        evidence = report_decision_evidence(SimpleNamespace(id="old-impact", snapshot=json.dumps(report)))[2]
        for data in (facts, evidence):
            self.assertEqual(data["findings"], [])
            self.assertEqual(data["impact_analysis"]["estimate"], report["impact_analysis"]["estimate"])
            self.assertEqual(data["limitations"], report["impact_analysis"]["limitations"])
        self.assertEqual(report, before)

    def test_weekly_updates_use_weekly_rolling_history_and_escape_email_content(self):
        from app.modules.alerts.router import build_weekly_report_digest
        from app.modules.alerts.schemas import WeeklyReportPreferenceResponse
        from app.modules.alerts.email_delivery import build_weekly_report_email_html, build_weekly_report_email_text

        definition, _, series = experiment()
        definition["impact"]["change"] = "Extra staff <script>unsafe</script>"
        frames = source_frames(definition, series)
        preference = WeeklyReportPreferenceResponse(enabled=True, cadence="weekly", delivery_day="monday",
            recipient_emails=["owner@example.test"], metric_focus=["1:orders", "2:comparison_orders"], include_recommendations=True)
        with patch.dict("os.environ", {"CURATED_METRIC_DEFAULTS_BACKEND": "false", "CORRELATION_REPORTING_TIMEZONE": "UTC"}), \
             patch("app.modules.alerts.router.load_dataframe_from_dataset", side_effect=lambda dataset: frames[dataset.id][1]), \
             patch("app.modules.alerts.router.generate_structured_analysis") as ai, \
             patch("app.modules.reports.service.compute_report_pair", side_effect=AssertionError("Weekly impact must not run correlations")) as correlate:
            digest = build_weekly_report_digest(preference, [pair[0] for pair in frames.values()], report_definition=definition,
                                                analysis_date=date(2025, 12, 29), include_ai_analysis=True)
        result = digest.cross_dataset_report
        self.assertEqual(result["grain"], "daily")
        self.assertEqual(result["analysis_grain"], "weekly")
        self.assertEqual(result["definition"]["grain"], "weekly")
        self.assertEqual(result["impact_analysis"]["grain"], "weekly")
        self.assertEqual(result["impact_analysis"]["status"], "estimated", result["impact_analysis"])
        self.assertEqual(result["impact_analysis"]["before_periods"], 110)
        self.assertEqual(result["impact_analysis"]["after_periods"], 46)
        self.assertEqual(result["impact_analysis"]["window"]["start"], "2022-12-29")
        ai.assert_not_called()
        correlate.assert_not_called()
        self.assertEqual(result["findings"], [])
        self.assertEqual(result["included_findings"], [])
        self.assertEqual(len(result["anomaly_analysis"]["metrics"]), 2)
        self.assertEqual(len(result["weekly_anomaly_analysis"]["metrics"]), 2)
        html, text = build_weekly_report_email_html(digest), build_weekly_report_email_text(digest)
        self.assertIn("Did your business change help?", html)
        self.assertIn("Your change appears to have helped.", text)
        self.assertIn("&lt;script&gt;unsafe", html)
        self.assertNotIn("<script>", html)
        self.assertIn("Study dates:", text)
        for content in (html, text):
            self.assertIn("Weekly report: daily detail", content)
            self.assertIn("Business impact is assessed separately using weekly history", content)
            self.assertNotIn("Relationship timing", content)
            self.assertNotIn("Relationship findings", content)
            self.assertIn("Unusual changes (anomaly detection)", content)
        result["findings"] = [{"id": "legacy", "business_summary": "Old exploratory correlation", "interpretation": "Old interpretation"}]
        result["included_findings"] = ["legacy"]
        for content in (build_weekly_report_email_html(digest), build_weekly_report_email_text(digest)):
            self.assertNotIn("Old exploratory correlation", content)
            self.assertNotIn("Relationship findings", content)
        self.assertEqual(result["included_findings"], ["legacy"])


class BusinessImpactWorkflowTests(unittest.TestCase):
    def setUp(self):
        from tests.test_business_reports import BusinessReportWorkflowTests
        from app.db.models import Dataset
        BusinessReportWorkflowTests.setUp(self)
        self.definition, _, series = experiment()
        from app.modules.decisions.models import Decision
        self.frames = source_frames(self.definition, series)
        with self.Session() as db:
            for identity, (source, frame) in self.frames.items():
                record = db.get(Dataset, identity)
                record.source_config = source.source_config
                record.row_count = len(frame)
            decision = Decision(clerk_user_id="owner", workspace_id="owner", dataset_id=1, metric_column="orders",
                title="Increase store staffing", action=self.definition["impact"]["change"], expected_outcome="Complete more orders",
                status="in_progress")
            db.add(decision); db.flush()
            self.definition["impact"]["decision_id"] = decision.id
            self.decision_id = decision.id
            db.commit()

    def test_enqueue_worker_save_reopen_and_decision_evidence_keep_the_same_estimate(self):
        from app.infrastructure.analysis_worker import execute_job
        from app.modules.reports import router
        from app.modules.reports.models import BusinessReport
        from app.modules.decisions.models import Decision
        from tests.report_timing_fixtures import attach_timing

        attach_timing(self)

        with patch.object(router, "generate_structured_analysis") as ai, \
             patch("app.modules.reports.service.compute_report_pair", side_effect=AssertionError("Impact worker must not run correlations")) as correlate:
            self.definition["lag"].update(enabled=True, maximum=60)
            response = self.client.post("/api/v2/business-reports/jobs", json=self.definition, headers={"Idempotency-Key": "impact-1"})
            self.assertEqual(response.status_code, 202, response.text)
            identity = response.json()["job_id"]
            self.assertEqual(self.client.post("/api/v2/business-reports/jobs", json=self.definition, headers={"Idempotency-Key": "impact-1"}).json()["job_id"], identity)
            execute_job(identity)
            result = self.client.get(f"/api/v2/business-reports/jobs/{identity}").json()
            self.assertEqual(result["status"], "succeeded", result)
            saved_response = self.client.post(f"/api/v2/business-reports/jobs/{identity}/save")
            self.assertEqual(saved_response.status_code, 201, saved_response.text)
            saved = saved_response.json()
            self.assertEqual(saved["impact_analysis"]["status"], "estimated", saved["impact_analysis"])
            self.assertEqual(saved["findings"], [])
            self.assertEqual(saved["included_findings"], [])
            self.frames[1][1]["orders"] = 10000000
            reopened = self.client.get(f"/api/v2/business-reports/{saved['report_id']}").json()
            self.assertEqual(reopened["impact_analysis"], saved["impact_analysis"])
            with self.Session() as db:
                evidence = router.report_decision_evidence(db.get(BusinessReport, saved["report_id"]))[2]
                self.assertEqual(evidence["impact_analysis"]["estimate"], saved["impact_analysis"]["estimate"])
                self.assertNotIn("trend", evidence["impact_analysis"])
                self.assertEqual(db.query(Decision).count(), 1)
                self.assertIsNotNone(saved.get("decision_review_id"))
            ai.assert_not_called()
            correlate.assert_not_called()
            self.assertEqual(self.client.get(f"/api/v2/business-reports/{saved['report_id']}", headers={"X-Workspace-Id": "other"}).status_code, 404)

    def test_private_comparison_never_reaches_the_worker_or_loader(self):
        from app.modules.reports import router
        definition = copy.deepcopy(self.definition)
        definition["metrics"][1]["dataset_id"] = 3
        definition["impact"]["comparison"]["dataset_id"] = 3
        with patch.object(router, "load_dataframe_from_dataset") as loader:
            response = self.client.post("/api/v2/business-reports/jobs", json=definition)
            self.assertEqual(response.status_code, 403, response.text)
            loader.assert_not_called()


if __name__ == "__main__":
    unittest.main()
