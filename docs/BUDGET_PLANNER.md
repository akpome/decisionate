# Budget Planner

Route: `/dashboard/budget-planner`. API: `/api/v2/budget-plans`.
This is a bounded observational budget-scenario tool, not a causal attribution
engine, a replacement for an experiment, or automatic platform budget control.

## Data and computation

- One additive outcome, 2-6 monetary spending options, up to 3 independent
  additive context measures. Same-source options require disjoint values of
  the same dimension. All sources are separately aggregated, never raw-joined.
- Server-approved metric policies and existing dimension authorization are
  reused. Rates, balances, mixed known spending currencies, yearless dates,
  missing values and negative values are rejected. Currency-unknown spending
  requires the explicit common-currency attestation; it is not converted.
- Up to three years, at least 104 contiguous matching complete weeks; newest
  complete shared week no more than 14 days behind the last completed week.
  Daily input requires seven distinct dates; weekly input explicitly represents
  complete totals labeled by Monday. Missing periods are never zero-filled.
- SciPy constrained least squares fits nonnegative spending slopes to
  log-transformed geometric-carryover exposures. Baseline terms are an intercept,
  trend, annual sine/cosine and optional standardized context measures. Exposure
  scales use training data inside each validation fold. A small ridge penalty
  stabilizes coefficients without penalizing the intercept.
- Carryover candidates are 0, 0.3 and 0.6. Two 16-week forward validation folds
  compare against a no-spending baseline. Relative RMS error must be <=25%,
  with at least 10% lower squared error than baseline; ill-conditioned fits,
  nearly constant spend and pairwise spend correlations above 0.9 are withheld.
- SLSQP redistributes a fixed budget within explicit limits and +/-20% of each
  option's recent eight-week spending average scaled to the planning horizon.
  Integer-cent rounding preserves the total and limits, or withholds the plan.
- Four-week residual blocks, 80 refits and the 5th/95th percentiles provide a
  conditional model range. The lower improvement must be positive; similarly
  performing carryover alternatives must agree on the direction of improvement.
  This does not account for all model-selection or omitted-variable uncertainty.
- Baseline and suggested allocations use the same total budget. Future context
  stays at its eight-week mean; gaps before the start keep recent spending.
  The horizon is 1-13 weeks beginning on a Monday within the next four weeks.

The model's monotone, diminishing response assumption and fixed carryover
candidates are deliberately limited. It must not be advertised as Google
Meridian, experimental causal lift, a global optimum, inventory optimization,
or a validated guarantee of future profit. Regression tests with synthetic
data establish implementation behavior, not business validity on real accounts.

## Worker and persistence

`budget_plan` runs through the existing durable reports-analysis worker and its
isolated child, native-thread settings, queue limits, source fingerprints,
membership checks, timeouts and cancellation. No AI call or external write is
performed. No additional Railway variables or second worker are needed. Deploy
the API, existing analytics worker and web frontend from the same revision.
An older worker cannot execute the new job kind.

API startup imports the `BudgetPlan` model before the repository's existing
`Base.metadata.create_all` bootstrap. `budget_plans` stores an immutable result
and definition per successful explicitly saved job. Repeated saves are
idempotent; unsupported previews cannot save. Source revisions are checked
again before saving. The queue's seven-day completed-job expiry does not remove
saved plans. Dataset/workspace deletion removes their derived plans.

Decision creation requires write permission and an already saved plan. It uses
the existing decision creation path with idempotency, explicit action, expected
outcome and a review date after the horizon. Source/metric selections and the
full frozen budget context are retained as `evidence_kind=budget_plan`, never
misrepresented as verified correlation timing or an impact study. Deleting a
plan leaves its decision intact. Existing decision-impact eligibility is not
silently broadened by this feature.

## Verification

Backend: `test_budget_planner.py`, the budget child-process test in
`test_analysis_worker_subprocess.py`, report lifecycle tests and support
knowledge tests. Frontend: `budget-planner.test.mjs` and existing shared-selector
tests. Browser checks exercise dimension-valued options, preview, save and
decision creation at desktop and 390/320px widths with mocked HTTP responses.
They do not certify live Railway connectivity or the quality of real customer
budget estimates.

Approved customer guidance is in `docs/knowledge-base/customer/budget-planner.md`
and the generated customer corpus. The original advertising-allocation support
question has a retrieval regression test; chat does not access customer data.
