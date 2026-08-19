import csv
from datetime import date, timedelta
from pathlib import Path


OUTPUT_DIR = Path(__file__).parent
START_DATE = date(2025, 1, 1)
ROW_COUNT = 100


def dates():
    return [
        (START_DATE + timedelta(days=index)).isoformat()
        for index in range(ROW_COUNT)
    ]


def write_csv(filename, rows):
    path = OUTPUT_DIR / filename
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def build_google_analytics():
    channels = ["Organic Search", "Paid Search", "Email", "Social"]
    campaigns = ["Spring Launch", "Brand Always On", "Product Education", "Retargeting"]
    rows = []
    for index, current_date in enumerate(dates()):
        sessions = 1200 + index * 11 + (index % 5) * 47
        conversions = 34 + (index % 9) * 3
        rows.append({
            "date": current_date,
            "channel": channels[index % len(channels)],
            "campaign": campaigns[index % len(campaigns)],
            "sessions": sessions,
            "users": round(sessions * 0.72),
            "new_users": round(sessions * 0.51),
            "conversions": conversions,
            "revenue": round(conversions * (86 + index % 7 * 4), 2),
            "bounce_rate": round(0.58 - (index % 8) * 0.012, 3),
            "engagement_rate": round(0.42 + (index % 7) * 0.014, 3),
        })
    return rows


def build_stripe():
    segments = ["SMB", "Mid-market", "Enterprise", "Startup"]
    products = ["Core", "Analytics", "Automation", "Advisory"]
    statuses = ["succeeded", "succeeded", "succeeded", "refunded"]
    rows = []
    for index, current_date in enumerate(dates()):
        charges = 26 + index % 11
        gross = charges * (145 + index % 6 * 18)
        refunds = 1 + index % 3
        rows.append({
            "date": current_date,
            "customer_segment": segments[index % len(segments)],
            "product": products[index % len(products)],
            "payment_status": statuses[index % len(statuses)],
            "charges": charges,
            "refunds": refunds,
            "gross_revenue": round(gross, 2),
            "stripe_fees": round(gross * 0.029 + charges * 0.30, 2),
            "net_revenue": round(gross - gross * 0.029 - charges * 0.30, 2),
            "active_subscriptions": 310 + index * 4 + index % 9 * 6,
            "failed_payments": index % 5,
        })
    return rows


def build_shopify():
    categories = ["Apparel", "Home", "Beauty", "Electronics"]
    products = ["Everyday Kit", "Premium Bundle", "Starter Pack", "Seasonal Set"]
    channels = ["Online Store", "Shop App", "Social", "Wholesale"]
    statuses = ["paid", "paid", "fulfilled", "refunded"]
    rows = []
    for index, current_date in enumerate(dates()):
        orders = 42 + index % 14 + index // 25
        units = orders + 8 + index % 9
        gross = units * (48 + index % 5 * 6)
        returns = index % 4
        rows.append({
            "date": current_date,
            "product_category": categories[index % len(categories)],
            "product": products[index % len(products)],
            "sales_channel": channels[index % len(channels)],
            "order_status": statuses[index % len(statuses)],
            "orders": orders,
            "units_sold": units,
            "gross_sales": round(gross, 2),
            "discounts": round(gross * (0.04 + index % 3 * 0.01), 2),
            "returns": returns,
            "net_sales": round(gross - gross * (0.04 + index % 3 * 0.01), 2),
        })
    return rows


def build_quickbooks():
    account_types = ["Revenue", "Cost of Goods Sold", "Operating Expense", "Accounts Receivable"]
    accounts = ["Services", "Software", "Payroll", "Marketing"]
    classes = ["North", "South", "Online", "Corporate"]
    transaction_types = ["Invoice", "Bill", "Payment", "Expense"]
    rows = []
    for index, current_date in enumerate(dates()):
        revenue = 6400 + index * 90 + index % 6 * 350
        expense = 2800 + index * 34 + index % 5 * 115
        rows.append({
            "date": current_date,
            "account_type": account_types[index % len(account_types)],
            "account_name": accounts[index % len(accounts)],
            "class": classes[index % len(classes)],
            "transaction_type": transaction_types[index % len(transaction_types)],
            "invoice_count": 18 + index % 8,
            "revenue": round(revenue, 2),
            "expense": round(expense, 2),
            "cash_flow": round(revenue - expense, 2),
            "outstanding_balance": round(18500 + index * 72 - index % 7 * 240, 2),
        })
    return rows


