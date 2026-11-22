import copy
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from urllib.parse import parse_qs, urlsplit
import unittest
from unittest.mock import patch

import pandas as pd
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.database import Base
from app.db.models import Dataset
from app.modules.alerts.email_delivery import weekly_decision_link
from app.modules.decisions import metric_plans as plans
from app.modules.decisions.models import Decision
from app.modules.decisions.router import has_required_attention
from app.modules.decisions.schemas import MetricPlan


class AutomaticReviewTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite://")
        Base.metadata.create_all(engine)
        self.addCleanup(engine.dispose)
        self.db = sessionmaker(bind=engine)()
        self.addCleanup(self.db.close)
        self.frames = {}
        for i, key in [(1, "spend"), (2, "orders")]:
            self.db.add(Dataset(id=i, workspace_id="shop", user_id="owner", file_path="unused", file_name=key+".csv",
                                row_count=14, column_count=2, source_type="csv", source_config='{"selected_metric_columns":["'+key+'"]}'))
            values = ([100] * 7 + [112] * 7) if i == 1 else ([20] * 7 + [21] * 7)
            self.frames[i] = pd.DataFrame({"date": pd.date_range("2025-01-01", periods=14), key: values})
        self.db.commit()
        self.start = date(2025, 1, 8)
        self.request = MetricPlan(start=self.start, review=self.start + timedelta(days=7),
            input={"dataset_id": 1, "metric_key": "spend", "direction": "increase", "unit": "percent", "change": 10},
            output={"dataset_id": 2, "metric_key": "orders", "direction": "increase", "unit": "amount", "change": 20})
        p = patch.object(plans, "load_dataframe_from_dataset", lambda ds: self.frames[ds.id].copy())
        p.start(); self.addCleanup(p.stop)

    def preview(self):
        return plans.preview(self.db, "owner", "shop", self.request)

    def save(self, review):
        d = Decision(clerk_user_id="owner", workspace_id="shop", dataset_id=2, title="Spend and orders",
                     expected_outcome="More orders", status="planned", review_date=datetime(2025, 1, 15))
        plans.store_review(d, review)
        self.db.add(d); self.db.commit()
        return d

    def test_two_targets_fixed_windows_and_mixed_results(self):
        review, previous = self.preview()
        self.assertIsNone(previous)
        self.assertEqual(review["checks"]["input"], {"baseline": 700, "target": 770, "actual": 784, "status": "met"})
        self.assertEqual(review["checks"]["output"], {"baseline": 140, "target": 160, "actual": 147, "status": "missed"})
        self.request.input.direction = "decrease"
        self.frames[1].loc[7:, "spend"] = 90
        self.assertEqual(self.preview()[0]["checks"]["input"]["status"], "met")
        self.assertEqual(plans.windows(self.start, self.request.review, 2),
                         {"before":{"start":"2025-01-03","end":"2025-01-07"}, "after":{"start":"2025-01-10","end":"2025-01-14"}})

    def test_worker_retries_missing_day_and_freezes_when_closed(self):
        self.frames[2].loc[9, "orders"] = float("nan")
        review, _ = self.preview()
        self.assertEqual(review["status"], "waiting")
        self.assertEqual(review["checks"]["input"]["status"], "met")
        d = self.save(review)
        q = self.db.query(Decision).filter(has_required_attention(datetime.now()))
        self.assertEqual(q.count(), 0)
        self.frames[2].loc[9, "orders"] = 34
        d.next_metric_check = datetime(2025, 1, 16)
        self.db.commit()
        plans.run_next_review(self.db)
        self.assertEqual(d.metric_review["checks"]["output"]["status"], "met")
        self.assertEqual(d.status, "planned")
        self.assertEqual(q.count(), 1)
        d.status = "completed"; self.db.commit()
        self.frames[2].loc[9, "orders"] = 250
        plans.refresh(self.db, d, on_open=True)
        self.assertEqual(d.outcome_measured_value, 160)
        self.assertEqual(q.count(), 0)

    def test_prior_decision_matches_scope_direction_and_duration_not_workspace_or_future(self):
        review, _ = self.preview()
        d = self.save(review)
        self.assertIsNone(self.preview()[1])
        self.request.start += timedelta(days=14); self.request.review += timedelta(days=14)
        self.assertEqual(self.preview()[1]["id"], d.id)
        self.request.input.direction = "decrease"
        self.assertIsNone(self.preview()[1])
        self.request.input.direction = "increase"
        d.workspace_id = "other"; self.db.commit()
        self.assertIsNone(self.preview()[1])
        filtered = copy.deepcopy(review["plan"])
        filtered["input"]["filter"] = {"column": "channel", "values": ["Search", "Social"]}
        before = plans.comparable_key(filtered)
        self.assertNotEqual(before, plans.comparable_key(review["plan"]))
        filtered["input"]["filter"]["values"].reverse()
        self.assertEqual(before, plans.comparable_key(filtered))

    def test_zero_baseline_and_unauthorized_source(self):
        self.frames[1].loc[:6, "spend"] = 0
        with self.assertRaisesRegex(ValueError, "zero"):
            self.preview()
        self.request.input.unit = "amount"
        self.assertEqual(self.preview()[0]["checks"]["input"]["target"], 10)
        with self.assertRaises(HTTPException):
            plans.preview(self.db, "other-user", "other-workspace", self.request)

    def test_email_routes_to_workspace_on_same_agency_host(self):
        digest = SimpleNamespace(review_url="https://agency.decisionate.app/weekly-reports?weekly=1")
        url = urlsplit(weekly_decision_link(digest, {"id": 23, "workspace_id": "owner:client:42"}))
        self.assertEqual((url.hostname, url.path), ("agency.decisionate.app", "/auth/redirect"))
        path = urlsplit(parse_qs(url.query)["redirect_url"][0])
        self.assertEqual(path.path, "/decisions/23")
        self.assertEqual(parse_qs(path.query)["workspace_id"], ["owner:client:42"])

    def test_report_filter_follows_plan_and_weekly_summary_uses_both_metric_scopes(self):
        from app.modules.reports.models import BusinessReport
        from app.modules.reports.intelligence_decisions import attach_continuity
        refs = [{"dataset_id": i, "metric_key": key, "date_column": "date", "aggregation": "sum"}
                for i, key in [(1, "spend"), (2, "orders")]]
        self.frames[1]["channel"] = "Search"
        other = self.frames[1].assign(channel="Social", spend=900)
        self.frames[1] = pd.concat([self.frames[1], other], ignore_index=True)
        definition = {"metrics": refs, "reporting_timezone": "UTC",
                      "dimension_filters": [{"dataset_id": 1, "column": "channel", "values": ["Search"]}]}
        snapshot = {"status": "ready", "definition": definition, "findings": []}
        self.db.add(BusinessReport(id="evidence", workspace_id="shop", user_id="owner", name="Channels",
                    definition=plans.encode(definition), snapshot=plans.encode(snapshot)))
        self.db.commit()
        self.request.report_id = "evidence"
        review, _ = self.preview()
        self.assertEqual(review["checks"]["input"]["baseline"], 700)
        decision = self.save(review)
        decision.metric_column = "orders"; self.db.commit()
        report = {"definition": definition, "window": {}, "previous_window": {},
                  "generated_at": datetime.now(timezone.utc).isoformat(),
                  "intelligence": {"findings": [], "recommendations": [], "quality": []},
                  "metrics": [{**ref, "id": f"{ref['dataset_id']}:{ref['metric_key']}",
                               "dataset_label": "shop", "label": ref["metric_key"], "value": 20,
                               "currency": review["plan"][role]["currency"]} for ref, role in zip(refs, plans.ROLES)]}
        attach_continuity(report, self.db, "shop")
        summary, = report["intelligence"]["decisions"]
        self.assertEqual((summary["id"], summary["assessment"]), (decision.id, review["summary"]))
        report["definition"]["dimension_filters"] = []
        attach_continuity(report, self.db, "shop")
        self.assertEqual(report["intelligence"]["decisions"], [])
