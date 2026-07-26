import os

from app.modules.datasets.services.file_loader import (
    get_dataset_file_source_dependencies,
    get_dataset_file_source_setup_note,
    is_dataset_file_source_available,
)


DATASET_SOURCES = [
    {
        "type": "csv",
        "label": "CSV",
        "category": "files",
        "status": "available",
        "connection_type": "upload",
        "sync_modes": ["manual"],
        "config_keys": [],
        "description": "Upload a CSV file from your computer.",
    },
    {
        "type": "excel",
        "label": "Excel",
        "category": "files",
        "status": "available",
        "connection_type": "upload",
        "sync_modes": ["manual"],
        "config_keys": [],
        "description": "Upload XLS or XLSX spreadsheets.",
    },
    {
        "type": "json",
        "label": "JSON",
        "category": "files",
        "status": "available",
        "connection_type": "upload",
        "sync_modes": ["manual"],
        "config_keys": [],
        "description": "Import structured JSON files and exports.",
    },
    {
        "type": "parquet",
        "label": "Parquet",
        "category": "files",
        "status": "available",
        "connection_type": "upload",
        "sync_modes": ["manual"],
        "config_keys": [],
        "description": "Import columnar Parquet data files.",
    },
    {
        "type": "google_drive",
        "label": "Google Drive",
        "category": "cloud_files",
        "status": "planned",
        "connection_type": "oauth",
        "sync_modes": ["manual", "scheduled"],
        "config_keys": ["folder_id", "file_id"],
        "description": (
            "Connect files stored in Google Drive. Folder and file IDs "
            "identify what to import; Google OAuth app credentials are added "
            "when configuring the connection."
        ),
    },
    {
        "type": "onedrive",
        "label": "OneDrive",
        "category": "cloud_files",
        "status": "planned",
        "connection_type": "oauth",
        "sync_modes": ["manual", "scheduled"],
        "config_keys": ["drive_id", "item_id"],
        "description": (
            "Connect files stored in Microsoft OneDrive. Drive and item IDs "
            "identify what to import; Microsoft OAuth app credentials are "
            "added when configuring the connection."
        ),
    },
    {
        "type": "shopify",
        "label": "Shopify",
        "category": "commerce",
        "status": "planned",
        "connection_type": "oauth",
        "sync_modes": ["manual", "scheduled", "webhook"],
        "config_keys": ["shop_domain"],
        "description": (
            "Connect store orders, products, and customer data. "
            "The shop domain identifies the store; OAuth app credentials "
            "are added when configuring the connection."
        ),
    },
    {
        "type": "stripe",
        "label": "Stripe",
        "category": "payments",
        "status": "planned",
        "connection_type": "api_key",
        "sync_modes": ["manual", "scheduled", "webhook"],
        "config_keys": ["account_id"],
        "description": (
            "Connect payments, customers, subscriptions, and invoices. "
            "The account ID identifies the Stripe account; API and webhook "
            "secrets are added when configuring the connection."
        ),
    },
    {
        "type": "quickbooks",
        "label": "QuickBooks",
        "category": "accounting",
        "status": "planned",
        "connection_type": "oauth",
        "sync_modes": ["manual", "scheduled"],
        "config_keys": ["company_id"],
        "description": (
            "Connect accounting, revenue, expense, and invoice data. "
            "The company ID identifies the QuickBooks company; OAuth app "
            "credentials are added when configuring the connection."
        ),
    },
    {
        "type": "freshbooks",
        "label": "FreshBooks",
        "category": "accounting",
        "status": "planned",
        "connection_type": "oauth",
        "sync_modes": ["manual", "scheduled"],
        "config_keys": ["account_id"],
        "description": (
            "Connect invoices, clients, payments, expenses, and time tracking "
            "data. The account ID identifies the FreshBooks account; OAuth app "
            "credentials are added when configuring the connection."
        ),
    },
    {
        "type": "xero",
        "label": "Xero",
        "category": "accounting",
        "status": "planned",
        "connection_type": "oauth",
        "sync_modes": ["manual", "scheduled"],
        "config_keys": ["tenant_id"],
        "description": (
            "Connect accounting, invoices, bills, contacts, payments, and "
            "cash flow data. The tenant ID identifies the Xero organization; "
            "OAuth app credentials are added when configuring the connection."
        ),
    },
    {
        "type": "google_analytics",
        "label": "Google Analytics",
        "category": "analytics",
        "status": "planned",
        "connection_type": "oauth",
        "sync_modes": ["manual", "scheduled"],
        "config_keys": ["property_id"],
        "description": (
            "Connect website and campaign performance data. The property ID "
            "identifies the analytics property; Google OAuth app credentials "
            "are added when configuring the connection."
        ),
    },
    {
        "type": "postgresql",
        "label": "PostgreSQL",
        "category": "databases",
        "status": "planned",
        "connection_type": "database",
        "sync_modes": ["manual", "scheduled"],
        "config_keys": ["connection_name", "query"],
        "description": (
            "Connect transactional PostgreSQL data for operational reporting. "
            "The connection name and query select the dataset; database "
            "credentials are added when configuring the connection."
        ),
    },
    {
        "type": "mysql",
        "label": "MySQL",
        "category": "databases",
        "status": "planned",
        "connection_type": "database",
        "sync_modes": ["manual", "scheduled"],
        "config_keys": ["connection_name", "query"],
        "description": (
            "Query operational data from MySQL databases. The connection name "
            "and query select the dataset; database credentials are managed "
            "by configuring the connection."
        ),
    },
    {
        "type": "sql_server",
        "label": "SQL Server",
        "category": "databases",
        "status": "planned",
        "connection_type": "database",
        "sync_modes": ["manual", "scheduled"],
        "config_keys": ["connection_name", "query"],
        "description": (
            "Query operational data from Microsoft SQL Server. The connection "
            "name and query select the dataset; database credentials are "
            "added when configuring the connection."
        ),
    },
    {
        "type": "snowflake",
        "label": "Snowflake",
        "category": "data_warehouses",
        "status": "planned",
        "connection_type": "data_warehouse",
        "sync_modes": ["manual", "scheduled"],
        "config_keys": ["warehouse", "database", "schema", "query"],
        "description": (
            "Query warehouse data from Snowflake. Warehouse, database, schema, "
            "and query identify the dataset; Snowflake account credentials "
            "are added when configuring the connection."
        ),
    },
    {
        "type": "bigquery",
        "label": "BigQuery",
        "category": "data_warehouses",
        "status": "planned",
        "connection_type": "data_warehouse",
        "sync_modes": ["manual", "scheduled"],
        "config_keys": ["project_id", "dataset", "query"],
        "description": (
            "Query warehouse data from Google BigQuery. Project, dataset, "
            "and query identify the dataset; service account credentials "
            "are added when configuring the connection."
        ),
    },
    {
        "type": "gcs",
        "label": "Google Cloud Storage",
        "category": "cloud_object_storage",
        "status": "planned",
        "connection_type": "object_storage",
        "sync_modes": ["manual", "scheduled"],
        "config_keys": ["bucket", "prefix", "file_pattern"],
        "description": (
            "Import CSV, JSON, Excel, or Parquet files stored in Google "
            "Cloud Storage. Bucket, prefix, and file pattern select the "
            "objects to import; service account credentials are added when "
            "configuring the connection."
        ),
    },
    {
        "type": "azure_blob_storage",
        "label": "Azure Blob Storage",
        "category": "cloud_object_storage",
        "status": "planned",
        "connection_type": "object_storage",
        "sync_modes": ["manual", "scheduled"],
        "config_keys": ["container", "path_prefix", "file_pattern"],
        "description": (
            "Import CSV, JSON, Excel, or Parquet files stored in Azure Blob "
            "Storage. Container, path prefix, and file pattern select the "
            "blobs to import; storage credentials are added when configuring "
            "the connection."
        ),
    },
    {
        "type": "s3",
        "label": "Amazon S3",
        "category": "cloud_object_storage",
        "status": "planned",
        "connection_type": "object_storage",
        "sync_modes": ["manual", "scheduled"],
        "config_keys": ["bucket", "prefix", "file_pattern"],
        "description": (
            "Import CSV, JSON, Excel, or Parquet files stored in Amazon S3. "
            "Bucket, prefix, and file pattern select the objects to import; "
            "AWS credentials are added when configuring the connection."
        ),
    },
    {
        "type": "crm",
        "label": "CRM",
        "category": "business_apps",
        "status": "planned",
        "connection_type": "oauth",
        "sync_modes": ["manual", "scheduled"],
        "config_keys": ["provider", "object_type"],
        "description": (
            "Connect sales and customer relationship data from supported CRM "
            "systems. Provider and object type select what records to import."
        ),
    },
    {
        "type": "hubspot",
        "label": "HubSpot",
        "category": "business_apps",
        "status": "planned",
        "connection_type": "oauth",
        "sync_modes": ["manual", "scheduled"],
        "config_keys": ["object_type"],
        "description": (
            "Connect SMB CRM contacts, companies, deals, and pipeline data. "
            "The object type identifies the HubSpot records to import; OAuth "
            "app credentials are added when configuring the connection."
        ),
    },
    {
        "type": "pipedrive",
        "label": "Pipedrive",
        "category": "business_apps",
        "status": "planned",
        "connection_type": "api_key",
        "sync_modes": ["manual", "scheduled"],
        "config_keys": ["object_type"],
        "description": (
            "Connect SMB sales pipeline, deals, people, and organization data. "
            "The object type identifies the Pipedrive records to import; API "
            "credentials are added when configuring the connection."
        ),
    },
    {
        "type": "mailchimp",
        "label": "Mailchimp",
        "category": "business_apps",
        "status": "planned",
        "connection_type": "api_key",
        "sync_modes": ["manual", "scheduled"],
        "config_keys": ["audience_id"],
        "description": (
            "Connect SMB email marketing audience, campaign, and engagement "
            "data. The audience ID identifies the Mailchimp list to import; "
            "API credentials are added when configuring the connection."
        ),
    },
    {
        "type": "marketing_platform",
        "label": "Marketing Platform",
        "category": "business_apps",
        "status": "planned",
        "connection_type": "oauth",
        "sync_modes": ["manual", "scheduled"],
        "config_keys": ["provider", "account_id"],
        "description": (
            "Connect campaign, audience, and channel performance from "
            "supported marketing platforms. Provider and account ID identify "
            "the source account."
        ),
    },
    {
        "type": "meta_ads",
        "label": "Meta Ads",
        "category": "business_apps",
        "status": "planned",
        "connection_type": "oauth",
        "sync_modes": ["manual", "scheduled"],
        "config_keys": ["ad_account_id"],
        "description": (
            "Connect Facebook and Instagram ad performance for SMB campaigns. "
            "The ad account ID identifies the Meta Ads account; OAuth app "
            "credentials are added when configuring the connection."
        ),
    },
    {
        "type": "rest_api",
        "label": "REST API",
        "category": "custom",
        "status": "planned",
        "connection_type": "api_key",
        "sync_modes": ["manual", "scheduled"],
        "config_keys": ["base_url", "endpoint", "method"],
        "description": (
            "Connect custom REST endpoints for operational data. Base URL, "
            "endpoint, and method define the import request; API credentials "
            "are added when configuring the connection."
        ),
    },
    {
        "type": "webhook",
        "label": "Webhook",
        "category": "custom",
        "status": "planned",
        "connection_type": "webhook",
        "sync_modes": ["webhook"],
        "config_keys": ["event_name"],
        "description": (
            "Receive event payloads from external systems through a signed "
            "Decisionate webhook endpoint."
        ),
    },
]


