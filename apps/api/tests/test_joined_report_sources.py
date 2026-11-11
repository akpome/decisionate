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
            for query in ("metadata_only=true&scope=multi", "dataset_id=1&scope=multi", "metadata_only=true&scope=multi&search=Source 1"):
                response = self.client.get("/api/v2/business-reports/catalog?" + query)
                self.assertEqual(response.status_code, 200, response.text)
                self.assertNotIn(1, [item["dataset_id"] for item in response.json()["datasets"]])
            loader.assert_not_called()
        result = self.client.get("/api/v2/business-reports/catalog?scope=multi").json()
        self.assertEqual([item["dataset_id"] for item in result["datasets"]], [2])
        for suffix in ("", "&scope=single"):
            response = self.client.get("/api/v2/business-reports/catalog?dataset_id=1" + suffix)
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
            first = self.client.get("/api/v2/business-reports/catalog?metadata_only=true&scope=multi").json()
            self.assertEqual(len(first["datasets"]), 25)
            self.assertEqual(first["next_offset"], 25)
            last = self.client.get("/api/v2/business-reports/catalog?metadata_only=true&scope=multi&offset=25").json()
            self.assertIsNone(last["next_offset"])
        identities = [item["dataset_id"] for page in (first, last) for item in page["datasets"]]
        self.assertEqual(identities, [1, 2, *range(5, 66, 2)])
        self.assertNotIn("private-storage-path", str(first))

    def test_all_new_multi_report_requests_reject_joined_sources_before_enqueue_or_file_reads(self):
        self.join_source()
        with patch.object(router, "load_dataframe_from_dataset", side_effect=AssertionError("No file reads")) as loader:
            for include_relationships in (True, False):
                for path in ("/jobs", "/preview", "/weekly-preview-jobs"):
                    payload = fixtures.definition(include_relationships=include_relationships,
                                                  grain="weekly" if path == "/weekly-preview-jobs" else "daily")
                    response = self.client.post("/api/v2/business-reports" + path, json=payload)
                    self.assertEqual(response.status_code, 400, response.text)
                    self.assertIn("Single dataset report", response.json()["detail"])
            loader.assert_not_called()
        with self.Session() as db:
            self.assertEqual(db.query(ReportAnalysisJob).count(), 0)

    def test_engine_rejects_joined_multi_sources_but_single_reports_still_run(self):
        self.join_source()
        for include_relationships in (True, False):
            with self.assertRaises(HTTPException) as error:
                build_report(self.frames, fixtures.definition(include_relationships=include_relationships))
            self.assertEqual(error.exception.status_code, 400)
        payload = fixtures.definition(scope="single", metrics=fixtures.definition()["metrics"][:1], include_anomalies=False)
        response = self.client.post("/api/v2/business-reports/preview", json=payload)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["dataset_count"], 1)
        self.assertEqual(response.json()["metrics"][0]["id"], "1:spend")

    def test_saved_snapshots_remain_readable_even_if_their_source_is_now_joined(self):
        saved = fixtures.BusinessReportWorkflowTests.save(self)
        self.join_source()
        response = self.client.get(f"/api/v2/business-reports/{saved['report_id']}")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["metrics"], saved["metrics"])
        self.assertEqual(response.json()["findings"], saved["findings"])


if __name__ == "__main__":
    unittest.main()
