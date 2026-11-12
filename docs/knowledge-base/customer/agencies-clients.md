# Agency and client workspaces

An agency workspace and its client workspaces are distinct data contexts.
Agency ownership does not imply unrestricted access to every client's data.
The client owner controls the agency-owner access supported by the application.

## Working with a client

Confirm that the client workspace exists, the client has accepted the appropriate
invitation and the required agency access has been granted. An authorized agency
owner can switch into that client's context for permitted analysis and decision
work. That context does not provide the client Data navigation for adding
datasets or connection parameters. Client owners normally work in their own
isolated workspace rather than an agency-wide workspace switcher.

Client users have the client-workspace data and analysis access supported for
their role. Granting agency-owner access remains a client-owner operation;
another client user or a support prompt cannot grant it implicitly.

## Invitations and first sign-in

Creating a client workspace in Settings sends an invitation to the client
owner's email address. The email names the agency and client workspace and links
to that workspace's sign-in page. The client signs in or creates an account with
the invited email address and verifies it. After sign-in, Decisionate accepts
the pending invitation and opens the client workspace, not a new personal
workspace. A client owner or client user signing in without the invitation link
also defaults to their client workspace unless they already selected another
accessible client workspace. An invitation link does not grant access to a
different signed-in account; switch to the invited account instead.

For an existing pending invitation, the agency owner can select the client under
Settings > Client Workspaces and choose Send invitation. Check the recipient's
inbox and spam folder before sending again. There is a one-minute wait between
send attempts. Revoking an invitation removes that pending access.

An email problem does not undo client workspace creation. If the screen says the
invitation email was not confirmed, keep the existing workspace and use Send
invitation; do not create the client again. Email sent means the email service
accepted the message, not that it reached the inbox. If sending or verified-email
lookup remains unavailable, contact support. A paused client must be resumed
before an invitation can be sent or accepted.

## Pause, resume or delete a client account

The agency workspace owner can manage their own clients in Settings under
Client Workspaces, without needing the client's permission to view their data.
Choose the client, then Pause account or Resume account. Pausing preserves the
client's data, members, invitations and saved schedules. It blocks workspace
access, shared dashboard links, automatic connector syncs and weekly reports.
Resuming restores access and allows saved schedules to run again. An import or
analysis that is queued or running must finish before pausing or deleting.

Delete Workspace requires typing the client's workspace name to confirm. It
permanently removes that workspace's data and access. It does not delete the
agency workspace or a person's access to other workspaces. Pausing or deleting a
client does not automatically change the agency subscription or purchased
workspace capacity. These actions are not available to agency team members or
client users.

## Branding

Reports emailed to agency-managed clients use the managing agency's configured
logo, brand name and colors when available. The footer retains Powered by
Decisionate. Emails to business and agency workspace owners use Decisionate's
logo. Missing agency branding should be corrected in authorized settings, not
replaced by a fabricated logo or an unrelated workspace's identity.

An agency logo does not mean the message is sent from the agency's domain.
Client weekly reports use the platform sender address and an agency-specific
display name. See Report email format and branding for the distinction.

## Escalation

For an access mismatch, share the intended workspace and the customer-safe error
through support. Do not include passwords, OAuth credentials or other clients'
records. The chatbot must not impersonate a client owner or silently change
access on the agency's behalf.
