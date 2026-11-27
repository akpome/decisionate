# Safe troubleshooting and support requests

Start with the active workspace, actual source coverage and the last confirmed
operation. A generic unavailable message is not proof of data loss, an expired
subscription, an AI failure or a connector permissions problem.

## Ask Decisionate

Open Help & Support and use Ask Decisionate for product guidance. You can
expand the cited documentation or open the relevant product page. Each answer
comes from a reviewed question and a documented answer, not generated text.

If it cannot confirm an answer, it says so. It may offer related questions
you can try, but does not present a loosely related guide as the answer.
Ask one question at a time or name the feature you want to use. Missing
documentation does not prove a feature is supported, unavailable or planned.
Human support can investigate missing details or live account issues.

Guidance questions are not sent to an AI provider. Do not include credentials or
private records. Ask Decisionate cannot inspect your account or datasets, access
GitHub, execute actions, or use business-analysis AI credits. The conversation
stays in the current page. Clear it, leave the page or switch workspaces to
start fresh. Usage limits can require you to wait.

Contact support opens the normal support form with the latest question for you
to review. It does not send an email automatically or attach the entire chat.

## Browse tool and workflow guides

In Help & Support, open Workflow guides and choose Browse all tool guides.
Use Search workflow guides or narrow Topic to find a task such as setting a
weekly target, comparing sales groups, or inviting a client. Expand a guide to
read its steps, examples and limits. Open page takes you to the relevant tool
when a link is shown. Your normal workspace permissions still apply.

These are the same reviewed guides Ask Decisionate cites. Browsing lets you
read every section, even when your particular question has no reviewed answer.

## Common checks

- No datasets: verify account/workspace and import status. A failed list request
  is different from a successful empty list. Retry the provided read control.
- No report-ready metrics: inspect the dataset, approved saved selection, date
  column and currency/policy warnings before selecting arbitrary fields.
- Insufficient relationship evidence: inspect real overlap, grouping, filters,
  variance and the observation count remaining after lagging.
- Anomaly not assessed: distinguish limited preceding history from no anomalies.
- Forecast unavailable: keep the selection and read seasonal/date/filter support
  warnings. A healthy Reports worker does not establish forecast availability.
- Save unconfirmed: preserve the draft and use recovery/verification controls.
  Do not repeatedly submit mutations or assume a failed response proves a failed
  save.
- Analysis queued or temporarily unavailable: preserve the selection, inspect
  progress and retry after recovery. Avoid creating many identical jobs.
- Email missing: confirm recipients and delivery history before resending. A
  completed scheduler request does not prove recipient delivery.

## Send a useful support request

Open Help & Support and choose Support, Bug report or Feature request. Provide
the affected page, action, expected result, actual message, approximate time and
whether the issue repeats. The authenticated workflow supplies account/workspace
context. A screenshot can help if it excludes private records and secrets.

Do not include passwords, tokens, API keys, card details or unrestricted source
payloads. Raw stack traces and provider logs belong in an authorized diagnostic
channel, not a customer-facing chatbot.

Suspected cross-workspace exposure, destructive mistakes, disputed payments or
persistent failures require human support. Guidance does not mean a chatbot has
already inspected the account, fixed the issue or changed a setting.
