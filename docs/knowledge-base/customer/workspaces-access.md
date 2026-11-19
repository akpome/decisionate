# Accounts, workspaces and access

A workspace is the boundary for datasets, connections, report evidence,
decisions, alert settings and AI context. Always check the workspace name before
analyzing data, changing settings or sharing a link.

Your email address is for signing in, invitations and notifications. A `usr_...`
value is the internal account reference, not a second login. Client workspace
references may also contain `:client:`; those identify workspaces, not people.
Production sign-in requires a verified email. When a Clerk login token omits it,
the API checks the account with Clerk rather than trusting a browser-supplied
email. Complete email verification before continuing if prompted.
Every production user account needs an email address. If an older account is
shown without an email, contact support to have an authorized administrator
recover its mapping. The same account ID and workspace data are preserved;
do not create a replacement account to work around the missing address.

## When someone leaves

Ask a full platform administrator to use **Platform Admin > People & access >
Users > Reassign email**. They enter the replacement's email, a reason and a
confirmation. The same account ID, workspaces, datasets, decisions and subscription
are retained. Previous sign-ins lose access; the replacement must use their own
sign-in and verify the new email. This transfers all access attached to that
account, not just one workspace. It does not merge an existing separate account
or transfer marketing consent. Protected and administrator accounts need
separate access review. Extra email recipients and public share links should
also be reviewed when an employee leaves.

## Roles and visibility

Workspace owners manage configuration such as members, connections and billing
where permitted. Members can analyze authorized data and work with decisions,
but do not receive owner configuration access merely by joining a workspace.
Client-workspace access and agency access have their own controls.

An owner adding someone who is not yet registered should send an email invitation.
Typing an unknown user reference does not create another account or grant access.

The API enforces access; showing a navigation item or knowing an object URL is
not sufficient authorization. A workspace owner is not automatically a platform
administrator. Platform Admin is an internal, separately authorized surface.

## Missing datasets or a restricted page

1. Confirm the account and active workspace are the intended ones.
2. Check whether the page is an owner configuration page or an analysis page.
3. Ask the workspace owner to review membership or an invitation if necessary.
4. If a previously accessible workspace disappears, report the page, time and
   expected access through Help & Support. Do not try another person's IDs.

Changing a URL, copying a dataset ID from another workspace, or asking a chatbot
to ignore access restrictions cannot grant access. If content from an unrelated
workspace appears, stop sharing or changing it and report a possible security
incident without distributing the exposed data.

## Workspace changes

Report and chart selections refer to the active workspace. An old browser tab
or bookmark may point to a different context. Switch using authorized controls
and reopen the relevant page rather than assuming an old link proves access.
