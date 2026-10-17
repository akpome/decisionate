"""Reviewed Opportunity defaults, separate from receipt/invoice measures."""

OPPORTUNITY_DEFAULT_METRICS = ("Amount", "ExpectedRevenue", "Probability", "TotalOpportunityQuantity")


def salesforce_resource(config):
    resource = str(config.get("resource_type") or config.get("resource") or config.get("object_type") or "opportunities").strip().lower()
    return {"opportunity": "opportunities", "account": "accounts", "lead": "leads"}.get(resource, resource)


def salesforce_metric_columns(source_type, config, columns):
    if source_type != "salesforce" or salesforce_resource(config) != "opportunities":
        return None
    return [column for column in OPPORTUNITY_DEFAULT_METRICS if column in columns]


def uses_salesforce_defaults(source_type, config):
    if salesforce_metric_columns(source_type, config, ()) is None:
        return False
    provenance = config.get("metric_selection_provenance")
    source = provenance.get("source") if isinstance(provenance, dict) else None
    if source == "user":
        return False
    # Unknown saved lists can be deliberate choices. Only migrate defaults
    # whose provenance we can establish, or an unconfigured dataset.
    return source == "recommended" or not isinstance(config.get("selected_metric_columns"), list)


def restrict_salesforce_profile(source_type, config, profile):
    allowed = salesforce_metric_columns(source_type, config, profile["available_metric_columns"])
    if allowed is None:
        return profile
    allowed = {*allowed, "__metric_record_count"}
    removed = set(profile["recommended_metric_columns"]) - allowed
    for field in profile["fields"]:
        if field["column"] in removed:
            field.update(status="advanced", reason="Not a standard sales-performance measure; available for manual selection.", exclusion_reason=None)
    profile["recommended_metric_columns"] = [column for column in profile["recommended_metric_columns"] if column in allowed]
    profile["advanced_metric_columns"] = list(dict.fromkeys([*profile["advanced_metric_columns"], *sorted(removed)]))
    return profile
