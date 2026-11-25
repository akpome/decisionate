# Set up a branded workspace portal

## Can I offer a portal under my own brand?

Professional and Agency both include a branded portal on a decisionate.app
address. Professional hosts one business workspace for its owner and invited
team. Agency also supports separate client workspaces. Open Settings to
choose your address, save a draft, preview and publish. This uses the same
workspace, login and subscription you already have.

If Custom Domain White Label Agency is offered in Billing, its owner can open
Settings and choose Set up a custom-domain portal. This separate offering appears
only when the platform administrator enables it. New custom-domain setup is closed by
default. Availability depends on both commercial availability and the platform's
hosting and provider setup. If
the page says hosting setup is not available yet, contact support; entering brand
details does not activate an unavailable service. Ordinary client workspaces
cannot create a portal.

If new setup is closed, its plan and Settings link are hidden. Saved setup details
are preserved and existing live portals remain accessible. Contact support for
maintenance while setup is closed. This custom-domain workflow is separate from shared
agency.decisionate.app portals described below. Each offering has independent
availability; do not assume either is open for new customers.

## How do I set up my portal?

For Professional, open Settings and select Hosted portal settings under
Branding. Agency shows Hosted portal settings directly. Choose an available
subdomain, add your name, support email, logo, colors and welcome
message, then Save draft. Preview the portal and explicitly activate or publish
it. Contact support to change a reserved address. Invite your team through
Workspace Members. Agencies can also invite client workspace owners through
their existing client controls. You do not need your own Stripe or hosting account.

Only for the separately enabled custom-domain offering, follow these steps:
Save your brand name, portal domain, support email, legal-page links, billing
currency and prices. Your legal pages must be on your business website, outside
the portal domain. A logo is optional. Annual prices are the total yearly charge.
Connect your own live Stripe account through Stripe's authorization page, then
choose Prepare portal. Do not paste Stripe or other provider keys into the form
or support chat.

Add the displayed DNS records with your domain provider and choose Check setup
again. Domain and provider checks must pass before Launch portal is available.
Launch checks the services again before opening the portal. The portal starts
at sign-in and uses the existing product, not a newly designed marketing site.

## What happens if setup stops or DNS is still waiting?

Your saved setup and completed steps remain. Reopen setup and continue. DNS
updates and deployments can take time. A failed provider step can be retried;
contact support if it repeatedly fails. Refresh if another setup operation is
running. Do not repeatedly authorize different Stripe accounts to work around
a provider error.

## Do customers pay into my Stripe account?

The portal uses the connected Stripe account and the prices you saved, with
the existing plan types and trial rules. Stripe must confirm the account is
ready for charges and payouts before launch. This does not automatically move
existing Decisionate subscriptions or add a platform revenue-sharing scheme.

## What are the limits of hosted setup?

There is one portal per Agency owner. Details lock once Stripe is connected.
Changes to launched domains, prices or credentials, cleanup and transfers need
operator support. Existing workspaces are not moved to the new brand. Connector
provider approvals and OAuth application setup are separate; file uploads remain
available. The backend and infrastructure are shared, not a separate regional
data-residency deployment. Ask Decisionate can explain this workflow but cannot
inspect provider accounts, launch a portal or verify a live payment or email.

## How does a Decisionate-hosted agency portal differ?

A hosted agency portal uses an address such as agency.decisionate.app, the existing
agency workspace and Decisionate-managed authentication, billing and email. It does
not require your own Stripe, Resend or hosting accounts. It does not create another
copy of your clients or datasets. The custom-domain product above is different.

## Which subscriptions include hosted portals?

Choose Professional for a single business workspace or Agency for client
workspaces. The hosted address is included; there is no separate add-on.
The former Decisionate-branded Agency tier has been upgraded to this Agency plan
without deleting client workspaces or changing existing Stripe charges.
Its monthly and annual prices for new subscriptions are set
by the platform administrator. An eligible owner opens Settings and uses the
inline Hosted portal settings editor. No separate setup link is required. Start with the portal address and
branding. Normal trial, renewal,
cancellation and payment grace rules still apply. If plan access is inactive, use Billing to
restore it. If new portals are unavailable, contact support. Branding alone cannot
enable one before the platform is ready.

## What is the difference between workspace branding and hosted portal settings?

On Professional, open Settings > Branding. Choose Workspace branding for the
workspace name, logo, colors and report display name. Choose Hosted portal
settings for the decisionate.app address, welcome and sign-in branding, and
appearance of the published portal. Workspace branding is the first view when
you open Settings. Only the selected editor is visible. Switching editors
keeps the draft edits on the current Settings page; it does not save or publish
them, unpublish a portal, or change the subscription. Save workspace branding
or save and publish portal changes in the applicable editor.

The Agency plan shows the hosted portal editor directly. Team members and
client workspace users do not gain portal editing permissions from these
options.

## How do I brand and publish my hosted portal?

Professional and Agency owners can edit their own Hosted portal settings in the
main app or while signed in to their active portal. A team member or agency
client cannot change the owner's portal. Professional owners can still set
general Workspace branding separately. Agency and Custom Domain White Label
Agency plans use their own portal configuration instead.
Decisionate product-update preferences are not shown on hosted portals; this
does not disable invitations, alerts or weekly report emails.