DATASET_SOURCE_ENV_KEYS = {
    "google_drive": [
        "GOOGLE_DRIVE_CLIENT_ID",
        "GOOGLE_DRIVE_CLIENT_SECRET",
    ],
    "onedrive": [
        "ONEDRIVE_CLIENT_ID",
        "ONEDRIVE_CLIENT_SECRET",
    ],
    "shopify": [
        "SHOPIFY_CLIENT_ID",
        "SHOPIFY_CLIENT_SECRET",
        "SHOPIFY_WEBHOOK_SECRET",
    ],
    "stripe": [
        "STRIPE_API_KEY",
        "STRIPE_WEBHOOK_SECRET",
    ],
    "quickbooks": [
        "QUICKBOOKS_CLIENT_ID",
        "QUICKBOOKS_CLIENT_SECRET",
    ],
    "freshbooks": [
        "FRESHBOOKS_CLIENT_ID",
        "FRESHBOOKS_CLIENT_SECRET",
    ],
    "xero": [
        "XERO_CLIENT_ID",
        "XERO_CLIENT_SECRET",
    ],
    "google_analytics": [
        "GOOGLE_ANALYTICS_CLIENT_ID",
        "GOOGLE_ANALYTICS_CLIENT_SECRET",
    ],
    "postgresql": [
        "POSTGRESQL_SOURCE_URL",
    ],
    "mysql": [
        "MYSQL_SOURCE_URL",
    ],
    "sql_server": [
        "SQL_SERVER_SOURCE_URL",
    ],
    "snowflake": [
        "SNOWFLAKE_ACCOUNT",
        "SNOWFLAKE_USER",
        "SNOWFLAKE_PASSWORD",
        "SNOWFLAKE_WAREHOUSE",
        "SNOWFLAKE_DATABASE",
        "SNOWFLAKE_SCHEMA",
    ],
    "bigquery": [
        "BIGQUERY_SOURCE_PROJECT_ID",
        "BIGQUERY_SOURCE_DATASET",
        "BIGQUERY_SOURCE_CREDENTIALS_JSON",
    ],
    "gcs": [
        "GCS_PROJECT_ID",
        "GCS_CREDENTIALS_JSON",
    ],
    "azure_blob_storage": [
        "AZURE_STORAGE_ACCOUNT_URL",
        "AZURE_STORAGE_CONNECTION_STRING",
    ],
    "s3": [
        "AWS_REGION",
        "AWS_ACCESS_KEY_ID",
        "AWS_SECRET_ACCESS_KEY",
    ],
    "crm": [
        "CRM_CLIENT_ID",
        "CRM_CLIENT_SECRET",
    ],
    "hubspot": [
        "HUBSPOT_CLIENT_ID",
        "HUBSPOT_CLIENT_SECRET",
    ],
    "pipedrive": [
        "PIPEDRIVE_API_TOKEN",
    ],
    "mailchimp": [
        "MAILCHIMP_API_KEY",
        "MAILCHIMP_SERVER_PREFIX",
    ],
    "marketing_platform": [
        "MARKETING_PLATFORM_CLIENT_ID",
        "MARKETING_PLATFORM_CLIENT_SECRET",
    ],
    "meta_ads": [
        "META_ADS_APP_ID",
        "META_ADS_APP_SECRET",
    ],
    "rest_api": [
        "CUSTOM_REST_API_BASE_URL",
        "CUSTOM_REST_API_KEY",
    ],
    "webhook": [
        "DATASET_WEBHOOK_SIGNING_SECRET",
    ],
}


