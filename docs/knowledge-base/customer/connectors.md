# Connector availability and setup

Use Connections to see the current deployment's connector catalog. A provider
appearing in the source registry does not prove that its integration is enabled,
authorized or usable for your account.

## What the catalog covers

Registry families include analytics and advertising, CRM, accounting, commerce,
payments, database queries and file uploads. Examples include Google Analytics,
Google Ads, Search Console, Meta Ads, Salesforce, HubSpot, Shopify, WooCommerce,
Square, Stripe, QuickBooks, FreshBooks, Sage, Xero, Zoho Books and Lightspeed
series, plus PostgreSQL, MySQL and SQL Server sources.

Lightspeed series are separate integrations, not interchangeable credentials or
schemas. The registry explicitly keeps Lightspeed K and O planned. Consult the
generated connector catalog for the exact registry inventory and Connections for
runtime availability. Do not infer availability from a marketing list or a
provider's own API documentation.

## Registry inventory

The reviewed registry contains these 27 source entries. This list includes file
and database sources; it is not a count of 27 enabled OAuth integrations.

| Family | Source entries |
| --- | --- |
| Files | CSV, Excel, JSON, Parquet |
| Databases | PostgreSQL, MySQL, SQL Server |
| Analytics | Google Analytics, Google Search Console |
| Advertising | Google Ads, Meta Ads |
| Other business sources | Google Business Profile, HubSpot, Salesforce Sales Cloud |
| Accounting | QuickBooks, FreshBooks, Sage Cloud Accounting, Xero, Zoho Books |
| Payments | Stripe, Square |
| Commerce | Shopify, WooCommerce, Lightspeed Retail R-Series, Lightspeed Retail X-Series |
| Restaurant | Lightspeed Restaurant K-Series, Lightspeed Restaurant O-Series |

Required configuration and actual availability remain source/deployment-specific.
K-Series and O-Series remain explicitly planned. A listed source does not prove
that its provider grants access to a particular customer's account.

## Connect safely

1. Choose a source actually available in Connections.
2. Provide the account, property, shop, company, tenant or object identifier
   requested for that connector. Use the provider account with appropriate access.
3. Complete authorization or enter credentials only in the designated controls.
4. Run the available connection/pull operation and inspect the resulting dataset.
5. Enable scheduled sync only after the manual result is correct.

Permissions, provider limits, regional support and available history can constrain
the result. A token refresh does not create new permissions or missing history.
If reauthorization is requested, use the connection's authorization workflow.

Never paste secrets into support chat. A chatbot should not guess provider API
versions, scopes or column names. A vendor-specific question not covered by the
reviewed source needs current official vendor documentation or human review.
