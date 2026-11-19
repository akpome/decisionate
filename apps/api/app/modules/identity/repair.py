"""Bounded profile repair; never delete an identity referenced by application data."""

import re

from fastapi import HTTPException
from sqlalchemy import String, column, func, inspect, or_, select, table

from app.application_context import identity_provider
from app.db.models import AppUser, AuthIdentity, WorkspaceApplication
from app.modules.applications import workspace_application_scope
from app.modules.identity.clerk import lookup_clerk_email


def _reference_columns(db):
    inspector = inspect(db.connection())
    result = []
    for name in inspector.get_table_names():
        if name in {"app_users", "auth_identities", "workspace_applications"}:
            continue
        columns = [item for item in inspector.get_columns(name) if item["name"] in {"user_id", "workspace_id"}
                   or item["name"].endswith(("_user_id", "_workspace_id"))]
        if columns:
            result.append(table(name, *(column(item["name"], item["type"]) for item in columns)))
    return result


def _referenced(db, user_id, identities, tables):
    references = {user_id, *(item.subject for item in identities if item.subject)}
    for source in tables:
        conditions = []
        for value in source.c:
            value = value if isinstance(value.type, String) else value.cast(String)
            conditions.append(or_(value.in_(references), *(value.startswith(reference + ":client:", autoescape=True)
                              for reference in references)))
        if db.execute(select(1).select_from(source).where(or_(*conditions)).limit(1)).first():
            return True
    return False


def repair_user_emails(db, *, after=None, limit=25, protected_ids=()):
    candidates = db.query(AppUser).filter(AppUser.id.startswith("usr_", autoescape=True),
        func.trim(func.coalesce(AppUser.email, "")) == "")
    if after:
        candidates = candidates.filter(AppUser.id > after)
    candidates = candidates.order_by(AppUser.id).limit(limit).all()
    tables = None
    result = {"checked": 0, "emails_updated": 0, "users_deleted": 0, "unresolved": [],
              "provider_unavailable": False, "next_user_id": None, "updated_user_ids": [], "deleted_user_ids": []}
    network_left = 5
    last = after
    for user in candidates:
        identities = db.query(AuthIdentity).filter_by(user_id=user.id).order_by(AuthIdentity.last_seen_at.desc()).all()
        email = next((item.email.strip() for item in identities
                      if item.email and re.fullmatch(r"[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+", item.email.strip())), None)
        external_exists = False
        unknown_provider = False
        try:
            with workspace_application_scope(user.id, db, include_portal=False) as application:
                subjects = {item.subject for item in identities if item.provider == identity_provider("clerk")
                            or application.is_default and item.provider == "legacy" and item.subject.startswith("user_")}
                known_providers = {identity_provider("clerk")} | ({"legacy"} if application.is_default else set())
                unknown_provider = any(item.provider not in known_providers for item in identities)
                if not email and subjects and not network_left:
                    break
                to_check = sorted(subjects)[:network_left] if not email else []
                unknown_provider |= not email and len(to_check) < len(subjects)
                for subject in to_check:
                    network_left -= 1
                    found, verified_email = lookup_clerk_email(subject)
                    external_exists |= found
                    if verified_email:
                        email = verified_email
                        break
        except (HTTPException, ValueError):
            result["provider_unavailable"] = True
            result["unresolved"].append({"user_id": user.id, "reason": "Email provider could not be checked. Record preserved."})
            break
        db.refresh(user, with_for_update=True)
        if not str(user.email or "").strip():
            preserve = user.id in protected_ids or external_exists or unknown_provider
            if not email and not preserve:
                if tables is None:
                    tables = _reference_columns(db)
                preserve = _referenced(db, user.id, identities, tables)
            if email:
                user.email = email
                result["emails_updated"] += 1
                result["updated_user_ids"].append(user.id)
            elif preserve:
                result["unresolved"].append({"user_id": user.id, "reason": "Account or linked data needs a verified email. Record preserved."})
            else:
                db.query(AuthIdentity).filter_by(user_id=user.id).delete(synchronize_session=False)
                db.query(WorkspaceApplication).filter_by(workspace_id=user.id).delete(synchronize_session=False)
                db.delete(user)
                result["users_deleted"] += 1
                result["deleted_user_ids"].append(user.id)
        result["checked"] += 1
        last = user.id
        db.flush()
    if last and not result["provider_unavailable"] and db.query(AppUser.id).filter(
            AppUser.id.startswith("usr_", autoescape=True), AppUser.id > last,
            func.trim(func.coalesce(AppUser.email, "")) == "").first():
        result["next_user_id"] = last
    return result
