import unittest
from unittest.mock import patch

from fastapi import HTTPException

from app.db.models import Dataset
from app.modules.reports import router
from app.modules.reports.models import ReportAnalysisJob
from app.modules.reports.service import build_report
from tests import test_business_reports as fixtures


class JoinedReportSourceTests(unittest.TestCase):
    def setUp(self):
        fixtures.BusinessReportWorkflowTests.setUp(self)

    def join_source(self, source_type="joined"):
        with self.Session() as db:
            db.get(Dataset, 1).source_type = source_type
            db.commit()
        self.frames[1][0].source_type = source_type

    def test_joined_sources_are_filtered_from_metadata_full_catalog_search_and_direct_lookups(self):
        self.join_source(" Joined ")
        with patch.object(router, "load_dataframe_from_dataset", side_effect=AssertionError("No file reads")) as loader:
            for scope in ("single", "multi"):
                for query in (f"metadata_only=true&scope={scope}", f"dataset_id=1&scope={scope}", f"metadata_only=true&scope={scope}&search=Source 1"):
                    response = self.client.get("/api/v2/business-reports/catalog?" + query)
                    self.assertEqual(response.status_code, 200, response.text)
                    self.assertNotIn(1, [item["dataset_id"] for item in response.json()["datasets"]])
            loader.assert_not_called()
        for scope in ("single", "multi"):
            result = self.client.get(f"/api/v2/business-reports/catalog?scope={scope}").json()
            self.assertEqual([item["dataset_id"] for item in result["datasets"]], [2])
        response = self.client.get("/api/v2/business-reports/catalog?dataset_id=1")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["datasets"][0]["dataset_id"], 1)
        self.assertEqual(response.json()["datasets"][0]["metrics"][0]["metric_key"], "spend")
        self.assertEqual(self.client.get("/api/v2/business-reports/catalog?scope=multi&dataset_id=3").json()["datasets"], [])

    def test_filtering_precedes_pagination_and_does_not_hide_original_or_entity_sources(self):
        with self.Session() as db:
            db.get(Dataset, 1).file_name = "joined-looking-name.csv"
            for identity in range(4, 66):
                db.add(Dataset(id=identity, user_id="owner", workspace_id="owner", file_name=f"Source {identity}",
                               file_path="private-storage-path", source_type="joined" if identity % 2 == 0 else "csv",
                               source_config="{}", row_count=0, column_count=0))
            db.get(Dataset, 5).source_type = "entity_matching"
            db.commit()
        with patch.object(router, "load_dataframe_from_dataset", side_effect=AssertionError("No file reads")):
            for scope in ("single", "multi"):
                first = self.client.get(f"/api/v2/business-reports/catalog?metadata_only=true&scope={scope}").json()
                self.assertEqual(len(first["datasets"]), 25)
                self.assertEqual(first["next_offset"], 25)
                last = self.client.get(f"/api/v2/business-reports/catalog?metadata_only=true&scope={scope}&offset=25").json()
                self.assertIsNone(last["next_offset"])
                identities = [item["dataset_id"] for page in (first, last) for item in page["datasets"]]
                self.assertEqual(identities, [1, 2, *range(5, 66, 2)])
                self.assertNotIn("private-storage-path", str(first))

    def test_all_three_report_modes_reject_joined_sources_before_enqueue_or_file_reads(self):
        self.join_source()
        with patch.object(router, "load_dataframe_from_dataset", side_effect=AssertionError("No file reads")) as loader:
            for mode in ({}, {"include_relationships": False}, {"scope": "single", "metrics": fixtures.definition()["metrics"][:1]}):
                for path in (("/jobs", "/preview") if mode.get("scope") == "single" else ("/jobs", "/preview", "/weekly-preview-jobs")):
                    payload = fixtures.definition(**mode, grain="weekly" if path == "/weekly-preview-jobs" else "daily")
                    response = self.client.post("/api/v2/business-reports" + path, json=payload)
                    self.assertEqual(response.status_code, 400, response.text)
                    self.assertIn("Choose original datasets", response.json()["detail"])
            loader.assert_not_called()
        with self.Session() as db:
            self.assertEqual(db.query(ReportAnalysisJob).count(), 0)

    def test_engine_rejects_joined_sources_in_all_modes_but_original_single_sources_still_run(self):
        self.join_source()
        for mode in ({}, {"include_relationships": False}, {"scope": "single", "metrics": fixtures.definition()["metrics"][:1]}):
            with self.assertRaises(HTTPException) as error:
                build_report(self.frames, fixtures.definition(**mode))
            self.assertEqual(error.exception.status_code, 400)
        payload = fixtures.definition(scope="single", metrics=fixtures.definition()["metrics"][1:], include_anomalies=False)
        response = self.client.post("/api/v2/business-reports/preview", json=payload)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["dataset_count"], 1)
        self.assertEqual(response.json()["metrics"][0]["id"], "2:net_sales")

    def test_saved_snapshots_remain_readable_even_if_their_source_is_now_joined(self):
        saved = fixtures.BusinessReportWorkflowTests.save(self)
        single = self.client.post("/api/v2/business-reports", json=fixtures.definition(scope="single", metrics=fixtures.definition()["metrics"][:1]))
        self.assertEqual(single.status_code, 201, single.text)
        self.join_source()
        for snapshot in (saved, single.json()):
            response = self.client.get(f"/api/v2/business-reports/{snapshot['report_id']}")
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()["metrics"], snapshot["metrics"])
            self.assertEqual(response.json()["findings"], snapshot["findings"])


if __name__ == "__main__":
    unittest.main()
