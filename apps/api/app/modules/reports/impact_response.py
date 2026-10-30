"""Pre-action counterfactual predictions and correlated-error phase summaries."""

import math

import numpy as np
import pandas as pd
from scipy.stats import t
from statsmodels.stats.sandwich_covariance import weights_bartlett
from statsmodels.tsa.stattools import acovf

from .impact_timing import response_date


def timed_response(values, design, before, after, grain, timing, change_date, additive, fit):
    training = design.loc[before]
    if np.linalg.matrix_rank(training) < training.shape[1] or np.linalg.cond(training) > 1e8:
        raise ValueError("Unstable earlier baseline")
    model = fit(values[before], training, grain)
    expected = np.asarray(model.predict(design))
    if not np.isfinite(expected).all() or not np.isfinite(np.asarray(model.cov_params())).all():
        raise ValueError("Nonfinite counterfactual")
    late_date = pd.Timestamp(response_date(change_date, timing["lag"], timing["grain"]))
    later = after & (design.index >= late_date)
    early = after & ~later
    count = int(before.sum())
    maximum = min({"daily": 14, "weekly": 4, "monthly": 2}[grain], max(1, count // 5))
    covariance = acovf(np.asarray(model.resid), adjusted=False, demean=True, fft=True, nlag=maximum)
    covariance *= count / model.df_resid
    covariance *= weights_bartlett(maximum)
    critical = float(t.ppf(.975, model.df_resid))

    def summarize(mask):
        observations = int(mask.sum())
        if not observations:
            return None
        weights = np.asarray(mask, dtype=float)
        if not additive:
            weights /= observations
        contrast = weights @ design.to_numpy()
        # Each phase needs uncertainty for the baseline and its correlated residual sum.
        parameter_variance = float(model.get_prediction(contrast.reshape(1, -1)).var_pred_mean[0])
        noise_variance = covariance[0] * float(weights @ weights)
        for lag in range(1, len(covariance)):
            noise_variance += 2 * covariance[lag] * float(weights[lag:] @ weights[:-lag])
        variance = float(parameter_variance + noise_variance)
        if not math.isfinite(variance) or variance < -1e-8:
            raise ValueError("Unstable prediction interval")
        error = critical * math.sqrt(max(0, variance))
        effect = float(weights @ (values - expected))
        selected = design.index[mask]
        last_end = selected[-1] + {"daily": pd.offsets.Day(1), "weekly": pd.offsets.Day(7), "monthly": pd.offsets.MonthBegin(1)}[grain]
        return {"effect": effect, "lower": effect - error, "upper": effect + error,
                "actual": float(weights @ values), "expected_without_change": float(weights @ expected),
                "observations": observations, "start": str(selected[0].date()), "end": str((last_end - pd.Timedelta(days=1)).date())}

    total = summarize(after)
    phases = [{"phase": name, **summary} for name, mask in (("early", early), ("later", later))
              if (summary := summarize(mask)) is not None]
    trimmed = np.flatnonzero(before)[count // 4:]
    alternate_design = design.iloc[trimmed]
    if np.linalg.matrix_rank(alternate_design) < alternate_design.shape[1] or np.linalg.cond(alternate_design) > 1e8:
        raise ValueError("Unstable trimmed baseline")
    alternate = fit(values[trimmed], alternate_design, grain)
    alternative = float(np.mean(values[after] - alternate.predict(design.loc[after])))
    per_period = float(np.mean(values[after] - expected[after]))
    denominator = int(after.sum()) if additive else 1
    uncertainty = (total["upper"] - total["lower"]) / (2 * critical * denominator)
    return {"total": total, "phases": phases, "expected": expected, "early": early, "later": later,
            "per_period_effect": per_period, "alternate_effect": alternative, "standard_error": uncertainty}
