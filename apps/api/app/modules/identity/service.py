from __future__ import annotations

import logging
import re
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import column, func, inspect, or_, select, table, text, update
from sqlalchemy.exc import IntegrityError

from app.configuration import get_runtime_configuration
from app.application_context import get_application, identity_provider
from app.db.database import SessionLocal, engine, get_table_columns
from app.db.models import (
    AppUser,
    AuthIdentity,
    Organization,
    OrganizationMember,
    WorkspaceSubscription,
    WorkspaceApplication,
    utc_now,
)
from app.modules.marketing.service import capture_identity


INTERNAL_USER_PREFIX = "usr_"
logger = logging.getLogger(__name__)
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
    ("organizations", "owner_user_id"),
    ("organizations", "managing_agency_workspace_id"),
    ("agency_client_invitations", "agency_workspace_id"),
    ("datasets", "workspace_id"),
    ("data_source_connections", "workspace_id"),
    ("oauth_connection_states", "workspace_id"),
    ("oauth_credentials", "workspace_id"),
    ("workspace_subscriptions", "workspace_id"),
    ("ai_usage_events", "workspace_id"),
    ("ai_usage_events", "billing_workspace_id"),
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


def normalize_user_email(value: str | None) -> str:
    email = str(value or "").strip().lower()
    if len(email) > 254 or not re.fullmatch(r"[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+", email):
        raise ValueError("A complete email address is required for this user account.")
    return email


def lock_user_email(db, email):
    from app.infrastructure.ingestion_jobs import lock_workspace_queue
    lock_workspace_queue(db, "user-email:" + get_application().id + ":" + email.strip().lower())


def lock_user_identity(db, user_id):
    from app.infrastructure.ingestion_jobs import lock_workspace_queue
    lock_workspace_queue(db, "user-identity:" + user_id)


def ensure_identity_revocation_column(bind=engine):
    with bind.begin() as connection:
        if "revoked_at" not in _existing_table_columns(connection, "auth_identities"):
            connection.execute(text("ALTER TABLE auth_identities ADD COLUMN revoked_at TIMESTAMP"))


def ensure_user_access_column(bind=engine):
    with bind.begin() as connection:
        if "access_paused_at" not in _existing_table_columns(connection, "app_users"):
            connection.execute(text("ALTER TABLE app_users ADD COLUMN access_paused_at TIMESTAMP"))


def require_user_access_active(db, user_id):
    lock_user_identity(db, user_id)
    paused_at = db.query(AppUser.access_paused_at).filter(AppUser.id == user_id).scalar()
    if paused_at is not None:
        raise HTTPException(403, "This account is paused because its email was reassigned. Contact your administrator.")


def _require_active_identity(db, identity):
    if identity is not None:
        lock_user_identity(db, identity.user_id)
        db.refresh(identity)
        if identity.revoked_at is not None:
            raise HTTPException(403, "This sign-in no longer has access to the reassigned account. Contact your administrator.")
        require_user_access_active(db, identity.user_id)


def _email_mapping_enforced() -> bool:
    runtime = get_runtime_configuration()
    return bool(runtime.auth_jwks_url or runtime.app_env in {"staging", "production"} or engine.dialect.name == "postgresql")


def ensure_user_email_constraint(bind=engine):
    with bind.begin() as connection:
        if connection.dialect.name == "postgresql":
            exists = connection.execute(text("SELECT 1 FROM pg_constraint WHERE conrelid = 'app_users'::regclass AND conname = 'ck_app_users_email_required'")).first()
            if not exists:
                # Existing incomplete profiles remain recoverable; new writes cannot add more.
                connection.execute(text("ALTER TABLE app_users ADD CONSTRAINT ck_app_users_email_required CHECK (left(id, 4) <> 'usr_' OR position(':client:' in id) > 0 OR (email IS NOT NULL AND btrim(email) <> '')) NOT VALID"))
        elif connection.dialect.name == "sqlite":
            for operation in ("INSERT", "UPDATE"):
                connection.execute(text(f"CREATE TRIGGER IF NOT EXISTS app_users_email_required_{operation.lower()} BEFORE {operation} ON app_users WHEN substr(NEW.id, 1, 4) = 'usr_' AND instr(NEW.id, ':client:') = 0 AND trim(coalesce(NEW.email, '')) = '' BEGIN SELECT RAISE(ABORT, 'User email is required'); END"))


