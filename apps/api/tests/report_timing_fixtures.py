"""Synthetic historical evidence with a known two-week driver lead."""

import copy
import json
from types import SimpleNamespace

import pandas as pd

from app.db.models import Dataset
from app.modules.decisions.models import Decision
from app.modules.reports.models import BusinessReport
from app.modules.reports.schemas import ReportDefinition
from app.modules.reports.service import build_report


def attach_timing(test, lag=2):
    outcome = test.frames[1][1].iloc[:104].copy()
    driver = outcome.iloc[:-lag].copy() if lag else outcome.copy()
    driver["ad_spend"] = outcome["orders"].to_numpy()[lag:]
    driver = driver[["date", "ad_spend"]]
    source = SimpleNamespace(id=4, source_type="csv", file_name="Advertising.csv",
                             source_config=json.dumps({"selected_metric_columns": ["ad_spend"]}))
    test.frames[4] = source, driver
    left = copy.deepcopy(test.definition["metrics"][0])
    right = {"dataset_id": 4, "metric_key": "ad_spend", "date_column": "date", "aggregation": "sum"}
    definition = ReportDefinition(name="Earlier staffing relationship", business_question="Does staffing lead completed orders?",
        metrics=[left, right], grain="weekly", method="pearson", filters={"minimum_observations": 52},
        date_range={"start": str(driver.date.iloc[0].date()), "end": str((driver.date.iloc[-1] + pd.Timedelta(days=6)).date())},
        lag={"enabled": True, "maximum": 12},
        pair_directions=[{"metric_a": {key: left[key] for key in ("dataset_id", "metric_key")},
                          "metric_b": {key: right[key] for key in ("dataset_id", "metric_key")}, "direction": "b_leads_a"}]
    ).model_dump(mode="json")
    snapshot = build_report({1: test.frames[1], 4: test.frames[4]}, definition)
    test.assertEqual(snapshot["findings"][0]["timing_validation"]["status"], "supported", snapshot["findings"][0])
    test.assertEqual(snapshot["findings"][0]["lag"], lag)
    with test.Session() as db:
        db.add(Dataset(id=4, user_id="owner", workspace_id="owner", file_name=source.file_name, file_path="unused.csv",
                       source_type="csv", source_config=source.source_config, row_count=len(driver), column_count=2))
        report = BusinessReport(workspace_id="owner", user_id="owner", name=definition["name"],
                                definition=json.dumps(snapshot["definition"]), snapshot=json.dumps(snapshot))
        db.add(report); db.flush()
        db.get(Decision, test.decision_id).recommendation_context = json.dumps({"evidence_kind": "business_report", "report_id": report.id})
        identity = report.id
        db.commit()
    return identity, snapshot
