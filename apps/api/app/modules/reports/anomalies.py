"""Past-only, per-metric anomaly evidence for report snapshots and weekly mail."""

import warnings

import numpy as np
import pandas as pd
from statsmodels.robust.norms import HuberT
from statsmodels.robust.robust_linear_model import RLM
from statsmodels.robust.scale import mad
from statsmodels.tools.sm_exceptions import ConvergenceWarning


ENGINE_VERSION = "report_anomalies.v1"
LOOKBACK_YEARS = 3
THRESHOLD = 3.5
MIN_TRAIN = {"daily": 28, "weekly": 16, "monthly": 12, "quarterly": 8}
MIN_CALIBRATION = {"daily": 14, "weekly": 8, "monthly": 6, "quarterly": 4}
FREQUENCIES = {"daily": "D", "weekly": "W-MON", "monthly": "MS", "quarterly": "QS"}


def historical_start(anchor):
    return (pd.Timestamp(anchor) - pd.DateOffset(years=LOOKBACK_YEARS)).date().isoformat()


def _number(value):
    number = float(value)
    return number if np.isfinite(number) else None


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
            "calibration_observations": len(errors)}


def detect_report_metric(points, descriptor, window, grain, seasonal=False, anchor=None):
    """Evaluate chronological blocks; no point trains its own block's baseline."""
    first, end = pd.Timestamp(window["start"]), pd.Timestamp(window["end"])
    values = points.set_index("period").value.sort_index()
    values = pd.to_numeric(values, errors="coerce").replace([np.inf, -np.inf], np.nan)
    targets = values.loc[(values.index >= first) & (values.index <= end)]
    partial_periods = False
    if grain != "daily" and not targets.empty:
        offset = {"weekly": pd.DateOffset(weeks=1), "monthly": pd.offsets.MonthBegin(1), "quarterly": pd.offsets.QuarterBegin(startingMonth=1)}[grain]
        complete = targets.index + offset - pd.Timedelta(days=1) <= end
        partial_periods = not complete.all() or (grain == "weekly" and first.dayofweek != 0) or (grain in {"monthly", "quarterly"} and first.day != 1) or (grain == "quarterly" and first.month not in {1, 4, 7, 10})
        targets = targets.loc[complete]
    available = targets.dropna()
    result = {"metric_id": descriptor["id"], "dataset_id": descriptor["dataset_id"],
              "dataset_label": descriptor["dataset_label"], "metric_key": descriptor["metric_key"],
              "label": descriptor["label"], "unit": descriptor.get("unit"), "currency": descriptor.get("currency"),
              "aggregation": descriptor.get("aggregation"), "grain": grain,
              "status": "insufficient_history", "seasonal_requested": seasonal,
              "seasonalities": [], "observations": len(available), "evaluated_observations": 0,
              "missing_observations": int(targets.isna().sum()), "anomaly_count": 0,
              "method": [], "history_window": {"start": historical_start(anchor or first), "end": str((first - pd.Timedelta(days=1)).date())},
              "anomalies": [], "warnings": [], "baselines": []}
    if partial_periods:
        result["warnings"].append("Partial calendar reporting periods are not compared with complete historical periods for anomaly detection.")
    if available.empty:
        result["status"] = "unavailable"
        result["warnings"].append("No usable observations in the reporting window.")
        return result
    if targets.isna().any():
        result["warnings"].append("Missing reporting periods are not treated as zero or scored as anomalies.")
    block_size = (7 if len(targets) <= 7 else 28) if grain == "daily" else 1
    seasonalities_used, methods = set(), set()
    annual_supported = False
    annual_limited = False
    preferred = None
    for offset in range(0, len(targets), block_size):
        block = targets.iloc[offset:offset + block_size].dropna()
        if block.empty:
            continue
        origin = targets.index[offset]
        floor = pd.Timestamp(historical_start(anchor or origin))
        history = values.loc[(values.index >= floor) & (values.index < origin)].dropna()
        if not _supports(history, origin, grain, ()):
            continue
        # Refit and recalibrate every block. Re-select the candidate family every
        # four long daily blocks to keep multi-year, many-metric reports bounded.
        reuse = preferred if grain == "daily" and block_size == 28 and offset // block_size % 4 else None
        baseline = _baseline(history, origin, grain, seasonal, block_size, floor, reuse)
        if baseline is None and reuse:
            baseline = _baseline(history, origin, grain, seasonal, block_size, floor)
        if baseline is None:
            annual_limited = True
            continue
        preferred = baseline["configuration"]
        annual_supported |= baseline["annual_validated"]
        annual_limited |= not baseline["annual_validated"]
        if "weekly" in baseline["seasonalities"]:
            block = block.loc[block.index.dayofweek.isin(baseline["train"].index.dayofweek.unique())]
            if block.empty:
                continue
        try:
            expected = _fit_predict(baseline["train"], block.index, baseline["seasonalities"], grain) + baseline["center"]
        except (ValueError, np.linalg.LinAlgError, ZeroDivisionError, FloatingPointError):
            continue
        half_width = max(THRESHOLD * baseline["spread"], baseline["tolerance"])
        residuals = block.to_numpy() - expected
        seasonalities_used.update(baseline["seasonalities"])
        methods.add(baseline["method"])
        result["evaluated_observations"] += len(block)
        result["baselines"].append({"start": str(block.index.min().date()), "end": str(block.index.max().date()),
            "history_start": str(baseline["train"].index.min().date()), "history_end": str(baseline["train"].index.max().date()),
            "observations": len(baseline["train"]), "calibration_observations": baseline["calibration_observations"],
            "seasonalities": list(baseline["seasonalities"]), "method": baseline["method"], "spread": _number(baseline["spread"])})
        for period, actual, prediction, residual in zip(block.index, block.to_numpy(), expected, residuals):
            if abs(residual) <= half_width:
                continue
            result["anomalies"].append({"period": str(period.date()), "value": _number(actual),
                "expected": _number(prediction), "lower": _number(prediction - half_width), "upper": _number(prediction + half_width),
                "deviation": _number(residual), "deviation_percent": _number(residual / abs(prediction) * 100) if abs(prediction) > baseline["tolerance"] else None,
                "score": _number(residual / baseline["spread"]) if baseline["spread"] > 0 else None,
                "direction": "high" if residual > 0 else "low", "seasonalities": list(baseline["seasonalities"])})
    result["seasonalities"], result["method"] = sorted(seasonalities_used), sorted(methods)
    result["anomaly_count"] = len(result["anomalies"])
    evaluated = result["evaluated_observations"]
    if evaluated:
        result["status"] = "ready" if evaluated == len(available) else "limited_history"
    if evaluated < len(available):
        result["warnings"].append(f"{len(available) - evaluated} observations could not be assessed: insufficient preceding history, coverage or past-only validation.")
    if seasonal:
        if not annual_supported or annual_limited:
            result["warnings"].append("Annual seasonality could not be validated for some or all reporting periods: at least two preceding annual cycles plus validation history and adequate coverage are required.")
        if evaluated and not seasonalities_used:
            result["warnings"].append("Seasonal adjustment was not established by past-only validation; a trend-only baseline was used.")
    return result


def anomaly_summary(results, seasonal, window, anchor=None):
    return {"engine_version": ENGINE_VERSION, "lookback_years": LOOKBACK_YEARS,
            "seasonal_business": seasonal, "anchor_date": str(anchor) if anchor else None,
            "window": window, "threshold": THRESHOLD, "metrics": results,
            "anomaly_count": sum(item["anomaly_count"] for item in results),
            "limitations": ["Expected ranges are exploratory anomaly thresholds, not guaranteed confidence intervals or proof of a business cause.",
                "Only preceding observations inside the rolling three-year cap train each baseline; the assessed block is held out.",
                "Calendar-seasonal terms are used only when enabled and supported by past-only validation. Holidays and promotions are not automatically known.",
                "Seasonal patterns and variability can change; sparse history, structural changes and correlated errors can limit detection."]}
