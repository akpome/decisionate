"""Generate paired synthetic daily CSVs, not provider-native API responses."""

import argparse
import csv
from datetime import date, timedelta
from decimal import Decimal
import json
import math
from pathlib import Path
import random
from statistics import correlation
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo


DEFAULT_YEAR = 2025
DEFAULT_SEED = 20251018
RESPONSE_LAG_DAYS = 2
WARMUP_DAYS = 28
META_METRICS = ("spend", "impressions", "clicks", "leads", "attributed_orders", "attributed_revenue")
SHOPIFY_METRICS = ("orders", "quantity", "gross_sales", "net_sales")
SCENARIO = {
    "base_daily_ad_budget_cad": 25,
    "minimum_daily_ad_budget_cad": 6,
    "maximum_daily_ad_budget_cad": 40,
    "ad_budget_cycle_amplitude_cad": 8,
    "ad_budget_noise_sd_cad": 5,
    "baseline_cpm_cad": 14,
    "baseline_click_through_rate": 0.016,
    "baseline_click_to_purchase_rate": 0.032,
    "baseline_daily_non_ad_orders": 70,
    "minimum_daily_non_ad_orders": 45,
    "non_ad_order_noise_sd": 4,
    "item_prices_cad": [29.95, 39.95, 49.95, 69.95, 89.95],
    "promotion_discount_rate": 0.15,
    "order_refund_probability": 0.045,
    "refund_delay_days": [7, 21],
}
DEFINITION_SOURCES = [
    {"title": "Shopify sales reports: sales, discounts, orders and average order value",
     "url": "https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/default-reports/sales-report"},
    {"title": "Shopify return on ad spend: attributed revenue divided by advertising cost",
     "url": "https://www.shopify.com/blog/roas"},
]


def money(cents):
    return f"{Decimal(cents) / Decimal(100):.2f}"


