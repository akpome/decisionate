export function relationshipDirectionOptions(left: string, right: string, t: (text: string) => string) {
  return [
    { value: "same_period", label: t("Same-period comparison only") },
    { value: "a_leads_b", label: t("{metric} leads").replace("{metric}", left) },
    { value: "b_leads_a", label: t("{metric} leads").replace("{metric}", right) },
  ] as const
}
