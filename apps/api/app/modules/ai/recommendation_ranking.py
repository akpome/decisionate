"""Deterministic recommendation ranking used for explainable action queues."""

from __future__ import annotations

import re


HIGH_SIGNAL_TERMS = (
    "urgent",
    "overdue",
    "risk",
    "declin",
    "decreas",
    "unavailable",
    "failed",
    "loss",
    "anomal",
    "underperform",
)
MEDIUM_SIGNAL_TERMS = (
    "investigate",
    "review",
    "compare",
    "monitor",
    "target",
    "checkpoint",
)


def prioritize_recommendations(
    recommendations: list[str],
    confidence: str = "low",
) -> list[dict]:
    ranked = []
    for index, recommendation in enumerate(recommendations):
        text = str(recommendation or "").strip()
        normalized = re.sub(r"[^a-z0-9 ]+", " ", text.lower())
        high_hits = sum(term in normalized for term in HIGH_SIGNAL_TERMS)
        medium_hits = sum(term in normalized for term in MEDIUM_SIGNAL_TERMS)
        score = high_hits * 3 + medium_hits
        confidence_bonus = 1 if confidence == "high" else 0
        priority = "high" if high_hits else "medium" if medium_hits else "low"
        reason = (
            "Contains an active risk or exception signal."
            if high_hits
            else "Calls for review or monitoring."
            if medium_hits
            else "Useful follow-up with no urgent signal detected."
        )
        ranked.append({
            "text": text,
            "priority": priority,
            "score": min(100, (score + confidence_bonus) * 20),
            "reason": reason,
            "original_index": index,
        })

    ranked.sort(
        key=lambda item: (
            {"high": 0, "medium": 1, "low": 2}[item["priority"]],
            -item["score"],
            item["original_index"],
        )
    )
    return ranked
