import unittest
from types import SimpleNamespace

from fastapi import HTTPException

from app.modules.auth_context import AuthContext
from app.modules.datasets.services.auth import (
    auth_context_cache_key,
    require_workspace_data_manager,
)


def build_request(
    role: str,
):
    request = SimpleNamespace(
        state=SimpleNamespace(),
    )

    setattr(
        request.state,
        auth_context_cache_key,
        AuthContext(
            user_id="user-1",
            workspace_id="agency-1",
            workspace_role=role,
        ),
    )

    return request


class WorkspacePermissionTests(unittest.TestCase):
    def test_client_role_cannot_modify_workspace_data_setup(self):
        with self.assertRaises(
            HTTPException,
        ) as context:
            require_workspace_data_manager(
                build_request("client")
            )

        self.assertEqual(
            context.exception.status_code,
            403,
        )
        self.assertEqual(
            context.exception.detail,
            "Client users cannot modify workspace data setup",
        )

    def test_member_role_can_modify_workspace_data_setup(self):
        require_workspace_data_manager(
            build_request("member")
        )


if __name__ == "__main__":
    unittest.main()
