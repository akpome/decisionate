import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException

from app.modules.auth_context import AuthContext
from app.modules.datasets.services.auth import (
    get_request_auth_context,
    get_user_id,
    get_workspace_id,
)
from app.modules.datasets.services.ownership import (
    verify_dataset_owner,
)


class DatasetAuthTests(unittest.TestCase):
    def test_request_auth_context_is_cached_on_request_state(self):
        request = SimpleNamespace(
            state=SimpleNamespace(),
        )
        auth_context = AuthContext(
            user_id="user-1",
            workspace_id="workspace-1",
        )

        with patch(
            "app.modules.datasets.services.auth.get_auth_context",
            return_value=auth_context,
        ) as get_auth_context:
            self.assertIs(
                get_request_auth_context(
                    request,
                ),
                auth_context,
            )
            self.assertIs(
                get_request_auth_context(
                    request,
                ),
                auth_context,
            )

        get_auth_context.assert_called_once_with(
            request,
        )

    def test_user_and_workspace_helpers_share_cached_auth_context(self):
        request = SimpleNamespace(
            state=SimpleNamespace(),
        )
        auth_context = AuthContext(
            user_id="user-1",
            workspace_id="workspace-1",
        )

        with patch(
            "app.modules.datasets.services.auth.get_auth_context",
            return_value=auth_context,
        ) as get_auth_context:
            user_id = get_user_id(
                request,
            )
            workspace_id = get_workspace_id(
                request,
                user_id,
            )

        self.assertEqual(
            user_id,
            "user-1",
        )
        self.assertEqual(
            workspace_id,
            "workspace-1",
        )
        get_auth_context.assert_called_once_with(
            request,
        )

    def test_workspace_helper_returns_verified_user_when_user_id_differs(self):
        request = SimpleNamespace(
            state=SimpleNamespace(),
        )
        auth_context = AuthContext(
            user_id="verified-user",
            workspace_id="workspace-1",
        )

        with patch(
            "app.modules.datasets.services.auth.get_auth_context",
            return_value=auth_context,
        ):
            self.assertEqual(
                get_workspace_id(
                    request,
                    "header-user",
                ),
                "verified-user",
            )

    def test_request_auth_context_without_state_does_not_cache(self):
        request = SimpleNamespace()
        auth_context = AuthContext(
            user_id="user-1",
            workspace_id="workspace-1",
        )

        with patch(
            "app.modules.datasets.services.auth.get_auth_context",
            return_value=auth_context,
        ) as get_auth_context:
            self.assertIs(
                get_request_auth_context(
                    request,
                ),
                auth_context,
            )
            self.assertIs(
                get_request_auth_context(
                    request,
                ),
                auth_context,
            )

        self.assertEqual(
            get_auth_context.call_count,
            2,
        )

    def test_verify_dataset_owner_accepts_padded_workspace_id(self):
        dataset = SimpleNamespace(
            user_id="owner-user",
            workspace_id="workspace-1",
        )

        verify_dataset_owner(
            dataset,
            "other-user",
            " workspace-1 ",
        )

    def test_verify_dataset_owner_accepts_padded_legacy_user_id(self):
        dataset = SimpleNamespace(
            user_id="owner-user",
            workspace_id=None,
        )

        verify_dataset_owner(
            dataset,
            " owner-user ",
            None,
        )

    def test_verify_dataset_owner_rejects_blank_workspace_for_workspace_dataset(self):
        dataset = SimpleNamespace(
            user_id="owner-user",
            workspace_id="workspace-1",
        )

        with self.assertRaises(
            HTTPException,
        ) as context:
            verify_dataset_owner(
                dataset,
                "owner-user",
                " ",
            )

        self.assertEqual(
            context.exception.status_code,
            403,
        )


if __name__ == "__main__":
    unittest.main()
