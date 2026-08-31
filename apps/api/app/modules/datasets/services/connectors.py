from __future__ import annotations

import importlib
import json
import os
from datetime import UTC, date, datetime, timedelta
import re
from time import sleep
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen

import pandas as pd

from app.configuration import get_provider_setting
from app.db.models import DataSourceConnection
from app.db.models import OAuthCredential
from app.modules.oauth.service import (
    OAuthProviderUnavailable,
    decrypt_token,
    encrypt_token,
    get_freshbooks_businesses,
    normalize_zoho_books_api_domain,
    refresh_oauth_token,
    token_expiry,
)


PAGE_SIZE = 100
STRIPE_ENCRYPTED_API_KEY_CONFIG = "_stripe_api_key_encrypted"
SALESFORCE_OBJECT_TYPES = {
    "Account",
    "Lead",
    "Opportunity",
}
SALESFORCE_RESOURCE_TYPES = {
    "accounts": "Account",
    "leads": "Lead",
    "opportunities": "Opportunity",
}
SALESFORCE_RESOURCE_ALIASES = {
    "account": "accounts",
    "accounts": "accounts",
    "lead": "leads",
    "leads": "leads",
    "opportunity": "opportunities",
    "opportunities": "opportunities",
}
SALESFORCE_MAX_SOQL_LENGTH = 6000
FRESHBOOKS_RESOURCE_PATHS = {
    "invoices": ("invoices/invoices", "invoices"),
    "expenses": ("expenses/expenses", "expenses"),
    "payments": ("payments/payments", "payments"),
    "clients": ("users/clients", "clients"),
    "credit_notes": ("credit_notes/credit_notes", "credit_notes"),
}
FRESHBOOKS_RESOURCE_TYPES = {
    "profile",
    "chart_of_accounts",
    "projects",
    *FRESHBOOKS_RESOURCE_PATHS,
}

SAGE_RESOURCE_TYPES = {
    "sales_invoices": ("sales_invoices", "$items"),
    "purchase_invoices": ("purchase_invoices", "$items"),
    "sales_credit_notes": ("sales_credit_notes", "$items"),
    "purchase_credit_notes": ("purchase_credit_notes", "$items"),
    "contacts": ("contacts", "$items"),
    "ledger_accounts": ("ledger_accounts", "$items"),
    "products": ("products", "$items"),
    "services": ("services", "$items"),
    "bank_accounts": ("bank_accounts", "$items"),
    "payments": ("contact_payments", "$items"),
    "other_payments": ("other_payments", "$items"),
    "journals": ("journals", "$items"),
}
SAGE_RESOURCE_ALIASES = {
    "sales_invoice": "sales_invoices",
    "sales_invoices": "sales_invoices",
    "invoice": "sales_invoices",
    "invoices": "sales_invoices",
    "purchase_invoice": "purchase_invoices",
    "purchase_invoices": "purchase_invoices",
    "purchase_bill": "purchase_invoices",
    "purchase_bills": "purchase_invoices",
    "sales_credit_note": "sales_credit_notes",
    "sales_credit_notes": "sales_credit_notes",
    "purchase_credit_note": "purchase_credit_notes",
    "purchase_credit_notes": "purchase_credit_notes",
    "contact": "contacts",
    "contacts": "contacts",
    "customer": "contacts",
    "customers": "contacts",
    "supplier": "contacts",
    "suppliers": "contacts",
    "ledger_account": "ledger_accounts",
    "ledger_accounts": "ledger_accounts",
    "account": "ledger_accounts",
    "accounts": "ledger_accounts",
    "product": "products",
    "products": "products",
    "service": "services",
    "services": "services",
    "bank_account": "bank_accounts",
    "bank_accounts": "bank_accounts",
    "payment": "payments",
    "payments": "payments",
    "contact_payment": "payments",
    "contact_payments": "payments",
    "other_payment": "other_payments",
    "other_payments": "other_payments",
    "journal": "journals",
    "journals": "journals",
}
SAGE_TRANSACTION_RESOURCES = {
    "sales_invoices",
    "purchase_invoices",
    "sales_credit_notes",
    "purchase_credit_notes",
    "payments",
    "other_payments",
    "journals",
}
SAGE_DATE_FILTER_RESOURCES = {
    "sales_invoices",
    "purchase_invoices",
    "sales_credit_notes",
    "purchase_credit_notes",
    "payments",
    "other_payments",
}

HUBSPOT_RESOURCE_TYPES = {
    "contacts",
    "companies",
    "deals",
    "tickets",
}


def normalize_salesforce_resource_type(value) -> str:
    normalized = re.sub(
        r"[\s-]+",
        "_",
        str(value or "").strip().lower(),
    )
    resource_type = SALESFORCE_RESOURCE_ALIASES.get(
        normalized,
        normalized,
    )
    if resource_type not in SALESFORCE_RESOURCE_TYPES:
        raise ConnectorUnavailable(
            "Salesforce resource_types contains an unsupported object: "
            f"{value}"
        )
    return resource_type


def normalize_salesforce_resource_types(config: dict) -> list[str]:
    """Return selected Salesforce objects in stable user order.

    ``object_type`` remains a compatibility fallback for connections created
    before Salesforce used the shared multi-object selector.
    """
    configured = config.get("resource_types")
    if configured is None or configured == "":
        configured = (
            config.get("object_type")
            or config.get("resource_type")
            or "opportunities"
        )

    if isinstance(configured, list):
        values = configured
    elif isinstance(configured, str):
        values = configured.split(",")
    else:
        values = []

    resources = []
    for value in values:
        if not str(value or "").strip():
            continue
        resource_type = normalize_salesforce_resource_type(value)
        if resource_type not in resources:
            resources.append(resource_type)

    if not resources:
        raise ConnectorUnavailable(
            "Select at least one Salesforce object before syncing"
        )
    return resources


def normalize_hubspot_resource_type(value) -> str:
    resource_type = str(value or "").strip().lower()
    if resource_type not in HUBSPOT_RESOURCE_TYPES:
        raise ConnectorUnavailable(
            "HubSpot resource_types contains an unsupported object: "
            f"{value}"
        )
    return resource_type


def normalize_hubspot_resource_types(config: dict) -> list[str]:
    """Return selected HubSpot CRM objects in stable user order.

    ``object_type`` remains a compatibility fallback for connections created
    before the object checklist was introduced.
    """
    configured = config.get("resource_types")
    if configured is None or configured == "":
        configured = config.get("object_type") or "deals"

    if isinstance(configured, list):
        values = configured
    elif isinstance(configured, str):
        values = configured.split(",")
    else:
        values = []

    resources = []
    for value in values:
        if not str(value or "").strip():
            continue
        resource_type = normalize_hubspot_resource_type(value)
        if resource_type not in resources:
            resources.append(resource_type)

    if not resources:
        raise ConnectorUnavailable(
            "Select at least one HubSpot object before syncing"
        )
    return resources


def normalize_freshbooks_resource_types(config: dict) -> list[str]:
    """Return the selected FreshBooks resources in stable user order."""
    configured = config.get("resource_types")
    if isinstance(configured, list):
        values = configured
    elif isinstance(configured, str):
        values = configured.split(",")
    else:
        legacy_resource = config.get("resource_type")
        values = [legacy_resource or "invoices"]

    resources = []
    for value in values:
        resource = str(value or "").strip().lower()
        if not resource:
            continue
        if resource not in FRESHBOOKS_RESOURCE_TYPES:
            raise ConnectorUnavailable(
                "FreshBooks resource_types contains an unsupported resource: "
                f"{resource}"
            )
        if resource not in resources:
            resources.append(resource)

    if not resources:
        raise ConnectorUnavailable(
            "Select at least one FreshBooks object before syncing"
        )
    return resources


def normalize_sage_resource_type(value) -> str:
    normalized = re.sub(
        r"[\s-]+",
        "_",
        str(value or "").strip().lower(),
    )
    compact = normalized.replace("_", "")
    resource_type = SAGE_RESOURCE_ALIASES.get(
        normalized,
        SAGE_RESOURCE_ALIASES.get(compact, normalized),
    )
    if resource_type not in SAGE_RESOURCE_TYPES:
        raise ConnectorUnavailable(
            "Sage resource_types contains an unsupported resource: "
            f"{value}"
        )
    return resource_type


def normalize_sage_resource_types(config: dict) -> list[str]:
    """Return selected Sage Accounting resources in stable user order."""
    configured = config.get("resource_types")
    if isinstance(configured, list):
        values = configured
    elif isinstance(configured, str):
        values = configured.split(",")
    else:
        values = [config.get("resource_type") or "sales_invoices"]

    resources = []
    for value in values:
        if not str(value or "").strip():
            continue
        resource_type = normalize_sage_resource_type(value)
        if resource_type not in resources:
            resources.append(resource_type)

    if not resources:
        raise ConnectorUnavailable(
            "Select at least one Sage Accounting object before syncing"
        )
    return resources


class ConnectorUnavailable(RuntimeError):
    pass


class ConnectorNoData(ConnectorUnavailable):
    """Raised when a valid sync returns no records for its requested range."""


