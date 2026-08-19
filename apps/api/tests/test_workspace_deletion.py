import unittest

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.database import Base
from app.db.models import (
    DataSourceConnection,
    Dataset,
    DatasetJoinCache,
    DatasetRelationship,
    Organization,
    OrganizationMember,
)
from app.modules.decisions.models import Decision
from app.modules.platform_admin import delete_workspace_records


class WorkspaceDeletionTests(unittest.TestCase):
    def test_workspace_deletion_removes_data_connections_and_analysis_records(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        session_factory = sessionmaker(bind=engine)
        db = session_factory()

        try:
            organization = Organization(
                name="Workspace",
                owner_user_id="owner-user",
            )
            db.add(organization)
            db.flush()
            organization_id = organization.id
            db.add(
                OrganizationMember(
                    organization_id=organization.id,
                    clerk_user_id="member-user",
                    role="member",
                )
            )
            dataset = Dataset(
                file_name="sample.parquet",
                file_path="manual_upload",
                source_type="parquet",
                row_count=1,
                column_count=1,
                user_id="owner-user",
                workspace_id="owner-user",
            )
            db.add(dataset)
            db.flush()
            db.add(
                Decision(
                    clerk_user_id="owner-user",
                    workspace_id="owner-user",
                    dataset_id=dataset.id,
                    title="Test decision",
                )
            )
            db.add(
                DataSourceConnection(
                    user_id="owner-user",
                    workspace_id="owner-user",
                    source_type="hubspot",
                    display_name="HubSpot",
                    status="active",
                )
            )
            db.add(
                DatasetJoinCache(
                    user_id="owner-user",
                    workspace_id="owner-user",
                    dashboard_key="general-business",
                    dataset_ids="[1]",
                    definition="{}",
                    result="{}",
                    source_fingerprint="test",
                )
            )
            db.add(
                DatasetRelationship(
                    user_id="owner-user",
                    workspace_id="owner-user",
                    name="Revenue relationship",
                    left_dataset_id=dataset.id,
                    left_date_column="date",
                    left_metric="revenue",
                    right_dataset_id=dataset.id,
                    right_date_column="date",
                    right_metric="revenue",
                )
            )
            db.commit()

            summary = delete_workspace_records(
                db,
                "owner-user",
                organization_id,
            )
            db.commit()

            self.assertEqual(summary["datasets"], 1)
            self.assertEqual(summary["decisions"], 1)
            self.assertEqual(summary["connections"], 1)
            self.assertEqual(summary["join_caches"], 1)
            self.assertEqual(summary["relationships"], 1)
            self.assertIsNone(
                db.query(Organization).filter(Organization.id == organization_id).first()
            )
            self.assertIsNone(
                db.query(Dataset).filter(Dataset.workspace_id == "owner-user").first()
            )
            self.assertIsNone(
                db.query(Decision).filter(Decision.workspace_id == "owner-user").first()
            )
            self.assertIsNone(
                db.query(DataSourceConnection)
                .filter(DataSourceConnection.workspace_id == "owner-user")
                .first()
            )
            self.assertIsNone(
                db.query(DatasetJoinCache)
                .filter(DatasetJoinCache.workspace_id == "owner-user")
                .first()
            )
            self.assertIsNone(
                db.query(DatasetRelationship)
                .filter(DatasetRelationship.workspace_id == "owner-user")
                .first()
            )
        finally:
            db.close()
            engine.dispose()


if __name__ == "__main__":
    unittest.main()
