import json
import unittest
from datetime import datetime

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.models import DataSourceConnection
from app.db.models import Dataset
from app.modules.datasets.router import find_connector_dataset
from app.modules.datasets.router import find_connector_datasets
from app.modules.datasets.router import build_connector_dataset_filename
from app.modules.datasets.router import connector_dataset_display_name
from app.modules.datasets.router import filter_canonical_connector_datasets


class ConnectorDatasetIdentityTests(unittest.TestCase):
    def test_repeated_resource_syncs_expose_only_latest_dataset(self):
        engine = create_engine("sqlite:///:memory:")
        DataSourceConnection.__table__.create(engine)
        Dataset.__table__.create(engine)
        Session = sessionmaker(bind=engine)
        db = Session()

        connection = DataSourceConnection(
            id=7,
            user_id="user-1",
            workspace_id="workspace-1",
            source_type="quickbooks",
            display_name="Books",
            status="connected",
        )
        db.add(connection)
        db.add_all([
            Dataset(
                id=1,
                user_id="user-1",
                workspace_id="workspace-1",
                source_type="quickbooks",
                source_config=json.dumps({
                    "connection_id": 7,
                    "resource_type": "Invoice",
                }),
                file_name="quickbooks-invoices-day-1.parquet",
                file_path="datasets/1.parquet",
                row_count=1,
                column_count=2,
                created_at=datetime(2026, 8, 1),
            ),
            Dataset(
                id=2,
                user_id="user-1",
                workspace_id="workspace-1",
                source_type="quickbooks",
                source_config=json.dumps({
                    "connection_id": 7,
                    "resource": "invoices",
                }),
                file_name="quickbooks-invoices-day-2.parquet",
                file_path="datasets/2.parquet",
                row_count=2,
                column_count=2,
                created_at=datetime(2026, 8, 2),
            ),
            Dataset(
                id=3,
                user_id="user-1",
                workspace_id="workspace-1",
                source_type="quickbooks",
                source_config=json.dumps({
                    "connection_id": 7,
                    "resource_type": "customers",
                }),
                file_name="quickbooks-customers.parquet",
                file_path="datasets/3.parquet",
                row_count=3,
                column_count=2,
                created_at=datetime(2026, 8, 2),
            ),
        ])
        db.commit()

        datasets = find_connector_datasets(db, connection)

        self.assertEqual(
            [dataset.id for dataset in datasets],
            [3, 2],
        )
        self.assertEqual(
            find_connector_dataset(db, connection, "invoices").id,
            2,
        )
        self.assertEqual(
            [
                dataset.id
                for dataset in filter_canonical_connector_datasets(
                    db,
                    [
                        db.get(Dataset, 3),
                        db.get(Dataset, 2),
                        db.get(Dataset, 1),
                    ],
                    "user-1",
                    "workspace-1",
                )
            ],
            [3, 2],
        )

        db.close()
        engine.dispose()

    def test_connector_names_use_object_without_sync_date(self):
        self.assertEqual(
            build_connector_dataset_filename(
                "xero",
                {"resource": "invoices"},
            ),
            "xero-invoices-dataset.csv",
        )
        self.assertEqual(
            build_connector_dataset_filename(
                "hubspot",
                {"object_type": "deals"},
            ),
            "hubspot-deals-dataset.csv",
        )

        class DatasetStub:
            source_type = "sage"
            source_config = json.dumps({
                "resource": "sales_invoices",
                "start_date": "2026-08-01",
                "end_date": "2026-08-30",
            })
            file_name = "sage-4-2026-08-30.parquet"

        self.assertEqual(
            connector_dataset_display_name(DatasetStub()),
            "sage-sales_invoices-dataset.parquet",
        )

    def test_single_connection_can_reuse_legacy_connector_dataset(self):
        engine = create_engine("sqlite:///:memory:")
        DataSourceConnection.__table__.create(engine)
        Dataset.__table__.create(engine)
        Session = sessionmaker(bind=engine)
        db = Session()

        connection = DataSourceConnection(
            id=9,
            user_id="user-1",
            workspace_id="workspace-1",
            source_type="stripe",
            display_name="Payments",
            status="connected",
        )
        db.add(connection)
        legacy_dataset = Dataset(
            id=4,
            user_id="user-1",
            workspace_id="workspace-1",
            source_type="stripe",
            source_config=json.dumps({
                "ingestion_mode": "connector_sync",
            }),
            file_name="stripe-payments.parquet",
            file_path="datasets/4.parquet",
            row_count=4,
            column_count=2,
        )
        db.add(legacy_dataset)
        db.commit()

        self.assertEqual(
            find_connector_dataset(db, connection).id,
            legacy_dataset.id,
        )

        db.close()
        engine.dispose()


if __name__ == "__main__":
    unittest.main()