def validate_user_email_constraint(db):
    if db.get_bind().dialect.name != "postgresql":
        return
    remaining = db.query(AppUser.id).filter(AppUser.id.startswith("usr_", autoescape=True),
        ~AppUser.id.contains(":client:"), func.trim(func.coalesce(AppUser.email, "")) == "").first()
    if not remaining:
        db.execute(text("ALTER TABLE app_users VALIDATE CONSTRAINT ck_app_users_email_required"))


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
) -> str | None:
    identity = (
        db.query(AuthIdentity)
        .filter(
            AuthIdentity.provider == LEGACY_AUTH_PROVIDER,
            AuthIdentity.subject == subject,
        )
        .first()
    )
    if identity:
        return identity.user_id if identity.revoked_at is None else None

    existing = db.query(AuthIdentity).join(AppUser, AppUser.id == AuthIdentity.user_id).filter(
        AuthIdentity.provider == identity_provider(), AuthIdentity.subject == subject, AuthIdentity.revoked_at.is_(None),
        AppUser.email.isnot(None), func.trim(AppUser.email) != "",
    ).first()
    if existing is None or ":client:" in subject:
        return None
    db.add(
        AuthIdentity(
            user_id=existing.user_id,
            provider=LEGACY_AUTH_PROVIDER,
            subject=subject,
        )
    )
    return existing.user_id


def _load_legacy_mapping(db) -> dict[str, str]:
    return {
        identity.subject: identity.user_id
        for identity in db.query(AuthIdentity)
        .filter(AuthIdentity.provider == LEGACY_AUTH_PROVIDER, AuthIdentity.revoked_at.is_(None))
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


def _migrate_subscription_workspace(connection, current_value: str, mapped_value: str) -> None:
    subscriptions = WorkspaceSubscription.__table__
    canonical = subscriptions.alias("canonical_subscription")
    canonical_exists = select(canonical.c.id).where(
        canonical.c.workspace_id == mapped_value,
    ).exists()
    try:
        # A savepoint keeps a concurrent canonical insert from aborting the
        # rest of the identity migration on PostgreSQL.
        with connection.begin_nested():
            result = connection.execute(
                update(subscriptions).where(
                    subscriptions.c.workspace_id == current_value,
                    ~canonical_exists,
                ).values(workspace_id=mapped_value, updated_at=subscriptions.c.updated_at),
            )
        if result.rowcount:
            return
    except IntegrityError as error:
        constraint = getattr(getattr(error.orig, "diag", None), "constraint_name", None)
        workspace_conflict = constraint == "ix_workspace_subscriptions_workspace_id" or (
            connection.dialect.name == "sqlite"
            and getattr(error.orig, "sqlite_errorname", None) == "SQLITE_CONSTRAINT_UNIQUE"
        )
        if not workspace_conflict or not connection.execute(select(canonical_exists)).scalar():
            raise

    if connection.execute(select(canonical_exists)).scalar():
        logger.warning(
            "Subscription identity migration deferred: the canonical workspace "
            "already has a subscription. Both records are preserved; billing "
            "reconciliation is required.",
            extra={"legacy_workspace_id": current_value, "workspace_id": mapped_value},
        )


def _migrate_verified_legacy_identity(db, subject, user_id):
    connection = db.connection()
    existing_tables = set(inspect(connection).get_table_names())
    mapping = {subject: user_id}
    migrated = False
    for table_name, column_name in dict.fromkeys((*LEGACY_IDENTITY_COLUMNS, *WORKSPACE_COLUMNS)):
        if table_name not in existing_tables or column_name not in _existing_table_columns(connection, table_name):
            continue
        source = table(table_name, column(column_name))
        value = source.c[column_name]
        rows = connection.execute(select(value).distinct().where(or_(
            value == subject, value.startswith(subject + ":client:", autoescape=True),
        ))).scalars().all()
        for current in rows:
            migrated = True
            mapped = _map_workspace_value(current, mapping)
            if table_name == "workspace_subscriptions":
                _migrate_subscription_workspace(connection, current, mapped)
            else:
                connection.execute(source.update().where(value == current).values({column_name: mapped}))
    if migrated and not db.query(AuthIdentity.id).filter_by(provider=LEGACY_AUTH_PROVIDER, subject=subject).first():
        db.add(AuthIdentity(user_id=user_id, provider=LEGACY_AUTH_PROVIDER, subject=subject))


def ensure_internal_identity_backfill() -> None:
    """Migrate known legacy identities without inventing email-less users."""

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

                if table_name == "workspace_subscriptions":
                    _migrate_subscription_workspace(connection, current_value, mapped_value)
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
    provider: str | None = None,
) -> str | None:
    provider = identity_provider(provider)
    clean_subject = str(subject or "").strip()
    if not clean_subject:
        return None

    if is_internal_user_id(clean_subject):
        from app.modules.applications import require_workspace_application
        require_workspace_application(db, clean_subject)
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
        return identity.user_id if identity.revoked_at is None else None

    if not get_application().is_default:
        return None

    legacy_identity = (
        db.query(AuthIdentity)
        .filter(
            AuthIdentity.provider == LEGACY_AUTH_PROVIDER,
            AuthIdentity.subject == clean_subject,
        )
        .first()
    )
    return legacy_identity.user_id if legacy_identity and legacy_identity.revoked_at is None else None


