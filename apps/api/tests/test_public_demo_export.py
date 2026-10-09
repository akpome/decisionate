import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from scripts.export_public_demo import export_public_demo
from app.modules.demo_dashboard import DEMO_DATASET_DEFINITIONS


class PublicDemoExportTests(unittest.TestCase):
    def test_export_keeps_all_samples_with_content_hashes(self):
        with tempfile.TemporaryDirectory() as directory:
            web_root = Path(directory)
            entries = export_public_demo(web_root)
            self.assertEqual(
                [entry["key"] for entry in entries], list(DEMO_DATASET_DEFINITIONS)
            )
            catalog = web_root / "features/demo/data/catalog.json"
            self.assertEqual(json.loads(catalog.read_text()), entries)

            for entry in entries:
                path = web_root / "public" / entry["asset"].lstrip("/")
                encoded = path.read_bytes()
                digest = hashlib.sha256(encoded).hexdigest()[:12]
                self.assertEqual(path.name, f"{entry['key']}.{digest}.json")
                payload = json.loads(encoded)
                self.assertTrue(payload["demo"])
                self.assertEqual(payload["selected_dataset"], entry["key"])
                self.assertEqual(len(payload["dataset"]["chart"]["data"]), 365)
                self.assertTrue(
                    all(value is False for value in payload["capabilities"].values())
                )
                self.assertTrue(payload["dataset"]["metrics"])
