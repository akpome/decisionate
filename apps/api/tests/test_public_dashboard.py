import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException

from app.modules.public_dashboard import (
    build_public_dashboard_brand_response,
    build_public_dashboard_dataset_response,
    get_clean_dataset_preference_entry,
    get_dataset_preference_entry,
    get_dashboard_preference,
    get_public_shared_dashboard,
    is_valid_share_token,
    normalize_share_token,
    parse_json_object_preference,
    parse_json_preference,
    raise_shared_dashboard_not_found,
)
from app.modules.organizations.router import (
    clean_dashboard_preferences,
    clean_metric_targets,
)
import pandas as pd


class PublicDashboardTests(unittest.TestCase):
    def test_public_brand_uses_report_name_and_saved_colors(self):
        organization = SimpleNamespace(
            name="Northstar Agency",
            report_display_name="Northstar Advisory",
            logo_url="https://example.com/logo.png",
            primary_color="#123456",
            accent_color="#ABCDEF",
        )

        self.assertEqual(
            build_public_dashboard_brand_response(
                organization,
            ),
            {
                "name": "Northstar Advisory",
                "logo_url": "https://example.com/logo.png",
                "primary_color": "#123456",
                "accent_color": "#ABCDEF",
            },
        )

    def test_public_brand_supports_direct_workspace_defaults(self):
        organization = SimpleNamespace(
            name="Acme Retail",
            report_display_name="",
            logo_url=None,
            primary_color=None,
            accent_color=None,
        )

        self.assertEqual(
            build_public_dashboard_brand_response(
                organization,
            ),
            {
                "name": "Acme Retail",
                "logo_url": None,
                "primary_color": "#2563EB",
                "accent_color": "#14B8A6",
            },
        )

    def test_public_brand_uses_safe_defaults_without_organization(self):
        self.assertEqual(
            build_public_dashboard_brand_response(
                None,
            ),
            {
                "name": "Decisionate",
                "logo_url": None,
                "primary_color": "#2563EB",
                "accent_color": "#14B8A6",
            },
        )

    def test_normalize_share_token_strips_whitespace(self):
        self.assertEqual(
            normalize_share_token("  abc123  "),
            "abc123",
        )

    def test_normalize_share_token_returns_none_for_blank(self):
        self.assertIsNone(
            normalize_share_token("   "),
        )
        self.assertIsNone(
            normalize_share_token(None),
        )
        self.assertIsNone(
            normalize_share_token(123),
        )

    def test_share_token_validation_accepts_trimmed_token(self):
        self.assertTrue(
            is_valid_share_token(
                " abc123 ",
                " abc123 ",
            )
        )

    def test_share_token_validation_rejects_missing_or_wrong_token(self):
        self.assertFalse(
            is_valid_share_token(
                "abc123",
                None,
            )
        )
        self.assertFalse(
            is_valid_share_token(
                "abc123",
                "wrong",
            )
        )

    def test_parse_json_preference_returns_none_for_invalid_json(self):
        self.assertIsNone(
            parse_json_preference("{invalid"),
        )
        self.assertIsNone(
            parse_json_preference(123),
        )
        self.assertEqual(
            parse_json_preference(
                {
                    "1": {
                        "target": 10,
                    },
                },
            ),
            {
                "1": {
                    "target": 10,
                },
            },
        )

    def test_parse_json_object_preference_accepts_objects(self):
        self.assertEqual(
            parse_json_object_preference('{"1": {"target": 10}}'),
            {
                "1": {
                    "target": 10,
                },
            },
        )
        self.assertEqual(
            parse_json_object_preference(
                {
                    "1": {
                        "target": 10,
                    },
                },
            ),
            {
                "1": {
                    "target": 10,
                },
            },
        )

    def test_parse_json_object_preference_rejects_non_objects(self):
        self.assertIsNone(
            parse_json_object_preference("[1, 2, 3]"),
        )
        self.assertIsNone(
            parse_json_object_preference('"value"'),
        )
        self.assertIsNone(
            parse_json_object_preference(123),
        )

    def test_get_dataset_preference_entry_returns_matching_dataset_only(self):
        self.assertEqual(
            get_dataset_preference_entry(
                {
                    "1": {
                        "revenue": 100,
                    },
                    "2": {
                        "revenue": 200,
                    },
                },
                2,
            ),
            {
                "2": {
                    "revenue": 200,
                },
            },
        )

    def test_get_dataset_preference_entry_rejects_missing_or_bad_entry(self):
        self.assertIsNone(
            get_dataset_preference_entry(
                {
                    "2": [
                        "bad",
                    ],
                },
                2,
            )
        )
        self.assertIsNone(
            get_dataset_preference_entry(
                {
                    "1": {
                        "revenue": 100,
                    },
                },
                2,
            )
        )

    def test_get_clean_dataset_preference_entry_sanitizes_legacy_values(self):
        self.assertEqual(
            get_clean_dataset_preference_entry(
                '{"7": {" revenue ": 100, "bad": "nan"}, "0": {"x": 1}}',
                7,
                clean_metric_targets,
            ),
            {
                "7": {
                    "revenue": 100.0,
                },
            },
        )

    def test_get_clean_dataset_preference_entry_preserves_dashboard_title(self):
        self.assertEqual(
            get_clean_dataset_preference_entry(
                '{"7": {"title": "  Sales   Board  ", "subtitle": " Weekly  KPIs ", "chartType": "line"}, "8": {"title": "Other"}}',
                7,
                clean_dashboard_preferences,
            ),
            {
                "7": {
                    "title": "Sales Board",
                    "subtitle": "Weekly KPIs",
                    "chartType": "line",
                },
            },
        )

    def test_shared_dashboard_not_found_uses_no_store_header(self):
        with self.assertRaises(HTTPException) as context:
            raise_shared_dashboard_not_found()

        self.assertEqual(
            context.exception.status_code,
            404,
        )
        self.assertEqual(
            context.exception.headers,
            {
                "Cache-Control": "no-store",
            },
        )

    def test_get_dashboard_preference_uses_shared_workspace_lookup(self):
        db = SimpleNamespace()
        dataset = SimpleNamespace(
            user_id="user-1",
            workspace_id="workspace-1",
        )
        preference = SimpleNamespace(
            selected_dataset_id=7,
        )

        with patch(
            "app.modules.public_dashboard.find_user_preference",
            return_value=preference,
        ) as find_preference:
            result = get_dashboard_preference(
                db,
                dataset,
            )

        self.assertIs(
            result,
            preference,
        )
        find_preference.assert_called_once_with(
            db,
            "user-1",
            "workspace-1",
        )

    def test_public_dataset_response_includes_source_metadata(self):
        dataset = SimpleNamespace(
            file_name="sales.json",
            source_type="json",
            source_config='{"ingestion_mode": "upload"}',
        )
        dataframe = pd.DataFrame({
            "month": [
                "Jan",
            ],
            "revenue": [
                10,
            ],
        })

        response = build_public_dashboard_dataset_response(
            dataset,
            dataframe,
        )

        self.assertEqual(
            response["file_name"],
            "sales.json",
        )
        self.assertEqual(
            response["source_type"],
            "json",
        )
        self.assertEqual(
            response["source_label"],
            "JSON",
        )
        self.assertEqual(
            response["source_config"],
            '{"ingestion_mode": "upload"}',
        )
        self.assertEqual(
            response["metrics"][0]["column"],
            "revenue",
        )

    def test_public_dashboard_response_includes_workspace_branding(self):
        response = SimpleNamespace(
            headers={},
        )
        db = SimpleNamespace(
            close=lambda: None,
        )
        dataset = SimpleNamespace(
            id=7,
            user_id="user-1",
            workspace_id="workspace-1",
            share_token="token",
            file_name="sales.json",
            source_type="json",
            source_config='{"ingestion_mode": "upload"}',
        )
        dataframe = pd.DataFrame({
            "month": [
                "Jan",
            ],
            "revenue": [
                10,
            ],
        })
        branding = {
            "name": "Northstar Advisory",
            "logo_url": None,
            "primary_color": "#123456",
            "accent_color": "#ABCDEF",
        }

        with patch(
            "app.modules.public_dashboard.SessionLocal",
            return_value=db,
        ), patch(
            "app.modules.public_dashboard.load_dataset",
            return_value=dataset,
        ), patch(
            "app.modules.public_dashboard.load_dataframe_from_dataset",
            return_value=dataframe,
        ), patch(
            "app.modules.public_dashboard.get_dashboard_preference",
            return_value=None,
        ), patch(
            "app.modules.public_dashboard.get_public_dashboard_brand",
            return_value=branding,
        ):
            result = asyncio.run(
                get_public_shared_dashboard(
                    7,
                    response,
                    "token",
                )
            )

        self.assertEqual(
            result["branding"],
            branding,
        )
        self.assertEqual(
            response.headers["Cache-Control"],
            "no-store",
        )

    def test_public_dashboard_hides_loader_http_errors(self):
        response = SimpleNamespace(
            headers={},
        )
        db = SimpleNamespace(
            close=lambda: None,
        )
        dataset = SimpleNamespace(
            id=7,
            user_id="user-1",
            workspace_id="workspace-1",
            share_token="token",
        )

        with patch(
            "app.modules.public_dashboard.SessionLocal",
            return_value=db,
        ), patch(
            "app.modules.public_dashboard.load_dataset",
            return_value=dataset,
        ), patch(
            "app.modules.public_dashboard.load_dataframe_from_dataset",
            side_effect=HTTPException(
                status_code=503,
                detail="Analytics adapter unavailable",
            ),
        ):
            with self.assertRaises(
                HTTPException,
            ) as context:
                asyncio.run(
                    get_public_shared_dashboard(
                        7,
                        response,
                        "token",
                    )
                )

        self.assertEqual(
            context.exception.status_code,
            404,
        )
        self.assertEqual(
            context.exception.headers,
            {
                "Cache-Control": "no-store",
            },
        )
        self.assertEqual(
            response.headers["Cache-Control"],
            "no-store",
        )


if __name__ == "__main__":
    unittest.main()
