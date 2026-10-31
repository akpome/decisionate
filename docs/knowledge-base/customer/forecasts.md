# Forecast a selected metric

Forecasts estimates future values using observed source history. It is separate
from Business Analysis, which reviews evidence and relationships over historical periods.
A projection is not a commitment that the business will achieve that outcome.

## Generate a forecast

1. Open Forecasts and select the intended dataset and metric.
2. Review Date column beside Dimension column. Select Unique values if the
   forecast should cover a segment rather than all eligible rows.
3. Choose the history range, grouping and aggregation appropriate to the source.
4. Enable Business has seasonal activity when recurring calendar patterns matter.
5. Review the forecast, historical series, model basis, validation and warnings.

The forecast uses the selected date field and dimension filter. Dashboard period
defaults do not silently define a forecast's history. A filter can leave too
little history even when the unfiltered dataset looks large.

## Seasonal support and fallback

Seasonal candidates use a bounded history of up to three years and past-only
validation. Annual patterns need enough preceding cycles and coverage. Trend-only
or non-seasonal fallback can be appropriate when seasonal support is not
established. Read the stated basis rather than assuming the checkbox guarantees
a seasonal model or that a fallback has the same capabilities.

## Quality and unavailable results

Validation errors describe performance on the available held-out history, not a
guaranteed future error bound. Gaps, changing business conditions, source delays
and exceptional events can undermine a forecast. Do not infer promotions or
holidays that were not provided as facts.

An API that does not support a requested seasonal, date or dimension policy
should not silently satisfy it with a different calculation. Preserve the
selection, retry after a confirmed service recovery and escalate persistent
unavailability. Forecasts were not moved into the Reports analysis-worker queue;
healthy report-worker status alone does not verify forecasting.
