# Meta App Review sign-in

Meta reviewers sign in with the dedicated review account's email and password.
To let them use a new browser without access to its inbox, an operator can
exempt that Clerk user from [Device Trust](https://clerk.com/docs/guides/protect/device-trust).
This does not apply to email-code sign-in, password resets, or enrolled MFA.
It does not change workspace access or affect other users.

1. In the Decisionate **production** Clerk instance, confirm that
   `meta_reviewer@decisionate.ca` belongs to the dedicated password-based review
   account. In Decisionate, verify it has access only to a demo workspace with
   synthetic data and no administrative privileges or live customer connections.
2. After deployment, run this once in the production **decisionate-api** Railway
   container. It uses the service's existing Clerk secret; do not copy that key
   into a browser, review notes, or chat.

   ```sh
   python /app/scripts/meta_reviewer_device_trust.py enable
   ```

   To run it from your terminal, use Railway's **Copy SSH Command** on
   the production service, then enter the command above. For a CLI already
   linked to the Decisionate project, the equivalent single command is:

   ```sh
   railway ssh --environment production --service decisionate-api python /app/scripts/meta_reviewer_device_trust.py enable
   ```

3. Confirm the command prints `Device Trust exception enabled`. In a fresh
   private browser window, sign in using the reviewer's **password**, not the
   email-code option. Verify the demo workspace opens without a new-device email.
   Share the unique password only through Meta's private reviewer instructions.

Use `status` instead of `enable` to inspect without changing anything. Use
`restore` when recurring review access is no longer needed, and **before**
changing the email or reassigning the account. The exception belongs to the
Clerk user, not to future accounts that may use the same email.

## If a code is still requested

Pushing this repository or deploying Decisionate does not set the exception.
Run the enable command and use `status` to confirm it is active on the production
reviewer. Status also reports whether that account has a password and enrolled
MFA. If Clerk requests an email code **before** the reviewer enters a password,
choose password sign-in instead; the exception does not replace an email code
used as the sign-in method. If a code is still required **after** a valid
password and the status confirms the exemption, check the sign-in event in
Clerk's production logs to identify the remaining check.
