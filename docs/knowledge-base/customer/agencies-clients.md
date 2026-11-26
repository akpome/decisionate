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

In an active client workspace, the client owner can open Settings > Agency
connection and turn on Allow agency access. The managing agency owner can then
open the client workspace. Turn it off to revoke access without unlinking,
changing ownership, or changing billing. This is separate from Share workspace,
which invites an individual collaborator.

## Invitations and first sign-in

In Settings > Client Workspaces, enter the client workspace name and Workspace
owner email, then choose Create and invite owner. This single action creates
the workspace and its owner invitation together and sends the invitation email
automatically; no separate invitation action is needed. The
email names the agency and client workspace and links
to the sign-in page, not directly to the dashboard. The link keeps the invited
workspace as the destination after sign-in. The client signs in or creates an account with
the invited email address and verifies it. After sign-in, Decisionate accepts
the pending invitation and opens the client workspace, not a new personal
workspace. A client owner or client user signing in without the invitation link
also defaults to their client workspace unless they already selected another
accessible workspace. An agency owner, team member, or client who signs in on
Decisionate is sent to the active branded portal for the workspace they open.
An unlinked workspace stays on Decisionate. On a hosted agency portal, an unrelated signed-in
session leads to Accept your invitation. Choose Continue to sign in if you
already have a login, or Create your login otherwise. If asked to continue,
that action signs out the previous session and opens the chosen form. On the
standard sign-in page, choose Use invited account if shown. Use the email that
received the invitation. Merely opening the invitation does not sign anyone
out or grant access to the current account.

Link an existing workspace is a separate, collapsed option for a client who
already owns a workspace. Invite to agency asks that owner to approve linking
their existing workspace; it is not a second step when creating a new one.
If the email is already tied to another workspace through ownership, membership
or a pending invitation, Decisionate blocks a new workspace or email invitation.
Use Link an existing workspace to reconnect a former client without deleting
their data. To replace a workspace instead, only its owner can delete it.

For an existing pending invitation, the agency owner can select the client under
Settings > Client Workspaces and choose Resend invitation, or Send invitation
when its email was not confirmed. Check the recipient's
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
owner and other client users cannot override that pause. A paused client owner
can choose Unlink agency, or contact the agency to resume access. Other client
users cannot unlink the workspace. Pausing preserves data and billing settings
but blocks data access and background work. The agency can manage this status
without being granted access to the client's data.

The agency cannot delete an accepted client's workspace, remove its owner or
take over member management. It sees Remove from agency instead. That action removes the
workspace from the agency's list and ends the agency's access and shared billing
for that workspace. It does not delete datasets, reports, decisions, connections,
members or the workspace itself. Workspace IDs and data IDs stay unchanged.
An active import, report analysis or AI request must finish before removal.

Manage client workspaces shows the current owner email, or the invited owner
and pending status before acceptance. Link an existing workspace is a separate
form for an owner who already has a workspace.

An active client owner can choose Share workspace in Settings to invite one
collaborator by email. The collaborator must verify the invited email before
getting access. The owner can resend or revoke a pending invitation and remove
an accepted collaborator. A pending invitation uses the same slot as an accepted
collaborator. Revoke it or remove current access before inviting another email.
Sharing does not give the collaborator ownership or
give the agency access to client data.

An active client owner can select Delete workspace in Settings without unlinking
first. While linked and paused, Unlink agency is the only available workspace action: deletion, trials,
direct subscription changes and analysis remain blocked. Unlinking requires confirmation,
removes the workspace from the agency's list and revokes its access without deleting data.
After unlinking, the owner can choose Delete workspace and type its name to confirm
permanent deletion, or continue independently with a trial or direct subscription.
Other client users and the agency cannot permanently delete an accepted workspace.
Deletion removes its data, connections, reports, decisions, matching records,
memberships, invitations and agency listing. The owner is signed out afterwards.
An app account with no remaining workspace or platform role is removed; shared
accounts and other workspaces are preserved. This does not delete the account
at the sign-in provider. Minimal email suppression and consent history is retained
to honor unsubscribe requests while email-provider cleanup is processed. A direct
paid subscription must be canceled in Billing before deletion. Removing a client
frees its used agency slot; it does not automatically reduce purchased capacity,
refund the agency or cancel the agency's subscription.
Queued imports and analyses are canceled as part of deletion. Work already running
must finish first; this protects against a worker recreating deleted data.

## Continue after leaving an agency

When the agency removes the client or the client chooses Unlink agency, the locked
workspace shows Client account unlinked and confirms that its data is preserved.
The notice offers the owner a link to review agency invitations in Settings.
An unlinked agency must send a new invitation, not simply resume the old account.
On a hosted agency portal, Open my workspace takes the client to Decisionate
sign-in and their own Settings. They cannot open an unlinked workspace through
the former agency's portal.
Limited client Settings shows Share workspace, Allow agency access, Unlink agency and Delete workspace
as allowed by the workspace status and the user's role. It does not show branding,
agency team management or email preferences. An unlinked owner reviews agency
invitations in Settings. Trial and direct subscription choices appear in Billing.
After independent Professional access is active, full workspace Settings is available.
The client owner can still open Settings and Billing. Their data
is preserved while they choose how to continue. Data analysis, shared links and
background work wait until an independent plan or an agency relationship is active.

Start free trial opens the existing workspace with full Professional-trial access
for 30 days. It does not create a replacement workspace or move any data. Each
workspace can start this independent trial only once; joining and leaving agencies
does not reset it. After the trial, choose a plan in Billing to continue.

An agency owner can choose Link an existing workspace in Settings and send
an invitation to the client's sign-in email. The same agency or a different agency
can do this. Sending the invitation alone grants no access. The verified client
owner opens Settings in their existing workspace and chooses Join agency or
Decline under Agency invitations. The agency needs an active Agency plan and an
available client slot when the owner accepts. A live independent paid subscription
must first be canceled in Billing to avoid overlapping subscriptions.

Joining preserves the same workspace and its records, uses the new agency's
billing and branding, and leaves agency data access off until the client owner
explicitly enables it. After accepting, the client returns to the agency's
branded portal if it is active. Without an active portal, the workspace stays on
Decisionate. The former agency does not regain access merely because
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
