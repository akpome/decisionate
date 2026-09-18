from __future__ import annotations

import re


def _normalise_text(value: object) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip().lower())


def _token_overlap(left: str, right: str) -> float:
    left_tokens = set(re.findall(r"[a-z0-9]+", left))
    right_tokens = set(re.findall(r"[a-z0-9]+", right))
    if not left_tokens or not right_tokens:
        return 0.0
    return len(left_tokens & right_tokens) / max(
        1,
        min(len(left_tokens), len(right_tokens)),
    )


def deduplicate_insights(insights: list[dict]) -> list[dict]:
    """Keep one actionable insight per source metric and near-identical message."""
    result: list[dict] = []
    seen_keys: set[tuple[str, str, str]] = set()

    for insight in insights:
        insight_type = _normalise_text(insight.get("type"))
        column = _normalise_text(insight.get("column"))
        title = _normalise_text(insight.get("title"))
        description = _normalise_text(insight.get("description"))
        exact_key = (insight_type, column, title)
        if exact_key in seen_keys:
            continue

        if any(
            _normalise_text(existing.get("type")) == insight_type
            and _normalise_text(existing.get("column")) == column
            and _token_overlap(
                _normalise_text(existing.get("description")),
                description,
            ) >= 0.9
            for existing in result
        ):
            continue

        seen_keys.add(exact_key)
        result.append(insight)

    return result


def deduplicate_text_items(items: list[str]) -> list[str]:
    """Collapse repeated alert/recommendation text while preserving order."""
    result: list[str] = []
    for item in items:
        text = str(item or "").strip()
        normalized = _normalise_text(text)
        if not normalized:
            continue
        if any(
            _normalise_text(existing) == normalized
            or _token_overlap(_normalise_text(existing), normalized) >= 0.9
            for existing in result
        ):
            continue
        result.append(text)
    return result
