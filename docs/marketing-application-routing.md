# Marketing and application domain routing

## Audit and behavior

The same Next.js 16 project serves all three primary domains. Previously,
`app/page.tsx` always rendered the marketing page and `proxy.ts` skipped Clerk
for `/` on every hostname. Marketing sign-in and signup links were relative.
There were no hostname redirects or rewrites in `next.config.ts`.

The existing proxy now applies these rules to the primary product only:

| Request | Result |
| --- | --- |
| `https://decisionate.ca/` | Existing marketing page, without an auth requirement |
| `https://www.decisionate.ca/<path>?<query>` | 308 permanent redirect to the same path/query on `decisionate.ca` |
| `https://app.decisionate.ca/`, signed out | 307 redirect to `/sign-in` on the app domain |
| `https://app.decisionate.ca/`, signed in | 307 redirect to `/auth/redirect` on the app domain |
| Old auth, onboarding, dashboard or platform-admin paths on the apex | 307 redirect to the same path/query on the app domain |
| Protected paths on the app domain | Existing Clerk protection and workspace authorization |

The existing `/auth/redirect` resolver still chooses an authorized workspace,
onboarding or platform administration. The proxy never chooses a workspace or
grants access based on a hostname. App-root redirects are private and uncached.

Old invitation links with a valid absolute `redirect_url` on the previous host
are converted to safe relative application paths before crossing hosts. Workspace
IDs, checkout parameters and OAuth return parameters are preserved. External or
unsafe return destinations remain rejected by the existing auth flow.

Marketing navigation, trial buttons, footer and policy sign-in links explicitly
use `https://app.decisionate.ca/sign-in` and `/sign-up`. Authentication's internal
links, password recovery, logout and post-auth destinations remain relative to
the app host. Root routing does not capture API handlers, shared links or Clerk
callbacks. Static assets retain the existing proxy exclusions.

No backend code, application IDs, credentials, user records, subscriptions,
workspaces or connector registrations are changed. This does not add a Vercel
project or Clerk instance. The existing hosted-portal branch runs first;
`*.decisionate.app`, other custom hosts, previews and localhost do not receive
these primary-host redirects. Custom-domain white labeling is not enabled.

## Deployment requirements

### Vercel

At the time of this audit, `https://decisionate.ca/` returned an HTTP 308 to
`https://www.decisionate.ca/`. Remove that existing domain redirect **before
deploying** the proxy change; otherwise apex-to-www and www-to-apex form a loop.
Both apex and app must serve the project directly, not redirect to another host.

- Keep `decisionate.ca`, `www.decisionate.ca` and `app.decisionate.ca` assigned
  to this same project with valid HTTPS certificates.
- Remove any dashboard-level redirect from `decisionate.ca` to `www` or from
  `app.decisionate.ca` to the marketing host. Those would conflict with the proxy.
  A `www`-to-apex redirect is compatible; the proxy also implements it.
- Keep the current Clerk publishable/secret keys and Railway API URL. Do not set
  `NEXT_PUBLIC_PORTAL_ID` or create another backend application for the app host.
- If explicit Clerk route variables are used, keep them relative:
  `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in` and
  `NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up`. The existing provider/card props keep
  successful authentication at `/auth/redirect` and logout at `/sign-in`.

### Existing Clerk production instance

- Keep the same production instance, keys, Frontend API hostname and JWT issuer.
  Moving the UI to a subdomain does not require a new identity store.
- In the instance's application-path settings, point the application/home URL to
  `https://app.decisionate.ca`, sign-in to `https://app.decisionate.ca/sign-in`,
  and signup to `https://app.decisionate.ca/sign-up`.
- If a subdomain allowlist or allowed redirect origins is configured, include
  `app.decisionate.ca` / `https://app.decisionate.ca` as appropriate for that
  setting. Check that email-verification and password-recovery links use the
  intended application paths.
- Do not replace existing social-login callback URLs merely because the UI moved;
  keep the Clerk callback endpoints already configured with those providers.

Clerk documents shared production sessions across subdomains of a configured
root domain: [production deployment](https://clerk.com/docs/guides/development/deployment/production).
See [redirect URL configuration](https://clerk.com/docs/guides/development/customize-redirect-urls)
for the distinction between sign-in paths and post-auth destinations.

### Existing Railway settings, without changing hosting

The backend must recognize the app origin as the **existing** default application,
not as a white-label application. If it is not already allowed, add
`https://app.decisionate.ca` to the existing `CORS_ALLOWED_ORIGINS`, preserving
other approved origins. For example, the primary production entries are:

```dotenv
CORS_ALLOWED_ORIGINS=https://decisionate.ca,https://www.decisionate.ca,https://app.decisionate.ca
DECISIONATE_WEB_APP_URL=https://app.decisionate.ca
```

The second value makes new invitations, billing returns and worker-generated
application links point directly at the app. Keep API, scheduler and worker
references consistent. Old links still redirect through the compatibility rules.
Do not change `DECISIONATE_APPLICATIONS`, JWT issuer/JWKS, Stripe customer/price
IDs or connector credentials. Connector OAuth callbacks and Stripe webhooks stay
on their existing Railway endpoints. No Railway deployment settings were changed
by this repository patch.

## Verification

Automated frontend tests cover public/apex routing, permanent `www` redirects,
signed-in/out app-root routing, legacy links, invitation account switching,
private dashboard protection, callback/recovery route reachability, static-asset
exclusions, hosted-portal behavior and rendered marketing links. Authentication
states in these tests are mocked; they do not prove a live Clerk session works.

After deployment and configuration, verify in an incognito browser:

1. Apex landing page and `www` redirect, including a URL with query parameters.
2. App root while logged out; email/social sign-in; app root after signing in.
3. Signup, email verification, password recovery and logout to app `/sign-in`.
4. Direct authorized dashboard links and denial of an unauthorized workspace.
5. A client invitation, including switching from an unrelated signed-in account.
6. An existing connector OAuth round trip and Stripe's supported billing test
   procedures, including return links and signed webhooks.

Provider emails, live credentials, billing and third-party OAuth transactions
must be checked in the configured environment; do not report route tests as
completed live provider tests.
