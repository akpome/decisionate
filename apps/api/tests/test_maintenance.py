import unittest
from unittest.mock import Mock, patch

from app.modules.maintenance import get_active_maintenance_notice


class MaintenanceNoticeTests(unittest.IsolatedAsyncioTestCase):
    async def test_active_notice_does_not_require_authentication(self):
        db = Mock()
        (
            db.query.return_value
            .filter.return_value
            .order_by.return_value
            .first.return_value
        ) = None

        with patch(
            "app.modules.maintenance.SessionLocal",
            return_value=db,
        ):
            response = await get_active_maintenance_notice()

        self.assertIsNone(response)
        db.close.assert_called_once_with()


if __name__ == "__main__":
    unittest.main()
