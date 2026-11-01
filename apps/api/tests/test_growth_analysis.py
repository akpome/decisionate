import json
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch

import pandas as pd
from pydantic import ValidationError

from app.modules.performance.growth_schemas import CashFlowDefinition, ConversionDefinition, RetentionDefinition, definition_adapter, references
from app.modules.performance.growth_service import calculate_growth
from app.modules.performance.models import PerformanceAnalysis
from app.modules.reports.models import ReportAnalysisJob
from tests import test_performance_analysis as performance_tests


def source(frame, identity=1, name="records.csv"):
    dataset = SimpleNamespace(id=identity, file_name=name, source_type="csv", source_config=json.dumps({
        "selected_metric_columns": [key for key in ("revenue", "ad_spend", "website_visits", "leads", "customers") if key in frame]}))
    return {identity: (dataset, frame)}


def retention_definition(**changes):
    return RetentionDefinition(**(dict(kind="retention", source={"dataset_id": 1, "date_column": "date"}, customer_column="customer_id",
        order_column="order_id", date_range={"start": "2025-01-01", "end": "2025-04-30"}, return_days=30, amounts_confirmed=True) | changes))


def purchases():
    return source(pd.DataFrame([
        ["2024-12-01", "older", "old"], ["2025-01-02", "older", "old-next"],
        ["2025-01-01", "private-A", "a-1"], ["2025-01-01", "private-A", "a-1"],
        ["2025-01-31", "private-A", "a-2"], ["2025-01-15", "private-B", "b-1"],
        ["2025-03-01", "private-B", "b-2"], ["2025-04-30", "new", "n-1"],
    ], columns=["date", "customer_id", "order_id"]))


def conversion_definition(**changes):
    return ConversionDefinition(**(dict(kind="conversion", source={"dataset_id": 1, "date_column": "date"},
        date_range={"start": "2025-01-01", "end": "2025-01-03"}, amounts_confirmed=True,
        steps=[{"name": "Visitors", "metric_key": "website_visits"}, {"name": "Enquiries", "metric_key": "leads"}, {"name": "Buyers", "metric_key": "customers"}]) | changes))


def pipeline():
    return source(pd.DataFrame({"date": pd.date_range("2025-01-01", periods=3),
                               "website_visits": [100, 100, 100], "leads": [40, 30, 30], "customers": [10, 5, 5]}))


def cash_definition(**changes):
    return CashFlowDefinition(**(dict(kind="cashflow", source={"dataset_id": 1, "date_column": "date"},
        start_date="2027-01-01", weeks=4, currency="CAD", opening_balance=200, reserve=100,
        incoming_metric="revenue", outgoing_metric="ad_spend", amounts_confirmed=True) | changes))


def payments():
    return source(pd.DataFrame({"date": ["2027-01-01", "2027-01-08"], "revenue": [100, 500], "ad_spend": [200, 50], "currency": ["CAD", "CAD"]}))


def separate_payments():
    return {
        **source(pd.DataFrame({"collection_date": ["2027-01-01", "2027-01-08", "2027-01-10"],
            "revenue": [100, 500, 999], "region": ["East", "East", "West"], "currency": ["CAD"] * 3}), name="receipts.csv"),
        **source(pd.DataFrame({"due_date": ["2027-01-02", "2027-01-09", "2027-01-15"],
            "revenue": [200, 50, 999], "region": ["East", "East", "West"], "currency": ["CAD"] * 3}), identity=2, name="bills.csv"),
    }


def separate_cash_definition(**changes):
    return cash_definition(**(dict(source={"dataset_id": 1, "date_column": "collection_date", "dimension_filter": {"column": "region", "values": ["East"]}},
        outgoing_source={"dataset_id": 2, "date_column": "due_date", "dimension_filter": {"column": "region", "values": ["East"]}},
        outgoing_metric="revenue") | changes))


