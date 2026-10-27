"""Reproducible, explicitly synthetic business-change studies with known effects."""

import argparse
import csv
from datetime import date, timedelta
import json
import math
from pathlib import Path
import random


def generate(output):
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    rng = random.Random(20261027)
    start, change_week, weeks = date(2024, 1, 1), 105, 147
    outcomes, comparisons = [], []
    noise = 0.
    for week in range(weeks):
        current = start + timedelta(weeks=week)
        control = max(1, round(100 + rng.gauss(0, 20)))
        noise = .3 * noise + rng.gauss(0, 2)
        base = round(200 + .2 * week + .8 * control + 25 * math.sin(2 * math.pi * week * 7 / 365.2425) + noise)
        active = week >= change_week
        outcomes.append({"week": str(current), "orders_helpful_change": base + 30 * active,
                         "orders_no_effect": base, "orders_harmful_change": base - 30 * active})
        comparisons.append({"week": str(current), "comparison_orders": control})
    for name, rows in (("changed_store.csv", outcomes), ("unchanged_store.csv", comparisons)):
        with (output / name).open("w", newline="", encoding="utf-8") as file:
            writer = csv.DictWriter(file, fieldnames=list(rows[0]), lineterminator="\n")
            writer.writeheader()
            writer.writerows(rows)
    manifest = {"synthetic": True, "seed": 20261027, "start": str(start), "end": str(start + timedelta(weeks=weeks, days=-1)),
                "change_date": str(start + timedelta(weeks=change_week)), "grain": "weekly", "seasonal_business": True,
                "comparison": "unchanged_store.csv / comparison_orders", "post_periods": weeks - change_week,
                "effects_per_week": {"orders_helpful_change": 30, "orders_no_effect": 0, "orders_harmful_change": -30},
                "notes": ["Fictional weekly counts, not connector exports or customer data.",
                          "The comparison is unaffected by construction. Only the changed store has the intervention.",
                          "Known effects test implementation behavior; they are not proof of real-world causal validity."]}
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[3] / "sample-data" / "business-impact")
    print(json.dumps(generate(parser.parse_args().output), indent=2))
