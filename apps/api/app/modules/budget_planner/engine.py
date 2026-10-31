"""Bounded observational scenarios, using SciPy's constrained estimators/optimizer.

No attribution or causal effects are claimed. Time-based validation, residual
block resampling and sensitivity checks can withhold an allocation entirely.
"""
import numpy as np
from scipy.optimize import lsq_linear, minimize
from scipy.signal import lfilter

VERSION = "budget-scenarios-v1"
DECAYS = (0.0, 0.3, 0.6)


def baseline(periods, controls):
    time = np.asarray(periods, dtype=float)
    return np.column_stack([np.ones(len(time)), time / 156,
                            np.sin(2 * np.pi * time / 52.18), np.cos(2 * np.pi * time / 52.18), controls])


def exposure(spend, decay):
    return lfilter([1 - decay], [1, -decay], spend, axis=0)


def design(base, spend, scale, decay):
    return np.column_stack([base, np.log1p(exposure(spend, decay) / scale)])


def fit(x, y, count):
    # Regularize slopes, but not the intercept; media slopes cannot be negative.
    penalty = np.eye(x.shape[1]) * 0.01
    penalty[0, 0] = 0
    fitted = lsq_linear(np.vstack([x, penalty]), np.r_[y, np.zeros(x.shape[1])],
                        bounds=(np.r_[np.full(x.shape[1] - count, -np.inf), np.zeros(count)], np.inf))
    if not fitted.success:
        raise ValueError("The spending model could not be fitted reliably")
    return fitted.x


def allocate_cents(values, lower, upper, total):
    low, high = np.ceil(lower * 100 - 1e-6).astype(np.int64), np.floor(upper * 100 + 1e-6).astype(np.int64)
    cents = np.clip(np.floor(values * 100).astype(np.int64), low, high)
    target = round(total * 100)
    if np.any(low > high) or low.sum() > target or high.sum() < target:
        raise ValueError("The spending limits cannot be satisfied to the nearest cent")
    for _ in range(len(values) * 3):
        difference = target - int(cents.sum())
        if not difference:
            return cents / 100
        candidates = np.flatnonzero(cents < high) if difference > 0 else np.flatnonzero(cents > low)
        if not len(candidates):
            break
        index = candidates[np.argmax(values[candidates] * 100 - cents[candidates]) if difference > 0
                           else np.argmin(values[candidates] * 100 - cents[candidates])]
        cents[index] += min(difference, int(high[index] - cents[index])) if difference > 0 else max(difference, int(low[index] - cents[index]))
    raise ValueError("The budget cannot be allocated within these limits to the nearest cent")