def build_datasets(year=DEFAULT_YEAR, seed=DEFAULT_SEED):
    start, end = date(year, 1, 1), date(year + 1, 1, 1)
    ad_rng, store_rng = random.Random(seed), random.Random(seed + 1)
    first = start - timedelta(days=WARMUP_DAYS)
    traffic, meta_rows, shopify_rows = [], [], []
    refunds_due = {}
    item_prices = [round(price * 100) for price in SCENARIO["item_prices_cad"]]
    weekday_factors = (0.96, 0.98, 1.00, 1.03, 1.08, 1.16, 1.10)

    for offset in range((end - first).days):
        current = first + timedelta(days=offset)
        annual_phase = 2 * math.pi * (current.timetuple().tm_yday - 30) / (end - start).days
        season = 1 + 0.14 * math.sin(annual_phase)
        promotion = current.month == 11 and 20 <= current.day <= 30
        seasonal_lift = 1.60 if promotion else 1.20 if current.month == 12 else 1.0
        weekly = weekday_factors[current.weekday()]
        budget = (SCENARIO["base_daily_ad_budget_cad"]
                  + SCENARIO["ad_budget_cycle_amplitude_cad"] * math.sin(2 * math.pi * offset / 35)
                  + ad_rng.gauss(0, SCENARIO["ad_budget_noise_sd_cad"]))
        spend_cents = min(SCENARIO["maximum_daily_ad_budget_cad"] * 100,
                          max(SCENARIO["minimum_daily_ad_budget_cad"] * 100,
                              round(budget * season * seasonal_lift * weekly * 100)))
        modeled_cpm = SCENARIO["baseline_cpm_cad"] + (2 if promotion else 0) + ad_rng.uniform(-1.8, 1.8)
        impressions = round((spend_cents / 100) * 1000 / modeled_cpm)
        clicks = round(impressions * (SCENARIO["baseline_click_through_rate"] + ad_rng.uniform(-0.002, 0.002)))
        leads = min(clicks, max(0, round(clicks * 0.06 + ad_rng.gauss(0, 2))))
        traffic.append(clicks)

        # Warm-up observations supply prior clicks without wrapping year-end data.
        earlier_clicks = traffic[max(0, offset - RESPONSE_LAG_DAYS)]
        fatigue = 1 - 0.12 * (offset % 35) / 34
        conversion_rate = SCENARIO["baseline_click_to_purchase_rate"] * fatigue * (1.2 if promotion else 1)
        attributed_orders = sum(store_rng.random() < conversion_rate for _ in range(earlier_clicks))
        other_orders = max(SCENARIO["minimum_daily_non_ad_orders"],
                           round(SCENARIO["baseline_daily_non_ad_orders"] * season * seasonal_lift * weekly
                                 + store_rng.gauss(0, SCENARIO["non_ad_order_noise_sd"])))
        orders = attributed_orders + other_orders
        quantity = gross_cents = discount_cents = attributed_cents = 0
        for order_index in range(orders):
            units = 1 + int(store_rng.random() < 0.55) + int(store_rng.random() < 0.15)
            basket = store_rng.choices(item_prices, weights=(15, 25, 28, 22, 10), k=units)
            order_gross = sum(basket)
            discount_rate = (SCENARIO["promotion_discount_rate"] if promotion else
                             store_rng.choice((0.05, 0.10)) if store_rng.random() < 0.30 else 0)
            order_discount = round(order_gross * discount_rate)
            quantity += units
            gross_cents += order_gross
            discount_cents += order_discount
            if order_index < attributed_orders:
                attributed_cents += order_gross - order_discount
            if store_rng.random() < SCENARIO["order_refund_probability"]:
                refund_day = current + timedelta(days=store_rng.randint(*SCENARIO["refund_delay_days"]))
                refund_value = min(order_gross - order_discount, round(store_rng.choice(basket) * (1 - discount_rate)))
                refunds_due[refund_day] = refunds_due.get(refund_day, 0) + refund_value
        refund_cents = refunds_due.pop(current, 0)
        if current < start:
            continue

        context = {"date": current.isoformat(), "data_origin": "synthetic", "currency": "CAD"}
        meta_rows.append({
            **context, "spend": money(spend_cents), "impressions": impressions,
            "clicks": clicks, "leads": leads, "attributed_orders": attributed_orders,
            "attributed_revenue": money(attributed_cents),
        })
        shopify_rows.append({
            **context, "orders": orders, "non_ad_orders": other_orders, "quantity": quantity,
            "gross_sales": money(gross_cents), "discounts": money(discount_cents),
            "refund_amount": money(refund_cents),
            "net_sales": money(gross_cents - discount_cents - refund_cents),
        })
    return meta_rows, shopify_rows


def measured_correlations(meta_rows, shopify_rows):
    results = []
    for left, right, lags in (
        ("spend", "net_sales", (0, RESPONSE_LAG_DAYS)),
        ("spend", "orders", (0, RESPONSE_LAG_DAYS)),
        ("clicks", "orders", (0, RESPONSE_LAG_DAYS)),
        ("attributed_orders", "orders", (0,)),
    ):
        for lag in lags:
            a = [float(row[left]) for row in (meta_rows[:-lag] if lag else meta_rows)]
            b = [float(row[right]) for row in shopify_rows[lag:]]
            results.append({
                "meta_ads_metric": left, "shopify_metric": right,
                "meta_ads_leads_by_days": lag, "observations": len(a),
                "pearson_coefficient": correlation(a, b),
            })
    return results


