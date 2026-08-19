"""Public, read-only demo data for the landing-page live demo."""

from __future__ import annotations

import json
import math
from datetime import date, timedelta

import pandas as pd
from fastapi import APIRouter, HTTPException, Query, Response

from app.modules.datasets.services.charts import generate_chart_data
from app.modules.datasets.services.metrics import generate_metrics
from app.modules.datasets.services.sources import get_dataset_source
from app.modules.public_dashboard import (
    clean_public_dashboard_key,
    DEFAULT_PUBLIC_DASHBOARD_BRAND,
)


router = APIRouter()

DEMO_DATASET_DEFINITIONS = {
    "google-analytics": {
        "source_type": "google_analytics",
        "label": "Google Analytics",
        "file_name": "demo-google-analytics-365-days.parquet",
        "dimensions": (
            "Organic Search",
            "Paid Search",
            "Social",
            "Email",
            "Referral",
            "Display",
            "Affiliate",
            "Direct",
        ),
    },
    "stripe": {
        "source_type": "stripe",
        "label": "Stripe",
        "file_name": "demo-stripe-365-days.parquet",
        "dimensions": (
            "Starter",
            "Professional",
            "Agency",
            "Consulting",
            "Implementation",
            "Support",
            "Add-ons",
        ),
    },
    "shopify": {
        "source_type": "shopify",
        "label": "Shopify",
        "file_name": "demo-shopify-365-days.parquet",
        "dimensions": (
            "Apparel",
            "Home",
            "Beauty",
            "Electronics",
            "Sports",
            "Outdoor",
            "Accessories",
            "Wellness",
        ),
    },
    "quickbooks": {
        "source_type": "quickbooks",
        "label": "QuickBooks",
        "file_name": "demo-quickbooks-365-days.parquet",
        "dimensions": (
            "Sales",
            "Services",
            "Operations",
            "Marketing",
            "Payroll",
            "Rent",
            "Software",
            "Other",
        ),
    },
    "freshbooks": {
        "source_type": "freshbooks",
        "label": "FreshBooks",
        "file_name": "demo-freshbooks-365-days.parquet",
        "dimensions": (
            "Consulting",
            "Design",
            "Development",
            "Marketing",
            "Training",
            "Support",
            "Strategy",
        ),
    },
    "sage": {
        "source_type": "sage",
        "label": "Sage Cloud Accounting",
        "file_name": "demo-sage-365-days.parquet",
        "dimensions": (
            "Product Sales",
            "Professional Services",
            "Subscriptions",
            "Projects",
            "Payroll",
            "Operating Costs",
            "Taxes",
        ),
    },
    "xero": {
        "source_type": "xero",
        "label": "Xero",
        "file_name": "demo-xero-365-days.parquet",
        "dimensions": (
            "Product Sales",
            "Services",
            "Retainers",
            "Projects",
            "Payroll",
            "Overhead",
            "Tax and Fees",
        ),
    },
    "hubspot": {
        "source_type": "hubspot",
        "label": "HubSpot",
        "file_name": "demo-hubspot-365-days.parquet",
        "dimensions": (
            "New",
            "Subscriber",
            "Lead",
            "Marketing Qualified",
            "Sales Qualified",
            "Opportunity",
            "Customer",
            "Evangelist",
        ),
    },
    "meta-ads": {
        "source_type": "meta_ads",
        "label": "Meta Ads",
        "file_name": "demo-meta-ads-365-days.parquet",
        "dimensions": (
            "Brand Awareness",
            "Prospecting",
            "Retargeting",
            "Lead Generation",
            "Conversions",
            "Catalog Sales",
            "Video Views",
            "Engagement",
        ),
    },
}

DEFAULT_DEMO_DATASET = "google-analytics"
DEMO_ROW_COUNT = 365


def _demo_dates() -> list[date]:
    end_date = date.today()
    start_date = end_date - timedelta(days=DEMO_ROW_COUNT - 1)
    return [
        start_date + timedelta(days=offset)
        for offset in range(DEMO_ROW_COUNT)
    ]


