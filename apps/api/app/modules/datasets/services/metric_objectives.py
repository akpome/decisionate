"""Shared objective relevance for profiled and curated metric defaults."""

OBJECTIVE_ALIASES = {
    "increase_revenue": ("revenue", "sales", "profit", "orders"),
    "profitability": ("profit", "margin", "revenue", "cost", "expense"),
    "reduce_expenses": ("cost", "expense", "spend"),
    "cash_flow": ("balance", "payment", "cash", "receivable", "revenue"),
    "qualified_leads": ("lead", "conversion", "click", "call"),
    "retention": ("customer", "retained", "churn", "repeat"),
    "marketing_return": ("spend", "cost", "lead", "conversion", "revenue", "roas"),
}


def objective_relevance(normalized_column, definition, objective):
    if definition:
        return 1.0 if objective in definition.business_functions else 0.65
    aliases = OBJECTIVE_ALIASES.get(objective, ())
    return 0.8 if any(alias in normalized_column for alias in aliases) else 0.35


def matches_objective(normalized_column, definition, objective):
    if objective not in OBJECTIVE_ALIASES:
        return True
    return bool(
        (definition and objective in definition.business_functions)
        or any(alias in normalized_column for alias in OBJECTIVE_ALIASES[objective])
    )