QUICKBOOKS_RESOURCE_TYPES = {
    "invoices": "Invoice",
    "customers": "Customer",
    "payments": "Payment",
    "sales_receipts": "SalesReceipt",
    "estimates": "Estimate",
    "bills": "Bill",
    "purchases": "Purchase",
    "vendors": "Vendor",
    "products_services": "Item",
    "accounts": "Account",
}
QUICKBOOKS_RESOURCE_ALIASES = {
    "invoice": "invoices",
    "customer": "customers",
    "payment": "payments",
    "salesreceipt": "sales_receipts",
    "sales_receipt": "sales_receipts",
    "estimate": "estimates",
    "bill": "bills",
    "purchase": "purchases",
    "vendor": "vendors",
    "item": "products_services",
    "account": "accounts",
}
QUICKBOOKS_TRANSACTION_RESOURCES = {
    "invoices",
    "payments",
    "sales_receipts",
    "estimates",
    "bills",
    "purchases",
}

ZOHO_BOOKS_RESOURCE_TYPES = {
    "invoices": ("invoices", "invoices"),
    "contacts": ("contacts", "contacts"),
    "expenses": ("expenses", "expenses"),
    "customer_payments": ("customerpayments", "customer_payments"),
    "credit_notes": ("creditnotes", "creditnotes"),
    "estimates": ("estimates", "estimates"),
    "sales_orders": ("salesorders", "salesorders"),
    "projects": ("projects", "projects"),
    "items": ("items", "items"),
}
ZOHO_BOOKS_RESOURCE_ALIASES = {
    "invoice": "invoices",
    "contact": "contacts",
    "expense": "expenses",
    "customerpayment": "customer_payments",
    "customerpayments": "customer_payments",
    "customer_payment": "customer_payments",
    "creditnote": "credit_notes",
    "creditnotes": "credit_notes",
    "estimate": "estimates",
    "salesorder": "sales_orders",
    "salesorders": "sales_orders",
    "project": "projects",
    "item": "items",
}
ZOHO_BOOKS_TRANSACTION_RESOURCES = {
    "invoices",
    "expenses",
    "customer_payments",
    "credit_notes",
    "estimates",
    "sales_orders",
}
ZOHO_BOOKS_DATE_FILTER_RESOURCES = {
    "invoices",
    "expenses",
    "credit_notes",
    "estimates",
    "sales_orders",
}

XERO_RESOURCE_TYPES = {
    "invoices": ("Invoices", "Invoices"),
    "contacts": ("Contacts", "Contacts"),
    "payments": ("Payments", "Payments"),
    "credit_notes": ("CreditNotes", "CreditNotes"),
    "quotes": ("Quotes", "Quotes"),
    "purchase_orders": ("PurchaseOrders", "PurchaseOrders"),
    "accounts": ("Accounts", "Accounts"),
    "items": ("Items", "Items"),
}
XERO_MASTER_DATA_RESOURCES = {"contacts", "accounts", "items"}
XERO_RESOURCE_ALIASES = {
    "invoice": "invoices",
    "contact": "contacts",
    "payment": "payments",
    "creditnote": "credit_notes",
    "creditnotes": "credit_notes",
    "quote": "quotes",
    "purchaseorder": "purchase_orders",
    "purchaseorders": "purchase_orders",
    "account": "accounts",
    "item": "items",
}


def normalize_xero_resource_type(value) -> str:
    normalized = re.sub(
        r"[\s-]+",
        "_",
        str(value or "").strip().lower(),
    )
    compact = normalized.replace("_", "")
    resource_type = XERO_RESOURCE_ALIASES.get(
        normalized,
        XERO_RESOURCE_ALIASES.get(compact, normalized),
    )
    if resource_type not in XERO_RESOURCE_TYPES:
        raise ConnectorUnavailable(
            "Xero resource_types contains an unsupported resource: "
            f"{value}"
        )
    return resource_type


def normalize_xero_resource_types(config: dict) -> list[str]:
    """Return selected Xero resources in stable user order."""
    configured = config.get("resource_types")
    if isinstance(configured, list):
        values = configured
    elif isinstance(configured, str):
        values = configured.split(",")
    else:
        # Existing Xero connections predate object selection and were invoice-only.
        values = [config.get("resource_type") or "invoices"]

    resources = []
    for value in values:
        if not str(value or "").strip():
            continue
        resource_type = normalize_xero_resource_type(value)
        if resource_type not in resources:
            resources.append(resource_type)

    if not resources:
        raise ConnectorUnavailable(
            "Select at least one Xero object before syncing"
        )
    return resources


def normalize_quickbooks_resource_type(value) -> str:
    normalized = re.sub(
        r"[\s-]+",
        "_",
        str(value or "").strip().lower(),
    )
    compact = normalized.replace("_", "")
    resource_type = QUICKBOOKS_RESOURCE_ALIASES.get(
        normalized,
        QUICKBOOKS_RESOURCE_ALIASES.get(compact, normalized),
    )
    if resource_type not in QUICKBOOKS_RESOURCE_TYPES:
        raise ConnectorUnavailable(
            "QuickBooks resource_types contains an unsupported resource: "
            f"{value}"
        )
    return resource_type


def normalize_quickbooks_resource_types(config: dict) -> list[str]:
    """Return selected QuickBooks entities in stable user order."""
    configured = config.get("resource_types")
    if isinstance(configured, list):
        values = configured
    elif isinstance(configured, str):
        values = configured.split(",")
    else:
        values = [config.get("resource_type") or "invoices"]

    resources = []
    for value in values:
        if not str(value or "").strip():
            continue
        resource_type = normalize_quickbooks_resource_type(value)
        if resource_type not in resources:
            resources.append(resource_type)

    if not resources:
        raise ConnectorUnavailable(
            "Select at least one QuickBooks object before syncing"
        )
    return resources


def normalize_zoho_books_resource_type(value) -> str:
    normalized = re.sub(
        r"[\s-]+",
        "_",
        str(value or "").strip().lower(),
    )
    compact = normalized.replace("_", "")
    resource_type = ZOHO_BOOKS_RESOURCE_ALIASES.get(
        normalized,
        ZOHO_BOOKS_RESOURCE_ALIASES.get(compact, normalized),
    )
    if resource_type not in ZOHO_BOOKS_RESOURCE_TYPES:
        raise ConnectorUnavailable(
            "Zoho Books resource_types contains an unsupported resource: "
            f"{value}"
        )
    return resource_type


def normalize_zoho_books_resource_types(config: dict) -> list[str]:
    """Return selected Zoho Books resources in stable user order."""
    configured = config.get("resource_types")
    if isinstance(configured, list):
        values = configured
    elif isinstance(configured, str):
        values = configured.split(",")
    else:
        values = [config.get("resource_type") or "invoices"]

    resources = []
    for value in values:
        if not str(value or "").strip():
            continue
        resource_type = normalize_zoho_books_resource_type(value)
        if resource_type not in resources:
            resources.append(resource_type)

    if not resources:
        raise ConnectorUnavailable(
            "Select at least one Zoho Books object before syncing"
        )
    return resources


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


def flatten_connector_record(
    value,
    prefix: str = "",
    flatten_lists: bool = False,
) -> dict:
    """Flatten provider fields while retaining their dynamic schema."""
    if not isinstance(value, dict):
        return {_dynamic_column_name("", prefix): value}

    flattened = {}
    for key, child in value.items():
        column = _dynamic_column_name(prefix, key)
        if isinstance(child, dict) and child:
            flattened.update(
                flatten_connector_record(
                    child,
                    column,
                    flatten_lists=flatten_lists,
                )
            )
            continue

        if isinstance(child, list) and flatten_lists:
            flattened[_dynamic_column_name(column, "count")] = len(child)
            for index, item in enumerate(child):
                item_column = _dynamic_column_name(column, index)
                if isinstance(item, dict) and item:
                    flattened.update(
                        flatten_connector_record(
                            item,
                            item_column,
                            flatten_lists=True,
                        )
                    )
                elif isinstance(item, list):
                    flattened.update(
                        flatten_connector_record(
                            {str(index): item},
                            column,
                            flatten_lists=True,
                        )
                    )
                else:
                    flattened[item_column] = item
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


CONNECTOR_DATE_COLUMN_NAMES = {
    "closedate",
    "closed_date",
    "createdat",
    "created_at",
    "createddate",
    "created_date",
    "createtime",
    "create_time",
    "date",
    "dateend",
    "date_end",
    "datestart",
    "date_start",
    "deliverydate",
    "delivery_date",
    "duedate",
    "due_date",
    "expirydate",
    "expiry_date",
    "invoicedate",
    "invoice_date",
    "lastmodifiedat",
    "last_modified_at",
    "lastmodifieddate",
    "last_modified_date",
    "timestamp",
    "transactiondate",
    "transaction_date",
    "updatedat",
    "updated_at",
    "updateddate",
    "updated_date",
    "updatetime",
    "update_time",
}


def is_connector_date_column(column) -> bool:
    """Identify provider date fields without changing their column names."""
    tokens = re.findall(r"[a-z0-9]+", str(column or "").lower())
    if not tokens:
        return False

    normalized_name = "".join(tokens)
    normalized_with_underscores = "_".join(tokens)
    leaf_name = tokens[-1]
    return (
        normalized_name in CONNECTOR_DATE_COLUMN_NAMES
        or normalized_with_underscores in CONNECTOR_DATE_COLUMN_NAMES
        or leaf_name in CONNECTOR_DATE_COLUMN_NAMES
    )


