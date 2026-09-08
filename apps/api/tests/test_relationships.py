import asyncio
import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.database import Base
from app.db.models import DatasetRelationship
from app.db.models import WeeklyReportPreference
from app.modules.datasets.router import delete_dataset_relationship


class DatasetRelationshipDeletionTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.session_factory = sessionmaker(bind=self.engine)

    def tearDown(self):
        self.engine.dispose()

    def add_relationship(self, workspace_id="workspace-1"):
        db = self.session_factory()
        try:
            relationship = DatasetRelationship(
                user_id="user-1",
                workspace_id=workspace_id,
                name="Revenue and spend",
                left_dataset_id=1,
                left_date_column="date",
                left_metric="revenue",
                right_dataset_id=2,
                right_date_column="date",
                right_metric="spend",
            )
            db.add(relationship)
            db.commit()
            db.refresh(relationship)
            return relationship.id
        finally:
            db.close()

    def test_delete_removes_relationship_and_alert_focus(self):
        relationship_id = self.add_relationship()
        db = self.session_factory()
        try:
            db.add(
                WeeklyReportPreference(
                    workspace_id="workspace-1",
                    enabled=1,
                    metric_focus=json.dumps([
                        {"dataset_id": 1, "metric": "revenue"},
                    ]),
                    relationship_focus=json.dumps(
                        [relationship_id, 999]
                    ),
                )
            )
            db.commit()
        finally:
            db.close()

        with patch(
            "app.modules.datasets.router.SessionLocal",
            self.session_factory,
        ), patch(
            "app.modules.datasets.router.get_user_id",
            return_value="user-1",
        ), patch(
            "app.modules.datasets.router.get_workspace_id",
            return_value="workspace-1",
        ):
            result = asyncio.run(
                delete_dataset_relationship(
                    SimpleNamespace(),
                    relationship_id,
                )
            )

        self.assertEqual(result, {"deleted": True})
        db = self.session_factory()
        try:
            self.assertIsNone(
                db.query(DatasetRelationship)
                .filter(DatasetRelationship.id == relationship_id)
                .first()
            )
            preference = db.query(WeeklyReportPreference).one()
            self.assertEqual(
                json.loads(preference.relationship_focus),
                [999],
            )
            self.assertEqual(preference.enabled, 1)
        finally:
            db.close()

    def test_delete_cannot_remove_relationship_from_another_workspace(self):
        relationship_id = self.add_relationship("workspace-2")

        with patch(
            "app.modules.datasets.router.SessionLocal",
            self.session_factory,
        ), patch(
            "app.modules.datasets.router.get_user_id",
            return_value="user-1",
        ), patch(
            "app.modules.datasets.router.get_workspace_id",
            return_value="workspace-1",
        ):
            with self.assertRaises(HTTPException) as context:
                asyncio.run(
                    delete_dataset_relationship(
                        SimpleNamespace(),
                        relationship_id,
                    )
                )

        self.assertEqual(context.exception.status_code, 404)
        db = self.session_factory()
        try:
            self.assertIsNotNone(
                db.query(DatasetRelationship)
                .filter(DatasetRelationship.id == relationship_id)
                .first()
            )
        finally:
            db.close()


if __name__ == "__main__":
    unittest.main()