def plan_matrix(spend, outcome, controls, periods, definition, *, gap_weeks=0):
    count, n = spend.shape[1], len(outcome)
    result = {"status": "needs_evidence", "checks": [], "allocations": [], "estimate": None,
              "engine_version": VERSION, "observations": n}
    def stop(message):
        result["checks"].append(message)
        return result
    if n < 104:
        return stop("At least 104 complete, matching weeks are needed. Add history; missing weeks are not treated as zero spending.")
    if np.any(spend < 0) or np.any(outcome < 0) or np.mean(outcome) <= 0:
        return stop("Use non-negative spending and a positive additive result such as sales or orders.")
    if np.any(np.mean(spend, axis=0) <= 0) or np.any(np.std(spend, axis=0) / np.maximum(np.mean(spend, axis=0), 1e-9) < .1):
        return stop("Each option needs a meaningful history of changing spend. Constant spending cannot reveal a spending response.")
    if np.any(np.abs(np.corrcoef(spend.T) - np.eye(count)) > .9):
        return stop("Some options move together too closely to separate their effects. Run a controlled test with independent changes.")

    if not all(np.isfinite(values).all() for values in (spend, outcome, controls)):
        return stop("Some records are missing or invalid. Complete the history before comparing budgets.")
    control_mean = controls.mean(axis=0)
    control_scale = np.maximum(controls.std(axis=0), 1e-9)
    base = baseline(periods, (controls - control_mean) / control_scale)
    scale = np.maximum(np.mean(spend, axis=0), 1e-9)
    yscale = np.mean(outcome[:n - 32])
    y = outcome / yscale
    candidates = []
    for decay in DECAYS:
        x = design(base, spend, scale, decay)
        errors, baseline_errors = [], []
        for split in (n - 32, n - 16):
            fold_base = baseline(periods, (controls - controls[:split].mean(axis=0)) / np.maximum(controls[:split].std(axis=0), 1e-9))
            fold_x = design(fold_base, spend, np.maximum(spend[:split].mean(axis=0), 1e-9), decay)
            coefficient = fit(fold_x[4:split], y[4:split], count)
            ordinary = np.linalg.lstsq(fold_base[4:split], y[4:split], rcond=None)[0]
            errors.extend((y[split:split + 16] - fold_x[split:split + 16] @ coefficient) ** 2)
            baseline_errors.extend((y[split:split + 16] - fold_base[split:split + 16] @ ordinary) ** 2)
        candidates.append((float(np.mean(errors)), float(np.mean(baseline_errors)), decay, x))
    candidates.sort(key=lambda item: item[0])
    error, base_error, decay, x = candidates[0]
    result["validation"] = {"held_out_weeks": 32, "relative_error": float(np.sqrt(error)),
                            "improvement_over_baseline": float(1 - error / max(base_error, 1e-12))}
    if np.sqrt(error) > .25 or error >= .9 * base_error:
        return stop("Spending does not explain later results reliably enough beyond normal trends and seasons. Collect better evidence or test a change.")
    if np.linalg.cond(x[4:]) > 1000:
        return stop("The spending and business-context data are too similar to separate reliably.")
    coef = fit(x[4:], y[4:], count)
    weeks, total = definition.weeks, definition.budget
    recent = np.mean(spend[-8:], axis=0) * weeks
    current = total * recent / recent.sum()
    lower = np.maximum(.8 * recent, [item.minimum or 0 for item in definition.options])
    upper = np.minimum(1.2 * recent, [item.maximum if item.maximum is not None else np.inf for item in definition.options])
    if np.any(lower > upper) or lower.sum() > total or upper.sum() < total:
        return stop("This budget or its limits fall outside the supported range. Keep spending within 20% of each option's recent weekly level, or collect evidence at the new level.")
    future_base = baseline(np.arange(periods[-1] + 1 + gap_weeks, periods[-1] + 1 + gap_weeks + weeks),
                           np.tile((controls[-8:].mean(axis=0) - control_mean) / control_scale, (weeks, 1)))
    def prediction(allocation, coefficient=coef, carryover=decay):
        future = np.tile(allocation / weeks, (weeks, 1))
        bridge = np.tile(spend[-8:].mean(axis=0), (gap_weeks, 1))
        transformed = np.log1p(exposure(np.vstack([spend, bridge, future]), carryover)[-weeks:] / scale)
        return float(np.sum(np.column_stack([future_base, transformed]) @ coefficient) * yscale)
    solution = minimize(lambda fractions: -prediction(fractions * total) / yscale, np.clip(current, lower, upper) / total,
                        method="SLSQP", bounds=list(zip(lower / total, upper / total)),
                        constraints=[{"type": "eq", "fun": lambda fractions: fractions.sum() - 1}],
                        options={"maxiter": 200, "ftol": 1e-10})
    if not solution.success:
        return stop("No feasible allocation was found within the spending limits.")
    try:
        proposed = allocate_cents(solution.x * total, lower, upper, total)
    except ValueError as error:
        return stop(str(error))
    current = allocate_cents(current, np.zeros(count), np.full(count, total), total)
    gain = prediction(proposed) - prediction(current)
    fitted = x @ coef
    residuals = y - fitted
    rng = np.random.default_rng(20261031)
    gains = []
    # Four-week residual blocks preserve some time dependence; this is not a
    # causal interval and excludes uncertainty about omitted business drivers.
    for _ in range(80):
        starts = rng.integers(4, n - 3, size=(n + 3) // 4)
        sampled = np.concatenate([residuals[start:start + 4] for start in starts])[:n]
        bootstrap = fit(x[4:], (fitted + sampled)[4:], count)
        gains.append(prediction(proposed, bootstrap) - prediction(current, bootstrap))
    low, high = np.quantile(gains, [.05, .95])
    sensitivity = []
    for alternative_error, _, alternative_decay, alternative_x in candidates:
        if alternative_error <= max(error * 1.15, 1e-9):
            alternative_coef = fit(alternative_x[4:], y[4:], count)
            sensitivity.append(prediction(proposed, alternative_coef, alternative_decay) - prediction(current, alternative_coef, alternative_decay))
    if gain <= 0 or low <= 0 or min(sensitivity) <= 0:
        return stop("The possible improvement is too uncertain to recommend moving money. Keep the current mix or run a measured test.")
    if not definition.comparable_spend_confirmed or not definition.business_context_confirmed:
        return stop("Confirm that spending options do not overlap, use the same currency, and that important business influences have been considered.")
    result.update(status="ready", allocations=[{"name": option.name, "current": float(current[i]),
                  "suggested": float(proposed[i]), "minimum": float(lower[i]), "maximum": float(upper[i]),
                  "reason": ("The model favors increasing this option within the budget and spending limits."
                             if proposed[i] > current[i] else "The model favors moving some of this budget to other options."
                             if proposed[i] < current[i] else "Keep this option at its current share of the budget.")}
                  for i, option in enumerate(definition.options)],
                  estimate={"additional_result": round(gain, 2), "lower": round(float(low), 2), "upper": round(float(high), 2)},
                  carryover=decay)
    result["checks"].append("The suggested mix improved the model estimate and passed the history, held-out accuracy and uncertainty checks.")
    return result