def normalize_connector_date(value):
    """Return canonical connector dates as UTC calendar dates."""
    if value is None:
        return None
    if isinstance(value, str) and not value.strip():
        return None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        # Provider epoch fields such as Stripe's ``created`` remain numeric;
        # only date-like strings and datetime values are normalized here.
        return value

    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass

    parsed_value = pd.to_datetime(
        value,
        errors="coerce",
        utc=True,
    )
    if pd.isna(parsed_value):
        return value
    return parsed_value.date().isoformat()


def build_dynamic_connector_row(
    source_record: dict,
    normalized_fields: dict,
    flatten_lists: bool = False,
) -> dict:
    """Combine all source fields with stable aliases used by analytics."""
    row = flatten_connector_record(
        source_record,
        flatten_lists=flatten_lists,
    )
    row = {
        key: (
            normalize_connector_date(value)
            if is_connector_date_column(key)
            else value
        )
        for key, value in row.items()
    }
    for key, value in normalized_fields.items():
        if value is None:
            continue
        if is_connector_date_column(key):
            value = normalize_connector_date(value)
        if key in row and row[key] not in (None, "") and row[key] != value:
            if is_connector_date_column(key):
                row[key] = value
                continue
            row[f"decisionate__{key}"] = value
            continue
        row[key] = value
    return row


def normalize_connector_dataframe_dates(dataframe: pd.DataFrame):
    """Normalize date-like columns in persisted connector data for querying."""
    if not isinstance(dataframe, pd.DataFrame) or dataframe.empty:
        return dataframe

    normalized_dataframe = dataframe.copy()
    for column in normalized_dataframe.columns:
        if is_connector_date_column(column):
            normalized_dataframe[column] = normalized_dataframe[column].map(
                normalize_connector_date
            )
    return normalized_dataframe