def _find_unique_user_by_email(
    db,
    email: str | None,
) -> AppUser | None:
    clean_email = str(email or "").strip().lower()
    if not clean_email:
        return None

    query = db.query(AppUser).filter(
        func.lower(func.trim(AppUser.email)) == clean_email,
        AppUser.access_paused_at.is_(None),
    )
    application = get_application()
    if application.is_default:
        query = query.filter(~AppUser.id.in_(select(WorkspaceApplication.workspace_id).where(
            WorkspaceApplication.application_id != application.id,
        )))
    else:
        query = query.filter(AppUser.id.in_(select(WorkspaceApplication.workspace_id).where(
            WorkspaceApplication.application_id == application.id,
        )))
    matches = query.all()

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
            AuthIdentity.provider == identity_provider(),
            func.lower(AuthIdentity.subject) == clean_email,
            AuthIdentity.user_id != current_user_id,
            AuthIdentity.revoked_at.is_(None),
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
    provider: str | None = None,
    email_verified: bool = False,
) -> str:
    provider = identity_provider(provider)
    clean_subject = str(subject or "").strip()
    if not clean_subject:
        raise ValueError("An external identity subject is required")

    db = SessionLocal()
    try:
        if email:
            if _email_mapping_enforced():
                email = normalize_user_email(email)
            lock_user_email(db, email)
        identity = (
            db.query(AuthIdentity)
            .filter(
                AuthIdentity.provider == provider,
                AuthIdentity.subject == clean_subject,
            )
            .first()
        )
        first_signin = identity is None
        _require_active_identity(db, identity)

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
            ) if get_application().is_default else None
            if legacy_identity:
                _require_active_identity(db, legacy_identity)
                identity = AuthIdentity(
                    user_id=legacy_identity.user_id,
                    provider=provider,
                    subject=clean_subject,
                )
                db.add(identity)
            else:
                user = existing_user
                if user is None:
                    if _email_mapping_enforced():
                        email = normalize_user_email(email)
                    user = AppUser(
                        id=new_internal_user_id(),
                        email=str(email or "").strip() or None,
                    )
                    db.add(user)
                    db.flush()

                lock_user_identity(db, user.id)
                db.refresh(user)
                if email and str(user.email or "").strip().lower() != str(email).strip().lower():
                    raise HTTPException(409, "This account's email changed. Sign in again with the assigned email.")

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
                lock_user_identity(db, reconciled_user_id)
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
                if user and not str(user.email or "").strip():
                    user.email = clean_email

        if _email_mapping_enforced():
            user = db.get(AppUser, identity.user_id)
            if user is None:
                db.add(AppUser(id=identity.user_id, email=normalize_user_email(email)))
            elif not str(user.email or "").strip():
                user.email = normalize_user_email(email)

        identity.last_seen_at = utc_now()
        if first_signin and email_verified and get_application().is_default and not is_internal_user_id(clean_subject):
            db.flush()
            _migrate_verified_legacy_identity(db, clean_subject, identity.user_id)
        from app.modules.applications import bind_workspace_application
        bind_workspace_application(db, identity.user_id)
        require_user_access_active(db, identity.user_id)
        if get_application().is_default:
            capture_identity(db, identity.user_id, email, verified=email_verified)
        db.commit()
        return identity.user_id
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def link_external_identity(
    subject: str,
    target_user_id: str,
    email: str | None = None,
    provider: str | None = None,
) -> str:
    """Attach a provider login to an existing internal Decisionate user."""

    provider = identity_provider(provider)
    clean_subject = str(subject or "").strip()
    clean_target_user_id = str(target_user_id or "").strip()
    if not clean_subject or not clean_target_user_id:
        raise ValueError(
            "Both an external identity and internal user are required"
        )

    db = SessionLocal()
    try:
        if email:
            lock_user_email(db, email)
        from app.modules.applications import require_workspace_application
        require_workspace_application(db, clean_target_user_id)
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
        for user_id in sorted({target_user.id, *([identity.user_id] if identity else [])}):
            lock_user_identity(db, user_id)
        require_user_access_active(db, target_user.id)
        _require_active_identity(db, identity)
        if identity is None:
            identity = AuthIdentity(
                provider=provider,
                subject=clean_subject,
            )
            db.add(identity)

        identity.user_id = target_user.id
        identity.email = str(email or "").strip() or identity.email
        if not target_user.email and _email_mapping_enforced():
            target_user.email = normalize_user_email(identity.email)
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
    provider: str | None = None,
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
        if not internal_user_id and "@" in clean_value:
            existing = _find_unique_user_by_email(db, clean_value)
            internal_user_id = existing.id if existing else None
    finally:
        db.close()

    if not internal_user_id:
        raise ValueError("No registered account matches this reference. Send an email invitation instead.")
    return internal_user_id


def resolve_workspace_reference(
    value: str | None,
    internal_user_id: str,
    external_subject: str | None = None,
) -> str:
    clean_value = str(value or "").strip()
    if not clean_value or clean_value == str(external_subject or "").strip():
        return internal_user_id

    if not get_application().is_default:
        return clean_value

    db = SessionLocal()
    try:
        legacy_mapping = _load_legacy_mapping(db)
    finally:
        db.close()

    return _map_workspace_value(clean_value, legacy_mapping)
