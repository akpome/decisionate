from __future__ import annotations

from uuid import uuid4

from sqlalchemy import func, text

from app.configuration import get_runtime_configuration
from app.db.database import SessionLocal, engine, get_table_columns
from app.db.models import (
    AppUser,
    AuthIdentity,
    Organization,
    OrganizationMember,
    utc_now,
)


INTERNAL_USER_PREFIX = "usr_"
DEFAULT_AUTH_PROVIDER = (
    get_runtime_configuration().auth_provider
)
LEGACY_AUTH_PROVIDER = "legacy"

LEGACY_IDENTITY_COLUMNS = (
    ("organizations", "owner_user_id"),
    ("organization_members", "clerk_user_id"),
    ("datasets", "user_id"),
    ("data_source_connections", "user_id"),
    ("oauth_connection_states", "user_id"),
    ("decisions", "clerk_user_id"),
    ("user_preferences", "clerk_user_id"),
    ("ai_usage_events", "actor_user_id"),
    ("usage_activity_events", "actor_user_id"),
    ("decision_activities", "actor_user_id"),
    ("platform_email_settings", "updated_by_user_id"),
    ("platform_billing_settings", "updated_by_user_id"),
    ("platform_admin_audit_events", "admin_user_id"),
    ("platform_admin_audit_events", "target_user_id"),
)

WORKSPACE_COLUMNS = (
    ("datasets", "workspace_id"),
    ("data_source_connections", "workspace_id"),
    ("oauth_connection_states", "workspace_id"),
    ("oauth_credentials", "workspace_id"),
    ("workspace_subscriptions", "workspace_id"),
    ("ai_usage_events", "workspace_id"),
    ("usage_activity_events", "workspace_id"),
    ("weekly_report_preferences", "workspace_id"),
    ("weekly_report_delivery_logs", "workspace_id"),
    ("user_preferences", "workspace_id"),
    ("decisions", "workspace_id"),
    ("decision_activities", "workspace_id"),
)


def is_internal_user_id(value: str | None) -> bool:
    return str(value or "").strip().startswith(INTERNAL_USER_PREFIX)


def new_internal_user_id() -> str:
    return f"{INTERNAL_USER_PREFIX}{uuid4().hex}"


def _existing_table_columns(connection, table_name: str) -> set[str]:
    return get_table_columns(connection, table_name)


def _collect_legacy_subjects() -> set[str]:
    subjects: set[str] = set()

    with engine.connect() as connection:
        for table_name, column_name in LEGACY_IDENTITY_COLUMNS:
            if column_name not in _existing_table_columns(
                connection,
                table_name,
            ):
                continue

            rows = connection.execute(
                text(
                    f"SELECT DISTINCT {column_name} "
                    f"FROM {table_name} "
                    f"WHERE {column_name} IS NOT NULL "
                    f"AND trim({column_name}) != ''"
                )
            ).fetchall()
            subjects.update(
                str(row[0]).strip()
                for row in rows
                if str(row[0] or "").strip()
                and not is_internal_user_id(str(row[0]))
            )

    return subjects


def _ensure_legacy_user_mapping(
    db,
    subject: str,
) -> str:
    identity = (
        db.query(AuthIdentity)
        .filter(
            AuthIdentity.provider == LEGACY_AUTH_PROVIDER,
            AuthIdentity.subject == subject,
        )
        .first()
    )
    if identity:
        return identity.user_id

    user = AppUser(
        id=new_internal_user_id(),
    )
    db.add(user)
    db.flush()
    db.add(
        AuthIdentity(
            user_id=user.id,
            provider=LEGACY_AUTH_PROVIDER,
            subject=subject,
        )
    )
    return user.id


def _load_legacy_mapping(db) -> dict[str, str]:
    return {
        identity.subject: identity.user_id
        for identity in db.query(AuthIdentity)
        .filter(AuthIdentity.provider == LEGACY_AUTH_PROVIDER)
        .all()
    }


def _map_workspace_value(
    value: str,
    legacy_mapping: dict[str, str],
) -> str:
    clean_value = str(value or "").strip()
    if not clean_value:
        return clean_value

    exact_mapping = legacy_mapping.get(clean_value)
    if exact_mapping:
        return exact_mapping

    for legacy_subject, internal_user_id in legacy_mapping.items():
        prefix = f"{legacy_subject}:client:"
        if clean_value.startswith(prefix):
            return f"{internal_user_id}{clean_value[len(legacy_subject):]}"

    return clean_value


