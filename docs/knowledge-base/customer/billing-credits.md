# Billing, trials and AI credits

Billing shows the current workspace's subscription, available plan actions,
allowances and applicable prices. Use that page as the authority for your
account. Historical screenshots and static support articles do not establish
current prices, trial dates or entitlements.

## Which subscription plans are available?

There are four alternative plans, not a base plan plus white-label add-ons:

- Professional: one business workspace.
- Standard Branded Agency: agency and client workspaces in the Decisionate-branded application.
- White Label Subdomain Agency: agency workspaces and a branded portal at an address such as agency.decisionate.app.
- Custom Domain White Label Agency: a branded portal on the agency's own domain, such as analytics.agency.com.

Custom-domain signup is closed by default and can be opened later by the platform
administrator. Hosted-subdomain signup also depends on the platform's availability
switch and shared sign-in configuration. An unavailable plan cannot be activated just by
choosing it in a request. Standard Branded Agency does not include a white-label portal.

Platform Admin > Billing and AI credit pricing sets each plan's monthly and annual
amounts and matching recurring Stripe price IDs. The pricing page and Billing use
these saved values. Annual prices are the entire year's charge. New white-label
prices are unset until configured, not automatically free. Changes do not rewrite
existing Stripe subscriptions. Review the available plan-change options in Billing;
do not create a second subscription to change tiers.

## Subscription changes

An active paid period normally renews; its end date is not automatically an
expired subscription. A trial end, scheduled cancellation, incomplete checkout,
past-due renewal and an expired plan are different states. Review the displayed
status and the available billing action rather than assuming every date is a
deadline to delete data.

Use the provided checkout, portal, plan-change or cancellation controls as an
authorized workspace manager. An agency client's billing arrangement can differ
from an independently billed business workspace. Escalate disputed charges,
missing payments or unexpected entitlement changes without sending card details.

## What AI credits mean

Decisionate AI credits are internal usage units, not a one-to-one number of
provider tokens or provider billing credits. The application can enforce a
workspace allowance, reserve usage, record successful charges and provide
additional-credit options when configured.

Exhausted credits can cause rules-based fallback even when the platform AI
provider is configured. Conversely, buying credits does not make missing
provider credentials or a provider outage disappear. Check both the source
label and account allowance before concluding that an external AI model ran.

## After cancellation or expiry

Access and retention depend on the actual subscription state and approved
policies. Do not promise that every file is retained forever or deleted
immediately. Use authorized support for data export or deletion questions beyond
the self-service controls, and consult current Terms and Privacy notices.
