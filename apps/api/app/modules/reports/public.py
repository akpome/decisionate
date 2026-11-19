"""Revocable access to selected, immutable report results, never workspace records."""

import json

from fastapi import APIRouter, HTTPException, Response

from app.db.database import SessionLocal
from app.modules.applications import workspace_belongs_to_application
from app.modules.workspace_lifecycle import workspace_is_paused
from app.modules.sharing_links import find_shared_link
from .models import BusinessReport, ReportShare


router = APIRouter(prefix="/public/reports", tags=["shared-reports"])
PUBLIC_HEADERS = {"Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer"}


def public_report(snapshot):
    fields = {"name", "business_question", "window", "previous_window", "history_window", "grain", "analysis_grain",
              "dataset_count", "status", "analysis_source", "generated_at", "metrics", "findings", "included_findings",
              "observations", "contrasts", "recommendations", "warnings", "limitations", "anomaly_analysis", "ai_analysis"}
    report = {key: value for key, value in snapshot.items() if key in fields}
    definition_fields = {"name", "scope", "include_relationships", "include_anomalies", "seasonal_business", "metrics", "method",
                         "grain", "date_range", "filters", "lag", "dimension_filters", "pair_directions", "excluded_pairs"}
    report["definition"] = {key: value for key, value in snapshot["definition"].items() if key in definition_fields}
    report["decisions"] = []
    return report


@router.get("/{token}")
def get_shared_report(token: str, response: Response):
    response.headers.update(PUBLIC_HEADERS)
    missing = HTTPException(404, "This shared report is unavailable. Ask the sender for a new email.", headers=PUBLIC_HEADERS)
    if not 32 <= len(token) <= 100:
        raise missing
    with SessionLocal() as db:
        email_link = find_shared_link(db, token)
        if email_link is not None:
            if email_link.revoked_at is not None or email_link.kind != "report":
                raise missing
            record = db.query(BusinessReport).filter_by(id=email_link.report_id, workspace_id=email_link.workspace_id).first()
        else:
            record = db.query(BusinessReport).join(ReportShare, ReportShare.report_id == BusinessReport.id).filter(ReportShare.token == token).first()
        if (record is None or not workspace_belongs_to_application(db, record.workspace_id)
                or workspace_is_paused(db, record.workspace_id)):
            raise missing
        snapshot = json.loads(record.snapshot)
        if snapshot["definition"].get("impact") or snapshot.get("weekly_report"):
            raise missing
        from app.modules.alerts.router import get_weekly_report_branding
        brand = get_weekly_report_branding(db, record.workspace_id)
        return {"report": public_report(snapshot), "branding": {
            "name": brand["brand_name"], "logo_url": brand.get("brand_logo_url"),
            "primary_color": brand["brand_primary_color"], "accent_color": brand["brand_accent_color"],
        }}