def ensure_internal_identity_backfill() -> None:
    """Create internal users and migrate legacy identity values once safely."""

    subjects = _collect_legacy_subjects()
    db = SessionLocal()
    try:
        for subject in subjects:
            _ensure_legacy_user_mapping(db, subject)
        db.commit()
        legacy_mapping = _load_legacy_mapping(db)
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

    if not legacy_mapping:
        return

    with engine.begin() as connection:
        for table_name, column_name in LEGACY_IDENTITY_COLUMNS:
            if column_name not in _existing_table_columns(
                connection,
                table_name,
            ):
                continue

            for legacy_subject, internal_user_id in legacy_mapping.items():
                connection.execute(
                    text(
                        f"UPDATE {table_name} "
                        f"SET {column_name} = :internal_user_id "
                        f"WHERE {column_name} = :legacy_subject"
                    ),
                    {
                        "internal_user_id": internal_user_id,
                        "legacy_subject": legacy_subject,
                    },
                )

        for table_name, column_name in WORKSPACE_COLUMNS:
            if column_name not in _existing_table_columns(
                connection,
                table_name,
            ):
                continue

            values = connection.execute(
                text(
                    f"SELECT DISTINCT {column_name} "
                    f"FROM {table_name} "
                    f"WHERE {column_name} IS NOT NULL "
                    f"AND trim({column_name}) != ''"
                )
            ).fetchall()
            for row in values:
                current_value = str(row[0]).strip()
                mapped_value = _map_workspace_value(
                    current_value,
                    legacy_mapping,
                )
                if mapped_value == current_value:
                    continue

                connection.execute(
                    text(
                        f"UPDATE {table_name} "
                        f"SET {column_name} = :mapped_value "
                        f"WHERE {column_name} = :current_value"
                    ),
                    {
                        "mapped_value": mapped_value,
                        "current_value": current_value,
                    },
                )


def find_internal_user_id(
    db,
    subject: str,
    provider: str = DEFAULT_AUTH_PROVIDER,
) -> str | None:
    clean_subject = str(subject or "").strip()
    if not clean_subject:
        return None

    if is_internal_user_id(clean_subject):
        user = db.query(AppUser).filter(AppUser.id == clean_subject).first()
        return user.id if user else None

    identity = (
        db.query(AuthIdentity)
        .filter(
            AuthIdentity.provider == provider,
            AuthIdentity.subject == clean_subject,
        )
        .first()
    )
    if identity:
        return identity.user_id

    legacy_identity = (
        db.query(AuthIdentity)
        .filter(
            AuthIdentity.provider == LEGACY_AUTH_PROVIDER,
            AuthIdentity.subject == clean_subject,
        )
        .first()
    )
    return legacy_identity.user_id if legacy_identity else None


def _find_unique_user_by_email(
    db,
    email: str | None,
) -> AppUser | None:
    clean_email = str(email or "").strip().lower()
    if not clean_email:
        return None

    matches = (
        db.query(AppUser)
        .filter(
            func.lower(AppUser.email) == clean_email,
        )
        .all()
    )

    if len(matches) == 1:
        return matches[0]

    # Provider migrations can leave duplicate AppUser rows for one email.
    # Prefer the only duplicate that still owns or belongs to a workspace;
    # this reconnects an existing account after its provider subject changes
    # without guessing when multiple workspace identities remain possible.
    workspace_matches = [
        user
        for user in matches
        if _has_workspace_access(db, user.id)
    ]
    return workspace_matches[0] if len(workspace_matches) == 1 else None


def _has_workspace_access(
    db,
    user_id: str,
) -> bool:
    return bool(
        db.query(OrganizationMember.id)
        .filter(OrganizationMember.clerk_user_id == user_id)
        .first()
        or db.query(Organization.id)
        .filter(Organization.owner_user_id == user_id)
        .first()
    )


def _reconcile_legacy_email_identity(
    db,
    current_user_id: str,
    email: str | None,
) -> str | None:
    """Reuse a member identity created from an email before signup."""

    clean_email = str(email or "").strip().lower()
    if not clean_email:
        return None

    legacy_identity = (
        db.query(AuthIdentity)
        .filter(
            AuthIdentity.provider == DEFAULT_AUTH_PROVIDER,
            func.lower(AuthIdentity.subject) == clean_email,
            AuthIdentity.user_id != current_user_id,
        )
        .first()
    )
    if not legacy_identity or not _has_workspace_access(
        db,
        legacy_identity.user_id,
    ):
        return None

    # Never move an already-used account into another identity. This only
    # repairs the pre-signup email-reference case when the new account has no
    # workspace access yet.
    if _has_workspace_access(db, current_user_id):
        return None

    return legacy_identity.user_id


