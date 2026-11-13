import type { WeeklyReportPreference } from "@/lib/api"

export function recipientEmails(value: string): string[] {
  return [...new Set(value.split(/[\n,;]+/).map(email => email.trim().toLowerCase()).filter(Boolean))]
}

export function deliveryValidation(preference: WeeklyReportPreference, recipients: string): string {
  const emails = recipientEmails(recipients)
  if (emails.some(email => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return "Enter a complete email address for each recipient."
  if (preference.enabled && !emails.length) return "Add at least one recipient before enabling scheduled email."
  if (preference.enabled && !preference.weekly_settings_configured && !preference.business_report_id && !preference.metric_focus.length && !preference.relationship_focus.length) {
    return "Preview and save a report in Weekly Reports before enabling scheduled email."
  }
  return ""
}

export function deliveryChanges(saved: WeeklyReportPreference, draft: WeeklyReportPreference, recipients: string): boolean {
  return saved.enabled !== draft.enabled || saved.delivery_day !== draft.delivery_day ||
    saved.include_recommendations !== draft.include_recommendations || saved.subject_prefix !== draft.subject_prefix ||
    JSON.stringify(saved.metric_targets) !== JSON.stringify(draft.metric_targets) ||
    JSON.stringify(saved.recipient_emails) !== JSON.stringify(recipientEmails(recipients))
}

export function deliveryStatus(status: string): string {
  return ({ sent: "Report sent", test_sent: "Test email sent", failed: "Report failed", test_failed: "Test email failed", skipped: "Not sent" } as Record<string, string>)[status] || "Status unavailable"
}
