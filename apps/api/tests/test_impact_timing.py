import copy
import json
import unittest
from datetime import datetime, timezone
from unittest.mock import patch

import numpy as np
import pandas as pd

from app.modules.correlation.engine import compute_pair
from app.modules.reports.impact import evaluate_impact, impact_facts, impact_lines
from app.modules.reports.impact_timing import decision_timing, response_date
from app.modules.reports.schemas import ImpactTimingEvidence
from app.modules.reports.timing_validation import validate_timing
from tests import test_business_impact as fixtures
from tests.report_timing_fixtures import attach_timing

experiment = fixtures.experiment


def timed_experiment(effect=30, lag=2, **kwargs):
    definition, metadata, series = experiment(effect, **kwargs)
    study = definition["impact"]
    study["decision_id"] = 7
    study["timing_evidence"] = ImpactTimingEvidence(status="supported", message="Consistent historical timing.",
        report_id="earlier-report", finding_id="earlier-finding", driver={"dataset_id": 4, "metric_key": "ad_spend"},
        driver_label="Advertising / Ad spend", outcome=study["outcome"], lag=lag, grain="weekly",
        history_window={"start": definition["date_range"]["start"], "end": str((pd.Timestamp(study["change_date"]) - pd.Timedelta(days=1)).date())},
        reporting_timezone=definition.get("reporting_timezone"), outcome_date_column="date", outcome_aggregation="sum", evidence_digest="test"
    ).model_dump(mode="json")
    return definition, metadata, series


