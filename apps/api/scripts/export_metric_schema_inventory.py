"""Export emitted schemas by exercising the repository's mocked connector tests."""

from __future__ import annotations

import functools
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.modules.datasets.services import connectors, google_analytics


MODULES = (
    "tests.test_connectors", "tests.test_new_connectors",
    "tests.test_google_analytics", "tests.test_sage_connector",
    "tests.test_xero_connector", "tests.test_zoho_books_connector",
)
SAFE_METADATA = {
    "connector", "resource", "resource_type", "object_type", "api_version",
    "api", "dimensions", "metrics", "line_item_key", "line_item_parent_keys",
}


def compact_inventory(schemas):
    result = {}
    for schema in schemas:
        metadata = schema["metadata"]
        connector = metadata.get("connector") or ("google_analytics" if schema["loader"] == "load_google_analytics_report" else "")
        resource = metadata.get("resource_type") or metadata.get("resource") or metadata.get("object_type") or "report"
        key = f"{connector}/{resource}/decisionate-v1"
        entry = result.setdefault(key, {"columns": set(), "api_versions": set()})
        entry["columns"].update(schema["columns"])
        if metadata.get("api_version"):
            entry["api_versions"].add(metadata["api_version"])
    return {key: {name: sorted(values) for name, values in entry.items()} for key, entry in sorted(result.items())}


def main():
    captured = {}
    for module in (connectors, google_analytics):
        for name, original in list(vars(module).items()):
            if not name.startswith("load_") or not (
                name.endswith("_dataframe") or name == "load_google_analytics_report"
            ):
                continue

            def wrap(function, function_name):
                @functools.wraps(function)
                def capture(*args, **kwargs):
                    result = function(*args, **kwargs)
                    if isinstance(result, tuple) and len(result) == 2:
                        frame, config = result
                        if hasattr(frame, "columns") and isinstance(config, dict):
                            metadata = {key: value for key, value in config.items() if key in SAFE_METADATA}
                            columns = {str(column): str(frame[column].dtype) for column in frame.columns}
                            key = json.dumps([function_name, metadata, columns], sort_keys=True)
                            captured[key] = {"loader": function_name, "metadata": metadata, "columns": columns}
                    return result
                return capture

            setattr(module, name, wrap(original, name))
    suite = unittest.defaultTestLoader.loadTestsFromNames(MODULES)
    result = unittest.TextTestRunner(stream=sys.stderr, verbosity=0).run(suite)
    if not result.wasSuccessful():
        return 1
    schemas = [captured[key] for key in sorted(captured)]
    payload = compact_inventory(schemas) if "--compact" in sys.argv else {"evidence": "existing_mocked_connector_contract_tests", "schemas": schemas}
    json.dump(payload, sys.stdout, indent=2, sort_keys=True)
    print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
