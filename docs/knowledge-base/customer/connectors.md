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

1. In Connections, open Connection sources and choose Add on the provider you need.
   This saves a connection and opens Configure added connections. Adding alone
   does not authorize the provider or create an imported dataset.
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

## How do I connect Google Business Profile?

In Connections > Connection sources, choose Add on Google Business Profile
when it is available. In Configure added connections, authorize a Google
account that manages the business locations you want to use. Select a location
offered for that account and sync. The dataset contains daily profile
performance such as website clicks and direction requests, not Google Ads or
Search Console data. Google must grant the app API access. If authorization or
locations are unavailable, check the connected Google account and provider
access rather than adding another connection.

## Which Lightspeed Retail connector should I choose?

In Connections > Connection sources, choose the series you actually use.
For R-Series, add Lightspeed Retail (R-Series), authorize it and supply the
retail account ID. For X-Series, add Lightspeed Retail (X-Series), enter your
store prefix, authorize it and choose the records to import. Finish in
Configure added connections and check the first synced dataset. Credentials,
identifiers and fields are not interchangeable across series. Restaurant
K-Series and O-Series are not enabled by either Retail connector.

## Where did my connector go after I added it?

Open Connections and choose Configure added connections. After a provider is
added successfully, its card disappears from Connection sources so you do not
add it twice. This is expected even if it still needs authorization.

1. Find the saved connection by name. Finish its account selection or
   authorization, then sync. If no rows arrive, check the account and date range
   before adding anything else.
2. Use the same saved connection to change its settings, sync again or remove
   it. Pausing automatic sync does not remove the connection from this tab.
3. After the last saved connection for that provider is removed, its card is
   available in Connection sources again. With no saved connections at all,
   the configuration tab is hidden. If adding failed, retry from the catalog
   after resolving the error. Switch workspaces only if you intended to manage
   a different workspace's connections.