Choose the subdomain, portal name, support email, logo, colors and welcome
message. Set one logo by entering its public HTTPS image URL in Logo URL or
choosing Upload logo. Uploads must be PNG, JPEG or WebP and can be up to 1 MB.
That same logo appears in the portal preview, sign-in screen and browser tab;
there is no separate browser-icon upload. Existing icon-only images are kept as
the logo when no logo was previously selected. Removing the logo clears that
image too. PNG or WebP can preserve a transparent background; JPEG cannot. The
previously distributed black-backed Decisionate JPEG is recognized and replaced
with its original transparent PNG, including in saved portal previews. Other
uploaded logos keep their original pixels and backgrounds.
Published colors apply to the signed-in hosted portal: primary for key actions
and navigation, accent for secondary highlights, and background for the area
behind workspace content. Decisionate adjusts the background and text colors as
needed for readability in light or dark mode. The logo and colors also appear in
the agency owner's own workspace on app.decisionate.ca without changing client
workspaces on the main app. Save draft does not change the live workspace. Use
Preview portal and Publish changes to apply the new branding. Other open tabs
may need a reload.
An optional background image can be up to 128 KB.
The subdomain field checks whether your chosen address is available. Names are
case-insensitive, and each address belongs to only one agency. Use 3-40 letters,
numbers or single hyphens; platform names such as app and support cannot be used.
Save draft reserves the address; checking availability alone does not reserve it.
If someone else reserves it first, choose another name. An address already reserved
by an agency stays unavailable to others, including while its portal is paused or
retired. After saving, the subdomain input is hidden. The saved portal address
remains visible with a copy control and, when active, an Open portal button.
Your saved address cannot then be renamed in this screen.
Preview desktop or mobile, then explicitly activate or publish. Draft changes are
not live until published. Reopen setup to continue. Publishing registers the portal's
sign-in domain with Clerk. If shared sign-in setup is unavailable, save the draft
and contact support. No manual hosting, sign-in or email verification switches are
needed; the portal still needs working HTTPS, authentication and delivery services.

If publishing fails, your draft and reserved address remain safe; the portal does
not open without verified sign-in setup. Follow the displayed reason. Temporary
service or rate-limit failures can be retried. Credential, account-permission or
sign-in-address verification problems require platform support, not another
subscription, a different subdomain or a new Clerk account. A subdomain-only
plan does not require custom-domain provisioning.
The publishing error may include a Reference naming the failed setup step.
Share that reference with platform support; it contains no API keys. A paid
Clerk plan alone does not confirm that the API server uses the correct instance
or has permission to create its domains. Do not disconnect a Clerk integration
or replace your production keys just to clear an unexplained error.

## How do team members and agency clients sign in?

The public portal welcome page offers Continue to sign in, not open registration.
People without a login should open their workspace invitation. Its sign-in page
offers Create your login; on a hosted welcome screen, continue with Continue to
sign up. Use the email address from the invitation and verify it. Clients who
already have an account sign in instead. Switching between sign-in and sign-up
preserves the invited workspace destination. A workspace address in a link is
not permission to join: the backend still requires the matching verified email
and a pending invitation or existing membership.

Credential entry, verification and password recovery use the existing secure
Decisionate account flow, then return to the branded portal. When opened from an
active agency portal, the credentials page uses that agency's published name and
logo, including its browser-tab icon. It still uses the shared secure sign-in
address; there is no separate login account or Clerk instance. Switching between
sign-in and sign-up retains the agency and invited workspace. Direct Decisionate
sign-ins retain Decisionate branding. This presentation does not change shared
verification emails or third-party identity-provider consent screens.
The portal's Continue button carries its return address in the first credentials
request, even if Clerk generates a plain primary sign-in URL. This lets the agency
name and published logo appear immediately instead of changing after page load.
After authentication, Clerk must share the signed-in session with the agency
portal before opening the workspace. The portal return link requests that sync;
it does not bypass sign-in or workspace permissions. A successful return opens the
authorized workspace or invitation destination, not the welcome screen again.
Clients need the
normal workspace invitation and permission; signup alone does not grant access,
create another workspace or enroll a client in a subscription.
Manage invitations in Settings. An invitation to attach an existing independent
workspace starts on the main application before that workspace joins the agency.

## What happens when Agency access ends or a client leaves?

There is no separate hosted subscription to cancel. Hosted access follows your
Professional or Agency plan. If the trial ends without an active paid
subscription, the hosted portal is removed and the address becomes available
for someone else to claim. The workspace itself is not deleted at trial expiry.
After subscribing, set up the portal again and choose the same address only if
it is still available. Continuing directly onto a paid plan keeps the portal.

For a paid plan, cancellation retains access through the end of the billing
period; expiry or the end of the payment grace period stops access. Agency pause
or platform suspension can also stop portal access. An unlinked client loses
agency portal access but keeps the main-app recovery options. Closing new setup
does not delete a live portal.
Ask Decisionate cannot confirm live billing/provider status; use Billing or contact
support.

## Why does my portal show Portal unavailable?

An unavailable hosted address shows a neutral page without workspace details.
If you already have a Decisionate account, use the sign-in link on the page to
sign in through Decisionate.ca. Otherwise, check the address or ask the workspace
owner who shared your link for help. The message
does not confirm whether an address is unregistered, access is paused or a service
is temporarily unavailable. Ask Decisionate cannot check the portal's live status.