def build_freshbooks():
    industries = ["Technology", "Healthcare", "Construction", "Professional Services"]
    projects = ["Discovery", "Implementation", "Support", "Optimization"]
    statuses = ["Sent", "Paid", "Overdue", "Draft"]
    rows = []
    for index, current_date in enumerate(dates()):
        hours = 36 + index % 17
        billed = hours * (135 + index % 4 * 15)
        payments = billed * (0.92 if index % 6 else 0.63)
        rows.append({
            "date": current_date,
            "client_industry": industries[index % len(industries)],
            "project": projects[index % len(projects)],
            "invoice_status": statuses[index % len(statuses)],
            "hours_billed": hours,
            "billable_amount": round(billed, 2),
            "project_expenses": round(hours * (18 + index % 5), 2),
            "payments_received": round(payments, 2),
            "outstanding_amount": round(billed - payments, 2),
            "utilization_rate": round(0.61 + (index % 9) * 0.025, 3),
        })
    return rows


def build_hubspot():
    stages = ["Lead", "Marketing Qualified", "Sales Qualified", "Opportunity", "Customer"]
    sources = ["Organic Search", "Paid Search", "Referral", "Partner", "Event"]
    industries = ["SaaS", "Retail", "Healthcare", "Construction", "Agency"]
    rows = []
    for index, current_date in enumerate(dates()):
        deals = 8 + index % 7
        deal_amount = deals * (2400 + index % 6 * 450)
        rows.append({
            "created_date": current_date,
            "lifecycle_stage": stages[index % len(stages)],
            "lead_source": sources[index % len(sources)],
            "deal_stage": stages[(index + 1) % len(stages)],
            "industry": industries[index % len(industries)],
            "company_count": 12 + index % 9,
            "contact_count": 48 + index * 2 + index % 11,
            "deal_count": deals,
            "deal_amount": round(deal_amount, 2),
            "closed_won_amount": round(deal_amount * (0.18 + index % 5 * 0.035), 2),
            "sales_activities": 75 + index * 3 + index % 13 * 4,
            "conversion_rate": round(0.08 + (index % 8) * 0.012, 3),
        })
    return rows


def build_meta_ads():
    campaigns = ["Spring Demand", "Retargeting", "Lead Generation", "Brand Awareness"]
    ad_sets = ["Broad Audience", "Lookalike 1%", "Website Visitors", "Customer List"]
    objectives = ["Sales", "Leads", "Traffic", "Awareness"]
    rows = []
    for index, current_date in enumerate(dates()):
        spend = 420 + index * 5 + index % 7 * 38
        impressions = 18500 + index * 260 + index % 6 * 1200
        clicks = round(impressions * (0.018 + index % 5 * 0.002))
        purchases = 18 + index % 9
        purchase_value = purchases * (98 + index % 6 * 12)
        rows.append({
            "date": current_date,
            "campaign_name": campaigns[index % len(campaigns)],
            "ad_set": ad_sets[index % len(ad_sets)],
            "objective": objectives[index % len(objectives)],
            "spend": round(spend, 2),
            "impressions": impressions,
            "reach": round(impressions * 0.74),
            "clicks": clicks,
            "leads": 32 + index % 12,
            "purchases": purchases,
            "purchase_value": round(purchase_value, 2),
            "ctr": round(clicks / impressions, 4),
            "cpc": round(spend / clicks, 2),
            "roas": round(purchase_value / spend, 2),
        })
    return rows


def main():
    datasets = {
        "google_analytics_demo_100_rows.csv": build_google_analytics(),
        "stripe_demo_100_rows.csv": build_stripe(),
        "shopify_demo_100_rows.csv": build_shopify(),
        "quickbooks_demo_100_rows.csv": build_quickbooks(),
        "freshbooks_demo_100_rows.csv": build_freshbooks(),
        "hubspot_demo_100_rows.csv": build_hubspot(),
        "meta_ads_demo_100_rows.csv": build_meta_ads(),
    }

    for filename, rows in datasets.items():
        write_csv(filename, rows)


if __name__ == "__main__":
    main()
