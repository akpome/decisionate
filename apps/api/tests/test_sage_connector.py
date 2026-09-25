import json
import os
import unittest
from datetime import date
from io import BytesIO
from types import SimpleNamespace
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlparse
from unittest.mock import MagicMock, patch

from app.modules.datasets.services import connectors
from app.modules.oauth.service import (
    OAuthProviderUnavailable,
    build_authorization_url,
    build_token_request,
    get_sage_businesses,
    get_sage_token_url,
    normalize_sage_country,
    read_token_response,
)


class SageConnectorTests(unittest.TestCase):
    def setUp(self):
        self.curl_transport_patcher = patch.object(
            connectors,
            "curl_requests",
            None,
        )
        self.curl_transport_patcher.start()
        self.addCleanup(self.curl_transport_patcher.stop)

    def test_sage_data_requests_use_browser_compatible_transport(self):
        curl = MagicMock()
        curl.get.return_value = type(
            "Response",
            (),
            {
                "status_code": 200,
                "text": '{"$items": []}',
                "headers": {"x-request-id": "sage-request-1"},
            },
        )()

        with patch.object(connectors, "curl_requests", curl), patch.object(
            connectors,
            "urlopen",
        ) as urlopen:
            payload = connectors.connector_json_request(
                "https://api.accounting.sage.com/v3.1/contacts",
                headers={
                    "Authorization": "Bearer sage-token",
                    "X-Business": "business-1",
                },
                source_type="sage",
            )

        self.assertEqual(payload, {"$items": []})
        curl.get.assert_called_once_with(
            "https://api.accounting.sage.com/v3.1/contacts",
            headers={
                "Accept": "application/json",
                "Authorization": "Bearer sage-token",
                "X-Business": "business-1",
            },
            timeout=30,
            impersonate="chrome",
        )
        urlopen.assert_not_called()

    def test_sage_retries_transient_data_request_failures(self):
        error = HTTPError(
            "https://api.accounting.sage.com/v3.1/contacts",
            500,
            "Internal Server Error",
            {},
            BytesIO(b"<html>500 Internal Server Error</html>"),
        )

        class Response:
            headers = {}

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self):
                return b'{"$items": []}'

        with patch.object(
            connectors,
            "urlopen",
            side_effect=[error, Response()],
        ), patch.object(connectors, "sleep") as mocked_sleep:
            payload = connectors.connector_json_request(
                "https://api.accounting.sage.com/v3.1/contacts",
                headers={"X-Business": "business-1"},
                source_type="sage",
            )

        self.assertEqual(payload, {"$items": []})
        mocked_sleep.assert_called_once_with(1)

    def test_sage_persistent_html_500_has_a_recoverable_message(self):
        error = HTTPError(
            "https://api.accounting.sage.com/v3.1/contacts",
            500,
            "Internal Server Error",
            {},
            BytesIO(b"<html>500 Internal Server Error</html>"),
        )

        with patch.object(
            connectors,
            "urlopen",
            side_effect=[error, error, error],
        ), patch.object(connectors, "sleep"):
            with self.assertRaisesRegex(
                connectors.ConnectorUnavailable,
                "temporary server error for the selected business",
            ):
                connectors.connector_json_request(
                    "https://api.accounting.sage.com/v3.1/contacts",
                    headers={"X-Business": "business-1"},
                    source_type="sage",
                )

    def test_sage_business_discovery_uses_browser_compatible_transport(self):
        curl = MagicMock()
        curl.get.return_value = type(
            "Response",
            (),
            {
                "status_code": 200,
                "text": '{"$items": [{"id": "business-1", "displayed_as": "Primary"}]}',
            },
        )()

        with patch.dict(
            os.environ,
            {
                "SAGE_BUSINESSES_API_URL": (
                    "https://api.accounting.sage.com/v3.1/businesses"
                ),
            },
            clear=False,
        ), patch("app.modules.oauth.service.curl_requests", curl):
            businesses = get_sage_businesses("sage-token")

        self.assertEqual(
            businesses,
            [{"business_id": "business-1", "name": "Primary"}],
        )
        curl.get.assert_called_once_with(
            "https://api.accounting.sage.com/v3.1/businesses",
            headers={
                "Accept": "application/json",
                "Authorization": "Bearer sage-token",
            },
            timeout=20,
            impersonate="chrome",
        )

    def test_sage_business_discovery_falls_back_after_browser_transport_5xx(
        self,
    ):
        curl = MagicMock()
        curl.get.return_value = type(
            "Response",
            (),
            {
                "status_code": 502,
                "text": "upstream temporarily unavailable",
            },
        )()

        class Response:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self):
                return b'{"$items": [{"id": "business-1"}]}'

        with patch.dict(
            os.environ,
            {
                "SAGE_BUSINESSES_API_URL": (
                    "https://api.accounting.sage.com/v3.1/businesses"
                ),
            },
            clear=False,
        ), patch("app.modules.oauth.service.curl_requests", curl), patch(
            "app.modules.oauth.service.urlopen",
            return_value=Response(),
        ) as urlopen:
            businesses = get_sage_businesses("sage-token")

        self.assertEqual(
            businesses,
            [{"business_id": "business-1", "name": "business-1"}],
        )
        request = urlopen.call_args.args[0]
        self.assertTrue(
            request.get_header("User-agent").startswith("Mozilla/5.0")
        )

    def test_sage_business_discovery_normalizes_business_options(self):
        class Response:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self):
                return json.dumps(
                    {
                        "$items": [
                            {"id": "business-1", "name": "Primary"},
                            {
                                "business_id": "business-2",
                                "displayed_as": "Secondary",
                            },
                        ]
                    }
                ).encode()

        with patch.dict(
            os.environ,
            {
                "SAGE_BUSINESSES_API_URL": (
                    "https://api.accounting.sage.com/v3.1/businesses"
                ),
            },
            clear=False,
        ), patch("app.modules.oauth.service.curl_requests", None), patch(
            "app.modules.oauth.service.urlopen",
            return_value=Response(),
        ) as urlopen:
            businesses = get_sage_businesses("sage-token")

        self.assertEqual(
            businesses,
            [
                {"business_id": "business-1", "name": "Primary"},
                {"business_id": "business-2", "name": "Secondary"},
            ],
        )
        request = urlopen.call_args.args[0]
        self.assertEqual(request.full_url, "https://api.accounting.sage.com/v3.1/businesses")
        self.assertEqual(request.get_header("Authorization"), "Bearer sage-token")

    def test_sage_business_discovery_derives_current_v31_endpoint(self):
        class Response:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self):
                return b'{"items": []}'

        with patch.dict(
            os.environ,
            {
                "SAGE_BUSINESSES_API_URL": "",
                "SAGE_API_BASE_URL": "https://api.accounting.sage.com/v3.1",
            },
            clear=False,
        ), patch("app.modules.oauth.service.curl_requests", None), patch(
            "app.modules.oauth.service.urlopen",
            return_value=Response(),
        ) as urlopen:
            get_sage_businesses("sage-token")

        request = urlopen.call_args.args[0]
        self.assertEqual(
            request.full_url,
            "https://api.accounting.sage.com/v3.1/businesses",
        )

    def test_sage_business_discovery_defaults_when_legacy_base_is_configured(self):
        class Response:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self):
                return b'{"$items": [{"id": "business-1", "name": "Primary"}]}'

        with patch.dict(
            os.environ,
            {
                "SAGE_BUSINESSES_API_URL": "",
                "SAGE_API_BASE_URL": (
                    "https://api.columbus.sage.com/uki/sageone/accounts/v3"
                ),
            },
            clear=False,
        ), patch("app.modules.oauth.service.curl_requests", None), patch(
            "app.modules.oauth.service.urlopen",
            return_value=Response(),
        ) as urlopen:
            businesses = get_sage_businesses("sage-token")

        self.assertEqual(
            businesses,
            [{"business_id": "business-1", "name": "Primary"}],
        )
        self.assertEqual(
            urlopen.call_args.args[0].full_url,
            "https://api.accounting.sage.com/v3.1/businesses",
        )

    def test_sage_business_discovery_ignores_legacy_business_url_override(self):
        class Response:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self):
                return b'{"$items": []}'

        with patch.dict(
            os.environ,
            {
                "SAGE_BUSINESSES_API_URL": (
                    "https://api.columbus.sage.com/uki/sageone/accounts/v3/businesses"
                ),
            },
            clear=False,
        ), patch("app.modules.oauth.service.curl_requests", None), patch(
            "app.modules.oauth.service.urlopen",
            return_value=Response(),
        ) as urlopen:
            get_sage_businesses("sage-token")

        self.assertEqual(
            urlopen.call_args.args[0].full_url,
            "https://api.accounting.sage.com/v3.1/businesses",
        )

    def test_sage_authorization_uses_read_only_consent(self):
        with patch.dict(
            os.environ,
            {
                "SAGE_CLIENT_ID": "client-id",
                "SAGE_CLIENT_SECRET": "client-secret",
                "SAGE_OAUTH_AUTHORIZATION_URL": (
                    "https://www.sageone.com/oauth2/auth/central?filter=api.v3.1"
                ),
                "SAGE_OAUTH_TOKEN_URL": "https://oauth.example/token",
                "SAGE_OAUTH_SCOPES": "readonly",
            },
            clear=False,
        ):
            url = build_authorization_url(
                "sage",
                "state-1",
                {"country": "CA"},
            )
            token_url = get_sage_token_url("US")

        self.assertIn("sageone.com/oauth2/auth/central", url)
        query = parse_qs(urlparse(url).query)
        self.assertEqual(query["filter"], ["apiv3.1"])
        self.assertEqual(query["country"], ["ca"])
        self.assertEqual(query["scope"], ["readonly"])
        self.assertEqual(token_url, "https://oauth.example/token")

    def test_sage_drops_unsupported_offline_access_scope(self):
        with patch.dict(
            os.environ,
            {
                "SAGE_CLIENT_ID": "client-id",
                "SAGE_CLIENT_SECRET": "client-secret",
                "SAGE_OAUTH_AUTHORIZATION_URL": (
                    "https://www.sageone.com/oauth2/auth/central"
                ),
                "SAGE_OAUTH_TOKEN_URL": "https://oauth.example/token",
                "SAGE_OAUTH_SCOPES": "readonly offline_access",
            },
            clear=False,
        ):
            url = build_authorization_url(
                "sage",
                "state-1",
                {"country": "CA"},
            )

        query = parse_qs(urlparse(url).query)
        self.assertEqual(query["scope"], ["readonly"])

    def test_sage_uses_central_token_endpoint_for_default_v31_url(self):
        with patch.dict(
            os.environ,
            {
                "SAGE_OAUTH_TOKEN_URL": (
                    "https://oauth.accounting.sage.com/token"
                ),
            },
            clear=False,
        ):
            self.assertEqual(
                get_sage_token_url("CA"),
                "https://oauth.accounting.sage.com/token",
            )
            self.assertEqual(
                get_sage_token_url("US"),
                "https://oauth.accounting.sage.com/token",
            )
            self.assertEqual(
                get_sage_token_url("DE"),
                "https://oauth.accounting.sage.com/token",
            )
            self.assertEqual(
                get_sage_token_url("ES"),
                "https://oauth.accounting.sage.com/token",
            )
            self.assertEqual(
                get_sage_token_url("FR"),
                "https://oauth.accounting.sage.com/token",
            )
            self.assertEqual(
                get_sage_token_url("GB"),
                "https://oauth.accounting.sage.com/token",
            )
            self.assertEqual(
                get_sage_token_url("IE"),
                "https://oauth.accounting.sage.com/token",
            )

    def test_sage_upgrades_legacy_regional_token_url_for_v31(self):
        with patch.dict(
            os.environ,
            {
                "SAGE_OAUTH_TOKEN_URL": (
                    "https://oauth.na.sageone.com/token"
                ),
            },
            clear=False,
        ):
            self.assertEqual(
                get_sage_token_url("CA"),
                "https://oauth.accounting.sage.com/token",
            )

    def test_sage_normalizes_region_aliases(self):
        self.assertEqual(normalize_sage_country("Canada"), "CA")
        self.assertEqual(normalize_sage_country("United States"), "US")
        self.assertEqual(normalize_sage_country("Germany"), "DE")
        self.assertEqual(normalize_sage_country("Spain"), "ES")
        self.assertEqual(normalize_sage_country("France"), "FR")
        self.assertEqual(normalize_sage_country("UK"), "GB")
        self.assertEqual(normalize_sage_country("IE"), "IE")

    def test_sage_requires_region_for_generic_endpoint(self):
        with patch.dict(
            os.environ,
            {
                "SAGE_OAUTH_TOKEN_URL": (
                    "https://oauth.accounting.sage.com/token"
                ),
            },
            clear=False,
        ):
            with self.assertRaisesRegex(
                OAuthProviderUnavailable,
                "Sage OAuth region is required",
            ):
                get_sage_token_url()

    def test_sage_token_request_uses_browser_compatible_user_agent(self):
        request = build_token_request(
            "sage",
            "https://oauth.accounting.sage.com/token",
            {"grant_type": "authorization_code"},
            {"Accept": "application/json"},
        )

        self.assertTrue(
            request.get_header("User-agent").startswith("Mozilla/5.0")
        )

    def test_sage_retries_central_endpoint_after_regional_forbidden(self):
        request = build_token_request(
            "sage",
            "https://oauth.na.sageone.com/token",
            {"grant_type": "authorization_code", "code": "code"},
            {"Accept": "application/json"},
        )
        blocked = SimpleNamespace(
            status_code=403,
            text="forbidden",
        )
        accepted = SimpleNamespace(
            status_code=200,
            text='{"access_token":"sage-token"}',
        )
        with patch("curl_cffi.requests.post", side_effect=[blocked, accepted]) as post:
            body = read_token_response("sage", request, "token exchange")

        self.assertEqual(body, '{"access_token":"sage-token"}')
        self.assertEqual(
            [call.args[0] for call in post.call_args_list],
            [
                "https://oauth.na.sageone.com/token",
                "https://oauth.accounting.sage.com/token",
            ],
        )

    def test_sage_invoices_are_normalized_for_analytics(self):
        connection = SimpleNamespace(
            id=7,
            source_type="sage",
            connection_config=json.dumps({"business_id": "business-1"}),
        )

        def fake_request(url, headers, **_kwargs):
            self.assertIn("sales_invoices", url)
            self.assertIn("attributes=all", url)
            self.assertEqual(headers["Authorization"], "Bearer sage-token")
            self.assertEqual(headers["X-Site"], "business-1")
            self.assertNotIn("Ocp-Apim-Subscription-Key", headers)
            return {
                "$items": [{
                    "id": "invoice-1",
                    "legacy_id": 1001,
                    "displayed_as": "SI-1001",
                    "$path": "/sales_invoices/invoice-1",
                    "date": "2026-01-02",
                    "due_date": "2026-02-01",
                    "status": "PROGRESS",
                    "total_amount": 1200,
                    "contact": {
                        "id": "contact-1",
                        "displayed_as": "Acme Ltd",
                        "$path": "/contacts/contact-1",
                    },
                    "currency": {"id": "GBP"},
                    "invoice_lines": [{
                        "description": "Consulting",
                        "quantity": 2,
                        "unit_price": 600,
                    }],
                }],
            }

        with patch.dict(
            os.environ,
            {
                "SAGE_API_BASE_URL": "https://api.example/sage",
                "SAGE_BUSINESS_HEADER": "X-Site",
            },
            clear=False,
        ), patch.object(
            connectors,
            "get_oauth_access_token",
            return_value="sage-token",
        ), patch.object(
            connectors,
            "connector_json_request",
            side_effect=fake_request,
        ):
            dataframe, report = connectors.load_sage_dataframe(
                None,
                connection,
                date(2026, 1, 1),
                date(2026, 1, 31),
            )

        self.assertEqual(len(dataframe), 1)
        self.assertEqual(dataframe.iloc[0]["invoice_id"], "invoice-1")
        self.assertEqual(dataframe.iloc[0]["total_amount"], 1200)
        self.assertNotIn("id", dataframe.columns)
        self.assertNotIn("legacy_id", dataframe.columns)
        self.assertNotIn("displayed_as", dataframe.columns)
        self.assertNotIn("$path", dataframe.columns)
        self.assertNotIn("contact__id", dataframe.columns)
        self.assertNotIn("contact__$path", dataframe.columns)
        self.assertEqual(
            dataframe.iloc[0]["invoice_lines__0__description"],
            "Consulting",
        )
        self.assertEqual(dataframe.iloc[0]["invoice_lines__0__quantity"], 2)
        self.assertEqual(report["connector"], "sage")

    def test_sage_v31_defaults_to_x_business_header(self):
        connection = SimpleNamespace(
            id=10,
            source_type="sage",
            connection_config=json.dumps({"business_id": "business-1"}),
        )

        def fake_request(_url, headers, **_kwargs):
            self.assertEqual(headers["X-Business"], "business-1")
            return {"$items": [], "$next": None}

        with patch.dict(
            os.environ,
            {
                "SAGE_API_BASE_URL": "https://api.accounting.sage.com/v3.1",
                "SAGE_BUSINESS_HEADER": "",
            },
            clear=False,
        ), patch.object(
            connectors,
            "get_oauth_access_token",
            return_value="sage-token",
        ), patch.object(
            connectors,
            "connector_json_request",
            side_effect=fake_request,
        ):
            dataframe, _ = connectors.load_sage_dataframe(
                None,
                connection,
                resource_type_override="contacts",
            )

        self.assertTrue(dataframe.empty)

    def test_sage_legacy_environment_is_upgraded_to_v31_for_business_selection(self):
        connection = SimpleNamespace(
            id=11,
            source_type="sage",
            connection_config=json.dumps(
                {"country": "CA", "business_id": "business-1"}
            ),
        )

        def fake_request(url, headers, **_kwargs):
            self.assertIn("api.accounting.sage.com/v3.1/contacts", url)
            self.assertEqual(headers["X-Business"], "business-1")
            return {"$items": [], "$next": None}

        with patch.dict(
            os.environ,
            {
                "SAGE_API_BASE_URL": (
                    "https://api.columbus.sage.com/uki/sageone/accounts/v3"
                ),
                "SAGE_BUSINESS_HEADER": "X-Site",
            },
            clear=False,
        ), patch.object(
            connectors,
            "get_oauth_access_token",
            return_value="sage-token",
        ), patch.object(
            connectors,
            "connector_json_request",
            side_effect=fake_request,
        ):
            dataframe, _ = connectors.load_sage_dataframe(
                None,
                connection,
                resource_type_override="contacts",
            )

        self.assertTrue(dataframe.empty)

    def test_sage_invoices_sync_by_updated_or_created_date(self):
        connection = SimpleNamespace(
            id=9,
            source_type="sage",
            connection_config=json.dumps({"business_id": "business-1"}),
        )

        def fake_request(url, headers, **_kwargs):
            self.assertIn(
                "updated_or_created_since=2026-01-01T00%3A00%3A00Z",
                url,
            )
            self.assertNotIn("from_date=", url)
            self.assertNotIn("to_date=", url)
            return {
                "$items": [{
                    "id": "invoice-updated",
                    "date": "2020-01-02",
                    "updated_at": "2026-01-15T12:00:00Z",
                    "total_amount": 1400,
                }],
                "$next": None,
            }

        with patch.dict(
            os.environ,
            {
                "SAGE_API_BASE_URL": "https://api.example/sage",
                "SAGE_BUSINESS_HEADER": "X-Site",
            },
            clear=False,
        ), patch.object(
            connectors,
            "get_oauth_access_token",
            return_value="sage-token",
        ), patch.object(
            connectors,
            "connector_json_request",
            side_effect=fake_request,
        ):
            dataframe, _ = connectors.load_sage_dataframe(
                None,
                connection,
                date(2026, 1, 1),
                date(2026, 1, 31),
            )

        self.assertEqual(len(dataframe), 1)
        self.assertEqual(dataframe.iloc[0]["record_id"], "invoice-updated")

    def test_sage_retries_without_change_filter_after_server_error(self):
        connection = SimpleNamespace(
            id=12,
            source_type="sage",
            connection_config=json.dumps({"business_id": "business-1"}),
        )
        calls = []

        def fake_request(url, headers, **_kwargs):
            calls.append(url)
            if "updated_or_created_since=" in url:
                raise connectors.ConnectorUnavailable(
                    "Connector request failed with HTTP 500: Sage returned a temporary server error"
                )
            return {
                "$items": [{
                    "id": "invoice-1",
                    "updated_at": "2026-01-15T12:00:00Z",
                }],
                "$next": None,
            }

        with patch.dict(
            os.environ,
            {
                "SAGE_API_BASE_URL": "https://api.example/sage",
                "SAGE_BUSINESS_HEADER": "X-Site",
            },
            clear=False,
        ), patch.object(
            connectors,
            "get_oauth_access_token",
            return_value="sage-token",
        ), patch.object(
            connectors,
            "connector_json_request",
            side_effect=fake_request,
        ):
            dataframe, _ = connectors.load_sage_dataframe(
                None,
                connection,
                date(2026, 1, 1),
                date(2026, 1, 31),
            )

        self.assertEqual(len(calls), 2)
        self.assertEqual(len(dataframe), 1)
        self.assertNotIn("updated_or_created_since=", calls[1])

    def test_sage_resource_failure_runs_business_preflight(self):
        connection = SimpleNamespace(
            id=14,
            source_type="sage",
            connection_config=json.dumps({"business_id": "business-1"}),
        )

        def fake_request(url, headers, **_kwargs):
            self.assertEqual(headers["X-Business"], "business-1")
            if url.endswith("/business"):
                return {"id": "business-1"}
            raise connectors.ConnectorUnavailable(
                "Connector request failed with HTTP 500: Sage returned a "
                "temporary server error"
            )

        with patch.dict(
            os.environ,
            {
                "SAGE_API_BASE_URL": "https://api.accounting.sage.com/v3.1",
                "SAGE_BUSINESS_HEADER": "X-Business",
            },
            clear=False,
        ), patch.object(
            connectors,
            "get_oauth_access_token",
            return_value="sage-token",
        ), patch.object(
            connectors,
            "connector_json_request",
            side_effect=fake_request,
        ):
            with self.assertRaisesRegex(
                connectors.ConnectorUnavailable,
                "sales_invoices.*business-1",
            ):
                connectors.load_sage_dataframe(
                    None,
                    connection,
                    resource_type_override="sales_invoices",
                )

    def test_sage_follows_provider_pagination_link(self):
        connection = SimpleNamespace(
            id=13,
            source_type="sage",
            connection_config=json.dumps({"business_id": "business-1"}),
        )
        calls = []

        def fake_request(url, headers, **_kwargs):
            calls.append(url)
            if len(calls) == 1:
                return {
                    "$items": [{"id": "invoice-1"}],
                    "$next": "/sales_invoices?page=2&items_per_page=100",
                }
            return {"$items": [{"id": "invoice-2"}], "$next": None}

        with patch.dict(
            os.environ,
            {
                "SAGE_API_BASE_URL": "https://api.accounting.sage.com/v3.1",
                "SAGE_BUSINESS_HEADER": "X-Business",
            },
            clear=False,
        ), patch.object(
            connectors,
            "get_oauth_access_token",
            return_value="sage-token",
        ), patch.object(
            connectors,
            "connector_json_request",
            side_effect=fake_request,
        ):
            dataframe, _ = connectors.load_sage_dataframe(
                None,
                connection,
                resource_type_override="sales_invoices",
            )

        self.assertEqual(len(dataframe), 2)
        self.assertEqual(
            calls[1],
            "https://api.accounting.sage.com/v3.1/sales_invoices?"
            "page=2&items_per_page=100&attributes=all",
        )

    def test_sage_pagination_link_with_api_version_path_is_not_duplicated(self):
        self.assertEqual(
            connectors.build_sage_pagination_url(
                "https://api.accounting.sage.com/v3.1",
                "/v3.1/sales_invoices?page=2",
            ),
            "https://api.accounting.sage.com/v3.1/sales_invoices?page=2",
        )

    def test_sage_resource_selection_uses_documented_endpoint(self):
        connection = SimpleNamespace(
            id=8,
            source_type="sage",
            connection_config=json.dumps(
                {
                    "business_id": "business-1",
                    "resource_types": ["contacts", "ledger_accounts"],
                }
            ),
        )

        def fake_request(url, headers, **_kwargs):
            self.assertIn("/contacts?", url)
            self.assertIn("items_per_page=100", url)
            self.assertIn("page=1", url)
            self.assertIn("attributes=all", url)
            self.assertEqual(headers["X-Site"], "business-1")
            return {
                "$items": [{
                    "id": "contact-1",
                    "legacy_id": 1002,
                    "displayed_as": "Acme Ltd",
                    "$path": "/contacts/contact-1",
                    "email": "finance@example.com",
                    "main_address": {
                        "id": "address-1",
                        "$path": "/addresses/address-1",
                        "address_line_1": "1 Main Street",
                        "city": "Halifax",
                    },
                }],
                "$next": None,
            }

        with patch.dict(
            os.environ,
            {
                "SAGE_API_BASE_URL": "https://api.example/sage",
                "SAGE_BUSINESS_HEADER": "X-Site",
            },
            clear=False,
        ), patch.object(
            connectors,
            "get_oauth_access_token",
            return_value="sage-token",
        ), patch.object(
            connectors,
            "connector_json_request",
            side_effect=fake_request,
        ):
            dataframe, report = connectors.load_sage_dataframe(
                None,
                connection,
                resource_type_override="contacts",
            )

        self.assertEqual(len(dataframe), 1)
        self.assertEqual(dataframe.iloc[0]["contact_id"], "contact-1")
        self.assertEqual(dataframe.iloc[0]["contact_name"], "Acme Ltd")
        self.assertNotIn("id", dataframe.columns)
        self.assertNotIn("legacy_id", dataframe.columns)
        self.assertNotIn("displayed_as", dataframe.columns)
        self.assertNotIn("$path", dataframe.columns)
        self.assertNotIn("main_address__id", dataframe.columns)
        self.assertNotIn("main_address__$path", dataframe.columns)
        self.assertEqual(
            dataframe.iloc[0]["main_address__address_line_1"],
            "1 Main Street",
        )
        self.assertEqual(dataframe.iloc[0]["main_address__city"], "Halifax")
        self.assertEqual(report["resource"], "contacts")

    def test_sage_requires_at_least_one_supported_resource(self):
        with self.assertRaises(connectors.ConnectorUnavailable):
            connectors.normalize_sage_resource_types({"resource_types": []})

        self.assertEqual(
            connectors.normalize_sage_resource_types({}),
            ["sales_invoices"],
        )


if __name__ == "__main__":
    unittest.main()
