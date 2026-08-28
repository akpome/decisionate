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
    "google_analytics",
    "hubspot",
    "stripe",
    "shopify",
    "meta_ads",
    "quickbooks",
    "freshbooks",
    "sage",
    "xero",
    "salesforce",
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
            "identifies the Analytics property. Authorize the Google account "
            "that has access to that property."
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
        "config_keys": ["api_key"],
        "description": (
            "Connect your Stripe account with a read-only restricted API key. "
            "No Stripe Connect relationship or account ID is required."
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
        "config_keys": [],
        "description": (
            "Connect QuickBooks invoice data."
        ),
    },
    {
        "type": "freshbooks",
        "label": "FreshBooks",
        "category": "accounting",
        "status": "planned",
        "connection_type": "oauth",
        "sync_modes": ["manual", "scheduled"],
        "config_keys": [],
        "description": (
            "Connect FreshBooks invoice data."
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
            "Connect Xero invoice data."
        ),
    },
    {
        "type": "hubspot",
        "label": "HubSpot",
        "category": "business_apps",
        "status": "planned",
        "connection_type": "oauth",
        "sync_modes": ["manual", "scheduled"],
        "config_keys": ["object_type", "properties"],
        "description": (
            "Connect contacts, companies, deals, and sales pipeline data."
        ),
    },
    {
        "type": "salesforce",
        "label": "Salesforce Sales Cloud",
        "category": "business_apps",
        "status": "planned",
        "connection_type": "oauth",
        "sync_modes": ["manual", "scheduled"],
        "config_keys": ["object_type"],
        "description": (
            "Connect one Sales Cloud object at a time. Accounts, leads, and "
            "opportunities are discovered with their available provider fields."
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
    "salesforce": [
        "SALESFORCE_CLIENT_ID",
        "SALESFORCE_CLIENT_SECRET",
    ],
    "google_analytics": [
        "GOOGLE_ANALYTICS_CLIENT_ID",
        "GOOGLE_ANALYTICS_CLIENT_SECRET",
    ],
    "meta_ads": [
        "META_ADS_APP_ID",
        "META_ADS_APP_SECRET",
    ],
}

# These settings are deliberately kept separate from environment_keys. The
# latter are credential fields shown in the connection editor; these are
# provider runtime settings and must remain deployment configuration.
DATASET_SOURCE_RUNTIME_ENV_KEYS = {
    "stripe": ["STRIPE_API_URL"],
    "shopify": [
        "SHOPIFY_API_VERSION",
        "SHOPIFY_API_BASE_URL_TEMPLATE",
    ],
    "quickbooks": [
        "QUICKBOOKS_API_BASE_URL",
        "QUICKBOOKS_API_VERSION",
    ],
    "freshbooks": [
        "FRESHBOOKS_API_BASE_URL_TEMPLATE",
        "FRESHBOOKS_IDENTITY_API_URL",
    ],
    "sage": [
        "SAGE_API_BASE_URL",
        "SAGE_BUSINESS_HEADER",
        "SAGE_OAUTH_TOKEN_URL",
    ],
    "hubspot": [
        "HUBSPOT_API_BASE_URL",
        "HUBSPOT_CRM_API_VERSION",
    ],
    "salesforce": [
        "SALESFORCE_API_VERSION",
    ],
    "meta_ads": [
        "META_ADS_API_BASE_URL",
        "META_ADS_GRAPH_VERSION",
        "META_ADS_TIME_INCREMENT",
    ],
    "xero": [
        "XERO_API_BASE_URL",
        "XERO_CONNECTIONS_API_URL",
    ],
    "google_analytics": [
        "GOOGLE_ANALYTICS_OAUTH_AUTHORIZATION_URL",
        "GOOGLE_ANALYTICS_OAUTH_TOKEN_URL",
        "GOOGLE_ANALYTICS_OAUTH_SCOPES",
    ],
}


def get_missing_provider_settings(source_type):
    return [
        key
        for key in DATASET_SOURCE_RUNTIME_ENV_KEYS.get(source_type, [])
        if not str(os.getenv(key, "") or "").strip()
    ]


def provider_setup_note(source_type, default_note):
    missing = get_missing_provider_settings(source_type)
    if not missing:
        return default_note
    return (
        f"{default_note} Missing provider setting(s): "
        f"{', '.join(missing)}."
    )


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

    runtime_env_keys = DATASET_SOURCE_RUNTIME_ENV_KEYS.get(
        source["type"],
        [],
    )
    if runtime_env_keys:
        missing_runtime_keys = get_missing_provider_settings(source["type"])
        cloned_source["provider_setting_keys"] = [
            *runtime_env_keys,
        ]
        cloned_source["missing_provider_setting_keys"] = [
            *missing_runtime_keys,
        ]
        cloned_source["provider_settings_configured"] = not bool(
            missing_runtime_keys
        )

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
                "Install the GA4 client and configure Google OAuth client "
                "credentials and token encryption to enable sync."
            )

    if source["type"] == "hubspot":
        if (
            is_oauth_provider_configured("hubspot")
            and not get_missing_provider_settings("hubspot")
        ):
            cloned_source["status"] = "available"
        else:
            cloned_source["status"] = "needs_setup"
            cloned_source["availability_note"] = (
                provider_setup_note(
                    "hubspot",
                    "Configure HubSpot OAuth credentials and token encryption "
                    "on the Decisionate server to enable sync.",
                )
            )

    if source["type"] == "stripe":
        if not get_missing_provider_settings("stripe"):
            cloned_source["status"] = "available"
        else:
            cloned_source["status"] = "needs_setup"
            cloned_source["availability_note"] = (
                provider_setup_note(
                    "stripe",
                    "Configure the Stripe API URL on the Decisionate server "
                    "to enable customer-provided key sync.",
                )
            )

    if source["type"] in {
        "shopify",
        "meta_ads",
        "quickbooks",
        "freshbooks",
        "xero",
        "salesforce",
    }:
        if (
            is_oauth_provider_configured(source["type"])
            and not get_missing_provider_settings(source["type"])
        ):
            cloned_source["status"] = "available"
        else:
            cloned_source["status"] = "needs_setup"
            cloned_source["availability_note"] = (
                provider_setup_note(
                    source["type"],
                    f"Configure {source['label']} OAuth credentials and token "
                    "encryption on the Decisionate server to enable sync.",
                )
            )

    if source["type"] == "sage":
        if (
            is_oauth_provider_configured("sage")
            and str(os.getenv("SAGE_API_SUBSCRIPTION_KEY", "") or "").strip()
            and not get_missing_provider_settings("sage")
        ):
            cloned_source["status"] = "available"
        else:
            cloned_source["status"] = "needs_setup"
            cloned_source["availability_note"] = (
                provider_setup_note(
                    "sage",
                    "Configure Sage OAuth credentials, the Sage API subscription "
                    "key, and token encryption on the Decisionate server to "
                    "enable sync.",
                )
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