class GrowthCalculationTests(unittest.TestCase):
    def test_retention_counts_purchases_once_and_only_mature_customers(self):
        result = calculate_growth(purchases(), retention_definition())
        self.assertEqual(result["status"], "ready", result)
        january = result["rows"][0]
        self.assertEqual((january["eligible"], january["returned"], january["rate"]), (2, 1, 50))
        self.assertEqual(result["rows"][-1]["waiting"], 1)
        self.assertNotIn("private-A", json.dumps(result))
        self.assertNotIn("a-1", json.dumps(result))

    def test_retention_never_calls_immature_customers_lost(self):
        payload = retention_definition(date_range={"start": "2025-04-01", "end": "2025-04-30"})
        result = calculate_growth(purchases(), payload)
        self.assertEqual(result["status"], "needs_data")
        self.assertIn("too early", result["headline"])
        self.assertFalse(any(row["ready"] for row in result["rows"]))

    def test_retention_checks_conflicting_purchase_ids_and_missing_identifiers(self):
        for failure in ("customer", "purchase", "conflict", "date"):
            with self.subTest(failure=failure):
                data = purchases()
                if failure == "customer": data[1][1].loc[2, "customer_id"] = None
                if failure == "purchase": data[1][1].loc[2, "order_id"] = " "
                if failure == "conflict": data[1][1].loc[3, "customer_id"] = "different"
                if failure == "date": data[1][1].loc[2, "date"] = "bad"
                result = calculate_growth(data, retention_definition())
                self.assertEqual(result["status"], "needs_data")
                self.assertTrue(result["next_action"])

    def test_retention_filters_scope_first_recorded_purchase(self):
        data = purchases(); data[1][1]["store"] = ["East", "East", "West", "West", "West", "East", "East", "East"]
        payload = retention_definition(source={"dataset_id": 1, "date_column": "date", "dimension_filter": {"column": "store", "values": ["West"]}})
        result = calculate_growth(data, payload)
        self.assertEqual(result["status"], "ready", result)
        self.assertEqual(result["rows"][0]["eligible"], 1)
        self.assertEqual(result["rows"][0]["returned"], 1)

    def test_conversion_uses_totals_and_identifies_largest_loss(self):
        result = calculate_growth(pipeline(), conversion_definition())
        self.assertEqual(result["status"], "ready", result)
        self.assertEqual(result["rows"][0]["rate"], 6.67)
        self.assertEqual(result["rows"][0]["lost"], 280)
        self.assertIn("Visitors and Enquiries: 200", result["next_action"])

    def test_conversion_inconsistent_fractional_or_missing_counts_never_rank(self):
        for counts in ([101, 101, 101], [1.5, 1, 1], [-1, 1, 1], [None, 1, 1]):
            data = pipeline(); data[1][1]["leads"] = counts
            result = calculate_growth(data, conversion_definition())
            self.assertEqual(result["status"], "needs_data", result)
            self.assertIsNone(result["rows"][0]["rate"])
            self.assertTrue(result["rows"][0]["issues"])

    def test_conversion_zero_counts_and_empty_dates(self):
        data = pipeline()
        data[1][1][["website_visits", "leads", "customers"]] = 0
        self.assertEqual(calculate_growth(data, conversion_definition())["status"], "needs_data")
        self.assertEqual(calculate_growth(pipeline(), conversion_definition(date_range={"start": "2024-01-01", "end": "2024-01-03"}))["status"], "needs_data")

    def test_conversion_grouped_rates_are_weighted_by_entrants(self):
        data = pipeline(); data[1][1]["channel"] = "A"
        extra = data[1][1].copy(); extra["channel"] = "B"; extra["website_visits"] = 1000
        data[1] = data[1][0], pd.concat([data[1][1], extra], ignore_index=True)
        result = calculate_growth(data, conversion_definition(group_column="channel"))
        self.assertEqual(result["status"], "ready", result)
        self.assertEqual(result["highlights"][-1]["value"], 1.21)
        self.assertEqual(len(result["rows"]), 2)

    def test_cash_balances_and_empty_schedule_weeks(self):
        result = calculate_growth(payments(), cash_definition())
        self.assertEqual(result["status"], "ready", result)
        self.assertEqual([row["balance"] for row in result["rows"]], [100, 550, 550, 550])
        self.assertEqual(result["highlights"][0]["value"], 550)
        self.assertEqual(result["rows"][-1]["incoming"], 0)

    def test_cash_separate_sources_use_own_dates_filters_and_same_named_amounts(self):
        payload = separate_cash_definition()
        refs = references(payload)
        self.assertEqual([(ref.dataset_id, ref.date_column, ref.metric_key) for ref in refs],
            [(1, "collection_date", "revenue"), (2, "due_date", "revenue")])
        result = calculate_growth(separate_payments(), payload)
        self.assertEqual(result["status"], "ready", result)
        self.assertEqual(result["rows"], calculate_growth(payments(), cash_definition())["rows"])
        self.assertEqual(result["definition"]["outgoing_source"]["dimension_filter"]["values"], ["East"])

    def test_cash_separate_sources_apply_delays_only_to_receipts(self):
        data = separate_payments()
        before = {identity: frame.copy(deep=True) for identity, (_, frame) in data.items()}
        result = calculate_growth(data, separate_cash_definition(collection_delay_days=7))
        self.assertEqual(result["status"], "ready", result)
        self.assertEqual([row["balance"] for row in result["rows"]], [0, 50, 550, 550])
        self.assertEqual([row["baseline"] for row in result["rows"]], [100, 550, 550, 550])
        for identity, (_, frame) in data.items():
            pd.testing.assert_frame_equal(frame, before[identity])
        changed = calculate_growth(data, separate_cash_definition(income_change_percent=-50, cost_change_percent=20))
        self.assertEqual(changed["rows"][-1]["balance"], 200)

    def test_cash_one_direction_can_have_no_payments_in_the_plan(self):
        for outside, expected in (([1], -50), ([2], 800), ([1, 2], None)):
            with self.subTest(outside=outside):
                data = separate_payments()
                for identity in outside:
                    date_column = "collection_date" if identity == 1 else "due_date"
                    data[identity][1][date_column] = pd.to_datetime(data[identity][1][date_column]) + pd.DateOffset(years=1)
                result = calculate_growth(data, separate_cash_definition())
                if expected is None:
                    self.assertEqual(result["status"], "needs_data", result)
                    self.assertFalse(result["rows"])
                else:
                    self.assertEqual(result["status"], "ready", result)
                    self.assertEqual(result["rows"][-1]["balance"], expected)

    def test_cash_invalid_outgoing_records_are_not_replaced_by_zero(self):
        for failure in ("currency", "missing", "negative", "date", "column", "filter"):
            with self.subTest(failure=failure):
                data, changes = separate_payments(), {}
                frame = data[2][1]
                if failure == "currency": frame["currency"] = "USD"
                if failure == "missing": frame.loc[0, "revenue"] = None
                if failure == "negative": frame.loc[0, "revenue"] = -10
                if failure == "date": frame.loc[0, "due_date"] = "bad"
                if failure == "column": changes["outgoing_metric"] = "unknown"
                if failure == "filter": changes["outgoing_source"] = {"dataset_id": 2, "date_column": "due_date", "dimension_filter": {"column": "region", "values": ["Unknown"]}}
                result = calculate_growth(data, separate_cash_definition(**changes))
                self.assertEqual(result["status"], "needs_data", result)
                self.assertEqual(result["rows"], [])

    def test_cash_legacy_definitions_and_source_validation(self):
        legacy = cash_definition().model_dump(mode="json", exclude={"outgoing_source"})
        restored = definition_adapter.validate_python(legacy)
        self.assertIsNone(restored.outgoing_source)
        self.assertEqual([ref.dataset_id for ref in references(restored)], [1, 1])
        self.assertEqual(calculate_growth(payments(), restored)["rows"], calculate_growth(payments(), cash_definition())["rows"])
        with self.assertRaises(ValidationError):
            separate_cash_definition(outgoing_source={"dataset_id": 1, "date_column": "date"})

    def test_delayed_receipts_warn_about_cash_shortfall_and_keep_baseline(self):
        result = calculate_growth(payments(), cash_definition(collection_delay_days=7))
        self.assertEqual(result["status"], "ready", result)
        self.assertEqual([row["balance"] for row in result["rows"]], [0, 50, 550, 550])
        self.assertEqual([row["baseline"] for row in result["rows"]], [100, 550, 550, 550])
        self.assertIn("2027-01-01", result["headline"])
        self.assertEqual(result["highlights"][-1]["value"], 100)

    def test_cash_adjustments_and_receipts_beyond_plan_are_explicit(self):
        result = calculate_growth(payments(), cash_definition(income_change_percent=-50, cost_change_percent=20))
        self.assertEqual(result["rows"][-1]["balance"], 200)
        delayed = calculate_growth(payments(), cash_definition(collection_delay_days=90))
        self.assertEqual(delayed["rows"][-1]["balance"], -50)
        self.assertEqual(sum(row["incoming"] for row in delayed["rows"]), 0)

    def test_cash_requires_real_schedule_and_valid_matching_currency_amounts(self):
        for failure in ("currency", "missing", "negative", "outside"):
            data = payments()
            if failure == "currency": data[1][1]["currency"] = "USD"
            if failure == "missing": data[1][1].loc[0, "revenue"] = None
            if failure == "negative": data[1][1].loc[0, "ad_spend"] = -10
            if failure == "outside": data[1][1]["date"] = ["2024-01-01", "2024-01-08"]
            result = calculate_growth(data, cash_definition())
            self.assertEqual(result["status"], "needs_data", result)
            self.assertEqual(result["rows"], [])

    def test_schemas_validate_bounds_distinct_columns_and_required_confirmation(self):
        for make, changes in [(retention_definition, {"customer_column": "date"}),
                              (cash_definition, {"opening_balance": float("nan")}), (cash_definition, {"weeks": 100}),
                              (cash_definition, {"outgoing_metric": "revenue"}), (conversion_definition, {"steps": [{"name": "A", "metric_key": "leads"}] * 2})]:
            with self.subTest(changes=changes), self.assertRaises(ValidationError): make(**changes)
        for make, data in [(retention_definition, purchases()), (conversion_definition, pipeline()), (cash_definition, payments())]:
            result = calculate_growth(data, make(amounts_confirmed=False))
            self.assertEqual(result["status"], "needs_data")
            self.assertEqual(result["rows"], [])
            json.dumps(result, allow_nan=False)


