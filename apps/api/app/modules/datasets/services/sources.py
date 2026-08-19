import os

from app.modules.datasets.services.file_loader import (
    get_dataset_file_source_dependencies,
    get_dataset_file_source_setup_note,
    is_dataset_file_source_available,
)
from app.modules.datasets.services.google_analytics import (
    is_google_analytics_connector_available,
)
from app.modules.oauth.service import (
    is_oauth_provider_configured,
)


IMPLEMENTED_CONNECTOR_TYPES = {
    "hubspot",
    "stripe",
    "shopify",
    "meta_ads",
    "quickbooks",
    "freshbooks",
    "sage",
    "xero",
    "postgresql",
    "mysql",
    "sql_server",
}
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
        "type": "google_analytics",
        "label": "Google Analytics",
        "category": "analytics",
        "status": "planned",
        "connection_type": "oauth",
        "sync_modes": ["manual", "scheduled"],
        "config_keys": ["property_id"],
        "description": (
            "Connect website and campaign performance data. The property ID "
            "identifies the analytics property; the API service account is "
            "configured on the Decisionate server."
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
            "Connect transactional PostgreSQL data for operational reporting."
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
            "Connect MySQL operational data for analysis and decision support."
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
            "Connect Microsoft SQL Server data for operational reporting."
        ),
    },
    {
        "type": "stripe",
        "label": "Stripe",
        "category": "payments",
        "status": "planned",
        "connection_type": "api_key",
        "sync_modes": ["manual", "scheduled"],
        "config_keys": ["account_id"],
        "description": (
            "Connect payments, subscriptions, customers, and invoices."
        ),
    },
    {
        "type": "shopify",
        "label": "Shopify",
        "category": "commerce",
        "status": "planned",
        "connection_type": "oauth",
        "sync_modes": ["manual", "scheduled"],
        "config_keys": ["shop_domain"],
        "description": (
            "Connect store orders, products, and customer data."
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
            "Connect accounting, revenue, expense, and invoice data."
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
            "Connect invoices, clients, payments, expenses, and time tracking."
        ),
    },
    {
        "type": "sage",
        "label": "Sage Cloud Accounting",
        "category": "accounting",
        "status": "planned",
        "connection_type": "oauth",
        "sync_modes": ["manual", "scheduled"],
        "config_keys": ["business_id"],
        "description": (
            "Connect Sage Cloud Accounting sales invoice data."
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
            "Connect Xero invoices, customers, payments, and accounting data."
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
            "Connect contacts, companies, deals, and sales pipeline data."
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
            "Connect Facebook and Instagram campaign performance data."
        ),
    },
]


DATASET_SOURCE_ENV_KEYS = {
    "postgresql": [
        "POSTGRESQL_SOURCE_URL",
    ],
    "mysql": [
        "MYSQL_SOURCE_URL",
    ],
    "sql_server": [
        "SQL_SERVER_SOURCE_URL",
    ],
    "stripe": [
        "STRIPE_API_KEY",
    ],
    "shopify": [
        "SHOPIFY_CLIENT_ID",
        "SHOPIFY_CLIENT_SECRET",
    ],
    "quickbooks": [
        "QUICKBOOKS_CLIENT_ID",
        "QUICKBOOKS_CLIENT_SECRET",
    ],
    "freshbooks": [
        "FRESHBOOKS_CLIENT_ID",
        "FRESHBOOKS_CLIENT_SECRET",
    ],
    "sage": [
        "SAGE_CLIENT_ID",
        "SAGE_CLIENT_SECRET",
        "SAGE_API_SUBSCRIPTION_KEY",
    ],
    "xero": [
        "XERO_CLIENT_ID",
        "XERO_CLIENT_SECRET",
    ],
    "hubspot": [
        "HUBSPOT_CLIENT_ID",
        "HUBSPOT_CLIENT_SECRET",
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
        configured_env_keys = [
            env_key
            for env_key in env_keys
            if str(os.getenv(env_key, "") or "").strip()
        ]
        cloned_source["environment_keys"] = [
            *env_keys,
        ]
        cloned_source["environment_configured"] = (
            len(configured_env_keys) == len(env_keys)
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

    if source["type"] == "google_analytics":
        if is_google_analytics_connector_available():
            cloned_source["status"] = "available"
        else:
            cloned_source["status"] = "needs_setup"
            cloned_source["availability_note"] = (
                "Install google-analytics-data and configure a server-side "
                "Google Analytics service account to enable manual sync."
            )

    if source["type"] == "hubspot":
        if is_oauth_provider_configured("hubspot"):
            cloned_source["status"] = "available"
        else:
            cloned_source["status"] = "needs_setup"
            cloned_source["availability_note"] = (
                "Configure HubSpot OAuth credentials and token encryption "
                "on the Decisionate server to enable sync."
            )

    if source["type"] == "stripe":
        if str(os.getenv("STRIPE_API_KEY", "") or "").strip():
            cloned_source["status"] = "available"
        else:
            cloned_source["status"] = "needs_setup"
            cloned_source["availability_note"] = (
                "Configure STRIPE_API_KEY on the Decisionate server to "
                "enable sync."
            )

    if source["type"] in {
        "shopify",
        "meta_ads",
        "quickbooks",
        "freshbooks",
        "xero",
    }:
        if is_oauth_provider_configured(source["type"]):
            cloned_source["status"] = "available"
        else:
            cloned_source["status"] = "needs_setup"
            cloned_source["availability_note"] = (
                f"Configure {source['label']} OAuth credentials and token "
                "encryption on the Decisionate server to enable sync."
            )

    if source["type"] == "sage":
        if (
            is_oauth_provider_configured("sage")
            and str(os.getenv("SAGE_API_SUBSCRIPTION_KEY", "") or "").strip()
        ):
            cloned_source["status"] = "available"
        else:
            cloned_source["status"] = "needs_setup"
            cloned_source["availability_note"] = (
                "Configure Sage OAuth credentials, the Sage API subscription "
                "key, and token encryption on the Decisionate server to "
                "enable sync."
            )

    database_environment_keys = {
        "postgresql": "POSTGRESQL_SOURCE_URL",
        "mysql": "MYSQL_SOURCE_URL",
        "sql_server": "SQL_SERVER_SOURCE_URL",
    }
    if source["type"] in database_environment_keys:
        environment_key = database_environment_keys[source["type"]]
        if str(os.getenv(environment_key, "") or "").strip():
            cloned_source["status"] = "available"
        else:
            cloned_source["status"] = "needs_setup"
            cloned_source["availability_note"] = (
                f"Configure {environment_key} on the Decisionate server "
                "before running a read-only query."
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