def measured_economics(meta_rows, shopify_rows):
    spend = sum(Decimal(row["spend"]) for row in meta_rows)
    attributed_revenue = sum(Decimal(row["attributed_revenue"]) for row in meta_rows)
    gross, discounts, refunds, net = (sum(Decimal(row[key]) for row in shopify_rows)
                                    for key in ("gross_sales", "discounts", "refund_amount", "net_sales"))
    orders = sum(row["orders"] for row in shopify_rows)
    paid_orders = sum(row["attributed_orders"] for row in meta_rows)
    days = len(meta_rows)
    return {
        "period_totals": {"ad_spend_cad": f"{spend:.2f}", "attributed_revenue_cad": f"{attributed_revenue:.2f}",
                          "gross_sales_cad": f"{gross:.2f}", "discounts_cad": f"{discounts:.2f}",
                          "refund_amount_cad": f"{refunds:.2f}", "net_sales_cad": f"{net:.2f}",
                          "orders": orders, "attributed_orders": paid_orders, "non_ad_orders": orders - paid_orders},
        "daily_averages": {"ad_spend_cad": f"{spend / days:.2f}", "orders": round(orders / days, 2),
                           "attributed_orders": round(paid_orders / days, 2),
                           "non_ad_orders": round((orders - paid_orders) / days, 2), "net_sales_cad": f"{net / days:.2f}"},
        "daily_ranges": {"ad_spend_cad": {"minimum": min((row["spend"] for row in meta_rows), key=Decimal),
                                          "maximum": max((row["spend"] for row in meta_rows), key=Decimal)},
                         "orders": {"minimum": min(row["orders"] for row in shopify_rows),
                                    "maximum": max(row["orders"] for row in shopify_rows)}},
        "days_order_count_exceeds_ad_spend_numeric_value": sum(Decimal(store["orders"]) > Decimal(meta["spend"])
                                                               for meta, store in zip(meta_rows, shopify_rows)),
        "weighted_unit_economics": {
            "average_order_value_cad": f"{(gross - discounts) / orders:.2f}",
            "media_cost_per_attributed_order_cad": f"{spend / paid_orders:.2f}",
            "media_only_attributed_roas": round(float(attributed_revenue / spend), 4),
            "blended_net_sales_to_ad_spend_ratio": round(float(net / spend), 4),
            "attributed_order_share_percent": round(100 * paid_orders / orders, 2),
        },
        "formulas": {
            "average_order_value_cad": "SUM(gross_sales - discounts) / SUM(orders); before later refunds.",
            "media_cost_per_attributed_order_cad": "SUM(spend) / SUM(attributed_orders); not new-customer acquisition cost.",
            "media_only_attributed_roas": "SUM(attributed_revenue) / SUM(spend); excludes agency fees and creative costs.",
            "blended_net_sales_to_ad_spend_ratio": "SUM(net_sales) / SUM(spend); includes non-ad orders, so this is not attributed ROAS.",
            "attributed_order_share_percent": "100 * SUM(attributed_orders) / SUM(orders).",
        },
    }


