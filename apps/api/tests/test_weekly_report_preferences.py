import asyncio
import unittest
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import patch

import pandas as pd
from fastapi import HTTPException

from app.modules.alerts.schemas import (
    WeeklyReportDigestMetric,
    WeeklyReportDigestResponse,
    WeeklyReportAIAnalysis,
    WeeklyReportPreferenceResponse,
    WeeklyReportPreferenceUpdate,
)
from app.modules.alerts.email_delivery import (
    build_weekly_report_email_message,
    build_weekly_report_email_text,
    is_email_delivery_configured,
    send_weekly_report_email,
)
from app.modules.alerts.router import (
    build_weekly_report_digest,
    build_weekly_report_test_digest,
    clean_delivery_day,
    clean_metric_focus,
    clean_recipient_emails,
    get_weekly_report_delivery_config,
    require_alerts_scheduler_secret,
    require_weekly_report_manager,
    update_weekly_report_preference,
    validate_weekly_report_digest_for_delivery,
    was_weekly_report_sent_today,
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

    def test_clean_metric_focus_preserves_dataset_metric_names(self):
        self.assertEqual(
            clean_metric_focus(
                [
                    " Gross Revenue ",
                    "gross revenue",
                    "",
                    123,
                    "Customer_Count",
                ]
            ),
            [
                "Gross Revenue",
                "Customer_Count",
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

    def test_weekly_report_digest_uses_selected_dataset_metrics(self):
        preference = WeeklyReportPreferenceResponse(
            enabled=True,
            cadence="weekly",
            delivery_day="monday",
            recipient_emails=[
                "client@example.com",
            ],
            metric_focus=[
                "Gross Revenue",
            ],
            include_recommendations=True,
        )
        dataset = SimpleNamespace(
            id=42,
            file_name="sales.csv",
        )

        with patch(
            "app.modules.alerts.router.load_dataframe_from_dataset",
            return_value=pd.DataFrame({
                "Gross Revenue": [
                    10,
                    20,
                ],
                "Cost": [
                    4,
                    6,
                ],
            }),
        ):
            digest = build_weekly_report_digest(
                preference,
                [
                    dataset,
                ],
                brand_name="Acme Retail",
            )

        self.assertEqual(
            digest.recipient_emails,
            [
                "client@example.com",
            ],
        )
        self.assertEqual(
            digest.dataset_count,
            1,
        )
        self.assertEqual(
            len(digest.metrics),
            1,
        )
        self.assertEqual(
            digest.metrics[0].column,
            "Gross Revenue",
        )
        self.assertEqual(
            digest.metrics[0].total,
            30.0,
        )
        self.assertEqual(
            digest.brand_name,
            "Acme Retail",
        )
        self.assertTrue(
            digest.subject.startswith(
                "Acme Retail KPI digest",
            )
        )

    def test_email_delivery_configuration_requires_host_and_sender(self):
        with patch.dict(
            "os.environ",
            {
                "SMTP_HOST": "smtp.example.com",
                "SMTP_FROM_EMAIL": "reports@example.com",
            },
            clear=True,
        ):
            self.assertTrue(
                is_email_delivery_configured()
            )

        with patch.dict(
            "os.environ",
            {
                "SMTP_HOST": "smtp.example.com",
            },
            clear=True,
        ):
            self.assertFalse(
                is_email_delivery_configured()
            )

            self.assertTrue(
                is_email_delivery_configured(
                    "workspace@example.com",
                )
            )

            self.assertTrue(
                is_email_delivery_configured(
                    "workspace@example.com",
                    "smtp.workspace.example",
                )
            )

    def test_weekly_report_digest_applies_sender_details_and_subject_prefix(self):
        preference = WeeklyReportPreferenceResponse(
            enabled=True,
            cadence="weekly",
            delivery_day="monday",
            recipient_emails=[
                "client@example.com",
            ],
            metric_focus=[
                "Revenue",
            ],
            include_recommendations=True,
            sender_name="Agency Insights",
            sender_email="reports@agency.example",
            reply_to_email="success@agency.example",
            subject_prefix="[Client KPI]",
        )
        dataset = SimpleNamespace(
            id=7,
            file_name="sales.csv",
        )

        with patch(
            "app.modules.alerts.router.load_dataframe_from_dataset",
            return_value=pd.DataFrame({
                "Revenue": [
                    100,
                ],
            }),
        ):
            digest = build_weekly_report_digest(
                preference,
                [
                    dataset,
                ],
                brand_name="Acme Retail",
            )

        self.assertTrue(
            digest.subject.startswith(
                "[Client KPI] Acme Retail KPI digest",
            )
        )
        self.assertEqual(
            digest.sender_name,
            "Agency Insights",
        )
        self.assertEqual(
            digest.sender_email,
            "reports@agency.example",
        )
        self.assertEqual(
            digest.reply_to_email,
            "success@agency.example",
        )

    def test_weekly_report_test_digest_uses_recipients_without_metrics(self):
        preference = SimpleNamespace(
            enabled=1,
            cadence="weekly",
            delivery_day="monday",
            recipient_emails='["client@example.com"]',
            metric_focus="[]",
            include_recommendations=1,
            sender_name="Agency Insights",
            sender_email="reports@example.com",
            reply_to_email="success@example.com",
            subject_prefix="[KPI]",
            smtp_host="smtp.example.com",
            smtp_port=587,
            smtp_username="apikey",
            smtp_password="existing-secret",
            smtp_use_tls=1,
            smtp_use_ssl=0,
            last_sent_at=None,
            last_send_status=None,
            last_send_error=None,
        )

        digest = build_weekly_report_test_digest(
            preference,
            "Acme Retail",
        )

        self.assertEqual(
            digest.recipient_emails,
            [
                "client@example.com",
            ],
        )
        self.assertEqual(
            digest.metrics,
            [],
        )
        self.assertIn(
            "KPI email test",
            digest.subject,
        )
        self.assertEqual(
            digest.sender_email,
            "reports@example.com",
        )

    def test_weekly_report_email_text_contains_dataset_kpis(self):
        digest = WeeklyReportDigestResponse(
            enabled=True,
            cadence="weekly",
            delivery_day="monday",
            recipient_emails=[
                "client@example.com",
            ],
            metric_focus=[
                "Revenue",
            ],
            brand_name="Acme Retail",
            subject="Decisionate KPI digest",
            preview_text="1 dataset KPI metric ready for review.",
            dataset_count=1,
            metrics=[
                WeeklyReportDigestMetric(
                    dataset_id=1,
                    dataset_name="sales.csv",
                    column="Revenue",
                    total=100,
                    average=50,
                    minimum=25,
                    maximum=75,
                ),
            ],
            recommendations=[
                "Review revenue.",
            ],
            unavailable_datasets=[],
            ai_analysis=WeeklyReportAIAnalysis(
                source="rules",
                fallback_reason="not_configured",
                summary="Review the selected KPI.",
                recommendations=[
                    "Review revenue.",
                ],
                risks=[],
                confidence="low",
                learning_context={
                    "learning_scope": "workspace",
                    "recorded_lesson_count": 1,
                    "recorded_outcome_count": 1,
                    "sampled_lesson_count": 1,
                    "sampled_evidence_count": 1,
                },
            ),
        )

        email_text = build_weekly_report_email_text(
            digest
        )

        self.assertIn(
            "Revenue (sales.csv)",
            email_text,
        )
        self.assertIn(
            "Total: 100.00",
            email_text,
        )
        self.assertIn(
            "from workspace decisions.",
            email_text,
        )
        self.assertIn(
            "deterministic rules fallback (AI provider not configured)",
            email_text,
        )
        self.assertIn(
            "Generated by Acme Retail.",
            email_text,
        )

    def test_weekly_report_email_message_uses_digest_brand_sender_by_default(self):
        digest = WeeklyReportDigestResponse(
            enabled=True,
            cadence="weekly",
            delivery_day="monday",
            recipient_emails=[
                "client@example.com",
            ],
            metric_focus=[
                "Revenue",
            ],
            brand_name="Acme Retail",
            subject="Acme Retail KPI digest",
            preview_text="1 dataset KPI metric ready for review.",
            dataset_count=1,
            metrics=[],
            recommendations=[],
            unavailable_datasets=[],
        )

        with patch.dict(
            "os.environ",
            {
                "SMTP_FROM_EMAIL": "reports@example.com",
            },
            clear=True,
        ):
            message = build_weekly_report_email_message(
                digest,
                "client@example.com",
            )

        self.assertEqual(
            message["From"],
            "Acme Retail <reports@example.com>",
        )

    def test_weekly_report_email_message_uses_workspace_sender_and_reply_to(self):
        digest = WeeklyReportDigestResponse(
            enabled=True,
            cadence="weekly",
            delivery_day="monday",
            recipient_emails=[
                "client@example.com",
            ],
            metric_focus=[
                "Revenue",
            ],
            sender_name="Agency Insights",
            sender_email="reports@agency.example",
            reply_to_email="success@agency.example",
            brand_name="Acme Retail",
            subject="Acme Retail KPI digest",
            preview_text="1 dataset KPI metric ready for review.",
            dataset_count=1,
            metrics=[],
            recommendations=[],
            unavailable_datasets=[],
        )

        with patch.dict(
            "os.environ",
            {
                "SMTP_FROM_EMAIL": "reports@example.com",
            },
            clear=True,
        ):
            message = build_weekly_report_email_message(
                digest,
                "client@example.com",
            )

        self.assertEqual(
            message["From"],
            "Agency Insights <reports@agency.example>",
        )
        self.assertEqual(
            message["Reply-To"],
            "success@agency.example",
        )

    def test_weekly_report_email_uses_workspace_smtp_settings(self):
        digest = WeeklyReportDigestResponse(
            enabled=True,
            cadence="weekly",
            delivery_day="monday",
            recipient_emails=[
                "client@example.com",
            ],
            metric_focus=[
                "Revenue",
            ],
            sender_name="Agency Insights",
            sender_email="reports@agency.example",
            reply_to_email="success@agency.example",
            brand_name="Acme Retail",
            subject="Acme Retail KPI digest",
            preview_text="1 dataset KPI metric ready for review.",
            dataset_count=1,
            metrics=[],
            recommendations=[],
            unavailable_datasets=[],
        )
        smtp_events = {
            "messages": [],
        }

        class FakeSMTP:
            def __init__(
                self,
                host,
                port,
                timeout,
            ):
                smtp_events["connect"] = (
                    host,
                    port,
                    timeout,
                )

            def __enter__(self):
                return self

            def __exit__(
                self,
                exc_type,
                exc_value,
                traceback,
            ):
                return False

            def starttls(self):
                smtp_events["starttls"] = True

            def login(
                self,
                username,
                password,
            ):
                smtp_events["login"] = (
                    username,
                    password,
                )

            def send_message(
                self,
                message,
            ):
                smtp_events["messages"].append(
                    message
                )

        with patch.dict(
            "os.environ",
            {},
            clear=True,
        ), patch(
            "app.modules.alerts.email_delivery.smtplib.SMTP",
            FakeSMTP,
        ):
            result = send_weekly_report_email(
                digest,
                {
                    "smtp_host": "smtp.workspace.example",
                    "smtp_port": 2525,
                    "smtp_username": "apikey",
                    "smtp_password": "secret",
                    "smtp_use_tls": True,
                    "smtp_use_ssl": False,
                },
            )

        self.assertEqual(
            result["delivered_count"],
            1,
        )
        self.assertEqual(
            smtp_events["connect"][:2],
            (
                "smtp.workspace.example",
                2525,
            ),
        )
        self.assertTrue(
            smtp_events["starttls"],
        )
        self.assertEqual(
            smtp_events["login"],
            (
                "apikey",
                "secret",
            ),
        )
        self.assertEqual(
            smtp_events["messages"][0]["From"],
            "Agency Insights <reports@agency.example>",
        )

    def test_weekly_report_delivery_requires_matching_dataset_metrics(self):
        digest = WeeklyReportDigestResponse(
            enabled=True,
            cadence="weekly",
            delivery_day="monday",
            recipient_emails=[
                "client@example.com",
            ],
            metric_focus=[
                "Revenue",
            ],
            subject="Decisionate KPI digest",
            preview_text="0 dataset KPI metrics ready for review.",
            dataset_count=1,
            metrics=[],
            recommendations=[],
            unavailable_datasets=[],
        )

        with self.assertRaises(
            HTTPException,
        ) as context:
            validate_weekly_report_digest_for_delivery(
                digest
            )

        self.assertEqual(
            context.exception.status_code,
            400,
        )

    def test_alert_scheduler_secret_is_required(self):
        request = SimpleNamespace(
            headers={
                "X-Alerts-Scheduler-Secret": "secret",
            },
        )

        with patch.dict(
            "os.environ",
            {},
            clear=True,
        ):
            with self.assertRaises(
                HTTPException,
            ) as context:
                require_alerts_scheduler_secret(
                    request
                )

        self.assertEqual(
            context.exception.status_code,
            503,
        )

    def test_alert_scheduler_secret_accepts_matching_header(self):
        request = SimpleNamespace(
            headers={
                "X-Alerts-Scheduler-Secret": "secret",
            },
        )

        with patch.dict(
            "os.environ",
            {
                "ALERTS_SCHEDULER_SECRET": "secret",
            },
            clear=True,
        ):
            require_alerts_scheduler_secret(
                request
            )

    def test_test_email_status_does_not_mark_weekly_digest_sent_today(self):
        current_time = datetime(
            2026,
            7,
            15,
            12,
            0,
            0,
        )
        preference = SimpleNamespace(
            last_send_status="test_sent",
            last_sent_at=None,
        )

        self.assertFalse(
            was_weekly_report_sent_today(
                preference,
                current_time,
            )
        )

    def test_delivery_config_reports_environment_readiness(self):
        request = SimpleNamespace()

        with patch.dict(
            "os.environ",
            {
                "SMTP_HOST": "smtp.example.com",
                "SMTP_FROM_EMAIL": "reports@example.com",
                "ALERTS_SCHEDULER_SECRET": "secret",
            },
            clear=True,
        ), patch(
            "app.modules.alerts.router.get_auth_context",
        ):
            config = asyncio.run(
                get_weekly_report_delivery_config(
                    request
                )
            )

        self.assertTrue(
            config.email_delivery_configured,
        )
        self.assertTrue(
            config.scheduler_configured,
        )
        self.assertIn(
            "SMTP_HOST",
            config.required_email_environment_keys,
        )

    def test_delivery_config_reports_workspace_smtp_readiness(self):
        request = SimpleNamespace()
        preference = SimpleNamespace(
            sender_email="reports@example.com",
            smtp_host="smtp.workspace.example",
        )

        with patch.dict(
            "os.environ",
            {},
            clear=True,
        ), patch(
            "app.modules.alerts.router.get_auth_context",
            return_value=SimpleNamespace(
                workspace_id="workspace-1",
            ),
        ), patch(
            "app.modules.alerts.router.get_weekly_report_preference_record",
            return_value=preference,
        ):
            config = asyncio.run(
                get_weekly_report_delivery_config(
                    request
                )
            )

        self.assertTrue(
            config.email_delivery_configured,
        )
        self.assertNotIn(
            "SMTP_HOST",
            config.required_email_environment_keys,
        )
        self.assertNotIn(
            "SMTP_FROM_EMAIL",
            config.required_email_environment_keys,
        )

    def test_weekly_report_update_can_clear_saved_smtp_password(self):
        request = SimpleNamespace()
        preference = SimpleNamespace(
            enabled=1,
            cadence="weekly",
            delivery_day="monday",
            recipient_emails="[]",
            metric_focus="[]",
            include_recommendations=1,
            sender_name="Agency Insights",
            sender_email="reports@example.com",
            reply_to_email="success@example.com",
            subject_prefix="[KPI]",
            smtp_host="smtp.example.com",
            smtp_port=587,
            smtp_username="apikey",
            smtp_password="existing-secret",
            smtp_use_tls=1,
            smtp_use_ssl=0,
            last_sent_at=None,
            last_send_status=None,
            last_send_error=None,
        )
        fake_db = SimpleNamespace(
            add=lambda _value: None,
            commit=lambda: None,
            refresh=lambda _value: None,
            close=lambda: None,
        )

        with patch(
            "app.modules.alerts.router.get_auth_context",
            return_value=SimpleNamespace(
                workspace_id="workspace-1",
                workspace_role="owner",
            ),
        ), patch(
            "app.modules.alerts.router.SessionLocal",
            return_value=fake_db,
        ), patch(
            "app.modules.alerts.router.get_weekly_report_preference_record",
            return_value=preference,
        ):
            response = asyncio.run(
                update_weekly_report_preference(
                    request,
                    WeeklyReportPreferenceUpdate(
                        enabled=True,
                        delivery_day="monday",
                        recipient_emails=[
                            "client@example.com",
                        ],
                        metric_focus=[
                            "Revenue",
                        ],
                        include_recommendations=True,
                        sender_name="Agency Insights",
                        sender_email="reports@example.com",
                        smtp_host="smtp.example.com",
                        smtp_port=587,
                        smtp_username="apikey",
                        smtp_clear_password=True,
                    ),
                )
            )

        self.assertEqual(
            preference.smtp_password,
            "",
        )
        self.assertFalse(
            response.smtp_password_set,
        )


if __name__ == "__main__":
    unittest.main()
