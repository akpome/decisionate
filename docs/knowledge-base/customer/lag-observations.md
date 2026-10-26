# Timing, direction and minimum observations

Lag is the number of grouped calendar periods by which one series is shifted
relative to another. A lag of 2 means two days with daily grouping, two weeks
with weekly grouping, two months with monthly grouping, or two quarters with
quarterly grouping. It is not automatically a two-day conversion delay.

## Set direction per pair

Leave Evaluate timing off for a same-period comparison. When timing is enabled,
choose which metric leads for each cross-dataset pair, or leave that pair at
Same-period comparison only. A metric can follow one metric and lead another;
there is no need to assign one global direction to the middle source.

The interface no longer offers Test both directions. Directional timing includes
lag zero and eligible positive lags up to the selected maximum of 12 periods.
The maximum is not a search of every day from 1 to 365. A pair left at
Same-period comparison only does not run positive-lag tests.

## Why one year can be insufficient

The default minimum is 24 matched observations, not 24 dates in the form. Twelve
monthly source points fail that threshold. Filtering, non-overlapping dates,
missing buckets and shifting for lag can reduce the usable pair further.
Constant or otherwise unsuitable series can prevent meaningful correlation even
when the nominal point count is large enough.

New report lag tests shift calendar buckets before dropping missing pairs. They
do not treat two neighboring surviving observations as adjacent calendar days
when dates between them were missing. Group more finely only if the source has
real observations at that finer frequency; do not manufacture history to pass a
threshold.

The best observed lag is a historical association under the selected tests.
Business timing knowledge should guide the hypothesis, and later independent
observations or an experiment should test it.