def build_manifest(year, seed, meta_rows, shopify_rows):
    return {
        "data_origin": "synthetic", "provider_native_export": False,
        "scenario": "Low-budget advertising for an established store driven mainly by organic and repeat-customer orders.",
        "year": year, "seed": seed, "currency": "CAD", "grain": "daily",
        "date_range": {"start": meta_rows[0]["date"], "end": meta_rows[-1]["date"]},
        "datasets": [
            {"file": f"meta_ads_daily_{year}.csv", "rows": len(meta_rows),
             "date_column": "date", "recommended_metrics": list(META_METRICS),
             "aggregation": "sum", "scope": "All modeled Meta Ads campaigns combined"},
            {"file": f"shopify_daily_{year}.csv", "rows": len(shopify_rows),
             "date_column": "date", "recommended_metrics": list(SHOPIFY_METRICS),
             "aggregation": "sum", "scope": "All modeled Shopify store orders combined"},
        ],
        "definitions": {
            "spend": "Media advertising cost in CAD, not a count of orders.",
            "impressions": "Modeled daily ad displays, not unique people.",
            "clicks": "Modeled daily ad clicks, not store orders or unique customers.",
            "leads": "Modeled marketing signups, separate from the purchase-count metric; a buyer need not first be counted as a lead.",
            "attributed_orders": "Synthetic daily purchase-attribution count; a demo aggregate name, not a native API field claim.",
            "attributed_revenue": "After-discount purchase value of the attributed orders on their purchase date, before later refunds; a synthetic demo aggregate, not a native Meta API field claim.",
            "orders": "Synthetic total store order count, including modeled advertising-attributed and other orders.",
            "non_ad_orders": "Synthetic organic/repeat-customer orders, generated independently of paid clicks; orders = non_ad_orders + Meta attributed_orders for the same date.",
            "quantity": "Synthetic gross item units ordered for the day; not order count or units net of later returns.",
            "gross_sales": "Modeled item value before discounts and refunds; excludes tax and shipping.",
            "net_sales": "gross_sales minus discounts minus refund_amount; excludes tax and shipping.",
            "discounts": "Supporting daily monetary total, not a discount percentage.",
            "refund_amount": "Positive merchandise refund amount processed today for modeled orders from 7-21 days earlier; not returned-item count. No other sales reversal types are modeled.",
        },
        "metric_units": {"spend": "CAD", "attributed_revenue": "CAD", "gross_sales": "CAD",
                         "discounts": "CAD", "refund_amount": "CAD", "net_sales": "CAD",
                         "orders": "count", "non_ad_orders": "count", "quantity": "count", "attributed_orders": "count",
                         "impressions": "count", "clicks": "count", "leads": "count"},
        "model": {
            "advertising_response_lag_days": RESPONSE_LAG_DAYS,
            "warmup_days_outside_export": WARMUP_DAYS,
            "fictional_scenario_assumptions_not_benchmarks": SCENARIO,
            "features": ["annual seasonality", "weekday variation", "November promotion", "December uplift",
                         "random click-to-purchase outcomes", "campaign fatigue", "non-advertising orders",
                         "individual order baskets", "discounts", "delayed partial refunds"],
            "limitations": [
                "Daily aggregate CSVs for demonstration, not raw connector responses or real customer data.",
                "Model parameters and attribution are invented for this demo, not provider benchmarks.",
                "Correlations are intentionally generated and do not establish real-world causation or attribution.",
                "Most orders are organic/repeat-customer purchases. The small paid-order response can be masked by other demand; the strongest total-sales correlation need not occur at the modeled paid-response lag.",
                "Shared seasonality affects both spending and organic orders; any correlation in store totals must not be attributed entirely to advertising.",
                "Gross and net sales are mathematically related; use cross-dataset pairs for the main demonstration.",
                "Spend is currency and orders are counts; compare spend to sales for a same-unit monetary view, not to the raw height of an order-count line.",
                "Attribution uses purchase dates in this fictional model, not provider attribution windows or native advertising-report time settings.",
                "Attributed purchase revenue excludes later refunds and may exceed net store sales on refund-heavy days.",
                "Revenue and ROAS are not profit; product costs, shipping, tax, fees, agency costs and creative costs are not modeled.",
            ],
        },
        "definition_sources": DEFINITION_SOURCES,
        "measured_economics": measured_economics(meta_rows, shopify_rows),
        "measured_pearson_correlations": measured_correlations(meta_rows, shopify_rows),
        "analysis_settings": {
            "method": "pearson", "grain": "daily", "aggregation": "sum",
            "minimum_observations": 30, "lag_days": {"minimum": 0, "maximum": 7},
            "direction": "Meta Ads leads Shopify", "business_objective": "general_business",
        },
    }