def load_connector_dataframe(
    db,
    connection: DataSourceConnection,
    start_date=None,
    end_date=None,
    quickbooks_resource_type: str | None = None,
    freshbooks_resource_type: str | None = None,
    sage_resource_type: str | None = None,
    xero_resource_type: str | None = None,
    zoho_books_resource_type: str | None = None,
    hubspot_resource_type: str | None = None,
    salesforce_resource_type: str | None = None,
) -> tuple[pd.DataFrame, dict]:
    if connection.source_type == "hubspot":
        return load_hubspot_dataframe(
            db,
            connection,
            start_date,
            end_date,
            hubspot_resource_type,
        )
    if connection.source_type == "salesforce":
        return load_salesforce_dataframe(
            db,
            connection,
            start_date,
            end_date,
            salesforce_resource_type,
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
            quickbooks_resource_type,
        )
    if connection.source_type == "freshbooks":
        return load_freshbooks_dataframe(
            db,
            connection,
            start_date,
            end_date,
            freshbooks_resource_type,
        )
    if connection.source_type == "sage":
        return load_sage_dataframe(
            db,
            connection,
            start_date,
            end_date,
            sage_resource_type,
        )
    if connection.source_type == "xero":
        return load_xero_dataframe(
            db,
            connection,
            start_date,
            end_date,
            xero_resource_type,
        )
    if connection.source_type == "zoho_books":
        return load_zoho_books_dataframe(
            db,
            connection,
            start_date,
            end_date,
            resource_type_override=zoho_books_resource_type,
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
    resource_type_override: str | None = None,
) -> tuple[pd.DataFrame, dict]:
    config = parse_connection_config(connection)
    object_type = normalize_hubspot_resource_type(
        resource_type_override
        or normalize_hubspot_resource_types(config)[0]
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


def validate_salesforce_instance_url(value) -> str:
    instance_url = str(value or "").strip().rstrip("/")
    parsed = urlparse(instance_url)
    hostname = (parsed.hostname or "").lower()
    if (
        parsed.scheme != "https"
        or not parsed.netloc
        or parsed.path not in ("", "/")
        or not (
            hostname == "salesforce.com"
            or hostname.endswith(".salesforce.com")
        )
    ):
        raise ConnectorUnavailable(
            "Salesforce authorization did not provide a valid instance URL"
        )
    return instance_url


def get_salesforce_api_version() -> str:
    value = get_provider_setting("SALESFORCE_API_VERSION").strip()
    normalized = value.removeprefix("v")
    if not re.fullmatch(r"\d+\.\d+", normalized):
        raise ConnectorUnavailable(
            "SALESFORCE_API_VERSION must be a Salesforce version such as 65.0"
        )
    return f"v{normalized}"


def salesforce_date_boundary(value, end_of_day: bool = False) -> str:
    if isinstance(value, datetime):
        value = value.date()
    boundary = "23:59:59" if end_of_day else "00:00:00"
    return f"{value.isoformat()}T{boundary}Z"


def salesforce_field_batches(
    object_type: str,
    field_names: list[str],
):
    batch = ["Id"]
    for field_name in field_names:
        if field_name == "Id":
            continue
        candidate = [*batch, field_name]
        query = (
            f"SELECT {', '.join(candidate)} FROM {object_type}"
        )
        if (
            len(query) > SALESFORCE_MAX_SOQL_LENGTH
            and len(batch) > 1
        ):
            yield batch
            batch = ["Id", field_name]
        else:
            batch = candidate
    if batch:
        yield batch


def resolve_salesforce_next_url(
    instance_url: str,
    next_url: str,
) -> str:
    parsed = urlparse(next_url)
    if parsed.scheme or parsed.netloc:
        base_host = (urlparse(instance_url).hostname or "").lower()
        if (
            parsed.scheme != "https"
            or (parsed.hostname or "").lower() != base_host
        ):
            raise ConnectorUnavailable(
                "Salesforce returned an invalid pagination URL"
            )
        return next_url
    if not next_url.startswith("/"):
        raise ConnectorUnavailable(
            "Salesforce returned an invalid pagination URL"
        )
    return f"{instance_url}{next_url}"


def load_salesforce_query_records(
    instance_url: str,
    api_root: str,
    access_token: str,
    soql: str,
):
    next_url = f"{api_root}/query/?{urlencode({'q': soql})}"
    seen_urls = set()
    while next_url:
        if next_url in seen_urls:
            raise ConnectorUnavailable(
                "Salesforce returned a repeated pagination URL"
            )
        seen_urls.add(next_url)
        payload = connector_json_request(
            next_url,
            headers={"Authorization": f"Bearer {access_token}"},
        )
        records = payload.get("records")
        if not isinstance(records, list):
            raise ConnectorUnavailable(
                "Salesforce returned an invalid records response"
            )
        for record in records:
            if isinstance(record, dict):
                yield record
        next_records_url = str(
            payload.get("nextRecordsUrl") or ""
        ).strip()
        next_url = (
            resolve_salesforce_next_url(instance_url, next_records_url)
            if next_records_url
            else ""
        )


def load_salesforce_dataframe(
    db,
    connection: DataSourceConnection,
    start_date=None,
    end_date=None,
    resource_type_override: str | None = None,
) -> tuple[pd.DataFrame, dict]:
    config = parse_connection_config(connection)
    resource_type = normalize_salesforce_resource_type(
        resource_type_override
        or config.get("resource_type")
        or config.get("object_type")
        or normalize_salesforce_resource_types(config)[0]
    )
    object_type = SALESFORCE_RESOURCE_TYPES[resource_type]

    instance_url = validate_salesforce_instance_url(
        config.get("instance_url")
    )
    access_token = get_oauth_access_token(
        db,
        connection,
        "salesforce",
    )
    api_version = get_salesforce_api_version()
    api_root = f"{instance_url}/services/data/{api_version}"
    describe_payload = connector_json_request(
        f"{api_root}/sobjects/{object_type}/describe",
        headers={"Authorization": f"Bearer {access_token}"},
    )
    described_fields = describe_payload.get("fields")
    if not isinstance(described_fields, list):
        raise ConnectorUnavailable(
            "Salesforce returned an invalid object description"
        )

    field_names = ["Id"]
    for field in described_fields:
        if not isinstance(field, dict):
            continue
        field_name = str(field.get("name") or "").strip()
        if (
            field_name
            and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", field_name)
            and field_name not in field_names
        ):
            field_names.append(field_name)
    for required_field in ("CreatedDate", "LastModifiedDate"):
        if required_field not in field_names:
            field_names.append(required_field)

    where_clauses = []
    if start_date is not None:
        where_clauses.append(
            "LastModifiedDate >= "
            f"{salesforce_date_boundary(start_date)}"
        )
    if end_date is not None:
        where_clauses.append(
            "LastModifiedDate <= "
            f"{salesforce_date_boundary(end_date, end_of_day=True)}"
        )
    where_clause = (
        f" WHERE {' AND '.join(where_clauses)}"
        if where_clauses
        else ""
    )

    records_by_id = {}
    query_count = 0
    for field_batch in salesforce_field_batches(
        object_type,
        field_names,
    ):
        query_count += 1
        soql = (
            f"SELECT {', '.join(field_batch)} FROM {object_type}"
            f"{where_clause} ORDER BY LastModifiedDate ASC"
        )
        for item in load_salesforce_query_records(
            instance_url,
            api_root,
            access_token,
            soql,
        ):
            record_id = str(item.get("Id") or "").strip()
            if not record_id:
                continue
            provider_record = {
                key: value
                for key, value in item.items()
                if key != "attributes"
            }
            row = build_dynamic_connector_row(
                provider_record,
                {
                    "record_id": record_id,
                    "created_at": item.get("CreatedDate"),
                    "updated_at": item.get("LastModifiedDate"),
                    "object_type": object_type,
                },
            )
            records_by_id.setdefault(record_id, {}).update(row)

    dataframe = pd.DataFrame(records_by_id.values())
    return dataframe, {
        "connector": "salesforce",
        "resource": resource_type,
        "resource_type": resource_type,
        "object_type": object_type,
        "api_version": api_version,
        "field_count": len(field_names),
        "query_count": query_count,
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
    encrypted_api_key = str(
        config.get(STRIPE_ENCRYPTED_API_KEY_CONFIG) or ""
    ).strip()
    if not encrypted_api_key:
        raise ConnectorUnavailable(
            "A customer-provided Stripe restricted API key is required before syncing"
        )
    try:
        api_key = decrypt_token(encrypted_api_key)
    except Exception as error:
        raise ConnectorUnavailable(
            "The stored Stripe API key could not be decrypted"
        ) from error
    if not api_key:
        raise ConnectorUnavailable(
            "A customer-provided Stripe restricted API key is required before syncing"
        )

    rows = []
    starting_after = None
    seen_starting_after = set()
    base_url = require_provider_url("STRIPE_API_URL")
    request_headers = {"Authorization": f"Bearer {api_key}"}
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


def quickbooks_query(
    resource_type: str,
    start_position: int,
    start_date,
    end_date,
) -> str:
    entity = QUICKBOOKS_RESOURCE_TYPES[resource_type]
    filters = []
    if resource_type in QUICKBOOKS_TRANSACTION_RESOURCES:
        if start_date is not None:
            filters.append(f"TxnDate >= '{start_date.isoformat()}'")
        if end_date is not None:
            filters.append(f"TxnDate <= '{end_date.isoformat()}'")
    where_clause = f" WHERE {' AND '.join(filters)}" if filters else ""
    return (
        f"SELECT * FROM {entity}{where_clause} "
        f"STARTPOSITION {start_position} MAXRESULTS {PAGE_SIZE}"
    )


def build_quickbooks_normalized_fields(
    record: dict,
    resource_type: str,
) -> dict:
    metadata = record.get("MetaData")
    metadata = metadata if isinstance(metadata, dict) else {}
    customer_ref = record.get("CustomerRef")
    customer_ref = customer_ref if isinstance(customer_ref, dict) else {}
    vendor_ref = record.get("VendorRef")
    vendor_ref = vendor_ref if isinstance(vendor_ref, dict) else {}
    currency_ref = record.get("CurrencyRef")
    currency_ref = currency_ref if isinstance(currency_ref, dict) else {}
    primary_email = record.get("PrimaryEmailAddr")
    primary_email = (
        primary_email.get("Address")
        if isinstance(primary_email, dict)
        else primary_email
    )
    normalized = {
        "record_id": record.get("Id") or record.get("id"),
        "resource_type": resource_type,
        "created_at": record.get("TxnDate") or metadata.get("CreateTime"),
        "updated_at": metadata.get("LastUpdatedTime"),
        "create_time": metadata.get("CreateTime"),
        "last_updated_time": metadata.get("LastUpdatedTime"),
        "total_amount": record.get("TotalAmt"),
        "balance": record.get("Balance"),
        "currency": currency_ref.get("value"),
        "customer_id": customer_ref.get("value"),
        "customer_name": customer_ref.get("name"),
        "vendor_id": vendor_ref.get("value"),
        "vendor_name": vendor_ref.get("name"),
    }

    if resource_type == "invoices":
        normalized.update({
            "invoice_id": record.get("Id"),
            "doc_number": record.get("DocNumber"),
            "due_date": record.get("DueDate"),
            "email_status": record.get("EmailStatus"),
            "invoice_status": record.get("TxnStatus"),
            "private_note": record.get("PrivateNote"),
        })
    elif resource_type == "customers":
        normalized.update({
            "customer_id": record.get("Id"),
            "customer_name": record.get("DisplayName"),
            "email": primary_email,
            "active": record.get("Active"),
        })
    elif resource_type == "vendors":
        normalized.update({
            "vendor_id": record.get("Id"),
            "vendor_name": record.get("DisplayName"),
            "email": primary_email,
            "active": record.get("Active"),
        })
    elif resource_type == "products_services":
        normalized.update({
            "item_id": record.get("Id"),
            "item_name": record.get("Name"),
            "item_type": record.get("Type"),
            "unit_price": record.get("UnitPrice"),
            "purchase_cost": record.get("PurchaseCost"),
            "quantity_on_hand": record.get("QtyOnHand"),
            "active": record.get("Active"),
        })
    elif resource_type == "accounts":
        normalized.update({
            "account_id": record.get("Id"),
            "account_name": record.get("Name"),
            "account_type": record.get("AccountType"),
            "account_sub_type": record.get("AccountSubType"),
            "current_balance": record.get("CurrentBalance"),
            "active": record.get("Active"),
        })
    else:
        normalized.update({
            "doc_number": record.get("DocNumber"),
            "transaction_status": record.get("TxnStatus"),
        })

    return normalized


def load_quickbooks_dataframe(
    db,
    connection: DataSourceConnection,
    start_date=None,
    end_date=None,
    resource_type_override: str | None = None,
) -> tuple[pd.DataFrame, dict]:
    config = parse_connection_config(connection)
    resource_type = normalize_quickbooks_resource_type(
        resource_type_override
        or normalize_quickbooks_resource_types(config)[0]
    )
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
    entity = QUICKBOOKS_RESOURCE_TYPES[resource_type]
    rows = []
    start_position = 1
    seen_positions = set()

    while True:
        if start_position in seen_positions:
            break
        seen_positions.add(start_position)
        query = quickbooks_query(
            resource_type,
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
            query_response.get(entity)
            if isinstance(query_response, dict)
            else None
        )
        if not isinstance(records, list):
            records = []

        for record in records:
            if not isinstance(record, dict):
                continue
            rows.append(
                build_dynamic_connector_row(
                    record,
                    build_quickbooks_normalized_fields(
                        record,
                        resource_type,
                    ),
                    flatten_lists=True,
                )
            )

        if not records or len(records) < PAGE_SIZE:
            break
        start_position += len(records)

    dataframe = pd.DataFrame(rows)
    if resource_type in QUICKBOOKS_TRANSACTION_RESOURCES:
        dataframe = filter_date_range(dataframe, start_date, end_date)
    return dataframe, {
        "connector": "quickbooks",
        "resource": resource_type,
        "object_type": entity,
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
    resource_type_override: str | None = None,
) -> tuple[pd.DataFrame, dict]:
    config = parse_connection_config(connection)
    resource_type = str(
        resource_type_override
        or normalize_freshbooks_resource_types(config)[0]
    ).strip().lower()
    if resource_type not in FRESHBOOKS_RESOURCE_TYPES:
        raise ConnectorUnavailable(
            "FreshBooks resource_type must be profile, invoices, expenses, "
            "payments, clients, chart_of_accounts, credit_notes, or projects"
        )

    account_id = str(config.get("account_id") or "").strip()
    business_id = str(config.get("business_id") or "").strip()
    business_uuid = str(config.get("business_uuid") or "").strip()
    access_token = get_oauth_access_token(db, connection, "freshbooks")
    needs_business_metadata = resource_type != "profile" and (
        not account_id
        or not re.fullmatch(r"[A-Za-z0-9_-]+", account_id)
        or (resource_type == "projects" and not business_id)
        or (resource_type == "chart_of_accounts" and not business_uuid)
    )
    if needs_business_metadata:
        businesses = [
            business
            for business in get_freshbooks_businesses(access_token)
            if business["active"]
        ]
        if len(businesses) != 1:
            raise ConnectorUnavailable(
                "FreshBooks returned multiple business accounts; account selection is required"
                if businesses
                else "FreshBooks did not return an active business account"
            )
        account_id = businesses[0]["account_id"]
        business_id = businesses[0].get("business_id") or business_id
        business_uuid = businesses[0].get("business_uuid") or business_uuid
        config["account_id"] = account_id
        if business_id:
            config["business_id"] = business_id
        if business_uuid:
            config["business_uuid"] = business_uuid
        connection.connection_config = json.dumps(
            config,
            sort_keys=True,
        )
    rows = []

    if resource_type == "profile":
        identity_url = get_provider_setting(
            "FRESHBOOKS_IDENTITY_API_URL"
        )
        if not identity_url:
            raise ConnectorUnavailable(
                "FRESHBOOKS_IDENTITY_API_URL is required for the FreshBooks connector"
            )
        payload = connector_json_request(
            identity_url,
            headers={
                "Accept": "application/json",
                "Api-Version": "alpha",
                "Authorization": f"Bearer {access_token}",
            },
        )
        response = payload.get("response")
        if not isinstance(response, dict):
            raise ConnectorUnavailable(
                "FreshBooks returned an invalid profile response"
            )
        profile = response.get("profile")
        profile = profile if isinstance(profile, dict) else response
        profile_record = dict(profile)
        identity_id = response.get("id")
        if identity_id is not None:
            profile_record["identity_id"] = identity_id
        rows.append(
            build_dynamic_connector_row(
                profile_record,
                {
                    "profile_id": identity_id,
                    "resource_type": resource_type,
                },
            )
        )
    else:
        if resource_type == "chart_of_accounts":
            rows = _load_freshbooks_chart_of_accounts_resource(
                access_token,
                business_uuid,
                start_date,
                end_date,
            )
        elif resource_type == "projects":
            rows = _load_freshbooks_projects_resource(
                access_token,
                business_id,
                start_date,
                end_date,
            )
        else:
            rows = _load_freshbooks_account_resource(
                access_token,
                account_id,
                resource_type,
                start_date,
                end_date,
            )

    dataframe = pd.DataFrame(rows)
    dataframe = filter_date_range(dataframe, start_date, end_date)
    return dataframe, {
        "connector": "freshbooks",
        "resource": resource_type,
        "account_id": account_id,
        "business_id": business_id,
        "business_uuid": business_uuid,
        "start_date": date_value(start_date),
        "end_date": date_value(end_date),
        "row_count": len(dataframe),
    }


def _load_freshbooks_chart_of_accounts_resource(
    access_token: str,
    business_uuid: str,
    start_date=None,
    end_date=None,
) -> list[dict]:
    base_template = get_provider_setting(
        "FRESHBOOKS_BUSINESS_API_BASE_URL_TEMPLATE"
    )
    if not base_template:
        raise ConnectorUnavailable(
            "FRESHBOOKS_BUSINESS_API_BASE_URL_TEMPLATE is required for the "
            "FreshBooks chart of accounts resource"
        )
    try:
        business_base_url = base_template.format(
            business_uuid=business_uuid
        ).rstrip("/")
    except KeyError as error:
        raise ConnectorUnavailable(
            "FRESHBOOKS_BUSINESS_API_BASE_URL_TEMPLATE must include "
            "{business_uuid}"
        ) from error

    params = {"user_ledger_entries": "true"}
    if start_date:
        params["start_date"] = start_date.isoformat()
    if end_date:
        params["end_date"] = end_date.isoformat()
    payload = connector_json_request(
        f"{business_base_url}/reports/chart_of_accounts?{urlencode(params)}",
        headers={"Authorization": f"Bearer {access_token}"},
    )
    response = payload.get("response")
    result = response.get("result") if isinstance(response, dict) else None
    records = (
        result.get("journal_entry_accounts")
        if isinstance(result, dict)
        else None
    )
    if not isinstance(records, list):
        raise ConnectorUnavailable(
            "FreshBooks returned an invalid chart_of_accounts response"
        )

    rows = []
    for record in records:
        if not isinstance(record, dict):
            continue
        account_uuid = record.get("account_uuid")
        rows.append(
            build_dynamic_connector_row(
                record,
                {
                    "record_id": account_uuid
                    or record.get("account_number")
                    or record.get("account_name"),
                    "resource_type": "chart_of_accounts",
                    "account_uuid": account_uuid,
                    "account_name": record.get("account_name"),
                    "account_number": record.get("account_number"),
                    "account_type": record.get("account_type"),
                    "account_sub_type": record.get("account_sub_type"),
                    "balance": record.get("balance"),
                    "currency_code": record.get("currency_code"),
                    "state": record.get("state"),
                },
                flatten_lists=True,
            )
        )
    return rows


def _load_freshbooks_projects_resource(
    access_token: str,
    business_id: str,
    start_date=None,
    end_date=None,
) -> list[dict]:
    base_template = get_provider_setting(
        "FRESHBOOKS_PROJECTS_API_BASE_URL_TEMPLATE"
    )
    if not base_template:
        raise ConnectorUnavailable(
            "FRESHBOOKS_PROJECTS_API_BASE_URL_TEMPLATE is required for the "
            "FreshBooks projects resource"
        )
    try:
        business_base_url = base_template.format(
            business_id=business_id
        ).rstrip("/")
    except KeyError as error:
        raise ConnectorUnavailable(
            "FRESHBOOKS_PROJECTS_API_BASE_URL_TEMPLATE must include "
            "{business_id}"
        ) from error

    rows = []
    page = 0
    seen_pages = set()
    while True:
        if page in seen_pages:
            raise ConnectorUnavailable(
                "FreshBooks returned a repeated projects page"
            )
        seen_pages.add(page)
        params = {
            "page": str(page),
            "per_page": str(PAGE_SIZE),
        }
        payload = connector_json_request(
            f"{business_base_url}/projects?{urlencode(params)}",
            # FreshBooks requires GET project requests to omit Content-Type.
            headers={"Authorization": f"Bearer {access_token}"},
        )
        records = payload.get("projects")
        if not isinstance(records, list):
            raise ConnectorUnavailable(
                "FreshBooks returned an invalid projects response"
            )
        for record in records:
            if not isinstance(record, dict):
                continue
            project_id = record.get("id")
            rows.append(
                build_dynamic_connector_row(
                    record,
                    {
                        "record_id": project_id,
                        "resource_type": "projects",
                        "project_id": project_id,
                        "title": record.get("title"),
                        "client_id": record.get("client_id"),
                        "project_type": record.get("project_type"),
                        "budget": record.get("budget"),
                        "fixed_price": record.get("fixed_price"),
                        "rate": record.get("rate"),
                        "billing_method": record.get("billing_method"),
                        "complete": record.get("complete"),
                        "active": record.get("active"),
                        "due_date": record.get("due_date"),
                        "created_at": record.get("created_at"),
                        "updated_at": record.get("updated_at"),
                        "logged_duration": record.get("logged_duration"),
                    },
                    flatten_lists=True,
                )
            )

        metadata = payload.get("meta")
        if isinstance(metadata, dict):
            try:
                pages = int(metadata.get("pages") or 0)
            except (TypeError, ValueError):
                pages = 0
            if pages and page + 1 >= pages:
                break
        if not records or len(records) < PAGE_SIZE:
            break
        page += 1

    return rows


def _load_freshbooks_account_resource(
    access_token: str,
    account_id: str,
    resource_type: str,
    start_date=None,
    end_date=None,
) -> list[dict]:
    base_template = get_provider_setting(
        "FRESHBOOKS_API_BASE_URL_TEMPLATE"
    )
    if not base_template:
        raise ConnectorUnavailable(
            "FRESHBOOKS_API_BASE_URL_TEMPLATE is required for the FreshBooks connector"
        )
    try:
        account_base_url = base_template.format(
            account_id=account_id
        ).rstrip("/")
    except KeyError as error:
        raise ConnectorUnavailable(
            "FRESHBOOKS_API_BASE_URL_TEMPLATE must include {account_id}"
        ) from error

    legacy_invoice_suffix = "/invoices/invoices"
    if account_base_url.endswith(legacy_invoice_suffix):
        account_base_url = account_base_url[: -len(legacy_invoice_suffix)]
    resource_path, response_key = FRESHBOOKS_RESOURCE_PATHS[resource_type]
    endpoint = f"{account_base_url.rstrip('/')}/{resource_path}"
    rows = []
    page = 1
    seen_pages = set()

    while True:
        if page in seen_pages:
            raise ConnectorUnavailable(
                "FreshBooks returned a repeated page while listing resources"
            )
        seen_pages.add(page)
        params = {
            "page": str(page),
            "per_page": str(PAGE_SIZE),
        }
        if resource_type in {"invoices", "expenses"}:
            if start_date:
                params["date_from"] = start_date.isoformat()
            if end_date:
                params["date_to"] = end_date.isoformat()
        elif resource_type == "payments":
            if start_date:
                params["date_min"] = start_date.isoformat()
            if end_date:
                params["date_max"] = end_date.isoformat()
        elif resource_type == "clients":
            if start_date:
                params["updated_min"] = start_date.isoformat()
            if end_date:
                params["updated_max"] = end_date.isoformat()

        payload = connector_json_request(
            f"{endpoint}?{urlencode(params)}",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        response = payload.get("response")
        result = response.get("result") if isinstance(response, dict) else None
        records = result.get(response_key) if isinstance(result, dict) else None
        if not isinstance(records, list):
            raise ConnectorUnavailable(
                f"FreshBooks returned an invalid {resource_type} response"
            )

        for record in records:
            if not isinstance(record, dict):
                continue
            amount = record.get("amount")
            record_id = (
                record.get("id")
                or record.get("invoiceid")
                or record.get("expenseid")
                or record.get("logid")
                or record.get("creditid")
                or record.get("clientid")
            )
            normalized_row = {
                "record_id": record_id,
                "resource_type": resource_type,
                "created_at": (
                    record.get("create_date")
                    or record.get("date")
                    or record.get("signup_date")
                    or record.get("created_at")
                ),
                "updated_at": record.get("updated") or record.get("updated_at"),
                "amount": (
                    amount.get("amount")
                    if isinstance(amount, dict)
                    else amount
                ),
                "currency": (
                    amount.get("code")
                    if isinstance(amount, dict)
                    else record.get("currency_code")
                ),
            }
            if resource_type == "invoices":
                outstanding = record.get("outstanding")
                normalized_row.update({
                    "invoice_id": record.get("invoiceid") or record.get("id"),
                    "invoice_number": record.get("invoice_number"),
                    "due_date": record.get("due_date"),
                    "date_paid": record.get("date_paid"),
                    "outstanding": (
                        outstanding.get("amount")
                        if isinstance(outstanding, dict)
                        else outstanding
                    ),
                    "status": record.get("v3_status") or record.get("display_status"),
                    "payment_status": record.get("payment_status"),
                    "client_id": record.get("clientid"),
                    "client_name": " ".join(
                        value
                        for value in [record.get("fname"), record.get("lname")]
                        if value
                    ).strip(),
                    "organization": record.get("organization"),
                })
            elif resource_type == "expenses":
                normalized_row.update({
                    "expense_id": record.get("expenseid") or record.get("id"),
                    "client_id": record.get("clientid"),
                    "vendor": record.get("vendor"),
                    "category_id": record.get("categoryid"),
                    "status": record.get("status"),
                })
            elif resource_type == "payments":
                normalized_row.update({
                    "payment_id": record.get("id") or record.get("logid"),
                    "invoice_id": record.get("invoiceid"),
                    "client_id": record.get("clientid"),
                    "payment_type": record.get("type"),
                })
            elif resource_type == "clients":
                normalized_row.update({
                    "client_id": record.get("id") or record.get("userid"),
                    "client_name": " ".join(
                        value
                        for value in [record.get("fname"), record.get("lname")]
                        if value
                    ).strip(),
                    "organization": record.get("organization"),
                    "email": record.get("email"),
                })
            elif resource_type == "credit_notes":
                paid = record.get("paid")
                normalized_row.update({
                    "credit_note_id": record.get("creditid")
                    or record.get("id"),
                    "credit_number": record.get("credit_number"),
                    "credit_type": record.get("credit_type"),
                    "client_id": record.get("clientid"),
                    "client_name": " ".join(
                        value
                        for value in [record.get("fname"), record.get("lname")]
                        if value
                    ).strip(),
                    "organization": record.get("organization"),
                    "payment_status": record.get("payment_status"),
                    "status": record.get("status")
                    or record.get("display_status"),
                    "paid_amount": (
                        paid.get("amount")
                        if isinstance(paid, dict)
                        else paid
                    ),
                    "paid_currency": (
                        paid.get("code")
                        if isinstance(paid, dict)
                        else None
                    ),
                })
            rows.append(
                build_dynamic_connector_row(
                    record,
                    normalized_row,
                )
            )

        if not records or len(records) < PAGE_SIZE:
            break
        page += 1

    return rows


def _sage_first_value(record: dict, *keys: str):
    for key in keys:
        value = record.get(key)
        if value is not None and value != "":
            return value
    return None


def _sage_nested_value(record: dict, field: str, *keys: str):
    nested = record.get(field)
    if not isinstance(nested, dict):
        return None
    return _sage_first_value(nested, *keys)


def build_sage_normalized_fields(record: dict, resource_type: str) -> dict:
    """Expose stable analytical aliases without dropping Sage fields."""
    contact = record.get("contact")
    contact = contact if isinstance(contact, dict) else {}
    normalized = {
        "record_id": _sage_first_value(
            record,
            "id",
            "invoice_id",
            "credit_note_id",
            "contact_id",
            "ledger_account_id",
            "product_id",
            "service_id",
            "payment_id",
            "journal_id",
        ),
        "resource_type": resource_type,
        "created_at": _sage_first_value(
            record,
            "date",
            "transaction_date",
            "created_at",
            "created_date",
        ),
        "updated_at": _sage_first_value(
            record,
            "updated_at",
            "updated_date",
        ),
        "total_amount": _sage_first_value(
            record,
            "total_amount",
            "total",
            "amount",
            "net_amount",
        ),
        "currency": (
            _sage_nested_value(record, "currency", "displayed_as", "id")
            or record.get("currency_code")
        ),
        "customer_id": (
            _sage_first_value(record, "customer_id")
            or _sage_first_value(contact, "id")
        ),
        "customer_name": (
            _sage_first_value(record, "customer_name", "contact_name")
            or _sage_first_value(contact, "displayed_as", "name")
        ),
        "status": _sage_first_value(record, "status", "status_id"),
    }

    if resource_type in {"sales_invoices", "purchase_invoices"}:
        normalized.update(
            {
                "invoice_id": record.get("id") or record.get("invoice_id"),
                "invoice_number": _sage_first_value(
                    record,
                    "invoice_number",
                    "displayed_as",
                ),
                "due_date": record.get("due_date"),
                "reference": record.get("reference"),
                "net_amount": record.get("net_amount"),
                "tax_amount": record.get("tax_amount"),
                "amount_due": record.get("amount_due"),
                "amount_paid": record.get("amount_paid"),
                "outstanding_amount": record.get("outstanding_amount"),
            }
        )
    elif resource_type in {"sales_credit_notes", "purchase_credit_notes"}:
        normalized.update(
            {
                "credit_note_id": record.get("id")
                or record.get("credit_note_id"),
                "credit_note_number": _sage_first_value(
                    record,
                    "credit_note_number",
                    "displayed_as",
                ),
                "reference": record.get("reference"),
                "net_amount": record.get("net_amount"),
                "tax_amount": record.get("tax_amount"),
            }
        )
    elif resource_type == "contacts":
        normalized.update(
            {
                "contact_id": record.get("id") or record.get("contact_id"),
                "contact_name": _sage_first_value(
                    record,
                    "name",
                    "displayed_as",
                ),
                "contact_type": _sage_first_value(
                    record,
                    "contact_type",
                    "type",
                ),
                "email": record.get("email"),
                "phone": record.get("phone"),
                "balance": record.get("balance"),
            }
        )
    elif resource_type == "ledger_accounts":
        normalized.update(
            {
                "ledger_account_id": record.get("id")
                or record.get("ledger_account_id"),
                "account_name": _sage_first_value(
                    record,
                    "name",
                    "displayed_as",
                ),
                "account_code": _sage_first_value(
                    record,
                    "ledger_account_code",
                    "nominal_code",
                    "code",
                ),
                "account_type": record.get("ledger_account_type"),
                "is_active": record.get("is_active"),
                "balance": record.get("balance"),
            }
        )
    elif resource_type in {"products", "services"}:
        normalized.update(
            {
                "product_service_id": record.get("id"),
                "product_service_name": _sage_first_value(
                    record,
                    "name",
                    "displayed_as",
                ),
                "sku": record.get("sku"),
                "description": record.get("description"),
                "sales_price": _sage_first_value(
                    record,
                    "sales_price",
                    "price",
                ),
                "purchase_price": record.get("purchase_price"),
            }
        )
    elif resource_type == "bank_accounts":
        normalized.update(
            {
                "bank_account_id": record.get("id"),
                "account_name": _sage_first_value(
                    record,
                    "name",
                    "displayed_as",
                ),
                "account_number": record.get("account_number"),
                "balance": record.get("balance"),
                "status": _sage_first_value(
                    record,
                    "status",
                    "is_active",
                ),
            }
        )
    elif resource_type in {"payments", "other_payments"}:
        normalized.update(
            {
                "payment_id": record.get("id") or record.get("payment_id"),
                "payment_reference": _sage_first_value(
                    record,
                    "reference",
                    "displayed_as",
                ),
                "bank_account_id": record.get("bank_account_id"),
                "contact_id": record.get("contact_id"),
            }
        )
    elif resource_type == "journals":
        normalized.update(
            {
                "journal_id": record.get("id") or record.get("journal_id"),
                "journal_reference": _sage_first_value(
                    record,
                    "reference",
                    "displayed_as",
                ),
                "journal_type": record.get("journal_type"),
            }
        )

    return normalized


def load_sage_dataframe(
    db,
    connection: DataSourceConnection,
    start_date=None,
    end_date=None,
    resource_type_override: str | None = None,
) -> tuple[pd.DataFrame, dict]:
    config = parse_connection_config(connection)
    resource_type = normalize_sage_resource_type(
        resource_type_override
        or normalize_sage_resource_types(config)[0]
    )
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

    resource_path, response_key = SAGE_RESOURCE_TYPES[resource_type]
    rows = []
    page = 1
    seen_pages = set()
    while True:
        if page in seen_pages:
            raise ConnectorUnavailable(
                "Sage returned a repeated pagination page"
            )
        seen_pages.add(page)
        params = {
            "items_per_page": str(PAGE_SIZE),
            "page": str(page),
        }
        if resource_type in SAGE_DATE_FILTER_RESOURCES:
            if start_date:
                params["from_date"] = start_date.isoformat()
            if end_date:
                params["to_date"] = end_date.isoformat()
        payload = connector_json_request(
            f"{base_url}/{resource_path}?{urlencode(params)}",
            headers={
                "Authorization": f"Bearer {access_token}",
                business_header: business_id,
                "Ocp-Apim-Subscription-Key": subscription_key,
                "Content-Type": "application/json",
            },
        )
        records = payload.get(response_key)
        if not isinstance(records, list):
            records = payload.get("items")
        if not isinstance(records, list):
            records = payload.get("data")
        if not isinstance(records, list):
            raise ConnectorUnavailable(
                f"Sage returned an invalid {resource_type} response"
            )

        for record in records:
            if not isinstance(record, dict):
                continue
            rows.append(
                build_dynamic_connector_row(
                    record,
                    build_sage_normalized_fields(record, resource_type),
                    flatten_lists=True,
                )
            )

        next_page = payload.get("$next")
        if (
            not records
            or len(records) < PAGE_SIZE
            or not next_page
        ):
            break
        page += 1

    dataframe = pd.DataFrame(rows)
    if resource_type in SAGE_TRANSACTION_RESOURCES:
        dataframe = filter_date_range(dataframe, start_date, end_date)
    return dataframe, {
        "connector": "sage",
        "resource": resource_type,
        "object_type": resource_path,
        "business_id": business_id,
        "start_date": date_value(start_date),
        "end_date": date_value(end_date),
        "row_count": len(dataframe),
    }


def _xero_first_value(record: dict, *keys: str):
    for key in keys:
        value = record.get(key)
        if value is not None and value != "":
            return value
    return None


def build_xero_normalized_fields(
    record: dict,
    resource_type: str,
    *,
    contact: dict | None = None,
    line_item_count: int | None = None,
) -> dict:
    """Expose stable analytical aliases without dropping Xero fields."""
    contact = contact if isinstance(contact, dict) else {}
    identifier_keys = {
        "invoices": ("InvoiceID",),
        "contacts": ("ContactID",),
        "payments": ("PaymentID",),
        "credit_notes": ("CreditNoteID",),
        "quotes": ("QuoteID",),
        "purchase_orders": ("PurchaseOrderID",),
        "accounts": ("AccountID",),
        "items": ("ItemID",),
    }
    record_id = _xero_first_value(
        record,
        *identifier_keys[resource_type],
        "ID",
        "Id",
        "id",
    )
    date_value = _xero_first_value(
        record,
        "DateString",
        "Date",
        "CreatedDateUTCString",
        "CreatedDateUTC",
        "UpdatedDateUTCString",
        "UpdatedDateUTC",
    )
    updated_value = _xero_first_value(
        record,
        "UpdatedDateUTCString",
        "UpdatedDateUTC",
    )
    normalized = {
        "record_id": record_id,
        "resource_type": resource_type,
        "created_at": parse_xero_date(date_value),
        "updated_at": parse_xero_date(updated_value),
    }

    if resource_type == "invoices":
        normalized.update({
            "invoice_id": record.get("InvoiceID"),
            "invoice_number": record.get("InvoiceNumber"),
            "invoice_type": record.get("Type"),
            "status": record.get("Status"),
            "due_date": parse_xero_date(
                record.get("DueDateString") or record.get("DueDate")
            ),
            "fully_paid_on": parse_xero_date(
                record.get("FullyPaidOnDate")
            ),
            "subtotal": record.get("SubTotal"),
            "total_tax": record.get("TotalTax"),
            "total": record.get("Total"),
            "amount_due": record.get("AmountDue"),
            "amount_paid": record.get("AmountPaid"),
            "currency": record.get("CurrencyCode"),
            "customer_id": contact.get("ContactID"),
            "customer_name": contact.get("Name"),
            "reference": record.get("Reference"),
            "line_item_count": line_item_count,
            "sent_to_contact": record.get("SentToContact"),
        })
    elif resource_type == "contacts":
        normalized.update({
            "contact_id": record.get("ContactID"),
            "contact_name": record.get("Name"),
            "contact_number": record.get("ContactNumber"),
            "contact_status": record.get("ContactStatus"),
            "email": record.get("EmailAddress"),
            "is_customer": record.get("IsCustomer"),
            "is_supplier": record.get("IsSupplier"),
        })
    elif resource_type == "payments":
        payment_invoice = record.get("Invoice")
        payment_invoice = (
            payment_invoice if isinstance(payment_invoice, dict) else {}
        )
        payment_credit_note = record.get("CreditNote")
        payment_credit_note = (
            payment_credit_note
            if isinstance(payment_credit_note, dict)
            else {}
        )
        normalized.update({
            "payment_id": record.get("PaymentID"),
            "payment_type": record.get("PaymentType"),
            "amount": record.get("Amount"),
            "currency_rate": record.get("CurrencyRate"),
            "invoice_id": payment_invoice.get("InvoiceID"),
            "invoice_number": payment_invoice.get("InvoiceNumber"),
            "credit_note_id": payment_credit_note.get("CreditNoteID"),
        })
    elif resource_type == "credit_notes":
        normalized.update({
            "credit_note_id": record.get("CreditNoteID"),
            "credit_note_number": record.get("CreditNoteNumber"),
            "credit_note_type": record.get("Type"),
            "status": record.get("Status"),
            "subtotal": record.get("SubTotal"),
            "total_tax": record.get("TotalTax"),
            "total": record.get("Total"),
            "remaining_credit": record.get("RemainingCredit"),
            "fully_paid_on": parse_xero_date(
                record.get("FullyPaidOnDate")
            ),
            "currency": record.get("CurrencyCode"),
            "customer_id": contact.get("ContactID"),
            "customer_name": contact.get("Name"),
        })
    elif resource_type == "quotes":
        normalized.update({
            "quote_id": record.get("QuoteID"),
            "quote_number": record.get("QuoteNumber"),
            "status": record.get("Status"),
            "expiry_date": parse_xero_date(
                record.get("ExpiryDate")
            ),
            "subtotal": record.get("SubTotal"),
            "total_tax": record.get("TotalTax"),
            "total": record.get("Total"),
            "currency": record.get("CurrencyCode"),
            "customer_id": contact.get("ContactID"),
            "customer_name": contact.get("Name"),
        })
    elif resource_type == "purchase_orders":
        normalized.update({
            "purchase_order_id": record.get("PurchaseOrderID"),
            "purchase_order_number": record.get("PurchaseOrderNumber"),
            "status": record.get("Status"),
            "delivery_date": parse_xero_date(
                record.get("DeliveryDate")
            ),
            "subtotal": record.get("SubTotal"),
            "total_tax": record.get("TotalTax"),
            "total": record.get("Total"),
            "currency": record.get("CurrencyCode"),
            "supplier_id": contact.get("ContactID"),
            "supplier_name": contact.get("Name"),
        })
    elif resource_type == "accounts":
        normalized.update({
            "account_id": record.get("AccountID"),
            "account_code": record.get("Code"),
            "account_name": record.get("Name"),
            "account_type": record.get("Type"),
            "account_class": record.get("Class"),
            "status": record.get("Status"),
            "current_balance": record.get("CurrentBalance"),
            "currency": record.get("CurrencyCode"),
        })
    elif resource_type == "items":
        sales_details = record.get("SalesDetails")
        sales_details = (
            sales_details if isinstance(sales_details, dict) else {}
        )
        purchase_details = record.get("PurchaseDetails")
        purchase_details = (
            purchase_details
            if isinstance(purchase_details, dict)
            else {}
        )
        normalized.update({
            "item_id": record.get("ItemID"),
            "item_code": record.get("Code"),
            "item_name": record.get("Name"),
            "description": record.get("Description"),
            "is_tracked": record.get("IsTrackedAsInventory"),
            "quantity_on_hand": record.get("QuantityOnHand"),
            "sales_unit_price": sales_details.get("UnitPrice"),
            "purchase_unit_price": purchase_details.get("UnitPrice"),
        })

    return normalized


def load_xero_dataframe(
    db,
    connection: DataSourceConnection,
    start_date=None,
    end_date=None,
    resource_type_override: str | None = None,
) -> tuple[pd.DataFrame, dict]:
    config = parse_connection_config(connection)
    resource_type = normalize_xero_resource_type(
        resource_type_override
        or normalize_xero_resource_types(config)[0]
    )
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
    resource_path, response_key = XERO_RESOURCE_TYPES[resource_type]
    rows = []
    page = 1
    seen_pages = set()

    while True:
        if page in seen_pages:
            break
        seen_pages.add(page)
        payload = connector_json_request(
            f"{base_url}/{resource_path}?{urlencode({'page': page})}",
            headers={
                "Authorization": f"Bearer {access_token}",
                "Xero-tenant-id": tenant_id,
            },
        )
        records = payload.get(response_key)
        if not isinstance(records, list):
            raise ConnectorUnavailable(
                f"Xero returned an invalid {resource_type} response"
            )

        for record in records:
            if not isinstance(record, dict):
                continue
            contact = record.get("Contact")
            contact = contact if isinstance(contact, dict) else {}
            line_items = record.get("LineItems")
            line_items = line_items if isinstance(line_items, list) else []
            rows.append(
                build_dynamic_connector_row(
                    record,
                    build_xero_normalized_fields(
                        record,
                        resource_type,
                        contact=contact,
                        line_item_count=len(line_items),
                    ),
                    flatten_lists=True,
                )
            )

        if not records or len(records) < PAGE_SIZE:
            break
        page += 1

    dataframe = pd.DataFrame(rows)
    if resource_type not in XERO_MASTER_DATA_RESOURCES:
        dataframe = filter_xero_sync_date_range(
            dataframe,
            start_date,
            end_date,
        )
    return dataframe, {
        "connector": "xero",
        "resource": resource_type,
        "object_type": resource_path,
        "tenant_id": tenant_id,
        "start_date": date_value(start_date),
        "end_date": date_value(end_date),
        "row_count": len(dataframe),
    }


def _zoho_books_first_value(record: dict, *keys: str):
    for key in keys:
        value = record.get(key)
        if value is not None and value != "":
            return value
    return None


def build_zoho_books_normalized_fields(
    record: dict,
    resource_type: str,
) -> dict:
    """Expose stable analytical aliases without dropping Zoho's fields."""
    record_id = _zoho_books_first_value(
        record,
        "invoice_id",
        "contact_id",
        "expense_id",
        "payment_id",
        "customerpayment_id",
        "creditnote_id",
        "estimate_id",
        "salesorder_id",
        "project_id",
        "item_id",
        "id",
    )
    created_at = _zoho_books_first_value(
        record,
        "date",
        "created_time",
        "creation_date",
        "created_at",
        "last_modified_time",
        "updated_time",
    )
    normalized = {
        "record_id": record_id,
        "resource_type": resource_type,
        "created_at": created_at,
        "updated_at": _zoho_books_first_value(
            record,
            "last_modified_time",
            "updated_time",
            "updated_at",
        ),
        "total_amount": _zoho_books_first_value(
            record,
            "total",
            "bcy_total",
            "amount",
            "bcy_amount",
        ),
        "balance": record.get("balance"),
        "currency": _zoho_books_first_value(
            record,
            "currency_code",
            "currency",
        ),
        "customer_id": record.get("customer_id"),
        "customer_name": _zoho_books_first_value(
            record,
            "customer_name",
            "contact_name",
        ),
    }

    if resource_type == "invoices":
        normalized.update(
            {
                "invoice_id": record.get("invoice_id"),
                "invoice_number": record.get("invoice_number"),
                "due_date": record.get("due_date"),
                "status": record.get("status"),
            }
        )
    elif resource_type == "contacts":
        normalized.update(
            {
                "contact_id": record.get("contact_id"),
                "contact_name": record.get("contact_name"),
                "company_name": record.get("company_name"),
                "contact_type": record.get("contact_type"),
                "email": record.get("email"),
                "phone": record.get("phone"),
                "status": record.get("status"),
                "outstanding_receivable_amount": record.get(
                    "outstanding_receivable_amount"
                ),
            }
        )
    elif resource_type == "expenses":
        normalized.update(
            {
                "expense_id": record.get("expense_id"),
                "account_name": record.get("account_name"),
                "description": record.get("description"),
                "status": record.get("status"),
            }
        )
    elif resource_type == "customer_payments":
        normalized.update(
            {
                "payment_id": _zoho_books_first_value(
                    record,
                    "payment_id",
                    "customerpayment_id",
                ),
                "payment_number": record.get("payment_number"),
                "payment_mode": record.get("payment_mode"),
            }
        )
    elif resource_type == "credit_notes":
        normalized.update(
            {
                "credit_note_id": record.get("creditnote_id"),
                "credit_note_number": record.get("creditnote_number"),
                "status": record.get("status"),
            }
        )
    elif resource_type == "estimates":
        normalized.update(
            {
                "estimate_id": record.get("estimate_id"),
                "estimate_number": record.get("estimate_number"),
                "status": record.get("status"),
            }
        )
    elif resource_type == "sales_orders":
        normalized.update(
            {
                "sales_order_id": record.get("salesorder_id"),
                "sales_order_number": record.get("salesorder_number"),
                "shipment_date": record.get("shipment_date"),
                "status": record.get("status"),
            }
        )
    elif resource_type == "projects":
        normalized.update(
            {
                "project_id": record.get("project_id"),
                "project_name": record.get("project_name"),
                "status": record.get("status"),
                "rate": record.get("rate"),
            }
        )
    elif resource_type == "items":
        normalized.update(
            {
                "item_id": record.get("item_id"),
                "item_name": record.get("name"),
                "rate": record.get("rate"),
                "purchase_rate": record.get("purchase_rate"),
                "status": record.get("status"),
                "stock_on_hand": record.get("stock_on_hand"),
            }
        )

    return normalized


def load_zoho_books_dataframe(
    db,
    connection: DataSourceConnection,
    start_date=None,
    end_date=None,
    resource_type_override: str | None = None,
) -> tuple[pd.DataFrame, dict]:
    config = parse_connection_config(connection)
    resource_type = normalize_zoho_books_resource_type(
        resource_type_override
        or normalize_zoho_books_resource_types(config)[0]
    )
    organization_id = str(
        config.get("organization_id") or ""
    ).strip()
    if not re.fullmatch(r"\d+", organization_id):
        raise ConnectorUnavailable(
            "Connect a Zoho Books organization before syncing"
        )

    access_token = get_oauth_access_token(
        db,
        connection,
        "zoho_books",
    )
    configured_domain = str(config.get("api_domain") or "").strip()
    if not configured_domain:
        configured_domain = require_provider_url(
            "ZOHO_BOOKS_API_BASE_URL"
        )
    try:
        api_domain = normalize_zoho_books_api_domain(configured_domain)
    except OAuthProviderUnavailable as error:
        raise ConnectorUnavailable(str(error)) from error

    resource_path, response_key = ZOHO_BOOKS_RESOURCE_TYPES[resource_type]
    rows = []
    page = 1
    seen_pages = set()
    while True:
        if page in seen_pages:
            raise ConnectorUnavailable(
                "Zoho Books returned a repeated pagination page"
            )
        seen_pages.add(page)
        params = {
            "organization_id": organization_id,
            "page": str(page),
            "per_page": str(PAGE_SIZE),
        }
        if resource_type in ZOHO_BOOKS_DATE_FILTER_RESOURCES:
            if start_date is not None:
                params["date_start"] = start_date.isoformat()
            if end_date is not None:
                params["date_end"] = end_date.isoformat()
        payload = connector_json_request(
            f"{api_domain}/books/v3/{resource_path}?{urlencode(params)}",
            headers={
                "Authorization": f"Zoho-oauthtoken {access_token}",
            },
        )
        records = payload.get(response_key)
        if not isinstance(records, list):
            raise ConnectorUnavailable(
                "Zoho Books returned an invalid "
                f"{resource_type} response"
            )
        for record in records:
            if not isinstance(record, dict):
                continue
            rows.append(
                build_dynamic_connector_row(
                    record,
                    build_zoho_books_normalized_fields(
                        record,
                        resource_type,
                    ),
                    flatten_lists=True,
                )
            )

        page_context = payload.get("page_context")
        if isinstance(page_context, list):
            page_context = (
                page_context[0]
                if page_context and isinstance(page_context[0], dict)
                else {}
            )
        if not isinstance(page_context, dict):
            page_context = {}
        has_more_page = page_context.get("has_more_page")
        if (
            not records
            or len(records) < PAGE_SIZE
            or has_more_page is False
            or str(has_more_page).lower() == "false"
        ):
            break
        page += 1

    dataframe = pd.DataFrame(rows)
    if resource_type in ZOHO_BOOKS_TRANSACTION_RESOURCES:
        dataframe = filter_date_range(
            dataframe,
            start_date,
            end_date,
        )
    return dataframe, {
        "connector": "zoho_books",
        "resource": resource_type,
        "object_type": resource_path,
        "organization_id": organization_id,
        "api_domain": api_domain,
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
            if source_type == "salesforce" and payload.get("instance_url"):
                refreshed_config = parse_connection_config(connection)
                refreshed_config["instance_url"] = validate_salesforce_instance_url(
                    payload.get("instance_url")
                )
                connection.connection_config = json.dumps(
                    refreshed_config,
                    sort_keys=True,
                )
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
    if "created_at" not in dataframe.columns:
        return dataframe
    dates = pd.to_datetime(
        dataframe["created_at"],
        errors="coerce",
        utc=True,
    )
    if not isinstance(dates, pd.Series) or dates.notna().sum() == 0:
        return dataframe
    mask = dates.notna()
    if start_date is not None:
        mask &= dates.dt.date >= start_date
    if end_date is not None:
        mask &= dates.dt.date <= end_date
    return dataframe.loc[mask].reset_index(drop=True)


def filter_xero_sync_date_range(
    dataframe: pd.DataFrame,
    start_date,
    end_date,
) -> pd.DataFrame:
    """Filter Xero transactions by change time, with a business-date fallback."""
    if dataframe.empty or (start_date is None and end_date is None):
        return dataframe

    date_column = "updated_at" if "updated_at" in dataframe.columns else "created_at"
    dates = pd.to_datetime(
        dataframe[date_column],
        errors="coerce",
        utc=True,
    )
    if not isinstance(dates, pd.Series) or dates.notna().sum() == 0:
        return dataframe

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