def normalize_dataset_source_type(
    source_type,
):
    if not isinstance(
        source_type,
        str,
    ):
        return "csv"

    normalized_source_type = (
        source_type or "csv"
    ).strip().lower()

    return normalized_source_type or "csv"


def get_configured_env_keys(
    env_keys,
):
    return [
        env_key
        for env_key in env_keys
        if str(
            os.getenv(
                env_key,
                "",
            )
        ).strip()
    ]


def clone_dataset_source(source):
    cloned_source = {
        **source,
        "sync_modes": [
            *source["sync_modes"],
        ],
        "config_keys": [
            *source["config_keys"],
        ],
    }
    env_keys = DATASET_SOURCE_ENV_KEYS.get(
        source["type"],
        [],
    )

    if env_keys:
        configured_env_keys = get_configured_env_keys(
            env_keys
        )
        cloned_source["environment_keys"] = [
            *env_keys,
        ]
        cloned_source["environment_configured"] = (
            len(configured_env_keys)
            == len(env_keys)
        )
        cloned_source["configured_environment_keys"] = [
            *configured_env_keys,
        ]

    if (
        source["connection_type"] == "upload"
        and source["status"] == "available"
    ):
        dependencies = get_dataset_file_source_dependencies(
            source["type"]
        )

        if dependencies:
            cloned_source["optional_dependencies"] = dependencies

        if not is_dataset_file_source_available(
            source["type"]
        ):
            cloned_source["status"] = "needs_setup"
            cloned_source["availability_note"] = (
                get_dataset_file_source_setup_note(
                    source["type"]
                )
            )

    return cloned_source


def list_dataset_sources():
    return [
        clone_dataset_source(source)
        for source in DATASET_SOURCES
    ]


def get_dataset_source(source_type):
    normalized_source_type = normalize_dataset_source_type(
        source_type
    )

    for source in DATASET_SOURCES:
        if source["type"] == normalized_source_type:
            return clone_dataset_source(source)

    return None


def is_dataset_source_available(source_type):
    source = get_dataset_source(
        source_type
    )

    return bool(
        source
        and source["status"] == "available"
    )
