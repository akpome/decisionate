"""Reusable decision templates for the decision creation workflow."""

from urllib.parse import urlencode

from app.configuration import get_runtime_configuration


ALERT_DECISION_TEMPLATE_SLUG = "investigate-kpi-signal"

DECISION_TEMPLATE_DEFINITIONS = (
    {
        "slug": ALERT_DECISION_TEMPLATE_SLUG,
        "name": "Investigate a KPI signal",
        "description": "Turn an unexpected metric movement into a focused investigation.",
        "category": "general",
        "priority": "medium",
        "confidence_score": "medium",
        "title_template": "Investigate {metric} movement",
        "decision_description": "Identify the main drivers behind {metric} movement and decide what action should be taken.",
        "expected_outcome": "Identify the primary driver of {metric} and agree on a measurable next action.",
        "review_days": 14,
    },
    {
        "slug": "reallocate-marketing-budget",
        "name": "Reallocate marketing budget",
        "description": "Decide where marketing spend should move to improve performance.",
        "category": "marketing",
        "priority": "high",
        "confidence_score": "medium",
        "title_template": "Reallocate budget based on {metric}",
        "decision_description": "Compare campaign or channel performance for {metric} and decide whether budget should be shifted.",
        "expected_outcome": "Improve {metric} within the next review period without exceeding the approved budget.",
        "review_days": 30,
    },
    {
        "slug": "improve-sales-conversion",
        "name": "Improve sales conversion",
        "description": "Create a practical intervention for a sales funnel or pipeline problem.",
        "category": "sales",
        "priority": "high",
        "confidence_score": "medium",
        "title_template": "Improve conversion measured by {metric}",
        "decision_description": "Locate the largest sales funnel constraint affecting {metric} and select one intervention to test.",
        "expected_outcome": "Increase {metric} by an agreed target before review.",
        "review_days": 30,
    },
    {
        "slug": "reduce-operating-costs",
        "name": "Reduce operating costs",
        "description": "Evaluate an operating cost signal and choose a controlled reduction action.",
        "category": "operations",
        "priority": "medium",
        "confidence_score": "medium",
        "title_template": "Reduce operating cost related to {metric}",
        "decision_description": "Review the cost driver behind {metric}, identify avoidable spend, and choose a reduction action that protects service quality.",
        "expected_outcome": "Reduce {metric} while maintaining the agreed service or quality threshold.",
        "review_days": 45,
    },
    {
        "slug": "improve-customer-retention",
        "name": "Improve customer retention",
        "description": "Plan an intervention when retention, churn, or customer health needs attention.",
        "category": "product",
        "priority": "high",
        "confidence_score": "medium",
        "title_template": "Improve retention measured by {metric}",
        "decision_description": "Identify the customer segment or journey stage most responsible for the {metric} signal and choose an intervention.",
        "expected_outcome": "Improve {metric} for the target customer segment before review.",
        "review_days": 45,
    },
    {
        "slug": "prioritize-product-improvement",
        "name": "Prioritize a product improvement",
        "description": "Turn product usage or customer evidence into a focused prioritization decision.",
        "category": "product",
        "priority": "medium",
        "confidence_score": "medium",
        "title_template": "Prioritize product improvement using {metric}",
        "decision_description": "Assess the evidence for {metric}, compare the expected impact and effort, and choose the next product improvement.",
        "expected_outcome": "Select one product improvement with a measurable {metric} success signal and an accountable owner.",
        "review_days": 30,
    },
    {
        "slug": "control-finance-variance",
        "name": "Control a finance variance",
        "description": "Investigate a revenue, expense, or cash variance and agree on corrective action.",
        "category": "finance",
        "priority": "high",
        "confidence_score": "medium",
        "title_template": "Control variance in {metric}",
        "decision_description": "Explain the financial variance in {metric}, determine whether it is temporary or structural, and select a corrective action.",
        "expected_outcome": "Bring {metric} back within its approved range by the review date.",
        "review_days": 30,
    },
)


def list_decision_templates() -> list[dict]:
    return [
        {
            **template,
        }
        for template in DECISION_TEMPLATE_DEFINITIONS
    ]


def get_decision_template(slug: str | None) -> dict | None:
    clean_slug = str(slug or "").strip().lower()
    return next(
        (
            {
                **template,
            }
            for template in DECISION_TEMPLATE_DEFINITIONS
            if template["slug"] == clean_slug
        ),
        None,
    )


def build_decision_template_url(
    slug: str = ALERT_DECISION_TEMPLATE_SLUG,
    dataset_id: int | None = None,
    metric: str | None = None,
) -> str:
    template = get_decision_template(slug)
    clean_slug = template["slug"] if template else ALERT_DECISION_TEMPLATE_SLUG
    params = {"template": clean_slug}

    if dataset_id is not None:
        params["dataset"] = str(dataset_id)
    if metric and str(metric).strip():
        params["metric"] = str(metric).strip()

    web_app_url = get_runtime_configuration().web_url.rstrip("/")
    return f"{web_app_url}/dashboard/decisions/new?{urlencode(params)}"
