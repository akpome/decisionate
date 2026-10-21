"""Past-only, per-metric anomaly evidence for report snapshots and weekly mail."""

import numpy as np
import pandas as pd

from app.modules.datasets.services.seasonal_baseline import (
    LOOKBACK_YEARS, historical_start, _baseline, _fit_predict, _supports,
)


ENGINE_VERSION = "report_anomalies.v1"
THRESHOLD = 3.5


def _number(value):
    number = float(value)
    return number if np.isfinite(number) else None


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