class GrowthRouteTests(unittest.TestCase):
    setUp = performance_tests.PerformanceRoutesTests.setUp

    def test_separate_cash_sources_survive_worker_save_reopen_and_outgoing_cleanup(self):
        from app.infrastructure import analysis_worker
        from app.modules.reports.cleanup import cleanup_source
        payload, data = separate_cash_definition(), separate_payments()
        response = self.client.post("/api/v2/performance-analyses/jobs", json=payload.model_dump(mode="json"))
        self.assertEqual(response.status_code, 202, response.text)
        job_id = response.json()["job_id"]
        with self.sessions() as db:
            self.assertEqual(set(json.loads(db.get(ReportAnalysisJob, job_id).sources)), {"1", "2"})
        loaded = set()
        def load_source(dataset, **kwargs):
            loaded.add(dataset.id)
            return data[dataset.id][1]
        with patch.object(analysis_worker, "SessionLocal", self.sessions), patch("app.modules.performance.service.load_dataframe_from_dataset", side_effect=load_source) as load:
            analysis_worker.execute_job(job_id)
        self.assertEqual(loaded, {1, 2})
        self.assertEqual(load.call_count, 2)
        saved = self.client.post(f"/api/v2/performance-analyses/jobs/{job_id}/save")
        self.assertEqual(saved.status_code, 201, saved.text)
        identity = saved.json()["analysis_id"]
        reopened = self.client.get(f"/api/v2/performance-analyses/{identity}").json()
        self.assertEqual(reopened["definition"]["outgoing_source"], payload.model_dump(mode="json")["outgoing_source"])
        self.assertEqual(reopened["rows"][-1]["balance"], 550)
        create = AsyncMock(return_value=SimpleNamespace(id=77))
        with patch("app.modules.decisions.router.require_decision_manager"), patch("app.modules.decisions.router.create_decision", create):
            response = self.client.post(f"/api/v2/performance-analyses/{identity}/decision", json={"title": "Review upcoming payments", "action": "Review payment dates and follow up on expected receipts.", "expected_outcome": "Keep enough cash for the planned payments.", "review_date": "2027-02-01"})
        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(create.call_args.args[0].evidence_dataset_ids, [1, 2])
        self.assertEqual({(metric.dataset_id, metric.metric_column) for metric in create.call_args.args[0].evidence_metrics}, {(1, "revenue"), (2, "revenue")})
        with self.sessions() as db:
            cleanup_source(db, 2)
            db.commit()
            self.assertIsNone(db.get(PerformanceAnalysis, identity))

    def test_separate_cash_sources_recheck_outgoing_data_before_saving(self):
        from app.db.models import Dataset
        payload = separate_cash_definition()
        job_id = self.client.post("/api/v2/performance-analyses/jobs", json=payload.model_dump(mode="json")).json()["job_id"]
        with self.sessions() as db:
            job = db.get(ReportAnalysisJob, job_id)
            job.status, job.result = "succeeded", json.dumps(calculate_growth(separate_payments(), payload))
            db.get(Dataset, 2).row_count += 1
            db.commit()
        self.assertEqual(self.client.post(f"/api/v2/performance-analyses/jobs/{job_id}/save").status_code, 409)

    def test_separate_cash_sources_require_access_to_the_outgoing_dataset(self):
        from app.db.models import Dataset
        with self.sessions() as db:
            db.get(Dataset, 2).workspace_id = "other"
            db.get(Dataset, 2).user_id = "other"
            db.commit()
        response = self.client.post("/api/v2/performance-analyses/jobs", json=separate_cash_definition().model_dump(mode="json"))
        self.assertIn(response.status_code, (403, 404), response.text)

    def test_all_three_use_worker_preview_save_history_and_cleanup(self):
        from app.infrastructure import analysis_worker
        from app.modules.reports.cleanup import cleanup_source
        for payload, data in [(retention_definition(), purchases()), (conversion_definition(), pipeline()), (cash_definition(), payments())]:
            with self.subTest(kind=payload.kind):
                response = self.client.post("/api/v2/performance-analyses/jobs", json=payload.model_dump(mode="json"))
                self.assertEqual(response.status_code, 202, response.text)
                job_id = response.json()["job_id"]
                with patch.object(analysis_worker, "SessionLocal", self.sessions), patch("app.modules.performance.service.load_dataframe_from_dataset", return_value=data[1][1]) as load:
                    analysis_worker.execute_job(job_id)
                load.assert_called_once()
                saved = self.client.post(f"/api/v2/performance-analyses/jobs/{job_id}/save")
                self.assertEqual(saved.status_code, 201, saved.text)
                saved_id = saved.json()["analysis_id"]
                self.assertEqual(self.client.post(f"/api/v2/performance-analyses/jobs/{job_id}/save").json()["analysis_id"], saved_id)
                self.assertEqual(len(self.client.get(f"/api/v2/performance-analyses?kind={payload.kind}").json()["analyses"]), 1)
                definition_adapter.validate_python(self.client.get(f"/api/v2/performance-analyses/{saved_id}").json()["definition"])
        with self.sessions() as db:
            cleanup_source(db, 1); db.commit()
            self.assertEqual(db.query(PerformanceAnalysis).count(), 0)

    def test_retention_decision_keeps_aggregate_evidence_not_customer_identifiers(self):
        payload = retention_definition()
        job_id = self.client.post("/api/v2/performance-analyses/jobs", json=payload.model_dump(mode="json")).json()["job_id"]
        with self.sessions() as db:
            job = db.get(ReportAnalysisJob, job_id)
            job.status, job.result = "succeeded", json.dumps(calculate_growth(purchases(), payload))
            db.commit()
        saved = self.client.post(f"/api/v2/performance-analyses/jobs/{job_id}/save").json()["analysis_id"]
        create = AsyncMock(return_value=SimpleNamespace(id=77))
        with patch("app.modules.decisions.router.require_decision_manager"), patch("app.modules.decisions.router.create_decision", create):
            response = self.client.post(f"/api/v2/performance-analyses/{saved}/decision", json={"title": "Review repeat purchases", "action": "Test a follow-up offer with a small customer group.", "expected_outcome": "Increase repeat purchases within ninety days.", "review_date": "2027-01-01"})
            self.assertEqual(response.status_code, 201, response.text)
        self.assertIsNone(create.call_args.args[0].metric_column)
        self.assertEqual(create.call_args.args[0].evidence_metrics, [])
        self.assertNotIn("private-A", create.call_args.args[0].recommendation_context)


if __name__ == "__main__":
    unittest.main()
