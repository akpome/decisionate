import unittest

from pydantic import ValidationError

from app.modules.reports.names import DEFAULT_WEEKLY_REPORT_NAME, weekly_report_name
from app.modules.reports.schemas import ReportDefinition, WeeklyReportSettings
from app.modules.reports.weekly import weekly_settings_copy
from tests.test_business_reports import definition


class WeeklyReportNameTests(unittest.TestCase):
    def test_generated_names_are_replaced_but_custom_names_are_preserved(self):
        generated = "Report (034a3449-983d-4130-8cb4-c6d870713c06)"
        for name in (None, "", "  ", generated, f"Weekly {generated}", f"Weekly Weekly {generated}", generated.upper()):
            with self.subTest(name=name):
                self.assertEqual(weekly_report_name(name), DEFAULT_WEEKLY_REPORT_NAME)
                source = {**definition(grain="weekly"), "name": name}
                self.assertEqual(weekly_settings_copy(source)["name"], DEFAULT_WEEKLY_REPORT_NAME)
                self.assertEqual(WeeklyReportSettings.model_validate(source).name, DEFAULT_WEEKLY_REPORT_NAME)
                self.assertEqual(source["name"], name)
        for name in (DEFAULT_WEEKLY_REPORT_NAME, "Sales and advertising", "Weekly Report (Canada)", f"Sales {generated}"):
            self.assertEqual(weekly_report_name(name), name)
            self.assertEqual(WeeklyReportSettings.model_validate(definition(name=name, grain="weekly")).name, name)
        self.assertEqual(ReportDefinition.model_validate(definition(name=generated)).name, generated)

    def test_missing_weekly_name_defaults_but_invalid_names_still_fail(self):
        source = definition(grain="weekly")
        source.pop("name")
        self.assertEqual(WeeklyReportSettings.model_validate(source).name, DEFAULT_WEEKLY_REPORT_NAME)
        for name in (123, [], "a" * 121):
            with self.subTest(name=name), self.assertRaises(ValidationError):
                WeeklyReportSettings.model_validate({**definition(grain="weekly"), "name": name})