class TimingValidationTests(unittest.TestCase):
    def validate(self, lag=2, changed_lag=None, trend=False, gap=False, enabled=True, direction="a_leads_b", length=240, method="pearson"):
        rng = np.random.default_rng(9)
        driver = rng.normal(0, 20, length)
        outcome = np.roll(driver, lag) + rng.normal(0, .5, length)
        if changed_lag is not None:
            outcome[length // 2:] = np.roll(driver, changed_lag)[length // 2:]
        if trend:
            driver = np.arange(length) * 10 + rng.normal(0, 1, length)
            outcome = np.arange(length) * 10 + rng.normal(0, 1, length)
        dates = pd.date_range("2022-01-03", periods=length, freq="W-MON")
        refs = [{"dataset_id": identity, "metric_key": "orders"} for identity in (1, 2)]
        series = {f"{i}:orders": pd.DataFrame({"period": dates, "value": values}) for i, values in ((1, driver), (2, outcome))}
        if gap:
            series["2:orders"].loc[50, "value"] = np.nan
        definition = experiment()[0]
        definition["method"] = method
        definition["lag"].update(enabled=enabled, maximum=12, direction=direction)
        rows = compute_pair(*refs, series, definition)
        selected = next(item for item in rows if item["selected"])
        return validate_timing(*refs, series, definition, selected, direction)

    def test_known_zero_and_nonzero_timing_need_independent_historical_checks(self):
        for method in ("pearson", "spearman"):
            for lag in (0, 1, 2, 7, 12):
                result = self.validate(lag, method=method)
                self.assertEqual(result["status"], "supported", result)
                self.assertEqual(result["lag"], lag)
                self.assertEqual(len(result["checks"]), 2)
                self.assertTrue(all(row["adjusted_p_value"] < .05 for row in result["checks"]))

    def test_untested_zero_unstable_delays_shared_trends_gaps_and_short_history_are_not_advice(self):
        for arguments in ({"enabled": False}, {"direction": "same_period"}, {"changed_lag": 7},
                          {"trend": True}, {"gap": True}, {"length": 52}):
            with self.subTest(arguments=arguments):
                self.assertEqual(self.validate(**arguments)["status"], "unavailable")


class TimedImpactCalculationTests(unittest.TestCase):
    def test_early_and_later_results_use_one_pre_action_baseline_and_reconcile_to_total(self):
        definition, metadata, series = timed_experiment(0)
        periods = series["1:orders"].period
        change = pd.Timestamp(definition["impact"]["change_date"])
        early = (periods >= change) & (periods < change + pd.Timedelta(weeks=2))
        later = periods >= change + pd.Timedelta(weeks=2)
        series["1:orders"].loc[early, "value"] += 5
        series["1:orders"].loc[later, "value"] += np.linspace(10, 35, later.sum())
        result = evaluate_impact(series, definition, metadata)
        self.assertEqual(result["status"], "estimated", result)
        self.assertEqual(result["early_periods"], 2)
        self.assertEqual(result["later_periods"], 44)
        self.assertEqual(result["change_date"], str(change.date()))
        self.assertEqual(result["method"], "pre_action_controlled_counterfactual_hac")
        early_phase, later_phase = result["phases"]
        self.assertAlmostEqual(early_phase["effect"], 10, delta=15)
        self.assertAlmostEqual(later_phase["effect"], 990, delta=50)
        self.assertAlmostEqual(sum(row["effect"] for row in result["phases"]), result["estimate"]["effect"])
        self.assertAlmostEqual(sum(row["actual"] for row in result["phases"]), result["estimate"]["actual"])
        for phase in result["phases"]:
            self.assertLess(phase["lower"], phase["upper"])
        self.assertEqual(result["trend"][110]["response_phase"], "early")
        self.assertEqual(result["trend"][112]["response_phase"], "later")
        self.assertIn("timing", impact_facts(result))
        self.assertNotIn("trend", impact_facts(result))
        email = " ".join(impact_lines({"impact_analysis": result}))
        for text in ("Early results", "Later results", "Early results remain included", "Suggested response window"):
            self.assertIn(text, email)
        json.dumps(result, allow_nan=False)

    def test_delayed_null_negative_and_positive_effects_across_repeated_seeds(self):
        false_alarms = misses = measured = 0
        for effect in (0, 30, -30):
            for seed in range(20):
                definition, metadata, series = timed_experiment(0, seed=seed)
                later = series["1:orders"].period >= pd.Timestamp(definition["impact"]["change_date"]) + pd.Timedelta(weeks=2)
                series["1:orders"].loc[later, "value"] += effect
                result = evaluate_impact(series, definition, metadata)
                if not result["estimate"]:
                    continue  # Reliability checks can correctly withhold an estimate.
                measured += 1
                estimated = result["estimate"]
                target = effect * later.sum()
                misses += not estimated["lower"] <= target <= estimated["upper"]
                false_alarms += effect == 0 and estimated["verdict"] != "unclear"
                if effect:
                    self.assertEqual(estimated["verdict"], "helped" if effect > 0 else "hurt")
        self.assertGreaterEqual(measured, 45)
        self.assertLessEqual(false_alarms, 3)
        self.assertLessEqual(misses, 8)

    def test_one_early_observation_has_nonzero_uncertainty_and_rates_are_not_summed(self):
        definition, metadata, series = timed_experiment(lag=1)
        metadata["1:orders"].update(additive=False, aggregation="avg")
        result = evaluate_impact(series, definition, metadata)
        self.assertEqual(result["status"], "estimated", result)
        early = result["phases"][0]
        self.assertEqual(early["observations"], 1)
        self.assertGreater(early["upper"] - early["lower"], 1)
        self.assertFalse(result["estimate"]["is_total"])
        self.assertAlmostEqual(sum(phase["effect"] * phase["observations"] for phase in result["phases"]) / result["after_periods"], result["estimate"]["effect"])

    def test_readiness_uses_observations_after_the_suggested_window_not_just_the_action(self):
        definition, metadata, series = timed_experiment(periods=120, lag=4)
        result = evaluate_impact(series, definition, metadata)
        self.assertEqual(result["headline"], "Waiting for enough results.")
        self.assertEqual(result["early_periods"], 4)
        self.assertEqual(result["later_periods"], 6)
        self.assertIsNone(result["estimate"])

    def test_future_dates_and_the_current_incomplete_day_do_not_count_as_results(self):
        definition, metadata, series = timed_experiment()
        with patch("app.modules.reports.impact.datetime") as clock:
            clock.now.return_value = datetime(2025, 3, 17, 12, tzinfo=timezone.utc)
            result = evaluate_impact(series, definition, metadata)
        self.assertEqual(result["observed_through"], "2025-03-16")
        self.assertEqual(result["after_periods"], 5)
        self.assertEqual(result["later_periods"], 3)
        self.assertEqual(result["headline"], "Waiting for enough results.")
        self.assertIsNone(result["estimate"])

    def test_missing_unknown_post_action_and_incompatible_timing_withhold_amount(self):
        definition, metadata, series = timed_experiment()
        for edit in ({"status": "unavailable", "message": "Not established"}, {"lag": None}, {"grain": None},
                     {"history_window": {"start": "2023-01-01", "end": definition["impact"]["change_date"]}},
                     {"outcome_date_column": "paid_date"}, {"outcome_aggregation": "avg"}, {"reporting_timezone": "America/Halifax"},
                     {"driver": definition["impact"]["comparison"]},
                     {"outcome_filter": {"dataset_id": 1, "column": "region", "values": ["East"]}}):
            study = copy.deepcopy(definition)
            study["impact"]["timing_evidence"].update(edit)
            result = evaluate_impact(series, study, metadata)
            self.assertIsNone(result["estimate"], edit)
        definition["impact"]["timing_evidence"] = None
        self.assertIsNone(evaluate_impact(series, definition, metadata)["estimate"])

    def test_calendar_lag_units_do_not_change_with_impact_grouping(self):
        self.assertEqual(response_date("2025-01-31", 1, "monthly"), "2025-02-28")
        self.assertEqual(response_date("2024-02-29", 1, "quarterly"), "2024-05-29")
        definition, metadata, series = timed_experiment()
        evidence = definition["impact"]["timing_evidence"]
        evidence.update(lag=10, grain="daily")
        result = evaluate_impact(series, definition, metadata)
        self.assertEqual(result["timing"]["expected_response_date"], "2025-02-20")
        self.assertEqual(result["timing"]["later_period_start"], "2025-02-24")

    def test_post_action_outcomes_cannot_change_baseline_or_the_historical_delay(self):
        definition, metadata, series = timed_experiment(0)
        first = evaluate_impact(series, definition, metadata)
        series["1:orders"].loc[110:, "value"] += np.arange(46) * 10
        second = evaluate_impact(series, definition, metadata)
        self.assertEqual(first["baseline"], second["baseline"])
        self.assertEqual(first["timing"], second["timing"])
        np.testing.assert_allclose([row["without_change"] for row in first["trend"]], [row["without_change"] for row in second["trend"]])

    def test_trimming_history_cannot_silently_fit_a_singular_baseline(self):
        from app.modules.reports.impact import _fit
        from app.modules.reports.impact_response import timed_response

        rng = np.random.default_rng(4)
        periods = pd.date_range("2023-01-02", periods=130, freq="W-MON")
        before = np.arange(130) < 100
        driver = np.zeros(130)
        driver[:20] = rng.normal(0, 2, 20)
        design = pd.DataFrame({"constant": np.ones(130), "time": np.arange(130) / 100, "comparison": driver}, index=periods)
        values = 100 + design.to_numpy() @ np.array([1, 5, 10]) + rng.normal(0, 1, 130)
        with self.assertRaisesRegex(ValueError, "trimmed baseline"):
            timed_response(values, design, before, ~before, "weekly", {"lag": 2, "grain": "weekly"}, str(periods[100].date()), True, _fit)


class ImpactTimingWorkflowTests(unittest.TestCase):
    def setUp(self):
        fixtures.BusinessImpactWorkflowTests.setUp(self)

    def test_server_uses_authorized_source_not_client_lag_and_freezes_saved_assessment(self):
        from app.infrastructure.analysis_worker import execute_job
        from app.modules.reports.models import BusinessReport

        source_id, snapshot = attach_timing(self)
        self.definition["impact"]["timing_evidence"] = timed_experiment(lag=12)[0]["impact"]["timing_evidence"]
        job = self.client.post("/api/v2/business-reports/jobs", json=self.definition)
        self.assertEqual(job.status_code, 202, job.text)
        execute_job(job.json()["job_id"])
        saved = self.client.post(f"/api/v2/business-reports/jobs/{job.json()['job_id']}/save")
        self.assertEqual(saved.status_code, 201, saved.text)
        result = saved.json()
        self.assertEqual(result["impact_analysis"]["timing"]["lag"], 2)
        self.assertEqual(result["impact_analysis"]["timing"]["report_id"], source_id)
        with self.Session() as db:
            db.delete(db.get(BusinessReport, source_id)); db.commit()
        reopened = self.client.get(f"/api/v2/business-reports/{result['report_id']}")
        self.assertEqual(reopened.status_code, 200, reopened.text)
        self.assertEqual(reopened.json()["impact_analysis"], result["impact_analysis"])

    def test_deleted_or_revoked_source_cancels_queued_work_and_does_not_expose_source_names(self):
        from app.infrastructure.analysis_worker import execute_job
        from app.db.models import Dataset
        from app.modules.decisions.models import Decision

        attach_timing(self)
        queued = self.client.post("/api/v2/business-reports/jobs", json=self.definition).json()
        with self.Session() as db:
            db.get(Dataset, 4).workspace_id = "private"
            db.get(Dataset, 4).user_id = "private"
            db.commit()
            evidence = decision_timing(db, db.get(Decision, self.decision_id), self.definition["impact"]["outcome"], "owner", "owner")
            self.assertEqual(evidence["status"], "unavailable")
            self.assertNotIn("Advertising", json.dumps(evidence))
        execute_job(queued["job_id"])
        result = self.client.get(f"/api/v2/business-reports/jobs/{queued['job_id']}").json()
        self.assertEqual(result["status"], "failed", result)
        self.assertIn("timing evidence changed", result["error"])

    def test_missing_source_legacy_snapshots_and_post_action_history_are_not_fabricated(self):
        from app.modules.decisions.models import Decision
        from app.modules.reports.models import BusinessReport

        with self.Session() as db:
            decision = db.get(Decision, self.decision_id)
            evidence = decision_timing(db, decision, self.definition["impact"]["outcome"], "owner", "owner")
            self.assertEqual(evidence["status"], "unavailable")
        source_id, snapshot = attach_timing(self)
        with self.Session() as db:
            decision = db.get(Decision, self.decision_id)
            evidence = decision_timing(db, decision, self.definition["impact"]["outcome"], "owner", "owner")
            self.assertEqual(evidence["status"], "supported")
            snapshot["findings"][0].pop("timing_validation")
            db.get(BusinessReport, source_id).snapshot = json.dumps(snapshot); db.commit()
            self.assertEqual(decision_timing(db, decision, self.definition["impact"]["outcome"], "owner", "owner")["status"], "unavailable")

    def test_multiple_reliable_drivers_require_an_explicit_relationship_not_an_arbitrary_delay(self):
        from app.db.models import Dataset
        from app.modules.decisions.models import Decision
        from app.modules.reports.models import BusinessReport

        source_id, snapshot = attach_timing(self)
        alternative = copy.deepcopy(snapshot["findings"][0])
        driver = next(alternative[key] for key in ("metric_a", "metric_b") if alternative[key]["dataset_id"] == 4)
        driver.update(dataset_id=5, id="5:ad_spend", dataset_label="Other advertising.csv")
        alternative.update(id="1:orders|5:ad_spend|2", lead_metric="5:ad_spend")
        alternative["timing_validation"]["lead_metric"] = "5:ad_spend"
        snapshot["definition"]["metrics"].append({**snapshot["definition"]["metrics"][1], "dataset_id": 5})
        snapshot["findings"].append(alternative)
        snapshot["included_findings"].append(alternative["id"])
        with self.Session() as db:
            db.add(Dataset(id=5, user_id="owner", workspace_id="owner", file_name="Other advertising.csv", file_path="unused.csv", source_type="csv", row_count=100, column_count=2))
            db.get(BusinessReport, source_id).snapshot = json.dumps(snapshot); db.commit()
            decision = db.get(Decision, self.decision_id)
            choose = decision_timing(db, decision, self.definition["impact"]["outcome"], "owner", "owner")
            self.assertEqual(choose["status"], "choose_relationship")
            self.assertIsNone(choose["lag"])
            self.assertEqual(len(choose["choices"]), 2)
            selected = decision_timing(db, decision, self.definition["impact"]["outcome"], "owner", "owner", alternative["id"])
            self.assertEqual(selected["status"], "supported")
            self.assertEqual(selected["driver"]["dataset_id"], 5)
            self.assertEqual(decision_timing(db, decision, self.definition["impact"]["outcome"], "owner", "owner", "unknown")["status"], "choose_relationship")

    def test_weekly_queue_and_email_keep_original_calendar_delay_and_fresh_timing(self):
        from app.infrastructure.analysis_worker import execute_job
        from app.modules.reports.jobs import enqueue_weekly
        from app.db.models import WeeklyReportPreference
        from app.modules.alerts.email_delivery import build_weekly_report_email_html, build_weekly_report_email_text
        from app.modules.alerts.schemas import WeeklyReportDigestResponse

        source_id, _ = attach_timing(self)
        self.definition["impact"]["timing_evidence"] = None  # Existing template created before timing metadata.
        with self.Session() as db:
            preference = WeeklyReportPreference(workspace_id="owner", enabled=0, weekly_report_definition=json.dumps(self.definition),
                metric_focus=json.dumps(["1:orders", "2:comparison_orders"]))
            db.add(preference); db.commit()
            job = enqueue_weekly(db, "owner", "owner", preference, include_ai=False)
            identity = job.id
            frozen = json.loads(job.definition)["configuration"]["template"]["impact"]["timing_evidence"]
            self.assertEqual(frozen["lag"], 2)
        with patch("app.modules.alerts.router.load_dataframe_from_dataset", side_effect=lambda source: self.frames[source.id][1].copy()), \
             patch("app.modules.alerts.router.get_weekly_report_branding", return_value={"brand_name": "Decisionate"}):
            execute_job(identity)
        result = self.client.get(f"/api/v2/business-reports/jobs/{identity}").json()
        self.assertEqual(result["status"], "succeeded", result)
        analysis = result["result"]["cross_dataset_report"]["impact_analysis"]
        self.assertEqual(analysis["timing"]["lag"], 2)
        self.assertEqual(analysis["timing"]["report_id"], source_id)
        self.assertEqual(analysis["timing"]["expected_response_date"], "2025-02-24")
        digest = WeeklyReportDigestResponse.model_validate(result["result"])
        for content in (build_weekly_report_email_html(digest), build_weekly_report_email_text(digest)):
            self.assertIn("Suggested response window", content)
            self.assertIn("Early results remain included", content)
        digest.cross_dataset_report["impact_analysis"]["timing"]["driver_label"] = "<script>driver</script>"
        html = build_weekly_report_email_html(digest)
        self.assertIn("&lt;script&gt;driver&lt;/script&gt;", html)
        self.assertNotIn("<script>", html)
