import unittest
from unittest.mock import patch

from fastapi import HTTPException

from app.modules.auth_context import (
    clean_optional_auth_env_value,
    clean_auth_value,
    get_auth_context,
    get_verified_user_id,
    get_verified_workspace_id,
    verify_clerk_bearer_token,
)


class FakeRequest:
    def __init__(self, headers):
        self.headers = headers


class AuthContextTests(unittest.TestCase):
    def test_clean_auth_value_trims_and_coerces_values(self):
        self.assertEqual(
            clean_auth_value(
                "  user-1  ",
            ),
            "user-1",
        )
        self.assertEqual(
            clean_auth_value(
                123,
            ),
            "123",
        )
        self.assertEqual(
            clean_auth_value(
                None,
            ),
            "",
        )

    def test_clean_optional_auth_env_value_trims_and_clears_blank_values(self):
        with patch.dict(
            "os.environ",
            {
                "CLERK_JWT_AUDIENCE": "  decisionate  ",
                "CLERK_JWT_ISSUER": "   ",
            },
            clear=True,
        ):
            self.assertEqual(
                clean_optional_auth_env_value(
                    "CLERK_JWT_AUDIENCE",
                ),
                "decisionate",
            )
            self.assertIsNone(
                clean_optional_auth_env_value(
                    "CLERK_JWT_ISSUER",
                )
            )
            self.assertIsNone(
                clean_optional_auth_env_value(
                    "MISSING_ENV",
                )
            )

    def test_verified_user_id_trims_header_value(self):
        with patch.dict(
            "os.environ",
            {},
            clear=True,
        ):
            self.assertEqual(
                get_verified_user_id(
                    FakeRequest({
                        "X-User-Id": "  user-1  ",
                    })
                ),
                "user-1",
            )

    def test_verified_user_id_coerces_non_string_header_value(self):
        with patch.dict(
            "os.environ",
            {},
            clear=True,
        ):
            self.assertEqual(
                get_verified_user_id(
                    FakeRequest({
                        "X-User-Id": 123,
                    })
                ),
                "123",
            )

    def test_verified_user_id_rejects_blank_header_value(self):
        with patch.dict(
            "os.environ",
            {},
            clear=True,
        ):
            with self.assertRaises(HTTPException) as context:
                get_verified_user_id(
                    FakeRequest({
                        "X-User-Id": "   ",
                    })
                )

        self.assertEqual(
            context.exception.status_code,
            401,
        )
        self.assertEqual(
            context.exception.detail,
                "Missing user id",
        )

    def test_verified_user_id_ignores_blank_jwks_url(self):
        with patch.dict(
            "os.environ",
            {
                "CLERK_JWKS_URL": "   ",
            },
            clear=True,
        ):
            self.assertEqual(
                get_verified_user_id(
                    FakeRequest({
                        "X-User-Id": " user-1 ",
                    })
                ),
                "user-1",
            )

    def test_verified_workspace_id_trims_and_defaults_blank_values(self):
        with patch(
            "app.modules.auth_context.verify_workspace_membership",
        ) as verify_membership:
            self.assertEqual(
                get_verified_workspace_id(
                    FakeRequest({
                        "X-Workspace-Id": "  workspace-1  ",
                    }),
                    "user-1",
                ),
                "workspace-1",
            )
            verify_membership.assert_called_once_with(
                "user-1",
                "workspace-1",
            )

        with patch(
            "app.modules.auth_context.verify_workspace_membership",
        ) as verify_membership:
            self.assertEqual(
                get_verified_workspace_id(
                    FakeRequest({
                        "X-Workspace-Id": "   ",
                    }),
                    "user-1",
                ),
                "user-1",
            )
            verify_membership.assert_not_called()

        with patch(
            "app.modules.auth_context.verify_workspace_membership",
        ) as verify_membership:
            self.assertEqual(
                get_verified_workspace_id(
                    FakeRequest({
                        "X-Workspace-Id": 123,
                    }),
                    "user-1",
                ),
                "123",
            )
            verify_membership.assert_called_once_with(
                "user-1",
                "123",
            )

    def test_auth_context_returns_trimmed_user_and_workspace(self):
        with patch.dict(
            "os.environ",
            {},
            clear=True,
        ), patch(
            "app.modules.auth_context.verify_workspace_membership",
        ) as verify_membership:
            context = get_auth_context(
                FakeRequest({
                    "X-User-Id": "  user-1  ",
                    "X-Workspace-Id": "  user-1  ",
                })
            )

        self.assertEqual(
            context.user_id,
            "user-1",
        )
        self.assertEqual(
            context.workspace_id,
            "user-1",
        )
        verify_membership.assert_not_called()

    def test_verify_clerk_bearer_token_cleans_optional_decode_settings(self):
        signing_key = type(
            "SigningKey",
            (),
            {
                "key": "public-key",
            },
        )()
        jwks_client = type(
            "JwksClient",
            (),
            {
                "get_signing_key_from_jwt": lambda self, token: signing_key,
            },
        )()

        with patch.dict(
            "os.environ",
            {
                "CLERK_JWKS_URL": " https://clerk.example/.well-known/jwks.json ",
                "CLERK_JWT_AUDIENCE": "   ",
                "CLERK_JWT_ISSUER": " https://issuer.example ",
            },
            clear=True,
        ), patch(
            "app.modules.auth_context.get_jwks_client",
            return_value=jwks_client,
        ), patch(
            "app.modules.auth_context.jwt.decode",
            return_value={
                "sub": " user-1 ",
            },
        ) as decode:
            self.assertEqual(
                verify_clerk_bearer_token(
                    " Bearer token-123 ",
                ),
                "user-1",
            )

        decode.assert_called_once_with(
            "token-123",
            "public-key",
            algorithms=[
                "RS256",
            ],
            audience=None,
            issuer="https://issuer.example",
            options={
                "verify_aud": False,
                "verify_iss": True,
            },
        )


if __name__ == "__main__":
    unittest.main()
