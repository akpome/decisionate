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
    "meta_ads": [
        "META_ADS_APP_ID",
        "META_ADS_APP_SECRET",
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
