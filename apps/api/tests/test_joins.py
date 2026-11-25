import unittest
from types import SimpleNamespace
from unittest.mock import patch

import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.models import Dataset, DatasetJoinCache
from app.modules.datasets import router as datasets
from app.modules.datasets.services.joins import (
    build_join_dataset_metadata,
    build_joined_dataset,
)
from app.modules.datasets.schemas import DatasetJoinRequest
from app.modules.datasets.services.join_cache import build_join_definition
from pydantic import ValidationError
from app.modules.datasets.services.numeric import (
    coerce_numeric_series,
    get_numeric_columns,
)


class DatasetJoinDateRangeTests(unittest.TestCase):
    def setUp(self):
        dates = ["2026-05-17T23:59:00Z", "2026-05-18T00:00:00Z", "2026-05-18T23:59:00Z", "2026-05-19T00:00:00Z", "2026-05-20T00:00:00Z"]
        self.frames = []
        self.selections = []
        for identity in [1, 2]:
            frame = pd.DataFrame({"date": dates, "revenue": [999, 10, 20, 30, 999]})
            dataset = SimpleNamespace(id=identity, file_name=f"sales-{identity}.csv", row_count=len(frame))
            self.frames.append((dataset, frame, build_join_dataset_metadata(dataset, frame)))
            self.selections.append({"dataset_id": identity, "date_column": "date", "metric_columns": ["revenue"]})

    def test_explicit_dates_exclude_both_outside_boundaries_before_joining(self):
        result = build_joined_dataset(self.frames, self.selections, "2026-05-18", end_date="2026-05-19")
        self.assertEqual(result["matched_period_count"], 1)
        self.assertEqual([row["period"] for row in result["rows"]], ["2026-05-01"])
        for metric in result["datasets"]:
            self.assertEqual([row[metric["label"]] for row in result["rows"]], [60])
        self.assertEqual(result["end_date"], "2026-05-19")

    def test_one_day_and_end_only_ranges_include_the_entire_end_day(self):
        for start, expected in [("2026-05-18", 30), (None, 1029)]:
            result = build_joined_dataset(self.frames, self.selections, start, end_date="2026-05-18")
            self.assertEqual(result["matched_period_count"], 1)
            for metric in result["datasets"]:
                self.assertEqual(result["rows"][0][metric["label"]], expected)

    def test_cached_definition_preserves_the_end_date_for_recalculation(self):
        definition = build_join_definition(self.selections, "2026-05-18", "all", "monthly", "sum", end_date="2026-05-19")
        self.assertEqual(definition["end_date"], "2026-05-19")
        self.assertNotIn("end_date", build_join_definition(self.selections, None, "all", "monthly", "sum"))

    def test_request_rejects_invalid_or_reversed_dates(self):
        for end in ["2026-05-17", "not-a-date", "2026-02-30"]:
            with self.assertRaises(ValidationError):
                DatasetJoinRequest(selections=self.selections, start_date="2026-05-18", end_date=end)
        payload = DatasetJoinRequest(selections=self.selections, start_date="2026-05-18", end_date="2026-05-18")
        self.assertEqual(str(payload.end_date), "2026-05-18")


class DatasetJoinMetadataTests(unittest.TestCase):
    def test_metadata_skips_date_inference_assertion(self):
        dataframe = pd.DataFrame({
            "event_date": ["2026-01-01", "2026-01-02"],
            "revenue": [100, 125],
        })
        dataset = SimpleNamespace(
            id=1708,
            file_name="dataset.csv",
            row_count=2,
        )

        with patch(
            "app.modules.datasets.services.joins._parse_dates",
            side_effect=AssertionError(
                "Something has gone wrong, please report a bug"
            ),
        ):
            metadata = build_join_dataset_metadata(
                dataset,
                dataframe,
            )

        self.assertEqual(metadata["date_columns"], [])
        self.assertEqual(metadata["numeric_columns"], ["revenue"])
        self.assertEqual(
            metadata["date_range"],
            {"start": None, "end": None},
        )

    def test_numeric_inference_skips_only_failing_column(self):
        dataframe = pd.DataFrame({
            "bad_metric": [1, 2],
            "revenue": [100, 125],
        })
        original_coerce = coerce_numeric_series

        def coerce_with_one_failure(series):
            if series.name == "bad_metric":
                raise AssertionError(
                    "Something has gone wrong, please report a bug"
                )
            return original_coerce(series)

        with patch(
            "app.modules.datasets.services.numeric.coerce_numeric_series",
            side_effect=coerce_with_one_failure,
        ):
            numeric_columns = get_numeric_columns(dataframe)

        self.assertEqual(
            [column for column, _series in numeric_columns],
            ["revenue"],
        )


