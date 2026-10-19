"""Recognize old generated evidence placeholders without renaming user actions."""


def is_legacy_evidence_title(title):
    value = (title or "").strip()
    return value in {"Review joined dataset evidence", "Review generated insight"} or value.startswith("Review joined evidence:")


def is_legacy_evidence_placeholder(title, action):
    value = (action or "").strip()
    return is_legacy_evidence_title(title) and (
        not value or is_legacy_evidence_title(value)
        or value == "Review the joined metrics and agree on the next action."
    )
