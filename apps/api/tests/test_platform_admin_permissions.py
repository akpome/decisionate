import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException

from app.modules.platform_admin import require_platform_admin


def build_request(user_id: str):
    return SimpleNamespace(
        headers={
            "X-User-Id": user_id,
        },
    )


class PlatformAdminPermissionTests(unittest.TestCase):
    def test_allowlisted_user_can_access_platform_admin(self):
        with patch.dict(
            "os.environ",
            {
                "DECISIONATE_PLATFORM_ADMIN_USER_IDS": " admin-1, admin-2 ",
            },
            clear=True,
        ):
            context = require_platform_admin(
                build_request("admin-2")
            )

        self.assertTrue(context.user_id.startswith("usr_"))
        self.assertEqual(context.external_user_id, "admin-2")

    def test_non_allowlisted_user_is_rejected(self):
        with patch.dict(
            "os.environ",
            {
                "DECISIONATE_PLATFORM_ADMIN_USER_IDS": "admin-1",
            },
            clear=True,
        ):
            with self.assertRaises(HTTPException) as context:
                require_platform_admin(
                    build_request("customer-1")
                )

        self.assertEqual(context.exception.status_code, 403)
        self.assertEqual(
            context.exception.detail,
            "Platform admin access required",
        )

    def test_missing_allowlist_fails_closed(self):
        with patch.dict("os.environ", {}, clear=True):
            with self.assertRaises(HTTPException) as context:
                require_platform_admin(
                    build_request("admin-1")
                )

        self.assertEqual(context.exception.status_code, 403)


if __name__ == "__main__":
    unittest.main()
