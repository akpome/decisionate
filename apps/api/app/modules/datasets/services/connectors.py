from __future__ import annotations

import importlib
import json
import os
from datetime import UTC, date, datetime, timedelta
import re
from time import sleep
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urljoin, urlparse
from urllib.request import Request, urlopen

import pandas as pd

from app.configuration import get_provider_setting
from app.db.models import DataSourceConnection
from app.db.models import OAuthCredential
from app.modules.oauth.service import (
    decrypt_token,
    encrypt_token,
    refresh_oauth_token,
    token_expiry,
)


PAGE_SIZE = 100
SALESFORCE_MAX_ATTEMPTS = 4
SALESFORCE_RETRY_STATUS_CODES = {429, 500, 502, 503, 504}
SALESFORCE_OBJECT_TYPES = {
    "opportunity": "Opportunity",
    "account": "Account",
    "lead": "Lead",
}
NETSUITE_MAX_ATTEMPTS = 4
NETSUITE_RETRY_STATUS_CODES = {429, 500, 502, 503, 504}
NETSUITE_RECORD_TYPES = {
    "invoice": "invoice",
    "customer": "customer",
    "sales_order": "salesorder",
    "salesorder": "salesorder",
    "sales order": "salesorder",
}


def salesforce_error_is_retryable(status_code: int, detail: str) -> bool:
    if status_code in SALESFORCE_RETRY_STATUS_CODES:
        return True
    return (
        status_code == 403
        and "REQUEST_LIMIT_EXCEEDED" in detail.upper()
    )


class ConnectorUnavailable(RuntimeError):
    pass


def require_provider_url(setting_name: str) -> str:
    value = get_provider_setting(setting_name).rstrip("/")
    if not value:
        raise ConnectorUnavailable(
            f"{setting_name} is required for this connector"
        )
    return value


def parse_connection_config(connection: DataSourceConnection) -> dict:
    value = connection.connection_config
    if isinstance(value, dict):
        return value
    if not value:
        return {}
    try:
        parsed = json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _dynamic_column_name(prefix: str, key) -> str:
    value = re.sub(r"[^0-9A-Za-z_]+", "_", str(key)).strip("_")
    return f"{prefix}__{value}" if prefix else value


def flatten_connector_record(value, prefix: str = "") -> dict:
    """Retain provider fields without imposing a connector-wide schema."""
    if not isinstance(value, dict):
        return {_dynamic_column_name("", prefix): value}

    flattened = {}
    for key, child in value.items():
        column = _dynamic_column_name(prefix, key)
        if isinstance(child, dict) and child:
            flattened.update(flatten_connector_record(child, column))
            continue
        if isinstance(child, (dict, list)):
            flattened[column] = json.dumps(
                child,
                sort_keys=True,
                default=str,
            )
            continue
        flattened[column] = child
    return flattened


def build_dynamic_connector_row(
    source_record: dict,
    normalized_fields: dict,
) -> dict:
    """Combine all source fields with stable aliases used by analytics."""
    row = flatten_connector_record(source_record)
    for key, value in normalized_fields.items():
        if value is None:
            continue
        if key in row and row[key] not in (None, "") and row[key] != value:
            row[f"decisionate__{key}"] = value
            continue
        row[key] = value
    return row


def load_connector_dataframe(
    db,
    connection: DataSourceConnection,
    start_date=None,
    end_date=None,
) -> tuple[pd.DataFrame, dict]:
    if connection.source_type == "hubspot":
        return load_hubspot_dataframe(
            db,
            connection,
            start_date,
            end_date,
        )
    if connection.source_type == "stripe":
        return load_stripe_dataframe(
            connection,
            start_date,
            end_date,
        )
    if connection.source_type == "shopify":
        return load_shopify_dataframe(
            db,
            connection,
            start_date,
            end_date,
        )
    if connection.source_type == "meta_ads":
        return load_meta_ads_dataframe(
            db,
            connection,
            start_date,
            end_date,
        )
    if connection.source_type == "quickbooks":
        return load_quickbooks_dataframe(
            db,
            connection,
            start_date,
            end_date,
        )
    if connection.source_type == "freshbooks":
        return load_freshbooks_dataframe(
            db,
            connection,
            start_date,
            end_date,
        )
    if connection.source_type == "sage":
        return load_sage_dataframe(
            db,
            connection,
            start_date,
            end_date,
        )
    if connection.source_type == "xero":
        return load_xero_dataframe(
            db,
            connection,
            start_date,
            end_date,
        )
    if connection.source_type == "salesforce":
        return load_salesforce_dataframe(
            db,
            connection,
            start_date,
            end_date,
        )
    if connection.source_type == "netsuite":
        return load_netsuite_dataframe(
            db,
            connection,
            start_date,
            end_date,
        )
    if connection.source_type in {"postgresql", "mysql", "sql_server"}:
        return load_database_dataframe(
            connection,
            start_date,
            end_date,
        )
    raise ConnectorUnavailable(
        f"{connection.source_type} connector does not have a dataset adapter yet"
    )


