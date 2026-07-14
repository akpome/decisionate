import unittest

from fastapi import HTTPException

from app.modules.alerts.router import (
    clean_delivery_day,
    clean_metric_focus,
    clean_recipient_emails,
    require_weekly_report_manager,
)


class WeeklyReportPreferenceTests(unittest.TestCase):
    def test_clean_recipient_emails_normalizes_and_deduplicates(self):
        self.assertEqual(
            clean_recipient_emails(
                [
                    " Client@Example.com ",
                    "client@example.com",
                    "",
                    123,
                ]
            ),
            [
                "client@example.com",
            ],
        )

    def test_clean_recipient_emails_rejects_invalid_email(self):
        with self.assertRaises(
            HTTPException,
        ) as context:
            clean_recipient_emails(
                [
                    "not-an-email",
                ]
            )

        self.assertEqual(
            context.exception.status_code,
            400,
        )

    def test_clean_delivery_day_accepts_supported_weekdays(self):
        self.assertEqual(
            clean_delivery_day(
                " Monday ",
            ),
            "monday",
        )

    def test_clean_metric_focus_defaults_to_revenue_and_customers(self):
        self.assertEqual(
            clean_metric_focus(
                [
                    "unknown",
                ]
            ),
            [
                "revenue",
                "customers",
            ],
        )

    def test_client_cannot_change_weekly_report_setup(self):
        with self.assertRaises(
            HTTPException,
        ) as context:
            require_weekly_report_manager(
                "client",
            )

        self.assertEqual(
            context.exception.status_code,
            403,
        )


if __name__ == "__main__":
    unittest.main()
