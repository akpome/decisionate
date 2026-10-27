Decisionate business-change demo (synthetic)

These are fictional weekly store results, not real provider or customer data.
They include normal ups and downs, a yearly seasonal pattern, and three known
outcomes of an ongoing change on January 5, 2026.

Upload changed_store.csv and unchanged_store.csv as two datasets. Keep week as
the date column and choose weekly grouping. The report dates are January 1,
2024 through October 25, 2026. Enable Business has seasonal activity.

In Did my change help?, record an ongoing change such as adding a staff member.
Choose one changed-store metric as the result and comparison_orders from
unchanged_store.csv as the comparison. The comparison stayed unchanged in the
simulation and no competing event was introduced. Confirm these assumptions
only for this fictional example; real businesses must check their own context.

Run the cases separately, keeping More of this result as the goal:
- orders_helpful_change: true effect +30 orders per week after the change.
- orders_no_effect: true effect zero.
- orders_harmful_change: true effect -30 orders per week after the change.

There are 42 complete weeks after the change. The known total effects are
+1,260, zero, and -1,260 orders. A model estimates these values with uncertainty;
it is not expected to reproduce the exact totals from noisy data.

Generate the files again from the repository root:
python3 -B apps/api/demo_data/generate_impact_demo.py

This demo tests software behavior, not real-world causal identification.