class FilteredJoinCopyTests(unittest.TestCase):
    def test_metrics_only_join_can_be_filtered_by_an_original_dimension_without_replacing_it(self):
        engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
        self.addCleanup(engine.dispose)
        for model in (Dataset, DatasetJoinCache):
            model.__table__.create(engine)
        sessions = sessionmaker(bind=engine)
        with sessions() as db:
            for identity, name in [(1, "Sales"), (2, "Ads")]:
                db.add(Dataset(id=identity, user_id="owner", workspace_id="workspace", file_name=name,
                               file_path=f"{name}.csv", row_count=2, column_count=3))
            db.commit()

        frames = {
            1: pd.DataFrame({"date": ["2026-01-01", "2026-01-02"], "region": ["East", "West"], "revenue": [5, 100]}),
            2: pd.DataFrame({"date": ["2026-01-01", "2026-01-02"], "spend": [10, 10]}),
        }
        stored = {}

        def persist(frame, *_):
            key = f"join-{len(stored) + 1}.parquet"
            stored[key] = frame.copy()
            return key, "local", key

        app = FastAPI()
        app.include_router(datasets.router, prefix="/datasets")
        with patch.object(datasets, "SessionLocal", sessions), patch.object(
            datasets, "get_user_id", return_value="owner",
        ), patch.object(datasets, "get_workspace_id", return_value="workspace"), patch.object(
            datasets, "require_workspace_data_manager",
        ) as require_manager, patch.object(
            datasets, "load_dataframe", side_effect=lambda db, identity, **_: (db.get(Dataset, identity), frames[identity]),
        ), patch.object(
            datasets, "load_dataframe_from_dataset", side_effect=lambda dataset, **_: stored[dataset.file_path],
        ), patch.object(datasets, "persist_joined_dataset_dataframe", side_effect=persist), patch.object(
            datasets, "remove_dataset_file",
        ) as remove:
            client = TestClient(app)
            payload = {"dashboard_key": "general-business", "start_date": "2026-01-01", "end_date": "2026-01-31", "selections": [
                {"dataset_id": 1, "date_column": "date", "metric_columns": ["revenue"]},
                {"dataset_id": 2, "date_column": "date", "metric_columns": ["spend"]},
            ]}
            original = client.post("/datasets/join", json=payload)
            self.assertEqual(original.status_code, 200, original.text)
            original_id = original.json()["derived_dataset_id"]
            catalog = client.get(f"/datasets/{original_id}/dimensions")
            self.assertEqual(catalog.status_code, 200, catalog.text)
            self.assertEqual(catalog.json()["columns"], [])
            change = {"dashboard_key": payload["dashboard_key"], "source_dataset_id": 1,
                      "dimension_filter": {"column": "region", "values": ["East"]}}
            path = f"/datasets/{original_id}/join/filtered-copy"
            require_manager.side_effect = HTTPException(403, "Workspace data manager required.")
            self.assertEqual(client.post(path, json=change).status_code, 403)
            self.assertEqual(len(stored), 1)
            require_manager.side_effect = None
            self.assertEqual(client.post(path, json={**change, "source_dataset_id": 999}).status_code, 422)
            filtered = client.post(path, json=change)
            self.assertEqual(filtered.status_code, 200, filtered.text)
            filtered_id = filtered.json()["derived_dataset_id"]
            self.assertNotEqual(filtered_id, original_id)
            self.assertEqual(filtered.json()["rows"], [{"period": "2026-01-01", "Sales · revenue": 5, "Ads · spend": 20}])
            self.assertEqual(filtered.json()["end_date"], "2026-01-31")
            remove.assert_not_called()

        with sessions() as db:
            self.assertEqual(db.get(Dataset, original_id).file_path, "join-1.parquet")
            self.assertEqual(stored["join-1.parquet"]["Sales · revenue"].tolist(), [105])
            self.assertEqual(db.get(Dataset, filtered_id).file_path, "join-2.parquet")


if __name__ == "__main__":
    unittest.main()