def resolve_external_identity(
    subject: str,
    email: str | None = None,
    provider: str = DEFAULT_AUTH_PROVIDER,
) -> str:
    clean_subject = str(subject or "").strip()
    if not clean_subject:
        raise ValueError("An external identity subject is required")

    db = SessionLocal()
    try:
        identity = (
            db.query(AuthIdentity)
            .filter(
                AuthIdentity.provider == provider,
                AuthIdentity.subject == clean_subject,
            )
            .first()
        )

        if identity is None:
            existing_user = _find_unique_user_by_email(
                db,
                email,
            )
            if existing_user is not None:
                reconciled_user_id = _reconcile_legacy_email_identity(
                    db,
                    existing_user.id,
                    email,
                )
                if reconciled_user_id:
                    existing_user = (
                        db.query(AppUser)
                        .filter(AppUser.id == reconciled_user_id)
                        .first()
                    )

            legacy_identity = (
                db.query(AuthIdentity)
                .filter(
                    AuthIdentity.provider == LEGACY_AUTH_PROVIDER,
                    AuthIdentity.subject == clean_subject,
                )
                .first()
            )
            if legacy_identity:
                identity = AuthIdentity(
                    user_id=legacy_identity.user_id,
                    provider=provider,
                    subject=clean_subject,
                )
                db.add(identity)
            else:
                user = existing_user
                if user is None:
                    user = AppUser(
                        id=new_internal_user_id(),
                        email=str(email or "").strip() or None,
                    )
                    db.add(user)
                    db.flush()

                identity = AuthIdentity(
                    user_id=user.id,
                    provider=provider,
                    subject=clean_subject,
                )
                db.add(identity)
        else:
            reconciled_user_id = _reconcile_legacy_email_identity(
                db,
                identity.user_id,
                email,
            )
            if reconciled_user_id:
                identity.user_id = reconciled_user_id

        if email:
            clean_email = str(email).strip()
            if clean_email:
                identity.email = clean_email
                user = (
                    db.query(AppUser)
                    .filter(AppUser.id == identity.user_id)
                    .first()
                )
                if user and not user.email:
                    user.email = clean_email

        identity.last_seen_at = utc_now()
        db.commit()
        return identity.user_id
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def sync_external_identity_email(
    subject: str,
    user_id: str,
    email: str | None,
    provider: str = DEFAULT_AUTH_PROVIDER,
) -> None:
    """Store an email on an already-resolved identity without relinking it."""

    clean_subject = str(subject or "").strip()
    clean_user_id = str(user_id or "").strip()
    clean_email = str(email or "").strip()
    if not clean_subject or not clean_user_id or not clean_email:
        return

    db = SessionLocal()
    try:
        identity = (
            db.query(AuthIdentity)
            .filter(
                AuthIdentity.provider == provider,
                AuthIdentity.subject == clean_subject,
                AuthIdentity.user_id == clean_user_id,
            )
            .first()
        )
        if identity is None:
            return

        identity.email = clean_email
        user = (
            db.query(AppUser)
            .filter(AppUser.id == clean_user_id)
            .first()
        )
        if user and not user.email:
            user.email = clean_email

        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def link_external_identity(
    subject: str,
    target_user_id: str,
    email: str | None = None,
    provider: str = DEFAULT_AUTH_PROVIDER,
) -> str:
    """Attach a provider login to an existing internal Decisionate user."""

    clean_subject = str(subject or "").strip()
    clean_target_user_id = str(target_user_id or "").strip()
    if not clean_subject or not clean_target_user_id:
        raise ValueError(
            "Both an external identity and internal user are required"
        )

    db = SessionLocal()
    try:
        target_user = (
            db.query(AppUser)
            .filter(AppUser.id == clean_target_user_id)
            .first()
        )
        if target_user is None:
            raise ValueError("Internal user not found")

        identity = (
            db.query(AuthIdentity)
            .filter(
                AuthIdentity.provider == provider,
                AuthIdentity.subject == clean_subject,
            )
            .first()
        )
        if identity is None:
            identity = AuthIdentity(
                provider=provider,
                subject=clean_subject,
            )
            db.add(identity)

        identity.user_id = target_user.id
        identity.email = str(email or "").strip() or identity.email
        if not target_user.email and identity.email:
            target_user.email = identity.email
        identity.last_seen_at = utc_now()
        db.commit()
        return target_user.id
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def resolve_user_reference(
    value: str,
    provider: str = DEFAULT_AUTH_PROVIDER,
) -> str:
    clean_value = str(value or "").strip()
    if not clean_value:
        raise ValueError("A user reference is required")

    db = SessionLocal()
    try:
        internal_user_id = find_internal_user_id(
            db,
            clean_value,
            provider,
        )
    finally:
        db.close()

    return internal_user_id or resolve_external_identity(
        clean_value,
        provider=provider,
    )


def resolve_workspace_reference(
    value: str | None,
    internal_user_id: str,
    external_subject: str | None = None,
) -> str:
    clean_value = str(value or "").strip()
    if not clean_value or clean_value == str(external_subject or "").strip():
        return internal_user_id

    db = SessionLocal()
    try:
        legacy_mapping = _load_legacy_mapping(db)
    finally:
        db.close()

    return _map_workspace_value(clean_value, legacy_mapping)
