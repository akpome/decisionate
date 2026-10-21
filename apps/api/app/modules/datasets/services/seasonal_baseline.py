"""Validated calendar baselines shared by reports and forecasts."""

import warnings

import numpy as np
import pandas as pd
from statsmodels.robust.norms import HuberT
from statsmodels.robust.robust_linear_model import RLM
from statsmodels.robust.scale import mad
from statsmodels.tools.sm_exceptions import ConvergenceWarning


LOOKBACK_YEARS = 3
MIN_TRAIN = {"daily": 28, "weekly": 16, "monthly": 12, "quarterly": 8}
MIN_CALIBRATION = {"daily": 14, "weekly": 8, "monthly": 6, "quarterly": 4}
FREQUENCIES = {"daily": "D", "weekly": "W-MON", "monthly": "MS", "quarterly": "QS"}


def historical_start(anchor):
    return (pd.Timestamp(anchor) - pd.DateOffset(years=LOOKBACK_YEARS)).date().isoformat()


def _design(dates, origin, seasonalities, grain, weekdays):
    elapsed = np.asarray((dates - origin).days, dtype=float)
    trend = elapsed / 365.25
    if grain in {"monthly", "quarterly"}:
        trend = np.asarray(dates.year - origin.year) + np.asarray(dates.month - origin.month) / 12
    columns = [np.ones(len(dates)), trend]
    if "weekly" in seasonalities:
        columns.extend((np.asarray(dates.dayofweek) == weekday).astype(float) for weekday in weekdays[1:])
    if "annual" in seasonalities:
        # Calendar phase, rather than a fixed 365-day shift, handles leap years.
        phase = (np.asarray(dates.dayofyear) - 1) / np.where(dates.is_leap_year, 366, 365)
        harmonics = 3
        if grain in {"monthly", "quarterly"}:
            period = 12 if grain == "monthly" else 4
            phase = (np.asarray(dates.month) - 1) / 12
            harmonics = period // 2 - 1
        for harmonic in range(1, harmonics + 1):
            columns.extend([np.sin(2 * np.pi * harmonic * phase), np.cos(2 * np.pi * harmonic * phase)])
        if grain in {"monthly", "quarterly"}:
            columns.append(np.cos(2 * np.pi * (period // 2) * phase))
    return np.column_stack(columns)


def _supports(train, origin, grain, seasonalities):
    if len(train) < MIN_TRAIN[grain]:
        return False
    periods = pd.date_range(train.index.min(), origin, freq=FREQUENCIES[grain], inclusive="left")
    weekdays = sorted(train.index.dayofweek.unique())
    if grain == "daily":
        periods = periods[periods.dayofweek.isin(weekdays)]
    if not len(periods) or len(train) / len(periods) < .8:
        return False
    if (origin - train.index.max()).days > {"daily": 7, "weekly": 21, "monthly": 62, "quarterly": 185}[grain]:
        return False
    if "weekly" in seasonalities and (origin - train.index.min()).days < 56:
        return False
    if "annual" in seasonalities:
        if train.index.min() > origin - pd.DateOffset(years=2):
            return False
        minimum = {"daily": 2 * 52 * len(weekdays) * .8, "weekly": 84, "monthly": 24, "quarterly": 8}[grain]
        if len(train) < minimum:
            return False
    return True


def _fit_predict(train, target_dates, seasonalities, grain):
    if np.ptp(train.to_numpy()) == 0:
        return np.full(len(target_dates), train.iloc[0], dtype=float)
    origin = train.index.max()
    weekdays = sorted(train.index.dayofweek.unique())
    if "weekly" in seasonalities and not target_dates.dayofweek.isin(weekdays).all():
        raise ValueError("No preceding baseline for this weekday")
    design = _design(train.index, origin, seasonalities, grain, weekdays)
    target = _design(target_dates, origin, seasonalities, grain, weekdays)
    if len(train) <= design.shape[1] + 2 or np.linalg.matrix_rank(design) < design.shape[1]:
        raise ValueError("Insufficient independent observations for the baseline")
    # Scaling keeps large currency amounts and small rates numerically comparable.
    scale = max(float(np.median(np.abs(train.to_numpy()))), float(np.std(train.to_numpy())), 1e-12)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        warnings.filterwarnings("ignore", message=r"Estimated scale is 0\.0.*", category=ConvergenceWarning)
        result = RLM(train.to_numpy() / scale, design, M=HuberT()).fit(maxiter=25, conv="coefs", tol=1e-5)
    prediction = np.asarray(result.predict(target)) * scale
    if not np.isfinite(prediction).all():
        raise ValueError("Non-finite baseline prediction")
    return prediction


def _baseline(history, origin, grain, seasonal, horizon, floor, preferred=None):
    calibration_size = max(MIN_CALIBRATION[grain], 2 * horizon)
    if len(history) < MIN_TRAIN[grain] + calibration_size:
        return None
    calibration = history.iloc[-calibration_size:]
    folds = np.array_split(np.arange(len(calibration)), 2)
    candidates = [()]
    if seasonal:
        if grain == "daily":
            candidates.append(("weekly",))
        candidates.append(("annual",))
        if grain == "daily":
            candidates.append(("weekly", "annual"))
    fits = []
    for seasonalities in ([preferred[0]] if preferred else candidates):
        for recent_days in ([preferred[1]] if preferred else (None, 180)):
            if recent_days and "annual" in seasonalities:
                continue
            errors = []
            try:
                for fold in folds:
                    held_out = calibration.iloc[fold]
                    cutoff = held_out.index.min()
                    start = max(floor, cutoff - pd.Timedelta(days=recent_days)) if recent_days else floor
                    train = history.loc[(history.index >= start) & (history.index < cutoff)]
                    if not _supports(train, cutoff, grain, seasonalities):
                        raise ValueError("Insufficient history or coverage")
                    errors.extend(held_out.to_numpy() - _fit_predict(train, held_out.index, seasonalities, grain))
                errors = np.asarray(errors)
                loss = float(np.median(np.abs(errors)) + .2 * np.quantile(np.abs(errors), .9))
                fits.append((loss, seasonalities, recent_days, errors))
            except (ValueError, np.linalg.LinAlgError, ZeroDivisionError, FloatingPointError):
                continue
    if not fits:
        return None
    # Prefer simpler models unless seasonal terms improve held-out error by 10%.
    plain = min((item for item in fits if not item[1]), key=lambda item: item[0], default=None)
    best = min(fits, key=lambda item: (item[0], len(item[1])))
    if plain and best[1] and best[0] >= plain[0] * .9:
        best = plain
    _, seasonalities, recent_days, errors = best
    start = max(floor, origin - pd.Timedelta(days=recent_days)) if recent_days else floor
    train = history.loc[history.index >= start]
    if not _supports(train, origin, grain, seasonalities):
        return None
    center = float(np.median(errors))
    spread = float(mad(errors))
    method = "residual_mad"
    tolerance = max(np.finfo(float).eps * 100, float(np.median(np.abs(train.to_numpy()))) * 1e-8)
    if spread <= tolerance:
        spread = float(np.std(errors, ddof=1))
        method = "residual_standard_deviation"
    if spread <= tolerance:
        spread, method = 0., "constant_residual"
    return {"train": train, "seasonalities": seasonalities, "center": center,
            "configuration": (seasonalities, recent_days),
            "annual_validated": any("annual" in item[1] for item in fits),
            "spread": spread, "method": method, "tolerance": tolerance,
            "calibration_observations": len(errors), "validation_errors": errors,
            "candidate_count": len(fits)}
