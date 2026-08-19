from __future__ import annotations

import os

try:
    from cryptography.fernet import Fernet, InvalidToken
except ModuleNotFoundError:  # pragma: no cover - dependency is required in production
    Fernet = None

    class InvalidToken(Exception):
        pass


SECRET_PREFIX = "enc:v1:"


class SecretProtectionUnavailable(RuntimeError):
    """Raised when an application-managed secret cannot be protected."""


def _encryption_key() -> str:
    return str(
        os.getenv("OAUTH_TOKEN_ENCRYPTION_KEY", "") or ""
    ).strip()


def _fernet() -> Fernet:
    if Fernet is None:
        raise SecretProtectionUnavailable(
            "Install cryptography to protect stored secrets"
        )

    key = _encryption_key()
    if not key:
        raise SecretProtectionUnavailable(
            "OAUTH_TOKEN_ENCRYPTION_KEY is required to protect stored secrets"
        )

    try:
        return Fernet(key.encode("ascii"))
    except (ValueError, TypeError) as error:
        raise SecretProtectionUnavailable(
            "OAUTH_TOKEN_ENCRYPTION_KEY is invalid"
        ) from error


def is_protected_secret(value: str | None) -> bool:
    return str(value or "").startswith(SECRET_PREFIX)


def secret_encryption_is_configured() -> bool:
    try:
        _fernet()
    except SecretProtectionUnavailable:
        return False
    return True


def encrypt_secret(value: str | None) -> str | None:
    clean_value = str(value or "")
    if not clean_value:
        return None
    if is_protected_secret(clean_value):
        return clean_value

    try:
        encrypted = _fernet().encrypt(
            clean_value.encode("utf-8")
        ).decode("ascii")
    except SecretProtectionUnavailable:
        if str(os.getenv("APP_ENV", "development")).strip().lower() != "production":
            return clean_value
        raise

    return f"{SECRET_PREFIX}{encrypted}"


def decrypt_secret(value: str | None) -> str:
    clean_value = str(value or "")
    if not clean_value or not is_protected_secret(clean_value):
        return clean_value

    encrypted_value = clean_value.removeprefix(SECRET_PREFIX)
    try:
        return _fernet().decrypt(
            encrypted_value.encode("ascii")
        ).decode("utf-8")
    except (InvalidToken, UnicodeDecodeError, ValueError) as error:
        raise SecretProtectionUnavailable(
            "Stored application secret cannot be decrypted"
        ) from error