def _wave(index: int, period: float, amplitude: float, baseline: float) -> float:
    return baseline + amplitude * math.sin(index / period)


def _category_factor(index: int, factors: tuple[float, ...]) -> float:
    return factors[index % len(factors)]


def _weekday_factor(current_date: date, factors: tuple[float, ...]) -> float:
    return factors[current_date.weekday()]


def _event_factor(index: int, event_days: tuple[int, ...], boost: float) -> float:
    return boost if index % 61 in event_days else 1.0


def build_demo_dataframe(dataset_key: str) -> pd.DataFrame:
    """Build one year of deterministic daily data for the selected connector."""
    definition = DEMO_DATASET_DEFINITIONS[dataset_key]
    dates = _demo_dates()
    dimensions = definition["dimensions"]
    rows = []

    for index, current_date in enumerate(dates):
        dimension = dimensions[index % len(dimensions)]
        trend = index / DEMO_ROW_COUNT
        if dataset_key == "google-analytics":
            channel_factor = _category_factor(
                index,
                (0.72, 1.22, 0.88, 1.06, 0.76, 1.34, 0.84, 1.0),
            )
            traffic_factor = _weekday_factor(
                current_date,
                (0.82, 0.94, 1.05, 1.11, 1.08, 0.96, 0.73),
            )
            seasonal_factor = 1 + 0.15 * math.sin(index / 55) + 0.07 * math.cos(index / 14)
            sessions = round(
                _wave(index, 18, 320, 1450)
                * channel_factor
                * traffic_factor
                * seasonal_factor
                * _event_factor(index, (3, 4, 5), 1.28)
                * (1 + trend * 0.28)
            )
            users = round(sessions * 0.72)
            new_users = round(users * (0.58 + 0.04 * math.sin(index / 20)))
            conversions = round(sessions * (0.032 + 0.004 * math.sin(index / 23)))
            rows.append({
                "date": current_date.isoformat(),
                "channel": dimension,
                "campaign": (
                    "Spring Demand"
                    if index % 3 == 0
                    else "Always On Search"
                    if index % 3 == 1
                    else "Customer Retargeting"
                ),
                "device_category": ("mobile", "desktop", "tablet")[index % 3],
                "country": ("Canada", "United States", "United Kingdom", "Australia")[index % 4],
                "landing_page": ("/pricing", "/demo", "/features", "/resources")[index % 4],
                "sessions": max(sessions, 0),
                "users": max(users, 0),
                "new_users": max(new_users, 0),
                "engaged_sessions": round(max(sessions * 0.64, 0)),
                "conversions": max(conversions, 0),
                "transactions": max(round(conversions * 0.78), 0),
                "event_count": max(round(sessions * (8.2 + index % 5 * 0.4)), 0),
                "revenue": round(conversions * (72 + 8 * math.sin(index / 15)), 2),
                "ad_cost": round(sessions * (0.19 + index % 4 * 0.025), 2),
                "bounce_rate": round(0.57 - (index % 9) * 0.009, 3),
                "engagement_rate": round(0.43 + (index % 8) * 0.012, 3),
                "avg_session_duration_seconds": round(128 + index % 11 * 9),
            })
        elif dataset_key == "shopify":
            product_factor = _category_factor(
                index,
                (0.68, 1.28, 0.86, 1.14, 0.76, 1.42, 0.94, 1.08),
            )
            shopping_day_factor = _weekday_factor(
                current_date,
                (0.74, 0.88, 0.98, 1.05, 1.18, 1.35, 1.26),
            )
            orders = round(
                _wave(index, 21, 12, 46)
                * product_factor
                * shopping_day_factor
                * (1 + 0.12 * math.sin(index / 48))
                * _event_factor(index, (0, 1, 2), 1.46)
                * (1 + trend * 0.22)
            )
            units = round(orders * (1.35 + 0.12 * math.sin(index / 13)))
            revenue = units * (68 + 9 * math.sin(index / 17))
            discounts = revenue * (0.035 + index % 3 * 0.012)
            tax = revenue * 0.13
            rows.append({
                "date": current_date.isoformat(),
                "created_at": current_date.isoformat(),
                "updated_at": current_date.isoformat(),
                "order_id": f"shop_order_{700001 + index}",
                "order_name": f"#D{index + 1001}",
                "product_category": dimension,
                "product": ("Everyday Kit", "Premium Bundle", "Starter Pack", "Seasonal Set")[index % 4],
                "sales_channel": ("Online Store", "Shop App", "Social", "Wholesale")[index % 4],
                "orders": max(orders, 0),
                "units_sold": max(units, 0),
                "revenue": round(max(revenue, 0), 2),
                "total_price": round(max(revenue + tax - discounts, 0), 2),
                "subtotal_price": round(max(revenue - discounts, 0), 2),
                "total_tax": round(max(tax, 0), 2),
                "total_discounts": round(max(discounts, 0), 2),
                "refunds": round(max(orders * 0.035, 0), 2),
                "line_item_count": max(round(units * 0.82), 0),
                "financial_status": "paid" if index % 10 else "refunded",
                "fulfillment_status": "fulfilled" if index % 5 else "partial",
                "customer_id": f"shop_customer_{index % 120 + 1:03d}",
                "customer_email": f"customer{index % 120 + 1:03d}@demo.example",
                "shipping_country": ("Canada", "United States", "United Kingdom")[index % 3],
                "source_name": ("web", "shop_app", "social")[index % 3],
                "test": "false",
            })
        elif dataset_key == "stripe":
            plan_factor = _category_factor(
                index,
                (0.62, 1.16, 1.38, 0.82, 1.08, 0.76, 1.22),
            )
            billing_cycle_factor = 1.24 if current_date.day in {1, 15, 28} else 1.0
            payments = round(
                _wave(index, 19, 18, 72)
                * plan_factor
                * billing_cycle_factor
                * (1 + 0.11 * math.cos(index / 37))
                * (1 + trend * 0.2)
            )
            customers = round(payments * (0.62 + 0.04 * math.sin(index / 14)))
            successful = round(payments * (0.91 + 0.02 * math.sin(index / 21)))
            revenue = successful * (58 + 7 * math.sin(index / 17))
            gross_revenue = payments * (66 + index % 5 * 8)
            refunds = round(payments * 0.025, 2)
            rows.append({
                "date": current_date.isoformat(),
                "created_at": current_date.isoformat(),
                "charge_id": f"ch_demo_{index + 1:04d}",
                "product_category": dimension,
                "customer_segment": ("SMB", "Mid-market", "Enterprise", "Startup")[index % 4],
                "payment_method": ("card", "bank_transfer", "card", "digital_wallet")[index % 4],
                "payments": max(payments, 0),
                "customers": max(customers, 0),
                "successful_payments": max(successful, 0),
                "revenue": round(max(revenue, 0), 2),
                "amount": round(max(gross_revenue * 100, 0)),
                "amount_major": round(max(gross_revenue, 0), 2),
                "amount_captured": round(max(gross_revenue * 0.995 * 100, 0)),
                "amount_refunded": round(max(refunds * (66 + index % 5 * 8) * 100, 0)),
                "gross_revenue": round(max(gross_revenue, 0), 2),
                "stripe_fees": round(max(gross_revenue * 0.029 + payments * 0.30, 0), 2),
                "net_revenue": round(max(gross_revenue * 0.971 - payments * 0.30, 0), 2),
                "refunds": refunds,
                "active_subscriptions": max(round(customers * 0.78), 0),
                "failed_payments": index % 5,
                "currency": "cad",
                "status": "succeeded" if index % 8 else "failed",
                "paid": "true" if index % 8 else "false",
                "refunded": "true" if refunds > 0 else "false",
                "customer_id": f"cus_demo_{index % 47 + 1:03d}",
                "payment_intent_id": f"pi_demo_{index + 1:04d}",
            })
        elif dataset_key == "quickbooks":
            account_factor = _category_factor(
                index,
                (1.36, 1.08, 0.72, 0.94, 1.18, 0.66, 0.86, 0.78),
            )
            quarter_factor = (1.08, 0.94, 1.16, 1.31)[(current_date.month - 1) // 3]
            invoices = round(
                _wave(index, 25, 8, 30)
                * account_factor
                * quarter_factor
                * (1 + 0.09 * math.sin(index / 10))
                * (1 + trend * 0.16)
            )
            revenue = invoices * (420 + 55 * math.sin(index / 19))
            expenses = revenue * (0.54 + 0.05 * math.sin(index / 27))
            balance = revenue * (0.18 + index % 5 * 0.025)
            rows.append({
                "date": current_date.isoformat(),
                "created_at": current_date.isoformat(),
                "due_date": (current_date + timedelta(days=30)).isoformat(),
                "invoice_id": f"qb_invoice_{index + 1:04d}",
                "doc_number": f"INV-{index + 2001}",
                "account_category": dimension,
                "account_name": ("Services", "Software", "Payroll", "Marketing")[index % 4],
                "class": ("North", "South", "Online", "Corporate")[index % 4],
                "transaction_type": ("Invoice", "Bill", "Payment", "Expense")[index % 4],
                "invoices": max(invoices, 0),
                "revenue": round(max(revenue, 0), 2),
                "expenses": round(max(expenses, 0), 2),
                "profit": round(max(revenue - expenses, 0), 2),
                "invoice_count": max(invoices, 0),
                "total_amount": round(max(revenue, 0), 2),
                "balance": round(max(balance, 0), 2),
                "currency": "CAD",
                "customer_id": f"qb_customer_{index % 60 + 1:03d}",
                "customer_name": ("Northstar Retail", "Harbour Health", "Summit Builders")[index % 3],
                "email_status": "EmailSent" if index % 6 else "NotSet",
                "invoice_status": "Open" if index % 4 else "Paid",
                "create_time": current_date.isoformat(),
                "last_updated_time": current_date.isoformat(),
            })
        elif dataset_key == "freshbooks":
            service_factor = _category_factor(
                index,
                (0.84, 1.16, 1.32, 0.78, 1.04, 0.7, 1.22),
            )
            workday_factor = _weekday_factor(
                current_date,
                (0.62, 0.94, 1.08, 1.17, 1.24, 0.88, 0.48),
            )
            invoices = round(
                _wave(index, 23, 9, 34)
                * service_factor
                * (1 + 0.08 * math.sin(index / 31))
                * (1 + trend * 0.16)
            )
            hours = round(
                _wave(index, 29, 15, 86)
                * service_factor
                * workday_factor
                * (1 + trend * 0.1)
            )
            revenue = invoices * (310 + 42 * math.sin(index / 19))
            expenses = revenue * (0.43 + 0.05 * math.sin(index / 27))
            payments = revenue * (0.76 + 0.06 * math.sin(index / 20))
            rows.append({
                "date": current_date.isoformat(),
                "created_at": current_date.isoformat(),
                "due_date": (current_date + timedelta(days=30)).isoformat(),
                "date_paid": (current_date + timedelta(days=18)).isoformat() if index % 5 else None,
                "invoice_id": f"fb_invoice_{index + 1:04d}",
                "invoice_number": f"FB-{index + 3001}",
                "service_category": dimension,
                "client_industry": ("Technology", "Healthcare", "Construction", "Professional Services")[index % 4],
                "project": ("Discovery", "Implementation", "Support", "Optimization")[index % 4],
                "invoices": max(invoices, 0),
                "billable_hours": max(hours, 0),
                "revenue": round(max(revenue, 0), 2),
                "expenses": round(max(expenses, 0), 2),
                "amount": round(max(revenue, 0), 2),
                "payments_received": round(max(payments, 0), 2),
                "outstanding": round(max(revenue - payments, 0), 2),
                "project_expenses": round(max(expenses, 0), 2),
                "utilization_rate": round(0.62 + (index % 8) * 0.025, 3),
                "currency": "CAD",
                "status": "Paid" if index % 5 else "Overdue",
                "payment_status": "Paid" if index % 5 else "PartiallyPaid",
                "client_id": f"fb_client_{index % 45 + 1:03d}",
                "client_name": ("Maple Systems", "Coastal Health", "Granite Works")[index % 3],
                "organization": ("Maple Systems Inc.", "Coastal Health Group", "Granite Works Ltd.")[index % 3],
            })
        elif dataset_key == "sage":
            account_factor = _category_factor(
                index,
                (1.28, 0.92, 1.18, 1.06, 0.68, 0.76, 0.84),
            )
            month_end_factor = 1.34 if current_date.day >= 25 else 1.0
            invoices = round(
                _wave(index, 26, 10, 38)
                * account_factor
                * month_end_factor
                * (1 + 0.1 * math.cos(index / 16))
                * (1 + trend * 0.15)
            )
            revenue = invoices * (390 + 48 * math.sin(index / 18))
            expenses = revenue * (0.51 + 0.04 * math.sin(index / 24))
            collected = revenue * (0.78 + 0.04 * math.sin(index / 20))
            tax = revenue * 0.13
            rows.append({
                "date": current_date.isoformat(),
                "created_at": current_date.isoformat(),
                "due_date": (current_date + timedelta(days=30)).isoformat(),
                "updated_at": current_date.isoformat(),
                "invoice_id": f"sage_invoice_{index + 1:04d}",
                "invoice_number": f"SAGE-{index + 4001}",
                "account_category": dimension,
                "customer_id": f"sage_customer_{index % 55 + 1:03d}",
                "customer_name": ("Maple Manufacturing", "Harbour Health", "Summit Construction")[index % 3],
                "status": "Paid" if index % 5 else "Overdue",
                "reference": f"PO-{index + 5001}",
                "currency": "CAD",
                "invoices": max(invoices, 0),
                "revenue": round(max(revenue, 0), 2),
                "expenses": round(max(expenses, 0), 2),
                "cash_collected": round(max(collected, 0), 2),
                "overdue_invoices": round(max(invoices * 0.12, 0), 2),
                "net_amount": round(max(revenue - tax, 0), 2),
                "tax_amount": round(max(tax, 0), 2),
                "total_amount": round(max(revenue, 0), 2),
                "amount_due": round(max(revenue - collected, 0), 2),
                "amount_paid": round(max(collected, 0), 2),
                "outstanding_amount": round(max(revenue - collected, 0), 2),
            })
        elif dataset_key == "xero":
            account_factor = _category_factor(
                index,
                (1.12, 0.86, 1.34, 0.78, 0.68, 1.04, 0.92),
            )
            quarter_end_factor = 1.42 if current_date.month in {3, 6, 9, 12} and current_date.day >= 20 else 1.0
            invoices = round(
                _wave(index, 22, 11, 42)
                * account_factor
                * quarter_end_factor
                * (1 + 0.13 * math.sin(index / 43))
                * (1 + trend * 0.18)
            )
            revenue = invoices * (360 + 50 * math.sin(index / 20))
            expenses = revenue * (0.49 + 0.05 * math.sin(index / 28))
            payments = revenue * (0.8 + 0.05 * math.sin(index / 23))
            tax = revenue * 0.13
            rows.append({
                "date": current_date.isoformat(),
                "created_at": current_date.isoformat(),
                "due_date": (current_date + timedelta(days=30)).isoformat(),
                "fully_paid_on": (current_date + timedelta(days=21)).isoformat() if index % 4 else None,
                "updated_at": current_date.isoformat(),
                "invoice_id": f"xero_invoice_{index + 1:04d}",
                "invoice_number": f"XERO-{index + 6001}",
                "invoice_type": "ACCREC",
                "status": "PAID" if index % 4 else "AUTHORISED",
                "account_category": dimension,
                "customer_id": f"xero_customer_{index % 65 + 1:03d}",
                "customer_name": ("Northstar Retail", "Coastal Services", "Granite Builders")[index % 3],
                "reference": f"REF-{index + 7001}",
                "currency": "CAD",
                "invoices": max(invoices, 0),
                "revenue": round(max(revenue, 0), 2),
                "expenses": round(max(expenses, 0), 2),
                "payments": round(max(payments, 0), 2),
                "receivables": round(max(revenue - payments, 0), 2),
                "subtotal": round(max(revenue - tax, 0), 2),
                "total_tax": round(max(tax, 0), 2),
                "total": round(max(revenue, 0), 2),
                "amount_due": round(max(revenue - payments, 0), 2),
                "amount_paid": round(max(payments, 0), 2),
                "line_item_count": max(round(invoices * 1.8), 1),
                "sent_to_contact": "true" if index % 6 else "false",
            })
        elif dataset_key == "meta-ads":
            campaign_factor = _category_factor(
                index,
                (0.64, 1.26, 1.08, 0.82, 1.42, 1.16, 0.72, 0.96),
            )
            media_day_factor = _weekday_factor(
                current_date,
                (0.78, 0.9, 1.02, 1.12, 1.18, 1.08, 0.86),
            )
            impressions = round(
                _wave(index, 16, 5200, 28000)
                * campaign_factor
                * media_day_factor
                * (1 + 0.18 * math.sin(index / 67))
                * _event_factor(index, (18, 19, 20), 1.55)
                * (1 + trend * 0.25)
            )
            clicks = round(impressions * (0.028 + 0.004 * math.sin(index / 17)))
            leads = round(clicks * (0.12 + 0.02 * math.sin(index / 14)))
            spend = clicks * (1.35 + 0.16 * math.sin(index / 19))
            conversions = round(leads * (0.24 + 0.03 * math.sin(index / 12)))
            rows.append({
                "date": current_date.isoformat(),
                "date_start": current_date.isoformat(),
                "date_stop": current_date.isoformat(),
                "campaign_id": f"meta_campaign_{index % 18 + 1:02d}",
                "campaign_name": dimension,
                "campaign_type": dimension,
                "ad_set": ("Broad Audience", "Lookalike 1%", "Website Visitors", "Customer List")[index % 4],
                "objective": ("Sales", "Leads", "Traffic", "Awareness")[index % 4],
                "placement": ("Facebook Feed", "Instagram Feed", "Stories", "Reels")[index % 4],
                "impressions": max(impressions, 0),
                "clicks": max(clicks, 0),
                "leads": max(leads, 0),
                "spend": round(max(spend, 0), 2),
                "reach": round(max(impressions * 0.74, 0)),
                "frequency": round(max(impressions / max(impressions * 0.74, 1), 0), 2),
                "ctr": round(clicks / max(impressions, 1), 4),
                "cpc": round(spend / max(clicks, 1), 2),
                "cpm": round(spend / max(impressions, 1) * 1000, 2),
                "conversions": max(conversions, 0),
                "purchases": max(round(conversions * 0.72), 0),
                "attributed_revenue": round(max(conversions * 185, 0), 2),
            })
        else:
            stage_factor = _category_factor(
                index,
                (0.58, 0.9, 1.12, 1.3, 0.76, 1.18, 0.68, 0.96),
            )
            source_factor = (0.82, 1.18, 0.94, 1.34, 0.72)[index % 5]
            leads = round(
                _wave(index, 17, 18, 82)
                * stage_factor
                * source_factor
                * (1 + 0.12 * math.cos(index / 29))
                * _event_factor(index, (27, 28, 29), 1.38)
                * (1 + trend * 0.2)
            )
            qualified = round(leads * (0.35 + 0.04 * math.sin(index / 16)))
            deals = round(qualified * (0.18 + 0.02 * math.sin(index / 12)))
            deal_amount = deals * (1850 + index % 6 * 275)
            rows.append({
                "date": current_date.isoformat(),
                "created_at": current_date.isoformat(),
                "updated_at": current_date.isoformat(),
                "record_id": f"hs_deal_{index + 1:04d}",
                "dealname": f"Demo Opportunity {index + 1:03d}",
                "lifecycle_stage": dimension,
                "lead_source": ("Organic Search", "Paid Search", "Referral", "Partner", "Event")[index % 5],
                "deal_stage": ("appointmentscheduled", "qualifiedtobuy", "presentationscheduled", "decisionmakerboughtin", "closedwon")[index % 5],
                "pipeline": ("default", "new-business", "expansion")[index % 3],
                "industry": ("SaaS", "Retail", "Healthcare", "Construction", "Agency")[index % 5],
                "leads": max(leads, 0),
                "qualified_leads": max(qualified, 0),
                "deals": max(deals, 0),
                "pipeline_value": round(max(deal_amount, 0), 2),
                "amount": round(max(deal_amount, 0), 2),
                "company_count": max(12 + index % 9, 0),
                "contact_count": max(48 + index * 2 + index % 11, 0),
                "deal_count": max(deals, 0),
                "closed_won_amount": round(max(deal_amount * (0.18 + index % 5 * 0.035), 0), 2),
                "sales_activities": max(75 + index * 3 + index % 13 * 4, 0),
                "conversion_rate": round(0.08 + (index % 8) * 0.012, 3),
                "company_name": ("Maple Systems", "Coastal Health", "Granite Builders")[index % 3],
                "company_domain": ("maple.example", "coastal.example", "granite.example")[index % 3],
            })

    return pd.DataFrame(rows)


def _dataset_response(dataset_key: str) -> dict:
    definition = DEMO_DATASET_DEFINITIONS[dataset_key]
    dataframe = build_demo_dataframe(dataset_key)
    source = get_dataset_source(definition["source_type"])
    source_label = source["label"] if source else definition["label"]
    source_config = json.dumps({
        "demo": True,
        "connector": definition["source_type"],
        "date_column": "date",
        "row_count": DEMO_ROW_COUNT,
    }, sort_keys=True)
    return {
        "file_name": definition["file_name"],
        "row_count": len(dataframe),
        "source_type": definition["source_type"],
        "source_label": source_label,
        "source_config": source_config,
        "preview": [],
        "metrics": generate_metrics(dataframe),
        "chart": generate_chart_data(dataframe, limit=None),
    }


def _available_datasets() -> list[dict]:
    return [
        {
            "key": key,
            "label": definition["label"],
            "source_type": definition["source_type"],
            "row_count": DEMO_ROW_COUNT,
        }
        for key, definition in DEMO_DATASET_DEFINITIONS.items()
    ]


@router.get("/demo")
async def get_demo_dashboard(
    response: Response,
    dataset: str = Query(DEFAULT_DEMO_DATASET),
    dashboard: str | None = None,
):
    response.headers["Cache-Control"] = "no-store"
    dataset_key = str(dataset or DEFAULT_DEMO_DATASET).strip().lower()
    if dataset_key not in DEMO_DATASET_DEFINITIONS:
        raise HTTPException(status_code=404, detail="Demo dataset not found")

    selected_dashboard = clean_public_dashboard_key(dashboard)
    return {
        "demo": True,
        "branding": {
            **DEFAULT_PUBLIC_DASHBOARD_BRAND,
            "name": "Decisionate Live Demo",
            "logo_url": "/icons/decisionate-icon.svg",
        },
        "dataset": _dataset_response(dataset_key),
        "demo_datasets": _available_datasets(),
        "selected_dataset": dataset_key,
        "selected_dashboard": selected_dashboard,
        "preference": {
            "selected_metric": None,
            "metric_targets": None,
            "dashboard_preferences": None,
            "dashboard_views": None,
            "joined_dataset_result": None,
        },
        "decision_summary": None,
        "capabilities": {
            "can_create_decisions": False,
            "can_upload": False,
            "can_delete_datasets": False,
        },
    }
