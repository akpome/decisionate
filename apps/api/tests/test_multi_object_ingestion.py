import json
import unittest
from types import SimpleNamespace

from app.modules.datasets import router as datasets_router
from app.modules.datasets.schemas import DataSourceConnectionSync


class MultiObjectIngestionTests(unittest.TestCase):
    def test_child_payload_selects_only_its_configured_object(self):
        payload = DataSourceConnectionSync(resource_type="invoices")

        self.assertEqual(
            datasets_router.select_connector_resource_types(
                ["invoices", "customers"],
                payload,
            ),
            ["invoices"],
        )

    def test_parent_keeps_successful_objects_when_one_child_fails(self):
        successful_child = SimpleNamespace(
            id=11,
            object_type="invoices",
            status=datasets_router.INGESTION_JOB_SUCCEEDED,
            error_message=None,
            result_payload=json.dumps({
                "datasets": [{"dataset_id": 101}],
            }),
        )
        failed_child = SimpleNamespace(
            id=12,
            object_type="customers",
            status=datasets_router.INGESTION_JOB_FAILED,
            error_message="Provider rejected this object",
            result_payload=None,
        )
        connection = SimpleNamespace(id=7)

        result, failures = datasets_router._build_parent_connector_job_result(
            connection,
            [successful_child, failed_child],
        )

        self.assertEqual([item["dataset_id"] for item in result["datasets"]], [101])
        self.assertEqual(result["failed_object_types"], ["customers"])
        self.assertTrue(result["partial"])
        self.assertEqual(failures, [failed_child])


if __name__ == "__main__":
    unittest.main()
