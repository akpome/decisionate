"""Conservative lead suggestions shared by reports and saved relationships."""

import re
import warnings

import numpy as np
import pandas as pd


def dataset_role(metric):
    connector = str(metric.get("connector") or "").lower()
    label = str(metric.get("dataset_label") or "").lower()
    # Provider metadata takes precedence; recognize named uploaded exports too.
    text = connector if connector not in {"", "csv", "upload", "uploaded_csv", "file"} else label
    if re.search(r"(?:meta|facebook|google|microsoft|bing|tiktok|linkedin|pinterest)[ _-]*(?:ads|advertising)|marketing", text):
        return "marketing"
    if re.search(r"shopify|woocommerce|square|lightspeed|point.of.sale|(?:^|[ _.-])(?:pos|revenue|sales)(?:$|[ _.-])", text):
        return "sales"
    return None


def resolve_direction(left, right, aligned, *, maximum_lag, minimum_observations, grain="daily"):
    roles = dataset_role(left), dataset_role(right)
    if roles[0] != roles[1] and any(roles):
        left_leads = roles[0] == "marketing" or roles[1] == "sales"
        return {"direction": "a_leads_b" if left_leads else "b_leads_a",
                "source": "business_context", "message": "Suggested from the source: marketing leads and sales follows. This is a suggested order, not proof of an effect."}
    fallback = {"direction": None, "source": "not_established",
                "message": "The history does not establish a dependable leader. Showing the same-period relationship; you can choose a direction."}
    if maximum_lag < 1 or aligned.empty:
        return fallback
    values = aligned[["left_value", "right_value"]].replace([np.inf, -np.inf], np.nan)
    # Never compress gaps into adjacent periods. Test the longest uninterrupted block.
    groups = values.isna().any(axis=1).cumsum()
    blocks = [block for _, block in values.groupby(groups) if not block.dropna().empty]
    values = max((block.dropna() for block in blocks), key=len, default=values.iloc[:0])
    if len(values) < max(minimum_observations, 48):
        return fallback
    from statsmodels.tools.sm_exceptions import InfeasibleTestError

    try:
        from statsmodels.tsa.stattools import adfuller, grangercausalitytests
        from statsmodels.tsa.vector_ar.var_model import VAR

        changes = values.copy()
        dates = pd.DatetimeIndex(aligned.loc[changes.index, "period"])
        # Remove recurring calendar patterns before asking which series adds predictive information.
        calendars = {"daily": [(dates.dayofweek, 21), (dates.month, 730)],
                     "weekly": [(dates.isocalendar().week.to_numpy(), 156)],
                     "monthly": [(dates.month, 36)], "quarterly": [(dates.quarter, 12)]}.get(grain, [])
        for calendar, minimum in calendars:
            if len(changes) >= minimum:
                changes = changes - changes.groupby(calendar).transform("mean")
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            if any(changes[column].std() <= 1e-10 for column in changes):
                return fallback
            if any(adfuller(changes[column], autolag="AIC")[1] > .05 for column in changes):
                changes = changes.diff().dropna()
                if any(changes[column].std() <= 1e-10 or adfuller(changes[column], autolag="AIC")[1] > .05 for column in changes):
                    return fallback
            maximum = min(maximum_lag, (len(changes) // 2 - 2) // 3)
            if maximum < 1:
                return fallback
            # Select model complexity before testing directions, rather than
            # choosing whichever of many lag orders has the smallest p-value.
            order = int(VAR(changes).select_order(maxlags=maximum).selected_orders["bic"])
            if order < 1:
                return fallback
            checks = []
            for direction, columns in (("a_leads_b", ["right_value", "left_value"]), ("b_leads_a", ["left_value", "right_value"])):
                result = grangercausalitytests(changes[columns], [order])[order]
                checks.append((float(result[0]["ssr_ftest"][1]), direction, columns))
            # Correct for the two direction tests and confirm each in both halves.
            supported = []
            for p, direction, columns in checks:
                if p * len(checks) > .05:
                    continue
                halves = np.array_split(changes[columns].to_numpy(), 2)
                if all(grangercausalitytests(half, [order])[order][0]["ssr_ftest"][1] <= .05 for half in halves):
                    supported.append((p, direction))
            if len({direction for _, direction in supported}) != 1:
                return fallback
        return {"direction": min(supported)[1], "source": "historical_timing",
                "message": "Suggested from historical timing, checked in earlier and later history. Timing is not proof of cause and effect."}
    except (ValueError, np.linalg.LinAlgError, InfeasibleTestError, ImportError):
        return fallback