def load_hubspot_dataframe(
    db,
    connection: DataSourceConnection,
    start_date=None,
    end_date=None,
) -> tuple[pd.DataFrame, dict]:
    config = parse_connection_config(connection)
    object_type = str(config.get("object_type") or "deals").strip().lower()
    if object_type not in {"contacts", "companies", "deals", "tickets"}:
        raise ConnectorUnavailable(
            "HubSpot object_type must be contacts, companies, deals, or tickets"
        )

    access_token = get_oauth_access_token(db, connection, "hubspot")
    configured_properties = config.get("properties")
    if isinstance(configured_properties, str):
        configured_properties = [
            value.strip()
            for value in configured_properties.split(",")
            if value.strip()
        ]
    if not isinstance(configured_properties, list):
        configured_properties = []
    properties = [
        str(value).strip()
        for value in configured_properties
        if str(value).strip()
    ]
    rows = []
    after = None
    seen_after = set()
    base_url = require_provider_url("HUBSPOT_API_BASE_URL")
    api_version = get_provider_setting("HUBSPOT_CRM_API_VERSION")
    if not api_version:
        raise ConnectorUnavailable(
            "HUBSPOT_CRM_API_VERSION is required for the HubSpot connector"
        )

    while True:
        if after is not None:
            if after in seen_after:
                break
            seen_after.add(after)
        params = {
            "limit": str(PAGE_SIZE),
            "archived": "false",
        }
        if properties:
            params["properties"] = ",".join(properties)
        if after:
            params["after"] = after
        payload = connector_json_request(
            f"{base_url}/crm/{api_version}/objects/"
            f"{object_type}?{urlencode(params)}",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        results = payload.get("results")
        if not isinstance(results, list):
            raise ConnectorUnavailable("HubSpot returned an invalid records response")

        for item in results:
            if not isinstance(item, dict):
                continue
            properties_payload = item.get("properties")
            normalized_row = {
                "record_id": item.get("id"),
                "created_at": item.get("createdAt"),
                "updated_at": item.get("updatedAt"),
                "archived": item.get("archived"),
            }
            if isinstance(properties_payload, dict):
                normalized_row.update(properties_payload)
            rows.append(
                build_dynamic_connector_row(
                    item,
                    normalized_row,
                )
            )

        paging = payload.get("paging")
        next_page = paging.get("next") if isinstance(paging, dict) else None
        after = next_page.get("after") if isinstance(next_page, dict) else None
        if not after or not results:
            break

    dataframe = pd.DataFrame(rows)
    dataframe = filter_date_range(dataframe, start_date, end_date)
    return dataframe, {
        "connector": "hubspot",
        "object_type": object_type,
        "start_date": date_value(start_date),
        "end_date": date_value(end_date),
        "row_count": len(dataframe),
    }


def load_stripe_dataframe(
    connection: DataSourceConnection,
    start_date=None,
    end_date=None,
) -> tuple[pd.DataFrame, dict]:
    config = parse_connection_config(connection)
    api_key = str(os.getenv("STRIPE_API_KEY", "") or "").strip()
    if not api_key:
        raise ConnectorUnavailable(
            "STRIPE_API_KEY is required for the Stripe connector"
        )

    rows = []
    starting_after = None
    seen_starting_after = set()
    base_url = require_provider_url("STRIPE_API_URL")
    account_id = str(config.get("account_id") or "").strip()
    if account_id:
        account_id = account_id.removeprefix("acct_")
        if not re.fullmatch(r"[A-Za-z0-9]+", account_id):
            raise ConnectorUnavailable(
                "Stripe account_id must be a valid connected account ID"
            )
        account_id = f"acct_{account_id}"
    request_headers = {"Authorization": f"Bearer {api_key}"}
    if account_id:
        request_headers["Stripe-Account"] = account_id
    while True:
        if starting_after is not None:
            if starting_after in seen_starting_after:
                break
            seen_starting_after.add(starting_after)
        params = {"limit": str(PAGE_SIZE)}
        if starting_after:
            params["starting_after"] = starting_after
        if start_date:
            params["created[gte]"] = str(
                datetime.combine(start_date, datetime.min.time(), tzinfo=UTC).timestamp()
            ).split(".")[0]
        if end_date:
            params["created[lte]"] = str(
                datetime.combine(end_date, datetime.max.time(), tzinfo=UTC).timestamp()
            ).split(".")[0]

        payload = connector_json_request(
            f"{base_url}/charges?{urlencode(params)}",
            headers=request_headers,
        )
        data = payload.get("data")
        if not isinstance(data, list):
            raise ConnectorUnavailable("Stripe returned an invalid charges response")

        for charge in data:
            if not isinstance(charge, dict):
                continue
            amount = charge.get("amount")
            normalized_row = {
                "charge_id": charge.get("id"),
                "created_at": timestamp_value(charge.get("created")),
                "amount": amount,
                "amount_major": (
                    float(amount) / 100
                    if isinstance(amount, (int, float))
                    else None
                ),
                "amount_captured": charge.get("amount_captured"),
                "amount_refunded": charge.get("amount_refunded"),
                "currency": charge.get("currency"),
                "status": charge.get("status"),
                "paid": charge.get("paid"),
                "refunded": charge.get("refunded"),
                "customer_id": charge.get("customer"),
                "payment_intent_id": charge.get("payment_intent"),
                "description": charge.get("description"),
                "failure_code": charge.get("failure_code"),
                "livemode": charge.get("livemode"),
            }
            rows.append(
                build_dynamic_connector_row(
                    charge,
                    normalized_row,
                )
            )

        if not payload.get("has_more") or not data:
            break
        last_item = data[-1]
        starting_after = last_item.get("id") if isinstance(last_item, dict) else None
        if not starting_after:
            break

    dataframe = pd.DataFrame(rows)
    return dataframe, {
        "connector": "stripe",
        "resource": "charges",
        "account_id": account_id,
        "start_date": date_value(start_date),
        "end_date": date_value(end_date),
        "row_count": len(dataframe),
    }


def load_shopify_dataframe(
    db,
    connection: DataSourceConnection,
    start_date=None,
    end_date=None,
) -> tuple[pd.DataFrame, dict]:
    config = parse_connection_config(connection)
    shop_domain = normalize_shop_domain(config.get("shop_domain"))
    if not shop_domain:
        raise ConnectorUnavailable(
            "Configure a Shopify shop domain before syncing"
        )

    access_token = get_oauth_access_token(db, connection, "shopify")
    api_version = get_provider_setting("SHOPIFY_API_VERSION")
    if not api_version:
        raise ConnectorUnavailable(
            "SHOPIFY_API_VERSION is required for the Shopify connector"
        )
    base_template = get_provider_setting("SHOPIFY_API_BASE_URL_TEMPLATE")
    if not base_template:
        raise ConnectorUnavailable(
            "SHOPIFY_API_BASE_URL_TEMPLATE is required for the Shopify connector"
        )
    next_url = (
        f"{base_template.format(shop_domain=shop_domain, api_version=api_version)}/orders.json?"
        f"{urlencode(shopify_order_params(start_date, end_date))}"
    )
    rows = []
    seen_urls = set()

    while True:
        if not next_url or next_url in seen_urls:
            break
        seen_urls.add(next_url)
        payload, headers = connector_json_request_with_headers(
            next_url,
            headers={"X-Shopify-Access-Token": access_token},
        )
        orders = payload.get("orders")
        if not isinstance(orders, list):
            raise ConnectorUnavailable("Shopify returned an invalid orders response")

        for order in orders:
            if not isinstance(order, dict):
                continue
            customer = order.get("customer")
            shipping_address = order.get("shipping_address")
            normalized_row = {
                "order_id": order.get("id"),
                "order_name": order.get("name"),
                "created_at": order.get("created_at"),
                "updated_at": order.get("updated_at"),
                "currency": order.get("currency"),
                "total_price": order.get("total_price"),
                "subtotal_price": order.get("subtotal_price"),
                "total_tax": order.get("total_tax"),
                "total_discounts": order.get("total_discounts"),
                "financial_status": order.get("financial_status"),
                "fulfillment_status": order.get("fulfillment_status"),
                "cancelled_at": order.get("cancelled_at"),
                "customer_id": (
                    customer.get("id")
                    if isinstance(customer, dict)
                    else None
                ),
                "customer_email": (
                    order.get("email") or customer.get("email")
                    if isinstance(customer, dict)
                    else order.get("email")
                ),
                "line_item_count": sum(
                    int(item.get("quantity") or 0)
                    for item in order.get("line_items", [])
                    if isinstance(item, dict)
                ),
                "shipping_country": (
                    shipping_address.get("country")
                    if isinstance(shipping_address, dict)
                    else None
                ),
                "source_name": order.get("source_name"),
                "test": order.get("test"),
            }
            rows.append(
                build_dynamic_connector_row(
                    order,
                    normalized_row,
                )
            )

        next_url = get_next_link(headers.get("Link"))
        if not next_url or not orders:
            break

    dataframe = pd.DataFrame(rows)
    return dataframe, {
        "connector": "shopify",
        "resource": "orders",
        "start_date": date_value(start_date),
        "end_date": date_value(end_date),
        "row_count": len(dataframe),
    }


def load_meta_ads_dataframe(
    db,
    connection: DataSourceConnection,
    start_date=None,
    end_date=None,
) -> tuple[pd.DataFrame, dict]:
    config = parse_connection_config(connection)
    ad_account_id = str(config.get("ad_account_id") or "").strip()
    ad_account_id = ad_account_id.removeprefix("act_")
    if not ad_account_id:
        raise ConnectorUnavailable(
            "Configure a Meta Ads account ID before syncing"
        )

    access_token = get_oauth_access_token(db, connection, "meta_ads")
    since = start_date or date.today() - timedelta(days=365)
    until = end_date or date.today()
    graph_version = get_provider_setting("META_ADS_GRAPH_VERSION")
    if not graph_version:
        raise ConnectorUnavailable(
            "META_ADS_GRAPH_VERSION is required for the Meta Ads connector"
        )
    graph_base_url = require_provider_url("META_ADS_API_BASE_URL")
    time_increment = get_meta_ads_time_increment()
    time_range = json.dumps(
        {"since": since.isoformat(), "until": until.isoformat()},
        separators=(",", ":"),
    )
    params = {
        "fields": ",".join([
            "date_start",
            "date_stop",
            "campaign_id",
            "campaign_name",
            "impressions",
            "clicks",
            "spend",
            "reach",
            "frequency",
            "ctr",
            "cpc",
            "cpm",
            "actions",
        ]),
        "level": "campaign",
        "time_increment": time_increment,
        "time_range": time_range,
        "limit": str(PAGE_SIZE),
    }
    next_url = (
        f"{graph_base_url}/{graph_version}/act_{ad_account_id}/"
        f"insights?{urlencode(params)}"
    )
    rows = []
    seen_urls = set()

    while True:
        if not next_url or next_url in seen_urls:
            break
        seen_urls.add(next_url)
        payload = connector_json_request(
            next_url,
            headers={"Authorization": f"Bearer {access_token}"},
        )
        records = payload.get("data")
        if not isinstance(records, list):
            raise ConnectorUnavailable("Meta Ads returned an invalid insights response")

        for record in records:
            if not isinstance(record, dict):
                continue
            actions = record.get("actions")
            action_values = {
                str(action.get("action_type")): action.get("value")
                for action in actions
                if isinstance(action, dict) and action.get("action_type")
            } if isinstance(actions, list) else {}
            normalized_row = {
                "date_start": record.get("date_start"),
                "date_stop": record.get("date_stop"),
                "campaign_id": record.get("campaign_id"),
                "campaign_name": record.get("campaign_name"),
                "impressions": record.get("impressions"),
                "clicks": record.get("clicks"),
                "spend": record.get("spend"),
                "reach": record.get("reach"),
                "frequency": record.get("frequency"),
                "ctr": record.get("ctr"),
                "cpc": record.get("cpc"),
                "cpm": record.get("cpm"),
                "leads": action_values.get("lead"),
                "purchases": action_values.get("purchase"),
            }
            for action_type, value in action_values.items():
                normalized_action = re.sub(
                    r"[^0-9A-Za-z_]+",
                    "_",
                    action_type,
                ).strip("_")
                if normalized_action:
                    normalized_row[f"action__{normalized_action}"] = value
            rows.append(
                build_dynamic_connector_row(
                    record,
                    normalized_row,
                )
            )

        paging = payload.get("paging")
        next_url = (
            paging.get("next")
            if isinstance(paging, dict)
            else None
        )
        if not next_url or not records:
            break

    dataframe = pd.DataFrame(rows)
    return dataframe, {
        "connector": "meta_ads",
        "resource": "campaign_insights",
        "start_date": since.isoformat(),
        "end_date": until.isoformat(),
        "time_increment": time_increment,
        "row_count": len(dataframe),
    }


def load_quickbooks_dataframe(
    db,
    connection: DataSourceConnection,
    start_date=None,
    end_date=None,
) -> tuple[pd.DataFrame, dict]:
    config = parse_connection_config(connection)
    company_id = str(
        config.get("company_id") or config.get("realm_id") or ""
    ).strip()
    if not company_id or not re.fullmatch(r"[A-Za-z0-9_-]+", company_id):
        raise ConnectorUnavailable(
            "Configure a valid QuickBooks company ID before syncing"
        )

    access_token = get_oauth_access_token(db, connection, "quickbooks")
    base_url = require_provider_url("QUICKBOOKS_API_BASE_URL")
    api_version = get_provider_setting("QUICKBOOKS_API_VERSION")
    if not api_version:
        raise ConnectorUnavailable(
            "QUICKBOOKS_API_VERSION is required for the QuickBooks connector"
        )
    rows = []
    start_position = 1
    seen_positions = set()

    while True:
        if start_position in seen_positions:
            break
        seen_positions.add(start_position)
        query = quickbooks_invoice_query(
            start_position,
            start_date,
            end_date,
        )
        url = (
            f"{base_url}/{api_version}/company/{company_id}/query?"
            f"{urlencode({'query': query})}"
        )
        payload = connector_json_request(
            url,
            headers={"Authorization": f"Bearer {access_token}"},
        )
        query_response = payload.get("QueryResponse")
        records = (
            query_response.get("Invoice")
            if isinstance(query_response, dict)
            else None
        )
        if not isinstance(records, list):
            records = []

        for invoice in records:
            if not isinstance(invoice, dict):
                continue
            customer_ref = invoice.get("CustomerRef")
            metadata = invoice.get("MetaData")
            normalized_row = {
                "invoice_id": invoice.get("Id"),
                "doc_number": invoice.get("DocNumber"),
                "created_at": invoice.get("TxnDate"),
                "due_date": invoice.get("DueDate"),
                "total_amount": invoice.get("TotalAmt"),
                "balance": invoice.get("Balance"),
                "currency": invoice.get("CurrencyRef", {}).get("value")
                if isinstance(invoice.get("CurrencyRef"), dict)
                else None,
                "customer_id": customer_ref.get("value")
                if isinstance(customer_ref, dict)
                else None,
                "customer_name": customer_ref.get("name")
                if isinstance(customer_ref, dict)
                else None,
                "email_status": invoice.get("EmailStatus"),
                "invoice_status": invoice.get("TxnStatus"),
                "create_time": metadata.get("CreateTime")
                if isinstance(metadata, dict)
                else None,
                "last_updated_time": metadata.get("LastUpdatedTime")
                if isinstance(metadata, dict)
                else None,
                "private_note": invoice.get("PrivateNote"),
            }
            rows.append(
                build_dynamic_connector_row(
                    invoice,
                    normalized_row,
                )
            )

        if not records or len(records) < PAGE_SIZE:
            break
        start_position += len(records)

    dataframe = pd.DataFrame(rows)
    dataframe = filter_date_range(dataframe, start_date, end_date)
    return dataframe, {
        "connector": "quickbooks",
        "resource": "Invoice",
        "company_id": company_id,
        "start_date": date_value(start_date),
        "end_date": date_value(end_date),
        "row_count": len(dataframe),
    }


def load_freshbooks_dataframe(
    db,
    connection: DataSourceConnection,
    start_date=None,
    end_date=None,
) -> tuple[pd.DataFrame, dict]:
    config = parse_connection_config(connection)
    account_id = str(config.get("account_id") or "").strip()
    if not account_id or not re.fullmatch(r"[A-Za-z0-9_-]+", account_id):
        raise ConnectorUnavailable(
            "Configure a valid FreshBooks account ID before syncing"
        )

    access_token = get_oauth_access_token(db, connection, "freshbooks")
    rows = []
    page = 1
    seen_pages = set()
    base_template = get_provider_setting(
        "FRESHBOOKS_API_BASE_URL_TEMPLATE"
    )
    if not base_template:
        raise ConnectorUnavailable(
            "FRESHBOOKS_API_BASE_URL_TEMPLATE is required for the FreshBooks connector"
        )
    try:
        base_url = base_template.format(account_id=account_id).rstrip("/")
    except KeyError as error:
        raise ConnectorUnavailable(
            "FRESHBOOKS_API_BASE_URL_TEMPLATE must include {account_id}"
        ) from error

    while True:
        if page in seen_pages:
            break
        seen_pages.add(page)
        params = {
            "page": str(page),
            "per_page": str(PAGE_SIZE),
        }
        if start_date:
            params["date_from"] = start_date.isoformat()
        if end_date:
            params["date_to"] = end_date.isoformat()
        payload = connector_json_request(
            f"{base_url}?{urlencode(params)}",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        response = payload.get("response")
        result = response.get("result") if isinstance(response, dict) else None
        invoices = result.get("invoices") if isinstance(result, dict) else None
        if not isinstance(invoices, list):
            invoices = []

        for invoice in invoices:
            if not isinstance(invoice, dict):
                continue
            amount = invoice.get("amount")
            outstanding = invoice.get("outstanding")
            normalized_row = {
                "invoice_id": invoice.get("invoiceid") or invoice.get("id"),
                "invoice_number": invoice.get("invoice_number"),
                "created_at": invoice.get("create_date") or invoice.get("created_at"),
                "due_date": invoice.get("due_date"),
                "date_paid": invoice.get("date_paid"),
                "amount": amount.get("amount")
                if isinstance(amount, dict)
                else amount,
                "currency": (
                    amount.get("code")
                    if isinstance(amount, dict)
                    else invoice.get("currency_code")
                ),
                "outstanding": outstanding.get("amount")
                if isinstance(outstanding, dict)
                else outstanding,
                "status": invoice.get("v3_status") or invoice.get("display_status"),
                "payment_status": invoice.get("payment_status"),
                "client_id": invoice.get("clientid"),
                "client_name": " ".join(
                    value
                    for value in [invoice.get("fname"), invoice.get("lname")]
                    if value
                ).strip(),
                "organization": invoice.get("organization"),
            }
            rows.append(
                build_dynamic_connector_row(
                    invoice,
                    normalized_row,
                )
            )

        if not invoices or len(invoices) < PAGE_SIZE:
            break
        page += 1

    dataframe = pd.DataFrame(rows)
    dataframe = filter_date_range(dataframe, start_date, end_date)
    return dataframe, {
        "connector": "freshbooks",
        "resource": "invoices",
        "account_id": account_id,
        "start_date": date_value(start_date),
        "end_date": date_value(end_date),
        "row_count": len(dataframe),
    }


def load_sage_dataframe(
    db,
    connection: DataSourceConnection,
    start_date=None,
    end_date=None,
) -> tuple[pd.DataFrame, dict]:
    config = parse_connection_config(connection)
    business_id = str(
        config.get("business_id")
        or config.get("resource_owner_id")
        or config.get("site_id")
        or ""
    ).strip()
    if not business_id:
        raise ConnectorUnavailable(
            "Connect a Sage business before syncing"
        )

    subscription_key = str(
        os.getenv("SAGE_API_SUBSCRIPTION_KEY", "") or ""
    ).strip()
    if not subscription_key:
        raise ConnectorUnavailable(
            "SAGE_API_SUBSCRIPTION_KEY is required before syncing Sage"
        )

    access_token = get_oauth_access_token(db, connection, "sage")
    base_url = require_provider_url("SAGE_API_BASE_URL")
    business_header = get_provider_setting("SAGE_BUSINESS_HEADER")
    if not business_header:
        raise ConnectorUnavailable(
            "SAGE_BUSINESS_HEADER is required for the Sage connector"
        )
    rows = []
    page = 1
    seen_pages = set()

    while True:
        if page in seen_pages:
            break
        seen_pages.add(page)
        params = {
            "items_per_page": str(PAGE_SIZE),
            "page": str(page),
        }
        if start_date:
            params["from_date"] = start_date.isoformat()
        if end_date:
            params["to_date"] = end_date.isoformat()
        payload = connector_json_request(
            f"{base_url}/sales_invoices?{urlencode(params)}",
            headers={
                "Authorization": f"Bearer {access_token}",
                business_header: business_id,
                "Ocp-Apim-Subscription-Key": subscription_key,
                "Content-Type": "application/json",
            },
        )
        invoices = payload.get("$items")
        if not isinstance(invoices, list):
            invoices = payload.get("items")
        if not isinstance(invoices, list):
            invoices = []

        for invoice in invoices:
            if not isinstance(invoice, dict):
                continue
            contact = invoice.get("contact")
            contact = contact if isinstance(contact, dict) else {}
            currency = invoice.get("currency")
            currency = currency if isinstance(currency, dict) else {}
            normalized_row = {
                "invoice_id": invoice.get("id"),
                "invoice_number": (
                    invoice.get("displayed_as")
                    or invoice.get("invoice_number")
                ),
                "created_at": invoice.get("date") or invoice.get("created_at"),
                "due_date": invoice.get("due_date"),
                "status": invoice.get("status"),
                "reference": invoice.get("reference"),
                "net_amount": invoice.get("net_amount"),
                "tax_amount": invoice.get("tax_amount"),
                "total_amount": invoice.get("total_amount"),
                "amount_due": invoice.get("amount_due"),
                "amount_paid": invoice.get("amount_paid"),
                "outstanding_amount": invoice.get("outstanding_amount"),
                "currency": currency.get("displayed_as") or currency.get("id"),
                "customer_id": contact.get("id"),
                "customer_name": contact.get("displayed_as") or contact.get("name"),
                "updated_at": invoice.get("updated_at"),
            }
            rows.append(
                build_dynamic_connector_row(
                    invoice,
                    normalized_row,
                )
            )

        if not invoices or len(invoices) < PAGE_SIZE:
            break
        page += 1

    dataframe = pd.DataFrame(rows)
    dataframe = filter_date_range(dataframe, start_date, end_date)
    return dataframe, {
        "connector": "sage",
        "resource": "sales_invoices",
        "business_id": business_id,
        "start_date": date_value(start_date),
        "end_date": date_value(end_date),
        "row_count": len(dataframe),
    }


def load_xero_dataframe(
    db,
    connection: DataSourceConnection,
    start_date=None,
    end_date=None,
) -> tuple[pd.DataFrame, dict]:
    config = parse_connection_config(connection)
    tenant_id = str(config.get("tenant_id") or "").strip()
    if not re.fullmatch(
        r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-"
        r"[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}",
        tenant_id,
    ):
        raise ConnectorUnavailable(
            "Connect a Xero organisation before syncing"
        )

    access_token = get_oauth_access_token(db, connection, "xero")
    base_url = require_provider_url("XERO_API_BASE_URL")
    rows = []
    page = 1
    seen_pages = set()

    while True:
        if page in seen_pages:
            break
        seen_pages.add(page)
        payload = connector_json_request(
            f"{base_url}/Invoices?{urlencode({'page': page})}",
            headers={
                "Authorization": f"Bearer {access_token}",
                "Xero-tenant-id": tenant_id,
            },
        )
        invoices = payload.get("Invoices")
        if not isinstance(invoices, list):
            invoices = []

        for invoice in invoices:
            if not isinstance(invoice, dict):
                continue
            contact = invoice.get("Contact")
            contact = contact if isinstance(contact, dict) else {}
            line_items = invoice.get("LineItems")
            line_items = line_items if isinstance(line_items, list) else []
            invoice_date = parse_xero_date(
                invoice.get("DateString") or invoice.get("Date")
            )
            normalized_row = {
                "invoice_id": invoice.get("InvoiceID"),
                "invoice_number": invoice.get("InvoiceNumber"),
                "invoice_type": invoice.get("Type"),
                "status": invoice.get("Status"),
                "created_at": invoice_date,
                "due_date": parse_xero_date(
                    invoice.get("DueDateString") or invoice.get("DueDate")
                ),
                "fully_paid_on": parse_xero_date(
                    invoice.get("FullyPaidOnDate")
                ),
                "subtotal": invoice.get("SubTotal"),
                "total_tax": invoice.get("TotalTax"),
                "total": invoice.get("Total"),
                "amount_due": invoice.get("AmountDue"),
                "amount_paid": invoice.get("AmountPaid"),
                "currency": invoice.get("CurrencyCode"),
                "customer_id": contact.get("ContactID"),
                "customer_name": contact.get("Name"),
                "reference": invoice.get("Reference"),
                "line_item_count": len(line_items),
                "sent_to_contact": invoice.get("SentToContact"),
                "updated_at": parse_xero_date(
                    invoice.get("UpdatedDateUTC")
                ),
            }
            rows.append(
                build_dynamic_connector_row(
                    invoice,
                    normalized_row,
                )
            )

        if not invoices or len(invoices) < PAGE_SIZE:
            break
        page += 1

    dataframe = pd.DataFrame(rows)
    dataframe = filter_date_range(dataframe, start_date, end_date)
    return dataframe, {
        "connector": "xero",
        "resource": "Invoices",
        "tenant_id": tenant_id,
        "start_date": date_value(start_date),
        "end_date": date_value(end_date),
        "row_count": len(dataframe),
    }


def netsuite_error_is_retryable(status_code: int, detail: str) -> bool:
    if status_code in NETSUITE_RETRY_STATUS_CODES:
        return True
    if status_code != 403:
        return False
    detail_upper = detail.upper()
    return any(
        marker in detail_upper
        for marker in (
            "RATE",
            "REQUEST_LIMIT",
            "CONCURRENCY",
            "TOO MANY",
        )
    )


def netsuite_json_request(
    url: str,
    headers: dict[str, str],
) -> dict:
    """Read one NetSuite REST response with bounded transient retries."""
    for attempt in range(NETSUITE_MAX_ATTEMPTS):
        request = Request(
            url,
            headers={
                "Accept": "application/json",
                "User-Agent": "Decisionate NetSuite connector",
                **headers,
            },
            method="GET",
        )
        try:
            with urlopen(request, timeout=30) as response:
                body = response.read().decode("utf-8")
        except HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")
            if (
                not netsuite_error_is_retryable(error.code, detail)
                or attempt == NETSUITE_MAX_ATTEMPTS - 1
            ):
                raise ConnectorUnavailable(
                    f"NetSuite request failed with HTTP {error.code}: "
                    f"{detail[:240]}"
                ) from error
            retry_after = None
            if error.headers:
                retry_after = error.headers.get("Retry-After")
            try:
                delay = float(retry_after)
            except (TypeError, ValueError):
                delay = float(2**attempt)
            sleep(min(max(delay, 0.0), 30.0))
            continue
        except (URLError, TimeoutError, OSError) as error:
            if attempt == NETSUITE_MAX_ATTEMPTS - 1:
                raise ConnectorUnavailable(
                    "NetSuite service is unavailable"
                ) from error
            sleep(float(min(2**attempt, 8)))
            continue

        try:
            payload = json.loads(body)
        except json.JSONDecodeError as error:
            raise ConnectorUnavailable(
                "NetSuite returned an invalid response"
            ) from error
        if not isinstance(payload, dict):
            raise ConnectorUnavailable(
                "NetSuite returned an invalid response"
            )
        return payload

    raise ConnectorUnavailable("NetSuite request could not be completed")


def validate_netsuite_account_id(value: str) -> str:
    account_id = str(value or "").strip()
    if not account_id or not re.fullmatch(r"[A-Za-z0-9_-]+", account_id):
        raise ConnectorUnavailable(
            "Configure a valid NetSuite account ID before syncing"
        )
    return account_id


def netsuite_base_url(account_id: str) -> str:
    template = get_provider_setting("NETSUITE_API_BASE_URL_TEMPLATE")
    if not template:
        raise ConnectorUnavailable(
            "NETSUITE_API_BASE_URL_TEMPLATE is required for NetSuite"
        )
    try:
        value = template.format(account_id=account_id).rstrip("/")
    except KeyError as error:
        raise ConnectorUnavailable(
            "NETSUITE_API_BASE_URL_TEMPLATE must include {account_id}"
        ) from error

    parsed = urlparse(value)
    hostname = (parsed.hostname or "").lower()
    allowed_host = (
        hostname.endswith(".suitetalk.api.netsuite.com")
        or hostname.endswith(".suitetalk.api.netsuite2.com")
    )
    if (
        parsed.scheme != "https"
        or not hostname
        or not allowed_host
        or parsed.username
        or parsed.password
        or parsed.port is not None
        or parsed.query
        or parsed.fragment
        or not parsed.path.rstrip("/").endswith("/services/rest/record/v1")
    ):
        raise ConnectorUnavailable(
            "NETSUITE_API_BASE_URL_TEMPLATE must resolve to the HTTPS "
            "NetSuite REST record API"
        )
    return value


def netsuite_date_literal(value) -> str:
    return f"{value.month}/{value.day}/{value.year}"


def netsuite_collection_query(start_date, end_date) -> str | None:
    filters = []
    if start_date is not None:
        filters.append(
            f'lastModifiedDate ON_OR_AFTER "{netsuite_date_literal(start_date)}"'
        )
    if end_date is not None:
        exclusive_end = end_date + timedelta(days=1)
        filters.append(
            f'lastModifiedDate BEFORE "{netsuite_date_literal(exclusive_end)}"'
        )
    return " AND ".join(filters) or None


def netsuite_next_url(base_url: str, next_url) -> str:
    candidate = urljoin(f"{base_url}/", str(next_url or "").strip())
    parsed = urlparse(candidate)
    base = urlparse(base_url)
    base_path = base.path.rstrip("/")
    if (
        parsed.scheme != "https"
        or parsed.hostname != base.hostname
        or parsed.username
        or parsed.password
        or parsed.port is not None
        or not parsed.path.startswith(f"{base_path}/")
        or parsed.fragment
    ):
        raise ConnectorUnavailable(
            "NetSuite returned an invalid pagination URL"
        )
    return candidate


def load_netsuite_dataframe(
    db,
    connection: DataSourceConnection,
    start_date=None,
    end_date=None,
) -> tuple[pd.DataFrame, dict]:
    config = parse_connection_config(connection)
    requested_record_type = str(config.get("record_type") or "").strip().lower()
    record_type = NETSUITE_RECORD_TYPES.get(requested_record_type)
    if not record_type:
        raise ConnectorUnavailable(
            "NetSuite record_type must be invoice, customer, or sales_order"
        )

    account_id = validate_netsuite_account_id(config.get("account_id"))
    access_token = get_oauth_access_token(db, connection, "netsuite")
    base_url = netsuite_base_url(account_id)
    query = netsuite_collection_query(start_date, end_date)
    params = {"limit": "1000"}
    if query:
        params["q"] = query
    next_url = f"{base_url}/{record_type}?{urlencode(params)}"
    seen_urls = set()
    record_ids = []

    while next_url:
        if next_url in seen_urls:
            raise ConnectorUnavailable(
                "NetSuite returned a repeated pagination URL"
            )
        seen_urls.add(next_url)
        payload = netsuite_json_request(
            next_url,
            headers={"Authorization": f"Bearer {access_token}"},
        )
        items = payload.get("items")
        if not isinstance(items, list):
            raise ConnectorUnavailable(
                "NetSuite returned an invalid record collection"
            )
        for item in items:
            if not isinstance(item, dict):
                continue
            record_id = str(item.get("id") or "").strip()
            if record_id:
                record_ids.append(record_id)

        has_more = bool(payload.get("hasMore"))
        links = payload.get("links")
        raw_next_url = (
            next(
                (
                    link.get("href")
                    for link in links
                    if isinstance(link, dict) and link.get("rel") == "next"
                ),
                None,
            )
            if isinstance(links, list)
            else None
        )
        if has_more and not raw_next_url:
            raise ConnectorUnavailable(
                "NetSuite response omitted the next pagination link"
            )
        next_url = (
            netsuite_next_url(base_url, raw_next_url)
            if has_more and raw_next_url
            else None
        )

    rows = []
    seen_record_ids = set()
    for record_id in record_ids:
        if record_id in seen_record_ids:
            continue
        seen_record_ids.add(record_id)
        detail_url = (
            f"{base_url}/{record_type}/{quote(record_id, safe='')}"
            "?expandSubResources=true"
        )
        record = netsuite_json_request(
            detail_url,
            headers={"Authorization": f"Bearer {access_token}"},
        )
        source_record = {
            key: value
            for key, value in record.items()
            if key != "links"
        }
        rows.append(
            build_dynamic_connector_row(
                source_record,
                {
                    "record_id": record.get("id") or record_id,
                    "record_type": record_type,
                    "created_at": (
                        record.get("dateCreated")
                        or record.get("createdDate")
                        or record.get("tranDate")
                    ),
                    "updated_at": record.get("lastModifiedDate"),
                },
            )
        )

    dataframe = pd.DataFrame(rows)
    dataframe = filter_date_range(dataframe, start_date, end_date)
    return dataframe, {
        "connector": "netsuite",
        "resource": record_type,
        "record_type": requested_record_type,
        "account_id": account_id,
        "start_date": date_value(start_date),
        "end_date": date_value(end_date),
        "row_count": len(dataframe),
    }


def salesforce_json_request(
    url: str,
    headers: dict[str, str],
) -> dict:
    """Read one Salesforce REST response with bounded transient retries."""
    for attempt in range(SALESFORCE_MAX_ATTEMPTS):
        request = Request(
            url,
            headers={"Accept": "application/json", **headers},
            method="GET",
        )
        try:
            with urlopen(request, timeout=30) as response:
                body = response.read().decode("utf-8")
        except HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")
            if (
                not salesforce_error_is_retryable(error.code, detail)
                or attempt == SALESFORCE_MAX_ATTEMPTS - 1
            ):
                raise ConnectorUnavailable(
                    f"Salesforce request failed with HTTP {error.code}: "
                    f"{detail[:240]}"
                ) from error
            retry_after = None
            if error.headers:
                retry_after = error.headers.get("Retry-After")
            try:
                delay = float(retry_after)
            except (TypeError, ValueError):
                delay = float(2**attempt)
            sleep(min(max(delay, 0.0), 30.0))
            continue
        except (URLError, TimeoutError, OSError) as error:
            if attempt == SALESFORCE_MAX_ATTEMPTS - 1:
                raise ConnectorUnavailable(
                    "Salesforce service is unavailable"
                ) from error
            sleep(float(min(2**attempt, 8)))
            continue

        try:
            payload = json.loads(body)
        except json.JSONDecodeError as error:
            raise ConnectorUnavailable(
                "Salesforce returned an invalid response"
            ) from error
        if not isinstance(payload, dict):
            raise ConnectorUnavailable(
                "Salesforce returned an invalid response"
            )
        return payload

    raise ConnectorUnavailable("Salesforce request could not be completed")


def normalize_salesforce_fields(value) -> str:
    if value is None or value == "":
        return "FIELDS(STANDARD)"
    if isinstance(value, str):
        values = [item.strip() for item in value.split(",") if item.strip()]
    elif isinstance(value, list):
        values = [str(item).strip() for item in value if str(item).strip()]
    else:
        raise ConnectorUnavailable(
            "Salesforce fields must be a comma-separated string or list"
        )
    if not values:
        return "FIELDS(STANDARD)"

    special_fields = {"FIELDS(STANDARD)", "FIELDS(CUSTOM)", "FIELDS(ALL)"}
    if any(item.upper() in special_fields for item in values):
        if len(values) != 1 or values[0].upper() not in special_fields:
            raise ConnectorUnavailable(
                "Salesforce FIELDS expressions cannot be combined with fields"
            )
        return values[0].upper()

    field_pattern = re.compile(
        r"^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)*$"
    )
    normalized = []
    seen = set()
    for field in values:
        if not field_pattern.fullmatch(field):
            raise ConnectorUnavailable(
                f"Invalid Salesforce field name: {field}"
            )
        key = field.lower()
        if key not in seen:
            normalized.append(field)
            seen.add(key)
    for required_field in ("Id", "CreatedDate", "LastModifiedDate"):
        if required_field.lower() not in seen:
            normalized.append(required_field)
    return ", ".join(normalized)


def validate_salesforce_instance_url(value: str) -> str:
    parsed = urlparse(str(value or "").strip())
    try:
        port = parsed.port
    except ValueError as error:
        raise ConnectorUnavailable(
            "Salesforce returned an invalid instance URL"
        ) from error
    hostname = (parsed.hostname or "").lower()
    if (
        parsed.scheme != "https"
        or not hostname
        or parsed.username
        or parsed.password
        or port is not None
        or parsed.path not in ("", "/")
        or parsed.query
        or parsed.fragment
        or not (
            hostname == "salesforce.com"
            or hostname.endswith(".salesforce.com")
        )
    ):
        raise ConnectorUnavailable(
            "Salesforce instance URL is missing or invalid"
        )
    return f"https://{hostname}"


def salesforce_query(
    object_type: str,
    field_expression: str,
    start_date,
    end_date,
) -> str:
    filters = []
    if start_date is not None:
        filters.append(
            f"LastModifiedDate >= '{start_date.isoformat()}T00:00:00Z'"
        )
    if end_date is not None:
        filters.append(
            f"LastModifiedDate <= '{end_date.isoformat()}T23:59:59Z'"
        )
    where_clause = f" WHERE {' AND '.join(filters)}" if filters else ""
    return (
        f"SELECT {field_expression} FROM {object_type}{where_clause} "
        "ORDER BY LastModifiedDate ASC"
    )


def salesforce_next_url(instance_url: str, next_records_url) -> str:
    candidate = urljoin(
        f"{instance_url}/",
        str(next_records_url or "").strip(),
    )
    parsed = urlparse(candidate)
    base = urlparse(instance_url)
    if (
        parsed.scheme != "https"
        or parsed.hostname != base.hostname
        or parsed.username
        or parsed.password
        or parsed.port is not None
        or parsed.path.startswith("/services/data/") is False
    ):
        raise ConnectorUnavailable(
            "Salesforce returned an invalid pagination URL"
        )
    return candidate


def load_salesforce_dataframe(
    db,
    connection: DataSourceConnection,
    start_date=None,
    end_date=None,
) -> tuple[pd.DataFrame, dict]:
    config = parse_connection_config(connection)
    requested_object_type = str(config.get("object_type") or "").strip()
    if not requested_object_type:
        raise ConnectorUnavailable(
            "Configure a Salesforce object_type before syncing"
        )
    object_type = SALESFORCE_OBJECT_TYPES.get(
        requested_object_type.lower()
    )
    if not object_type:
        raise ConnectorUnavailable(
            "Salesforce object_type must be Opportunity, Account, or Lead"
        )

    field_expression = normalize_salesforce_fields(config.get("fields"))
    access_token = get_oauth_access_token(db, connection, "salesforce")
    api_version = get_provider_setting("SALESFORCE_API_VERSION")
    if not re.fullmatch(r"v[0-9]+\.[0-9]+", api_version or ""):
        raise ConnectorUnavailable(
            "SALESFORCE_API_VERSION must look like vXX.0"
        )
    instance_url = validate_salesforce_instance_url(
        config.get("_instance_url")
        or get_provider_setting("SALESFORCE_API_BASE_URL")
    )
    query = salesforce_query(
        object_type,
        field_expression,
        start_date,
        end_date,
    )
    next_url = (
        f"{instance_url}/services/data/{api_version}/query/?"
        f"{urlencode({'q': query})}"
    )
    seen_urls = set()
    rows = []

    while next_url:
        if next_url in seen_urls:
            raise ConnectorUnavailable(
                "Salesforce returned a repeated pagination URL"
            )
        seen_urls.add(next_url)
        payload = salesforce_json_request(
            next_url,
            headers={"Authorization": f"Bearer {access_token}"},
        )
        records = payload.get("records")
        if not isinstance(records, list):
            raise ConnectorUnavailable(
                "Salesforce returned an invalid records response"
            )
        for record in records:
            if not isinstance(record, dict):
                continue
            source_record = {
                key: value
                for key, value in record.items()
                if key != "attributes"
            }
            rows.append(
                build_dynamic_connector_row(
                    source_record,
                    {
                        "record_id": record.get("Id"),
                        "created_at": record.get("CreatedDate"),
                        "updated_at": record.get("LastModifiedDate"),
                    },
                )
            )

        if payload.get("done"):
            next_url = None
            continue
        raw_next_url = payload.get("nextRecordsUrl")
        if not raw_next_url:
            raise ConnectorUnavailable(
                "Salesforce response omitted nextRecordsUrl"
            )
        next_url = salesforce_next_url(instance_url, raw_next_url)

    dataframe = pd.DataFrame(rows)
    return dataframe, {
        "connector": "salesforce",
        "resource": object_type,
        "object_type": object_type,
        "fields": field_expression,
        "api_version": api_version,
        "start_date": date_value(start_date),
        "end_date": date_value(end_date),
        "row_count": len(dataframe),
    }


def load_database_dataframe(
    connection: DataSourceConnection,
    start_date=None,
    end_date=None,
) -> tuple[pd.DataFrame, dict]:
    config = parse_connection_config(connection)
    query = validate_read_query(config.get("query"))
    url_env = {
        "postgresql": "POSTGRESQL_SOURCE_URL",
        "mysql": "MYSQL_SOURCE_URL",
        "sql_server": "SQL_SERVER_SOURCE_URL",
    }[connection.source_type]
    database_url = str(os.getenv(url_env, "") or "").strip()
    if not database_url:
        raise ConnectorUnavailable(
            f"{url_env} is required for the {connection.source_type} connector"
        )

    try:
        sqlalchemy = importlib.import_module("sqlalchemy")
    except ModuleNotFoundError as error:
        raise ConnectorUnavailable(
            "Database connectors require SQLAlchemy"
        ) from error

    bounded_query = bound_database_query(connection.source_type, query)
    engine = sqlalchemy.create_engine(
        database_url,
        pool_pre_ping=True,
    )
    try:
        with engine.connect() as database_connection:
            dataframe = pd.read_sql_query(
                sqlalchemy.text(bounded_query),
                database_connection,
            )
    except Exception as error:
        raise ConnectorUnavailable(
            f"{connection.source_type} query could not be loaded"
        ) from error
    finally:
        engine.dispose()

    if "created_at" in dataframe.columns:
        dataframe = filter_date_range(dataframe, start_date, end_date)
    return dataframe, {
        "connector": connection.source_type,
        "query": query[:240],
        "row_count": len(dataframe),
    }


def get_oauth_access_token(
    db,
    connection: DataSourceConnection,
    source_type: str,
) -> str:
    credential = (
        db.query(OAuthCredential)
        .filter(
            OAuthCredential.connection_id == connection.id,
            OAuthCredential.source_type == source_type,
        )
        .first()
    )
    if not credential:
        raise ConnectorUnavailable(
            f"Connect the {source_type} account before syncing"
        )
    try:
        token = decrypt_token(credential.access_token_encrypted)
    except Exception as error:
        raise ConnectorUnavailable(
            f"The stored {source_type} authorization could not be read"
        ) from error
    if not token:
        raise ConnectorUnavailable(
            f"Connect the {source_type} account before syncing"
        )

    refresh_token = None
    if credential.refresh_token_encrypted:
        try:
            refresh_token = decrypt_token(credential.refresh_token_encrypted)
        except Exception as error:
            raise ConnectorUnavailable(
                f"The stored {source_type} refresh authorization could not be read"
            ) from error
    expires_at = credential.expires_at
    refresh_deadline = datetime.now(UTC).replace(tzinfo=None) + timedelta(
        seconds=60
    )
    if refresh_token and expires_at and expires_at <= refresh_deadline:
        try:
            payload = refresh_oauth_token(
                source_type,
                refresh_token,
                parse_connection_config(connection),
            )
            token = str(payload.get("access_token") or "").strip()
            if not token:
                raise ConnectorUnavailable(
                    f"The {source_type} provider returned no refreshed token"
                )
            credential.access_token_encrypted = encrypt_token(token)
            credential.refresh_token_encrypted = encrypt_token(
                str(payload.get("refresh_token") or "").strip()
            ) or credential.refresh_token_encrypted
            credential.token_type = str(payload.get("token_type") or "") or credential.token_type
            credential.scope = str(payload.get("scope") or "") or credential.scope
            credential.expires_at = token_expiry(payload)
            db.commit()
        except ConnectorUnavailable:
            raise
        except Exception as error:
            raise ConnectorUnavailable(
                f"The {source_type} authorization could not be refreshed"
            ) from error
    return token


def connector_json_request(url: str, headers: dict[str, str]) -> dict:
    payload, _headers = connector_json_request_with_headers(url, headers)
    return payload


def connector_json_request_with_headers(
    url: str,
    headers: dict[str, str],
) -> tuple[dict, dict[str, str]]:
    request = Request(
        url,
        headers={"Accept": "application/json", **headers},
        method="GET",
    )
    try:
        with urlopen(request, timeout=30) as response:
            body = response.read().decode("utf-8")
            response_headers = {
                key: value
                for key, value in response.headers.items()
            }
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise ConnectorUnavailable(
            f"Connector request failed with HTTP {error.code}: {detail[:240]}"
        ) from error
    except (URLError, TimeoutError, OSError) as error:
        raise ConnectorUnavailable("Connector service is unavailable") from error

    try:
        payload = json.loads(body)
    except json.JSONDecodeError as error:
        raise ConnectorUnavailable("Connector returned an invalid response") from error
    if not isinstance(payload, dict):
        raise ConnectorUnavailable("Connector returned an invalid response")
    return payload, response_headers


def validate_read_query(value) -> str:
    query = str(value or "").strip().rstrip(";").strip()
    if not query:
        raise ConnectorUnavailable(
            "Configure a read-only SQL query before syncing"
        )
    if ";" in query or not re.match(r"^(select|with)\b", query, re.IGNORECASE):
        raise ConnectorUnavailable(
            "Database connector queries must contain one SELECT or WITH statement"
        )
    if re.search(
        r"\b(insert|update|delete|drop|alter|truncate|create|grant|revoke)\b",
        query,
        re.IGNORECASE,
    ):
        raise ConnectorUnavailable("Database connector queries must be read-only")
    return query


def bound_database_query(_source_type: str, query: str) -> str:
    """Keep a validated read query intact without imposing a row cap."""
    return query


def normalize_shop_domain(value) -> str | None:
    domain = str(value or "").strip().lower()
    domain = domain.removeprefix("https://").removeprefix("http://")
    domain = domain.split("/", 1)[0]
    if not domain or "." not in domain or any(
        character in domain for character in " <>\"'"
    ):
        return None
    return domain


def shopify_order_params(start_date, end_date) -> dict[str, str]:
    params = {"limit": str(PAGE_SIZE), "status": "any"}
    if start_date:
        params["created_at_min"] = f"{start_date.isoformat()}T00:00:00Z"
    if end_date:
        params["created_at_max"] = f"{end_date.isoformat()}T23:59:59Z"
    return params


def quickbooks_invoice_query(start_position: int, start_date, end_date) -> str:
    filters = []
    if start_date is not None:
        filters.append(f"TxnDate >= '{start_date.isoformat()}'")
    if end_date is not None:
        filters.append(f"TxnDate <= '{end_date.isoformat()}'")
    where_clause = f" WHERE {' AND '.join(filters)}" if filters else ""
    return (
        f"SELECT * FROM Invoice{where_clause} "
        f"STARTPOSITION {start_position} MAXRESULTS {PAGE_SIZE}"
    )


def get_meta_ads_time_increment() -> str:
    value = get_provider_setting("META_ADS_TIME_INCREMENT")
    if not value:
        raise ConnectorUnavailable(
            "META_ADS_TIME_INCREMENT is required for the Meta Ads connector"
        )
    normalized = value.strip().lower()
    if normalized == "all":
        return "all"
    try:
        increment = int(normalized)
    except ValueError as error:
        raise ConnectorUnavailable(
            "META_ADS_TIME_INCREMENT must be an integer from 1 to 90 or all"
        ) from error
    if increment <= 0 or increment > 90:
        raise ConnectorUnavailable(
            "META_ADS_TIME_INCREMENT must be an integer from 1 to 90 or all"
        )
    return str(increment)


def get_next_link(link_header: str | None) -> str | None:
    if not link_header:
        return None
    match = re.search(r"<([^>]+)>;\s*rel=\"next\"", link_header)
    return match.group(1) if match else None


def filter_date_range(dataframe: pd.DataFrame, start_date, end_date) -> pd.DataFrame:
    if dataframe.empty or (start_date is None and end_date is None):
        return dataframe
    dates = pd.to_datetime(dataframe.get("created_at"), errors="coerce", utc=True)
    mask = dates.notna()
    if start_date is not None:
        mask &= dates.dt.date >= start_date
    if end_date is not None:
        mask &= dates.dt.date <= end_date
    return dataframe.loc[mask].reset_index(drop=True)


def date_value(value) -> str | None:
    return value.isoformat() if value is not None else None


def parse_xero_date(value) -> str | None:
    if value is None:
        return None

    raw_value = str(value).strip()
    if not raw_value:
        return None

    timestamp_match = re.search(r"/Date\((-?\d+)", raw_value)
    if timestamp_match:
        try:
            return datetime.fromtimestamp(
                int(timestamp_match.group(1)) / 1000,
                tz=UTC,
            ).date().isoformat()
        except (OSError, OverflowError, ValueError):
            return None

    parsed_value = pd.to_datetime(
        raw_value,
        errors="coerce",
        utc=True,
    )
    if pd.isna(parsed_value):
        return None
    return parsed_value.date().isoformat()


def timestamp_value(value) -> str | None:
    try:
        return datetime.fromtimestamp(int(value), tz=UTC).isoformat()
    except (TypeError, ValueError, OSError):
        return None
