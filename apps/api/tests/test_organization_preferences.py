import unittest
from types import SimpleNamespace

from fastapi import HTTPException

from app.modules.organizations.router import (
    clean_optional_brand_color,
    clean_optional_logo_url,
    clean_optional_organization_text,
    clean_dashboard_preferences,
    clean_member_role,
    clean_member_user_id,
    clean_metric_targets,
    clean_invite_email,
    clean_organization_name,
    clean_preference_dataset_id,
    clean_optional_selected_metric,
    find_exact_user_preference,
    find_user_preference,
    parse_preference_json_object,
    serialize_user_preference,
)


class FakePreferenceQuery:
    def __init__(
        self,
        preference,
    ):
        self.preference = preference

    def filter(
        self,
        *args,
    ):
        return self

    def first(self):
        return self.preference


class FakePreferenceDb:
    def __init__(
        self,
        preferences,
    ):
        self.preferences = list(preferences)
        self.query_count = 0

    def query(
        self,
        model,
    ):
        preference = self.preferences[
            self.query_count
        ]
        self.query_count += 1

        return FakePreferenceQuery(
            preference,
        )


class OrganizationPreferenceTests(unittest.TestCase):
    def test_find_user_preference_prefers_workspace_match(self):
        workspace_preference = SimpleNamespace(
            workspace_id="workspace-1",
        )
        fallback_preference = SimpleNamespace(
            workspace_id=None,
        )
        db = FakePreferenceDb(
            [
                workspace_preference,
                fallback_preference,
            ]
        )

        preference = find_user_preference(
            db,
            "user-1",
            "workspace-1",
        )

        self.assertIs(
            preference,
            workspace_preference,
        )
        self.assertEqual(
            db.query_count,
            1,
        )

    def test_find_user_preference_falls_back_to_personal_preference(self):
        fallback_preference = SimpleNamespace(
            workspace_id=None,
        )
        db = FakePreferenceDb(
            [
                None,
                fallback_preference,
            ]
        )

        preference = find_user_preference(
            db,
            "user-1",
            "workspace-1",
        )

        self.assertIs(
            preference,
            fallback_preference,
        )
        self.assertEqual(
            db.query_count,
            2,
        )

    def test_find_user_preference_uses_personal_preference_without_workspace(self):
        fallback_preference = SimpleNamespace(
            workspace_id=None,
        )
        db = FakePreferenceDb(
            [
                fallback_preference,
            ]
        )

        preference = find_user_preference(
            db,
            "user-1",
            "",
        )

        self.assertIs(
            preference,
            fallback_preference,
        )
        self.assertEqual(
            db.query_count,
            1,
        )

    def test_find_exact_user_preference_does_not_use_personal_fallback(self):
        fallback_preference = SimpleNamespace(
            workspace_id=None,
        )
        db = FakePreferenceDb(
            [
                None,
                fallback_preference,
            ]
        )

        preference = find_exact_user_preference(
            db,
            "user-1",
            "workspace-1",
        )

        self.assertIsNone(
            preference,
        )
        self.assertEqual(
            db.query_count,
            1,
        )

    def test_parse_preference_json_object_rejects_invalid_or_non_object_values(self):
        self.assertEqual(
            parse_preference_json_object(
                {
                    "7": {
                        "revenue": 100,
                    },
                },
            ),
            {
                "7": {
                    "revenue": 100,
                },
            },
        )
        self.assertEqual(
            parse_preference_json_object(
                '{"7": {"revenue": 100}}',
            ),
            {
                "7": {
                    "revenue": 100,
                },
            },
        )
        self.assertIsNone(
            parse_preference_json_object(
                "{bad-json",
            )
        )
        self.assertIsNone(
            parse_preference_json_object(
                "[1, 2, 3]",
            )
        )
        self.assertIsNone(
            parse_preference_json_object(
                None,
            )
        )
        self.assertIsNone(
            parse_preference_json_object(
                123,
            )
        )

    def test_clean_optional_selected_metric_trims_and_clears_values(self):
        self.assertEqual(
            clean_optional_selected_metric(
                " revenue ",
            ),
            "revenue",
        )
        self.assertIsNone(
            clean_optional_selected_metric(
                "   ",
            )
        )
        self.assertIsNone(
            clean_optional_selected_metric(
                None,
            )
        )
        self.assertIsNone(
            clean_optional_selected_metric(
                123,
            )
        )

    def test_clean_preference_dataset_id_accepts_positive_integer(self):
        self.assertEqual(
            clean_preference_dataset_id(
                7,
            ),
            7,
        )

    def test_clean_preference_dataset_id_rejects_invalid_values(self):
        for value in (
            0,
            -1,
            True,
            1.5,
        ):
            with self.subTest(
                value=value,
            ):
                with self.assertRaises(
                    HTTPException,
                ) as context:
                    clean_preference_dataset_id(
                        value,
                    )

                self.assertEqual(
                    context.exception.status_code,
                    400,
                )

    def test_clean_organization_name_trims_and_rejects_invalid_values(self):
        self.assertEqual(
            clean_organization_name(
                "  Decisionate  ",
            ),
            "Decisionate",
        )

        for value, detail in (
            (
                "   ",
                "Organization name is required",
            ),
            (
                123,
                "Organization name must be text",
            ),
        ):
            with self.subTest(
                value=value,
            ):
                with self.assertRaises(
                    HTTPException,
                ) as context:
                    clean_organization_name(
                        value,
                    )

                self.assertEqual(
                    context.exception.status_code,
                    400,
                )
                self.assertEqual(
                    context.exception.detail,
                    detail,
                )

    def test_clean_optional_organization_text_trims_and_clears_values(self):
        self.assertEqual(
            clean_optional_organization_text(
                "  Agency Reports  ",
                "Report display name",
                120,
            ),
            "Agency Reports",
        )
        self.assertIsNone(
            clean_optional_organization_text(
                "   ",
                "Report display name",
                120,
            )
        )

    def test_clean_optional_logo_url_requires_http_url(self):
        self.assertEqual(
            clean_optional_logo_url(
                " https://agency.example/logo.png ",
            ),
            "https://agency.example/logo.png",
        )

        with self.assertRaises(
            HTTPException,
        ) as context:
            clean_optional_logo_url(
                "ftp://agency.example/logo.png",
            )

        self.assertEqual(
            context.exception.detail,
            "Logo URL must start with http:// or https://",
        )

    def test_clean_optional_brand_color_accepts_hex_color(self):
        self.assertEqual(
            clean_optional_brand_color(
                " #2563eb ",
                "Primary color",
            ),
            "#2563EB",
        )
        self.assertIsNone(
            clean_optional_brand_color(
                "",
                "Primary color",
            )
        )

        with self.assertRaises(
            HTTPException,
        ) as context:
            clean_optional_brand_color(
                "blue",
                "Primary color",
            )

        self.assertEqual(
            context.exception.detail,
            "Primary color must be a hex color like #2563EB",
        )

    def test_clean_member_user_id_trims_and_rejects_invalid_values(self):
        self.assertEqual(
            clean_member_user_id(
                "  user-1  ",
            ),
            "user-1",
        )

        for value, detail in (
            (
                "   ",
                "Member user id is required",
            ),
            (
                123,
                "Member user id must be text",
            ),
        ):
            with self.subTest(
                value=value,
            ):
                with self.assertRaises(
                    HTTPException,
                ) as context:
                    clean_member_user_id(
                        value,
                    )

                self.assertEqual(
                    context.exception.status_code,
                    400,
                )
                self.assertEqual(
                    context.exception.detail,
                    detail,
                )

    def test_clean_member_role_normalizes_and_rejects_invalid_values(self):
        self.assertEqual(
            clean_member_role(
                " Client ",
            ),
            "client",
        )
        self.assertEqual(
            clean_member_role(
                "MEMBER",
            ),
            "member",
        )

        for value in (
            "owner",
            "",
            123,
        ):
            with self.subTest(
                value=value,
            ):
                with self.assertRaises(
                    HTTPException,
                ) as context:
                    clean_member_role(
                        value,
                    )

                self.assertEqual(
                    context.exception.status_code,
                    400,
                )
                self.assertEqual(
                    context.exception.detail,
                    "Invalid member role",
                )

    def test_clean_invite_email_normalizes_and_rejects_invalid_values(self):
        self.assertEqual(
            clean_invite_email(
                " Client@Example.COM ",
            ),
            "client@example.com",
        )

        for value, detail in (
            (
                "",
                "Invite email is required",
            ),
            (
                "not-an-email",
                "Invite email must be a valid email address",
            ),
            (
                123,
                "Invite email must be text",
            ),
        ):
            with self.subTest(
                value=value,
            ):
                with self.assertRaises(
                    HTTPException,
                ) as context:
                    clean_invite_email(
                        value,
                    )

                self.assertEqual(
                    context.exception.status_code,
                    400,
                )
                self.assertEqual(
                    context.exception.detail,
                    detail,
                )

    def test_clean_metric_targets_keeps_finite_targets_for_positive_dataset_keys(self):
        self.assertEqual(
            clean_metric_targets(
                {
                    " 7 ": {
                        " revenue ": 100,
                        "profit": float("inf"),
                        "": 12,
                    },
                    "0": {
                        "revenue": 50,
                    },
                    "abc": {
                        "revenue": 60,
                    },
                },
            ),
            {
                "7": {
                    "revenue": 100.0,
                },
            },
        )

    def test_clean_dashboard_preferences_keeps_known_values(self):
        self.assertEqual(
            clean_dashboard_preferences(
                {
                    " 7 ": {
                        "selectedMetrics": [
                            " revenue ",
                            "",
                            123,
                        ],
                        "chartType": "line",
                        "scaleMode": "unknown",
                        "periodFilter": "1y",
                        "dashboardTemplate": "executive",
                        "startDate": " 2026-07-01 ",
                    },
                    "8": {
                        "startDate": "July 1, 2026",
                    },
                    "-1": {
                        "chartType": "bar",
                    },
                },
            ),
            {
                "7": {
                    "selectedMetrics": [
                        "revenue",
                    ],
                    "chartType": "line",
                    "periodFilter": "1y",
                    "dashboardTemplate": "executive",
                    "startDate": "2026-07-01",
                },
                "8": {},
            },
        )

    def test_serialize_user_preference_ignores_corrupt_json_preferences(self):
        preference = SimpleNamespace(
            selected_dataset_id=7,
            selected_metric=" revenue ",
            metric_targets="{bad-json",
            dashboard_preferences="[1, 2, 3]",
        )

        self.assertEqual(
            serialize_user_preference(
                preference,
            ),
            {
                "selected_dataset_id": 7,
                "selected_metric": "revenue",
                "metric_targets": None,
                "dashboard_preferences": None,
            },
        )


if __name__ == "__main__":
    unittest.main()
