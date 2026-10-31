"""Weekly report names are stable labels, unlike one-off analysis draft names."""

import re

DEFAULT_WEEKLY_REPORT_NAME = "Weekly Business Report"
_GENERATED_WEEKLY_NAME = re.compile(
    r"(?:Weekly )*Report \([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\)", re.IGNORECASE
)


def weekly_report_name(name: str | None) -> str:
    return DEFAULT_WEEKLY_REPORT_NAME if not name or not name.strip() or _GENERATED_WEEKLY_NAME.fullmatch(name.strip()) else name
