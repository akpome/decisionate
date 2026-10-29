"""A bounded controlled interrupted time series, not automatic causal discovery."""

import math

import numpy as np
import pandas as pd
from statsmodels.regression.linear_model import OLS

from app.modules.correlation.engine import metric_id


ENGINE_VERSION = "controlled_change.v2"
MINIMUM_BEFORE = {"daily": 90, "weekly": 52, "monthly": 24}
MINIMUM_AFTER = {"daily": 28, "weekly": 8, "monthly": 6}


class ImpactUnavailable(ValueError):
    pass


def _end(periods, grain):
    return periods + {"daily": pd.offsets.Day(1), "weekly": pd.offsets.Day(7), "monthly": pd.offsets.MonthBegin(1)}[grain]


def _number(value):
    value = float(value)
    return value if math.isfinite(value) else None


def _fit(y, design, grain):
    # HAC handles short-range residual dependence; it does not remove confounding.
    lags = min({"daily": 14, "weekly": 4, "monthly": 2}[grain], max(1, len(y) // 5))
    return OLS(y, design, missing="raise").fit(cov_type="HAC", cov_kwds={"maxlags": lags, "use_correction": True}, use_t=True)


def _design(periods, comparison, before, grain, seasonal):
    scale = float(np.std(comparison[before]))
    time = (periods - periods[0]).days.to_numpy(dtype=float)
    columns = {"constant": np.ones(len(periods)), "time": time / max(float(time[before].max()), 1),
               "comparison": (comparison - np.mean(comparison[before])) / scale}
    if grain == "daily":
        for day in range(1, 7):
            columns[f"weekday_{day}"] = (periods.dayofweek == day).astype(float)
    if seasonal:
        for harmonic in (1, 2):
            angle = 2 * np.pi * harmonic * time / 365.2425
            columns[f"annual_sin_{harmonic}"] = np.sin(angle)
            columns[f"annual_cos_{harmonic}"] = np.cos(angle)
    return pd.DataFrame(columns, index=periods)


def _prediction_error(values, design, train_end, test_end, grain):
    training = design.iloc[:train_end]
    if np.linalg.matrix_rank(training) < training.shape[1] or np.linalg.cond(training) > 1e8:
        raise ImpactUnavailable("The earlier comparison does not support a stable baseline.")
    fit = _fit(values[:train_end], training, grain)
    predictions = np.asarray(fit.predict(design.iloc[train_end:test_end]))
    if not np.isfinite(predictions).all():
        raise ImpactUnavailable("The earlier comparison does not support a stable baseline.")
    return float(np.mean(np.abs(values[train_end:test_end] - predictions)))


def _baseline(periods, control, values, before, grain, selection_end):
    designs = {False: _design(periods, control, before, grain, False)}
    pre_periods, pre_y = periods[before], values[before]
    yearly_history = (_end(pre_periods, grain)[-1] - pre_periods[0]).days >= 728
    cuts = [int(selection_end * .7), int(selection_end * .85), selection_end]
    yearly_training = cuts[0] > 0 and (_end(pre_periods[:cuts[0]], grain)[-1] - pre_periods[0]).days >= 364
    details = {"selection_uses": "pre_action_only", "annual_history_available": bool(yearly_history),
               "selection_end": str(pre_periods[selection_end - 1].date()), "required_improvement": .15,
               "comparison_errors": [], "adjusted_errors": [], "annual_adjustment": False}
    # Reserve the last pre-action holdout for a separate reliability check.
    if yearly_history and yearly_training:
        designs[True] = _design(periods, control, before, grain, True)
        for seasonal, key in ((False, "comparison_errors"), (True, "adjusted_errors")):
            try:
                pre_x = designs[seasonal].loc[before]
                details[key] = [_prediction_error(pre_y, pre_x, start, end, grain)
                                for start, end in zip(cuts, cuts[1:])]
            except (ImpactUnavailable, ValueError, np.linalg.LinAlgError):
                details[key] = []
        plain, adjusted = details["comparison_errors"], details["adjusted_errors"]
        details["annual_adjustment"] = bool(plain and adjusted and
            np.mean(adjusted) <= np.mean(plain) * .85 and all(a <= p for p, a in zip(plain, adjusted)))
    seasonal = details["annual_adjustment"]
    baseline = {"kind": "comparison_with_yearly_adjustment" if seasonal else "comparison",
                "annual_adjustment": seasonal, "annual_history_available": bool(yearly_history),
                "message": "The comparison provides the expected baseline, with an extra yearly adjustment supported by earlier checks." if seasonal else
                           "The comparison's normal movement provides the expected baseline; earlier records were used to check its reliability."}
    return designs[seasonal], baseline, details


def _step_fit(values, design, after, grain):
    matrix = design.assign(change=after.astype(float))
    if np.linalg.matrix_rank(matrix) < matrix.shape[1] or np.linalg.cond(matrix) > 1e8:
        raise ImpactUnavailable("The comparison follows the change too closely to separate their effects. Choose a different comparison.")
    fitted = _fit(values, matrix, grain)
    if not np.isfinite(np.asarray(fitted.params)).all() or not np.isfinite(np.asarray(fitted.cov_params())).all():
        raise ImpactUnavailable("The comparison does not provide a stable estimate. Choose a different comparison.")
    return fitted, matrix


def _format(value, currency=None):
    unit = f"{currency} " if currency else ""
    return f"{unit}{value:,.2f}".rstrip("0").rstrip(".")


def evaluate_impact(series, definition, metadata):
    study = definition["impact"]
    outcome_id, comparison_id = metric_id(study["outcome"]), metric_id(study["comparison"])
    grain, window = definition["grain"], definition["date_range"]
    outcome, comparison = metadata.get(outcome_id), metadata.get(comparison_id)
    result = {"engine_version": ENGINE_VERSION, "method": "controlled_interrupted_time_series_hac",
              "status": "not_ready", "evidence_grade": "not_established", "change": study["change"],
              "change_date": study["change_date"], "window": window, "grain": grain,
              "outcome": outcome, "comparison": comparison, "comparison_reason": study["comparison_reason"],
              "headline": "We cannot tell whether this change helped yet.", "summary": "", "next_steps": [],
              "checks": [], "estimate": None, "trend": [], "baseline": None, "before_periods": None, "after_periods": None,
              "assumptions": ["The comparison was not affected by your change, including indirect effects.",
                              "No other event changed the result at the same time in a way the comparison cannot explain.",
                              "The earlier link between the result and comparison continued after the change.",
                              "This first version measures a lasting level change, not a one-day event or a gradually changing effect."],
              "limitations": ["This is an estimate from business records, not a randomized experiment or a guarantee of cause and effect.",
                              "The range allows for short-term ups and downs in the model, but not unknown events or a wrong comparison.",
                              "The range does not include every uncertainty from choosing the baseline.",
                              "Passing the checks cannot prove the comparison was unaffected or rule out every other explanation."]}

    def check(key, passed, message, details=None):
        result["checks"].append({"key": key, "passed": bool(passed), "message": message, "details": details or {}})

    def stop(message, next_step):
        result["summary"] = message
        result["next_steps"] = [next_step]
        return result

    confirmed = study["comparison_unaffected"] and study["other_changes"] == "none_known"
    check("business_context", confirmed, "Comparison and other business changes checked." if confirmed else "The comparison or other changes still need checking.")
    if not confirmed:
        return stop("We need an unaffected comparison and no known competing change before estimating the effect.",
                    "Check whether the change also affected the comparison, and whether a promotion, price change or other event happened at the same time.")
    if grain not in MINIMUM_BEFORE or outcome is None or comparison is None or outcome_id not in series or comparison_id not in series:
        return stop("The result or comparison is unavailable for this analysis.", "Choose available metrics from different datasets, grouped by day, week or month.")
    if outcome.get("currency_unresolved") or comparison.get("currency_unresolved"):
        return stop("One of the selected money amounts contains mixed or unknown currencies.", "Filter each dataset to one known currency before measuring the change. Currencies are not converted automatically.")
    periods = pd.date_range(pd.Timestamp(window["start"]).normalize(), pd.Timestamp(window["end"]).normalize(), freq="D")
    if grain == "weekly":
        periods = periods[periods.dayofweek == 0]
    elif grain == "monthly":
        periods = periods[periods.day == 1]
    ends = _end(periods, grain)
    change = pd.Timestamp(study["change_date"])
    before, after = ends <= change, periods >= change
    # Discard partial boundary periods and the bucket containing a mid-period change.
    keep = (ends <= pd.Timestamp(window["end"]) + pd.Timedelta(days=1)) & (before | after)
    periods, before, after = periods[keep], before[keep], after[keep]
    result.update(before_periods=int(before.sum()), after_periods=int(after.sum()))
    if before.sum() < MINIMUM_BEFORE[grain] or after.sum() < MINIMUM_AFTER[grain]:
        return stop(f"This comparison needs at least {MINIMUM_BEFORE[grain]} complete {grain} periods before the change and {MINIMUM_AFTER[grain]} after it. We have {int(before.sum())} before and {int(after.sum())} after.",
                    "Include more history before the change, and allow enough time after it. Partial weeks or months do not count.")
    joined = pd.DataFrame({key: points.set_index("period")["value"].reindex(periods) for key, points in series.items() if key in {outcome_id, comparison_id}})
    covered = np.isfinite(joined.to_numpy(dtype=float)).all()
    check("shared_dates", covered, "Both datasets cover every complete comparison period." if covered else "Some comparison periods are missing from one or both datasets.")
    if not covered:
        return stop("We cannot reliably measure the change because some dates are missing. Missing values have not been filled with zero.",
                    "Complete the missing history in both datasets or choose a fully covered date range.")
    values, control = joined[outcome_id].to_numpy(dtype=float), joined[comparison_id].to_numpy(dtype=float)
    if float(np.std(control[before])) <= max(1e-10, abs(float(np.mean(control[before]))) * 1e-10) or float(np.std(values[before])) < 1e-10:
        return stop("There is not enough earlier variation to check whether this comparison is useful.", "Choose a comparison with a meaningful, changing history before the business change.")
    count = int(before.sum())
    holdout = max(MINIMUM_AFTER[grain], count // 5)
    split = count - holdout
    try:
        design, baseline, baseline_details = _baseline(periods, control, values, before, grain, split)
        result["baseline"] = baseline
        if not baseline["annual_history_available"]:
            result["limitations"].append("There is less than two years of history before the action. Separate yearly differences cannot be checked reliably; the baseline relies on the comparison and the earlier history available.")
        pre_y, pre_x = values[before], design.loc[before]
        if np.linalg.matrix_rank(pre_x.iloc[:split]) < design.shape[1]:
            raise ImpactUnavailable("The earlier comparison is too repetitive to separate it from ordinary trends or seasons.")
        pre_fit = _fit(pre_y[:split], pre_x.iloc[:split], grain)
        predicted = np.asarray(pre_fit.predict(pre_x.iloc[split:]))
        error = float(np.mean(np.abs(pre_y[split:] - predicted)))
        baseline_error = float(np.mean(np.abs(pre_y[split:] - np.mean(pre_y[:split]))))
        without_comparison = _prediction_error(pre_y, pre_x.drop(columns="comparison"), split, count, grain)
        typical = max(float(np.mean(np.abs(pre_y))), float(np.std(pre_y)), 1e-10)
        useful = error <= typical * .25 and error <= baseline_error * .9 and error <= without_comparison * .9
        check("earlier_prediction", useful, "The comparison explained earlier business results reasonably well." if useful else "The comparison did not explain earlier business results well enough.",
              {"held_back_periods": holdout, "mean_absolute_error": error, "simple_baseline_error": baseline_error,
               "without_comparison_error": without_comparison,
               "maximum_relative_error": .25, "required_baseline_improvement": .1})
        check("seasonal_baseline", useful, baseline["message"] if useful else "The selected baseline did not pass the separate earlier-history check.", baseline_details)
        if not useful:
            return stop("Before your change, this comparison could not reliably explain the result. An impact estimate could be misleading.",
                        "Choose a better unaffected comparison, such as a similar location that did not make the change.")
        # An implausible historical effect is a warning, not evidence of a real intervention.
        placebo_passed, placebo_details = True, []
        for fraction in (.6, .75):
            fake_after = np.arange(count) >= int(count * fraction)
            placebo, _ = _step_fit(pre_y, pre_x, fake_after, grain)
            lower, upper = placebo.conf_int(alpha=.01).loc["change"]
            ok = lower <= 0 <= upper
            placebo_passed &= bool(ok)
            placebo_details.append({"date": str(pre_x.index[int(count * fraction)].date()), "effect": _number(placebo.params["change"]),
                                    "lower_99": _number(lower), "upper_99": _number(upper)})
        check("earlier_false_alarms", placebo_passed, "Earlier dates did not produce a clear false alarm." if placebo_passed else "The comparison found an apparent effect before the real change.", {"tests": placebo_details})
        if not placebo_passed:
            return stop("This comparison also suggests changes on earlier dates when your action had not happened. We are withholding the estimate.",
                        "Check earlier business changes or use a more stable comparison.")
        in_range = bool(((control[after] >= control[before].min() - np.std(control[before])) &
                         (control[after] <= control[before].max() + np.std(control[before]))).all())
        check("comparison_range", in_range, "The comparison stayed close to its earlier range." if in_range else "The comparison moved too far outside its earlier range.")
        if not in_range:
            return stop("The comparison changed too much after your action for a dependable estimate.", "Check what changed in the comparison, or select another unaffected comparison.")
        fitted, matrix = _step_fit(values, design, after, grain)
        effect = float(fitted.params["change"])
        lower, upper = map(float, fitted.conf_int(alpha=.05).loc["change"])
        trimmed = np.arange(len(periods)) >= count // 4
        sensitivity, _ = _step_fit(values[trimmed], design.loc[trimmed], after[trimmed], grain)
        alternate = float(sensitivity.params["change"])
        stable = abs(alternate - effect) <= max(2 * float(fitted.bse["change"]), abs(effect) * .5, typical * .02)
        check("history_sensitivity", stable, "The answer was similar when some older history was left out." if stable else "The answer changed too much when some older history was left out.",
              {"alternate_effect_per_period": alternate})
        if not stable:
            return stop("The estimated effect depends too heavily on which earlier dates we use. We are withholding the estimate.",
                        "Review earlier business changes and try a more stable comparison.")
    except ImpactUnavailable as error:
        return stop(str(error), "Try a different unaffected comparison or a longer, fully covered date range.")
    except (ValueError, np.linalg.LinAlgError):
        return stop("The available history does not support a stable calculation.", "Try a different unaffected comparison or a longer, fully covered date range.")
    if not all(math.isfinite(value) for value in (effect, lower, upper)):
        return stop("The available history does not support a stable estimate.", "Try a different unaffected comparison.")
    actual_mean = float(np.mean(values[after]))
    expected_mean = actual_mean - effect
    # Totals are only meaningful for approved additive metrics, not rates or balances.
    additive = outcome.get("additive", outcome["aggregation"] in {"sum", "count"})
    multiplier = int(after.sum()) if additive else 1
    amount, low, high = effect * multiplier, lower * multiplier, upper * multiplier
    desired = 1 if study["desired_direction"] == "increase" else -1
    favorable_low, favorable_high = (low, high) if desired == 1 else (-high, -low)
    verdict = "helped" if favorable_low > 0 else "hurt" if favorable_high < 0 else "unclear"
    worthwhile = study.get("worthwhile_change")
    meaningful = None if worthwhile is None else "likely" if favorable_low >= worthwhile and favorable_low > 0 else "unlikely" if favorable_high < worthwhile else "unclear"
    label = outcome["label"]
    currency = outcome.get("currency")
    change_word = "more" if amount >= 0 else "less"
    scope = "over the measured time after the change" if additive else "per measured period after the change"
    headline = {"helped": "Your change appears to have helped.", "hurt": "Your change appears to have worked against your goal.",
                "unclear": "It is not clear yet whether your change helped."}[verdict]
    summary = (f"We estimate {_format(abs(amount), currency)} {change_word} {label} {scope}, compared with what we would expect without the change. "
               f"The model's 95% range is {_format(low, currency)} to {_format(high, currency)}. ")
    summary += "The range includes no effect, so do not treat this as a confirmed improvement." if verdict == "unclear" else "This is a model-based estimate and depends on the comparison and business context you confirmed."
    next_step = {"helped": "Check the benefit against the full cost of the change before expanding it. A small controlled test can strengthen the evidence.",
                 "hurt": "Review the change and its costs before extending it. Check for another event the comparison did not capture.",
                 "unclear": "Do not increase your commitment based on this result alone. Collect more data or test the change in a small, comparable group."}[verdict]
    if meaningful == "unlikely":
        next_step = "The estimated benefit is below your minimum worthwhile improvement. Review the cost or try a different approach."
    expected = np.asarray(fitted.predict(matrix.assign(change=0)))
    if not np.isfinite(expected).all() or (np.all(values >= 0) and np.any(expected[after] < 0)):
        return stop("The comparison produced an unrealistic result without the change. We are withholding the estimate.", "Use a better unaffected comparison or a shorter, stable period after the change.")
    result.update(status="estimated", evidence_grade="model_estimated", headline=headline, summary=summary, next_steps=[next_step],
                  estimate={"effect": amount, "lower": low, "upper": high, "confidence_level": .95, "verdict": verdict,
                            "per_period_effect": effect, "actual": actual_mean * multiplier, "expected_without_change": expected_mean * multiplier,
                            "relative_percent": effect / abs(expected_mean) * 100 if expected_mean != 0 else None,
                            "is_total": additive, "worthwhile_change": worthwhile, "worthwhile_result": meaningful},
                  trend=[{"period": str(period.date()), "actual": float(actual), "without_change": float(prediction), "after_change": bool(is_after)}
                         for period, actual, prediction, is_after in zip(periods, values, expected, after)])
    return result


def impact_facts(analysis):
    return {key: value for key, value in analysis.items() if key != "trend"}


def is_impact_report(report):
    return bool(report.get("impact_analysis") or report.get("definition", {}).get("impact"))


def impact_lines(report):
    analysis = report.get("impact_analysis")
    if not analysis:
        return []
    return [analysis["headline"], f"Business change: {analysis['change']}. Date: {analysis['change_date']}.",
            f"Study dates: {analysis['window']['start']} to {analysis['window']['end']} ({analysis['grain']}).",
            analysis["summary"], *analysis["next_steps"], "Model-based evidence, not a randomized test. The comparison must be unaffected by the change."]
