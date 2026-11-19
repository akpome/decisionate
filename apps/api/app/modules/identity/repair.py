"""Bounded profile repair; never delete an identity referenced by application data."""

import re

from fastapi import HTTPException
from sqlalchemy import String, column, func, inspect, or_, select, table

from app.application_context import get_application, identity_provider
from app.db.models import AppUser, AuthIdentity, Organization, OrganizationMember, PlatformAdminRole, WorkspaceApplication
from app.modules.applications import workspace_application_scope
from app.modules.identity.clerk import lookup_clerk_email
from app.modules.identity.service import lock_user_email, normalize_user_email, validate_user_email_constraint


def _email_in_use(db, user_id, email):
    from app.modules.applications import workspace_application_id
    profiles = db.query(AppUser.id).filter(AppUser.id != user_id, func.lower(func.trim(AppUser.email)) == email).all()
    aliases = db.query(AuthIdentity.user_id).filter(AuthIdentity.user_id != user_id, func.lower(func.trim(AuthIdentity.email)) == email).all()
    return any(workspace_application_id(db, other_id) == get_application().id for other_id, in [*profiles, *aliases])


def map_user_email(db, user_id, requested_email):
    if not re.fullmatch(r"usr_[A-Za-z0-9_-]+", user_id):
        raise HTTPException(400, "Choose an internal user account, not a workspace reference.")
    email = normalize_user_email(requested_email)
    user = db.get(AppUser, user_id)
    identities = db.query(AuthIdentity).filter_by(user_id=user_id).order_by(AuthIdentity.last_seen_at.desc()).all()
    if user is None and not (identities or db.query(Organization.id).filter_by(owner_user_id=user_id).first()
            or db.query(OrganizationMember.id).filter_by(clerk_user_id=user_id).first()
            or db.query(PlatformAdminRole.id).filter_by(user_id=user_id).first()):
        raise HTTPException(404, "User account not found.")
    with workspace_application_scope(user_id, db, include_portal=False) as application:
        lock_user_email(db, email)
        user = db.query(AppUser).filter_by(id=user_id).populate_existing().with_for_update().first()
        if user and str(user.email or "").strip():
            if user.email.strip().lower() == email:
                return {"user_id": user_id, "email": email, "mapped": True, "changed": False}
            raise HTTPException(409, "This account already has an email. Existing mappings cannot be replaced here.")
        if _email_in_use(db, user_id, email):
            raise HTTPException(409, "This email is already mapped to another account in this application. Review both accounts instead of merging them.")
        known = {identity_provider("clerk")} | ({"legacy"} if application.is_default else set())
        if any(item.provider not in known for item in identities):
            raise HTTPException(409, "This sign-in provider needs identity recovery before an email can be mapped.")
        subjects = {item.subject for item in identities if item.provider == identity_provider("clerk")
                    or application.is_default and item.provider == "legacy" and item.subject.startswith("user_")}
        if len(subjects) > 5:
            raise HTTPException(409, "This account has multiple sign-in references. Review its identities before mapping an email.")
        active, verified = False, set()
        for subject in sorted(subjects):
            found, address = lookup_clerk_email(subject)
            active |= found
            if address:
                verified.add(address.lower())
        if active and email not in verified:
            raise HTTPException(409, "The email must match a verified primary email on this account's existing Clerk sign-in. Verify that email in Clerk first.")
    if user is None:
        user = AppUser(id=user_id, email=email)
        db.add(user)
    else:
        user.email = email
    db.flush()
    validate_user_email_constraint(db)
    return {"user_id": user_id, "email": email, "mapped": True, "changed": True}


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
        ~AppUser.id.contains(":client:"),
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
        if email:
            with workspace_application_scope(user.id, db, include_portal=False):
                lock_user_email(db, email)
                if _email_in_use(db, user.id, email.strip().lower()):
                    result["unresolved"].append({"user_id": user.id, "reason": "Email already belongs to another account. Explicit identity review is required."})
                    result["checked"] += 1
                    last = user.id
                    continue
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
            ~AppUser.id.contains(":client:"),
            func.trim(func.coalesce(AppUser.email, "")) == "").first():
        result["next_user_id"] = last
    result["remaining_unmapped"] = db.query(AppUser.id).filter(AppUser.id.startswith("usr_", autoescape=True),
        ~AppUser.id.contains(":client:"), func.trim(func.coalesce(AppUser.email, "")) == "").count()
    if not result["remaining_unmapped"]:
        validate_user_email_constraint(db)
    return result
