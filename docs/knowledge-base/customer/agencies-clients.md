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
owner's email address automatically; no separate send action is needed. The
email names the agency and client workspace and links
to the sign-in page, not directly to the dashboard. The link keeps the invited
workspace as the destination after sign-in. The client signs in or creates an account with
the invited email address and verifies it. After sign-in, Decisionate accepts
the pending invitation and opens the client workspace, not a new personal
workspace. A client owner or client user signing in without the invitation link
also defaults to their client workspace unless they already selected another
accessible client workspace. If the browser is already signed in to an account
without access to the invited workspace, the link returns to Sign in with a
Use invited account action. That action signs out the current account and opens
login while keeping the invited workspace as the destination. It does not grant
access to the wrong account or automatically sign anyone out merely for opening
the link.

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

Before the client owner accepts their invitation, the agency owner can pause,
resume or delete the unused client workspace in Settings > Client Workspaces.
Pausing preserves its data and schedules but blocks access and background work.
Deletion requires typing the workspace name and permanently removes its data.

After the client accepts, the workspace belongs to that client owner. The agency
can still pause and resume the client workspace while it manages that client.
Only the managing agency owner can resume an agency-paused workspace; the client
owner and other client users cannot override that pause. The paused notice asks
the client to contact their agency. Pausing preserves data and billing settings
but blocks data access and background work. The agency can manage this status
without being granted access to the client's data.

The agency cannot delete an accepted client's workspace, remove its owner or
take over member management. It sees Remove from agency instead. That action removes the
workspace from the agency's list and ends the agency's access and shared billing
for that workspace. It does not delete datasets, reports, decisions, connections,
members or the workspace itself. Workspace IDs and data IDs stay unchanged.
An active import, report analysis or AI request must finish before removal.

The client owner can choose Delete workspace in their own Settings and type its
name to confirm permanent deletion. Other client users cannot do this. A direct
paid subscription must be canceled in Billing before deletion. Removing a client
frees its used agency slot; it does not automatically reduce purchased capacity,
refund the agency or cancel the agency's subscription.

## Continue after leaving an agency

The client owner can still open Settings and Billing after removal. Their data
is preserved while they choose how to continue. Data analysis, shared links and
background work wait until an independent plan or an agency relationship is active.

Start free trial opens the existing workspace with full Professional-trial access
for 30 days. It does not create a replacement workspace or move any data. Each
workspace can start this independent trial only once; joining and leaving agencies
does not reset it. After the trial, choose a plan in Billing to continue.

An agency owner can choose Add an existing client workspace in Settings and send
an invitation to the client's sign-in email. The same agency or a different agency
can do this. Sending the invitation alone grants no access. The verified client
owner opens Settings in their existing workspace and chooses Join agency or
Decline under Agency invitations. The agency needs an active Agency plan and an
available client slot when the owner accepts. A live independent paid subscription
must first be canceled in Billing to avoid overlapping subscriptions.

Joining preserves the same workspace and its records, uses the new agency's
billing and branding, and leaves agency data access off until the client owner
explicitly enables it. The former agency does not regain access merely because
its name remains in an older workspace ID or invitation link.

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
