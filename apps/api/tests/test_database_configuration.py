import os
import unittest
from unittest.mock import patch

from app.configuration import get_runtime_configuration


class DatabaseConfigurationTests(unittest.TestCase):
    def test_staging_requires_database_url(self):
        with patch.dict(
            os.environ,
            {
                "APP_ENV": "staging",
                "DATABASE_URL": "",
            },
            clear=False,
        ):
            with self.assertRaisesRegex(RuntimeError, "DATABASE_URL must be configured"):
                get_runtime_configuration()

    def test_staging_rejects_sqlite(self):
        with patch.dict(
            os.environ,
            {
                "APP_ENV": "staging",
                "DATABASE_URL": "sqlite:///./decisionate.db",
            },
            clear=False,
        ):
            with self.assertRaisesRegex(RuntimeError, "must point to PostgreSQL"):
                get_runtime_configuration()

    def test_development_keeps_sqlite_default(self):
        with patch.dict(
            os.environ,
            {
                "APP_ENV": "development",
                "DATABASE_URL": "",
            },
            clear=False,
        ):
            configuration = get_runtime_configuration()

        self.assertEqual(
            configuration.database_url,
            "sqlite:///./decisionate.db",
        )


if __name__ == "__main__":
    unittest.main()