def write_demo(output_dir, year=DEFAULT_YEAR, seed=DEFAULT_SEED):
    output_dir = Path(output_dir)
    meta_rows, shopify_rows = build_datasets(year, seed)
    manifest = build_manifest(year, seed, meta_rows, shopify_rows)
    output_dir.mkdir(parents=True, exist_ok=True)
    filenames = []
    for filename, rows in ((f"meta_ads_daily_{year}.csv", meta_rows), (f"shopify_daily_{year}.csv", shopify_rows)):
        with (output_dir / filename).open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=list(rows[0]), lineterminator="\n")
            writer.writeheader()
            writer.writerows(rows)
        filenames.append(filename)

    (output_dir / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    guide = f"""SYNTHETIC META ADS + SHOPIFY CORRELATION DEMO

Period: {year}-01-01 through {year}-12-31 (inclusive).
Rows: {len(meta_rows)} per CSV, one daily aggregate per date.
Currency: CAD. Seed: {seed}. No real customer or account data.
These are CSV upload datasets, not native Meta Ads or Shopify API exports.

SCENARIO: Low ad budget for an established, organic/repeat-customer-led store.
Daily ad spend is capped at CAD{SCENARIO['maximum_daily_ad_budget_cad']}; daily non-ad orders are at least
{SCENARIO['minimum_daily_non_ad_orders']}. The order count exceeds the numerical CAD spend on every date.
This is a chosen fictional scenario, not a general ecommerce benchmark.
Only attributed_orders are assigned to advertising. Shopify non_ad_orders
contains the organic/repeat-customer portion; it is not generated by paid clicks.

Compare Meta spend with Shopify orders for the requested demonstration.
These are different units: CAD versus order count. Use separate axes or
standardized series for a visual comparison; their raw heights are not ROAS.
For a same-unit monetary comparison, use spend versus net_sales (both CAD).

MEASURED ECONOMICS FOR THIS GENERATED SCENARIO
{json.dumps(manifest['measured_economics'], indent=2)}

These are measurements of fictional data, not industry averages. Ratios use
period totals, not averages or sums of daily ratios. ROAS is not profit.

1. Upload the two CSVs separately in Decisionate's Datasets page.
2. Keep the general-business objective and save the metric selections.
   Meta Ads: {', '.join(META_METRICS)}.
   Shopify: {', '.join(SHOPIFY_METRICS)}.
   Use date as the date column, not as a numeric metric.
3. Open the multi-metric correlation analysis and select metrics from both uploads.
4. Use the full date range, daily grouping, SUM aggregation and Pearson correlation.
5. Compare spend versus orders, spend versus net_sales and clicks versus orders at lag 0.
6. Enable lags 0 through 7 days with Meta Ads leading Shopify.
   The paid-order response is delayed by {RESPONSE_LAG_DAYS} days, but is only a small part
   of store orders. Total orders need not have their strongest association at
   that lag. Shared seasonality is not proof of an advertising effect.
   The manifest contains the actual measured coefficients, not target results.
7. attributed_orders and attributed_revenue are subsets of store purchases.
   Their relationship to store totals is partly mechanical, not independent evidence.

The model includes seasonality, weekday variation, a November promotion,
December uplift, variable conversion outcomes, campaign fatigue, individual
order baskets, partial refunds 7-21 days after purchase, and non-ad orders. Effects and
parameters are invented for this demo, not benchmarks for either provider.
attributed_orders and attributed_revenue are synthetic aggregate labels, not
native API field claims. Both are recorded on the purchase date; revenue is
after discounts and before later refunds. This is not a native Meta attribution window.
net_sales = gross_sales - discounts - refund_amount; tax and shipping are excluded.
refund_amount includes only merchandise refunds; other reversal types are not modeled.
discounts and refund_amount support the arithmetic; they are not required for
the recommended correlation analysis. Gross and net sales are mechanically
related, so their association is not evidence that one causes the other.

Synthetic correlation demonstrates the tool, not real-world causation,
advertising effectiveness, or a verified attribution window.

Official definitions consulted (scenario parameters are not sourced benchmarks):
{chr(10).join(source['url'] for source in DEFINITION_SOURCES)}

Regenerate from the repository root:
python3 apps/api/demo_data/connectors/generate_correlation_demo_data.py --year {year} --seed {seed}
"""
    (output_dir / "README.txt").write_text(guide, encoding="utf-8")
    filenames.extend(("manifest.json", "README.txt"))
    archive_path = output_dir / f"meta_ads_shopify_correlation_{year}.zip"
    with ZipFile(archive_path, "w", compression=ZIP_DEFLATED) as archive:
        for filename in filenames:
            info = ZipInfo(filename, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, (output_dir / filename).read_bytes())
    return manifest, archive_path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--year", type=int, default=DEFAULT_YEAR)
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED)
    parser.add_argument("--output-dir", type=Path)
    args = parser.parse_args()
    output_dir = args.output_dir or Path(__file__).resolve().parents[4] / "sample-data" / f"meta_ads_shopify_{args.year}"
    try:
        manifest, archive_path = write_demo(output_dir, args.year, args.seed)
    except ValueError as error:
        parser.error(str(error))
    print(json.dumps({"archive": str(archive_path), "datasets": manifest["datasets"],
                      "measured_economics": manifest["measured_economics"],
                      "measured_pearson_correlations": manifest["measured_pearson_correlations"]}, indent=2))


if __name__ == "__main__":
    main()
