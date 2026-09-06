import asyncio
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

import pandas as pd
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.models import DataSourceConnection
from app.db.models import Dataset
from app.modules.datasets.router import sync_source_connection
from app.modules.datasets.schemas import DataSourceConnectionSync
from app.modules.datasets.services.google_analytics import (
    GoogleAnalyticsConnectorUnavailable,
    load_google_analytics_report,
    validate_report_request,
)
from app.modules.datasets.services.connectors import ConnectorNoData


class GoogleAnalyticsConnectorTests(unittest.TestCase):
    def test_report_request_normalizes_fields_and_dates(self):
        result = validate_report_request(
            property_id="123456",
            start_date="2026-01-01",
            end_date="2026-01-31",
            dimensions=["date", "date"],
            metrics=["sessions", "activeUsers"],
        )

        self.assertEqual(
            result,
            (
                "123456",
                "2026-01-01",
                "2026-01-31",
                ["date"],
                ["sessions", "activeUsers"],
            ),
        )

    def test_report_request_rejects_invalid_property_and_range(self):
        with self.assertRaises(ValueError):
            validate_report_request(
                property_id="not-numeric",
                start_date="2026-01-01",
                end_date="2026-01-31",
            )

        with self.assertRaises(ValueError):
            validate_report_request(
                property_id="123456",
                start_date="2026-02-01",
                end_date="2026-01-31",
            )

    def test_report_request_rejects_invalid_field_names(self):
        with self.assertRaises(ValueError):
            validate_report_request(
                property_id="123456",
                start_date="2026-01-01",
                end_date="2026-01-31",
                metrics=["sessions;drop"],
            )

    def test_missing_service_account_is_explicit(self):
        from app.modules.datasets.services import google_analytics

        with patch.dict(
            os.environ,
            {
                "GOOGLE_ANALYTICS_SERVICE_ACCOUNT_FILE": "",
                "GOOGLE_ANALYTICS_SERVICE_ACCOUNT_JSON": "",
            },
            clear=False,
        ):
            with self.assertRaises(GoogleAnalyticsConnectorUnavailable):
                google_analytics.load_google_analytics_report(
                    property_id="123456",
                    start_date="2026-01-01",
                    end_date="2026-01-31",
                )

    def test_invalid_service_account_configuration_is_not_ready(self):
        from app.modules.datasets.services import google_analytics

        with patch.dict(
            os.environ,
            {
                "GOOGLE_ANALYTICS_SERVICE_ACCOUNT_FILE": "/missing/key.json",
                "GOOGLE_ANALYTICS_SERVICE_ACCOUNT_JSON": "",
            },
            clear=False,
        ):
            self.assertFalse(
                google_analytics.is_google_analytics_connector_available()
            )

    def test_report_response_is_converted_to_dataset_rows(self):
        class FakeRequest:
            def __init__(self, **kwargs):
                self.kwargs = kwargs

        class FakeField:
            def __init__(self, name):
                self.name = name

        class FakeValue:
            def __init__(self, value):
                self.value = value

        class FakeRow:
            def __init__(self, dimensions, metrics):
                self.dimension_values = [
                    FakeValue(value)
                    for value in dimensions
                ]
                self.metric_values = [
                    FakeValue(value)
                    for value in metrics
                ]

        class FakeResponse:
            dimension_headers = [FakeField("date")]
            metric_headers = [
                FakeField("sessions"),
                FakeField("activeUsers"),
            ]
            rows = [
                FakeRow(
                    ["20260101"],
                    ["12", "9"],
                ),
            ]

        class FakeClient:
            def __init__(self, credentials):
                self.credentials = credentials

            def run_report(self, request):
                self.request = request
                return FakeResponse()

        class FakeCredentials:
            @classmethod
            def from_service_account_info(
                cls,
                info,
                scopes,
            ):
                return {
                    "info": info,
                    "scopes": scopes,
                }

        analytics_module = types.ModuleType(
            "google.analytics.data_v1beta"
        )
        analytics_module.BetaAnalyticsDataClient = FakeClient
        types_module = types.ModuleType(
            "google.analytics.data_v1beta.types"
        )
        types_module.DateRange = FakeRequest
        types_module.Dimension = FakeRequest
        types_module.Metric = FakeRequest
        types_module.RunReportRequest = FakeRequest
        service_account_module = types.ModuleType(
            "google.oauth2.service_account"
        )
        service_account_module.Credentials = FakeCredentials
        oauth_module = types.ModuleType("google.oauth2")
        oauth_module.service_account = service_account_module

        modules = {
            "google": types.ModuleType("google"),
            "google.analytics": types.ModuleType(
                "google.analytics"
            ),
            "google.analytics.data_v1beta": analytics_module,
            "google.analytics.data_v1beta.types": types_module,
            "google.oauth2": oauth_module,
            "google.oauth2.service_account": service_account_module,
        }

        with patch.dict(
            os.environ,
            {
                "GOOGLE_ANALYTICS_SERVICE_ACCOUNT_FILE": "",
                "GOOGLE_ANALYTICS_SERVICE_ACCOUNT_JSON": '{"type":"service_account"}',
                "GOOGLE_ANALYTICS_SCOPE": (
                    "https://www.googleapis.com/auth/analytics.readonly"
                ),
            },
            clear=False,
        ), patch.dict(
            sys.modules,
            modules,
        ):
            dataframe, report = load_google_analytics_report(
                property_id="123456",
                start_date="2026-01-01",
                end_date="2026-01-31",
                dimensions=["date"],
                metrics=["sessions", "activeUsers"],
            )

        self.assertEqual(
            list(dataframe.columns),
            ["date", "sessions", "activeUsers"],
        )
        self.assertEqual(
            dataframe.iloc[0].tolist(),
            ["2026-01-01", 12, 9],
        )
        self.assertEqual(report["row_count"], 1)

    def test_sync_route_persists_google_analytics_dataset(self):
        engine = create_engine("sqlite:///:memory:")
        DataSourceConnection.__table__.create(engine)
        Dataset.__table__.create(engine)
        Session = sessionmaker(bind=engine)
        db = Session()
        db.add(
            DataSourceConnection(
                id=1,
                user_id="user-1",
                workspace_id="workspace-1",
                source_type="google_analytics",
                display_name="Marketing analytics",
                status="needs_setup",
                connection_config='{"property_id": "123456"}',
            )
        )
        db.commit()
        db.close()

        with tempfile.TemporaryDirectory() as directory:
            dataset_path = Path(directory) / "google-analytics.csv"
            with patch(
                "app.modules.datasets.router.SessionLocal",
                Session,
            ), patch(
                "app.modules.datasets.router.get_user_id",
                return_value="user-1",
            ), patch(
                "app.modules.datasets.router.get_workspace_id",
                return_value="workspace-1",
            ), patch(
                "app.modules.datasets.router.build_dataset_upload_path",
                return_value=str(dataset_path),
            ), patch(
                "app.modules.datasets.router.get_dataset_upload_dir",
                return_value=directory,
            ), patch(
                "app.modules.datasets.router.load_google_analytics_report",
                return_value=(
                    pd.DataFrame({
                        "date": ["20260101"],
                        "sessions": ["12"],
                    }),
                    {
                        "property_id": "123456",
                        "start_date": "2026-01-01",
                        "end_date": "2026-01-31",
                        "dimensions": ["date"],
                        "metrics": ["sessions"],
                        "row_count": 1,
                    },
                ),
            ):
                response = asyncio.run(
                    sync_source_connection(
                        types.SimpleNamespace(),
                        1,
                        DataSourceConnectionSync(
                            start_date="2026-01-01",
                            end_date="2026-01-31",
                            metrics=["sessions"],
                        ),
                    )
                )

            self.assertEqual(response["dataset_id"], 1)
            self.assertEqual(response["row_count"], 1)
        db = Session()
        try:
            connection = db.query(DataSourceConnection).one()
            dataset = db.query(Dataset).one()
            self.assertEqual(connection.status, "connected")
            self.assertIsNotNone(connection.last_synced_at)
            self.assertEqual(dataset.source_type, "google_analytics")
            self.assertEqual(dataset.row_count, 1)
            self.assertTrue(Path(dataset.file_path).exists())
        finally:
            db.close()
            engine.dispose()

    def test_sync_route_returns_no_data_notification(self):
        engine = create_engine("sqlite:///:memory:")
        DataSourceConnection.__table__.create(engine)
        Dataset.__table__.create(engine)
        Session = sessionmaker(bind=engine)
        db = Session()
        db.add(
            DataSourceConnection(
                id=1,
                user_id="user-1",
                workspace_id="workspace-1",
                source_type="google_analytics",
                display_name="Marketing analytics",
                status="connected",
                connection_config='{"property_id": "123456"}',
            )
        )
        db.commit()
        db.close()

        message = (
            "Google Ads returned no records from 2026-08-07 through "
            "2026-09-06."
        )
        with patch(
            "app.modules.datasets.router.SessionLocal",
            Session,
        ), patch(
            "app.modules.datasets.router.get_user_id",
            return_value="user-1",
        ), patch(
            "app.modules.datasets.router.get_workspace_id",
            return_value="workspace-1",
        ), patch(
            "app.modules.datasets.router.run_data_source_sync",
            side_effect=ConnectorNoData(message),
        ):
            response = asyncio.run(
                sync_source_connection(
                    types.SimpleNamespace(),
                    1,
                    DataSourceConnectionSync(
                        start_date="2026-08-07",
                        end_date="2026-09-06",
                    ),
                )
            )

        self.assertEqual(
            response,
            {
                "connection_id": 1,
                "status": "no_data",
                "message": message,
                "datasets": [],
            },
        )
        db = Session()
        try:
            self.assertEqual(db.query(Dataset).count(), 0)
        finally:
            db.close()
            engine.dispose()


if __name__ == "__main__":
    unittest.main()
