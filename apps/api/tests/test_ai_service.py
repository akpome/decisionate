import json
import os
from contextlib import ExitStack
from email.message import Message
from http.client import IncompleteRead
from io import BytesIO
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError

from app.modules.ai import service


class FakeAIResponse:
    def __init__(self, payload):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        return False

    def read(self):
        return json.dumps(self.payload).encode("utf-8")


class AIServiceTests(unittest.TestCase):
    def setUp(self):
        with service._analysis_cache_lock:
            service._analysis_cache.clear()

    def tearDown(self):
        with service._analysis_cache_lock:
            service._analysis_cache.clear()

    def test_learning_metadata_ignores_invalid_counts(self):
        metadata = service.build_learning_context_metadata({
            "historical_decision_learning": {
                "learning_scope": "metric",
                "recorded_lesson_count": "invalid",
                "recorded_outcome_count": -2,
                "sampled_lesson_count": None,
                "sampled_evidence_count": "3",
            },
        })

        self.assertEqual(
            metadata,
            {
                "learning_scope": "metric",
                "recorded_lesson_count": 0,
                "recorded_outcome_count": 0,
                "recorded_recommendation_count": 0,
                "sampled_lesson_count": 0,
                "sampled_evidence_count": 3,
                "successful_outcome_count": 0,
                "partially_successful_outcome_count": 0,
                "unsuccessful_outcome_count": 0,
                "historical_success_rate": None,
            },
        )

    def test_learning_metadata_calculates_weighted_success_rate(self):
        metadata = service.build_learning_context_metadata({
            "historical_decision_learning": {
                "outcome_counts": {
                    "successful": 2,
                    "partially_successful": 1,
                    "unsuccessful": 1,
                },
            },
        })

        self.assertEqual(
            metadata["historical_success_rate"],
            0.62,
        )

    def test_missing_key_returns_explicit_fallback(self):
        with patch.dict(
            os.environ,
            {
                "AI_PROVIDER": "openai",
                "OPENAI_API_KEY": "",
            },
            clear=False,
        ):
            result = service.generate_structured_analysis(
                context="test",
                facts={"value": 1},
                fallback_summary="Baseline summary",
                fallback_recommendations=["Review the metric"],
            )

        self.assertEqual(result["source"], "rules")
        self.assertEqual(
            result["fallback_reason"],
            service.FALLBACK_NOT_CONFIGURED,
        )

    def test_fallback_recommendations_use_historical_outcome_pattern(self):
        result = service.build_fallback_analysis(
            summary="Baseline summary",
            recommendations=["Review the metric"],
            risks=[],
            learning_context={
                "recorded_lesson_count": 1,
                "recorded_outcome_count": 2,
                "recorded_recommendation_count": 1,
                "outcome_counts": {
                    "unsuccessful": 2,
                    "successful": 0,
                },
                "examples": [
                    {
                        "lesson_learned": "Use a smaller test group first.",
                    },
                ],
            },
        )

        self.assertTrue(
            any(
                "skew unsuccessful" in recommendation
                for recommendation in result["recommendations"]
            )
        )
        self.assertTrue(
            any(
                "smaller test group" in recommendation
                for recommendation in result["recommendations"]
            )
        )

    def test_fallback_recommendations_flag_mixed_outcomes(self):
        result = service.build_fallback_analysis(
            summary="Baseline summary",
            recommendations=[],
            risks=[],
            learning_context={
                "recorded_outcome_count": 3,
                "outcome_counts": {
                    "successful": 1,
                    "partially_successful": 1,
                    "unsuccessful": 1,
                },
            },
        )

        self.assertTrue(
            any(
                "outcomes are mixed" in recommendation
                for recommendation in result["recommendations"]
            )
        )

    def test_unsupported_provider_returns_explicit_fallback(self):
        with patch.dict(
            os.environ,
            {
                "AI_PROVIDER": "anthropic",
                "OPENAI_API_KEY": "test-key",
            },
            clear=False,
        ):
            result = service.generate_structured_analysis(
                context="test",
                facts={"value": 1},
                fallback_summary="Baseline summary",
                fallback_recommendations=["Review the metric"],
            )

        self.assertEqual(result["source"], "rules")
        self.assertEqual(
            result["fallback_reason"],
            service.FALLBACK_UNSUPPORTED_PROVIDER,
        )

    def test_provider_result_is_cached_and_bounded(self):
        calls = []
        provider_payload = {
            "choices": [
                {
                    "message": {
                        "content": json.dumps({
                            "summary": "Provider summary",
                            "recommendations": ["Review the metric"],
                            "risks": [],
                            "confidence": "medium",
                        }),
                    },
                },
            ],
        }

        def fake_urlopen(request, timeout):
            calls.append(
                json.loads(request.data.decode("utf-8"))
            )
            return FakeAIResponse(provider_payload)

        with patch.dict(
            os.environ,
            {
                "AI_PROVIDER": "openai",
                "OPENAI_API_KEY": "test-key",
                "OPENAI_MODEL": "gpt-4o-mini",
                "OPENAI_API_URL": "https://example.test/chat/completions",
                "AI_MAX_OUTPUT_TOKENS": "500",
                "AI_ANALYSIS_CACHE_TTL_SECONDS": "300",
            },
            clear=False,
        ), patch(
            "app.modules.ai.service.urlopen",
            side_effect=fake_urlopen,
        ):
            first = service.generate_structured_analysis(
                context="test",
                facts={"value": 1},
                fallback_summary="Baseline summary",
                fallback_recommendations=["Review the metric"],
            )
            second = service.generate_structured_analysis(
                context="test",
                facts={"value": 1},
                fallback_summary="Baseline summary",
                fallback_recommendations=["Review the metric"],
            )

        self.assertEqual(first, second)
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0]["max_tokens"], 500)
        self.assertEqual(
            set(json.loads(calls[0]["messages"][1]["content"])),
            {"context", "facts"},
        )
        self.assertEqual(
            json.loads(calls[0]["messages"][1]["content"])["facts"],
            {"value": 1},
        )
        self.assertEqual(first["source"], "openai")


class AIProviderFailureDiagnosticsTests(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.secret = "sk-test-secret-not-real"
        self.runtime = SimpleNamespace(
            ai_provider="openai", ai_api_key=self.secret, ai_model="test-only-model",
            ai_api_url=f"https://example.test/chat/completions?private={self.secret}",
        )
        self.stack.enter_context(patch.object(service, "get_runtime_configuration", return_value=self.runtime))
        self.stack.enter_context(patch.object(service, "_get_cached_analysis", return_value=None))
        self.cache = self.stack.enter_context(patch.object(service, "_cache_analysis"))
        self.remote = self.stack.enter_context(patch.object(service, "urlopen"))
        self.reserve = self.stack.enter_context(patch.object(service, "reserve_ai_credits", return_value={"id": "reservation"}))
        self.release = self.stack.enter_context(patch.object(service, "release_ai_credits"))
        self.settle = self.stack.enter_context(patch.object(service, "settle_ai_credits"))
        self.stack.enter_context(patch.dict(os.environ, {"AI_REQUEST_TIMEOUT_SECONDS": "20", "AI_MAX_OUTPUT_TOKENS": "500"}))

    def generate(self, facts=None):
        return service.generate_structured_analysis(
            context="private-business-context", facts=facts if facts is not None else {"customer_note": "private-customer-data"},
            fallback_summary="Calculated summary", fallback_recommendations=["Review the results"],
            workspace_id="private-workspace", actor_user_id="private-actor",
        )

    def response(self, content, finish_reason="stop", headers=None, refusal=None):
        response = FakeAIResponse({"choices": [{"finish_reason": finish_reason,
            "message": {"content": content, "refusal": refusal}}]})
        response.headers = headers or {"x-request-id": "req_0123456789abcdef"}
        return response

    def failure(self, facts=None):
        with self.assertLogs(service.logger, level="WARNING") as captured:
            result = self.generate(facts=facts)
        log = "\n".join(captured.output)
        self.assertEqual(result["source"], "rules")
        self.assertEqual(result["fallback_reason"], "provider_unavailable")
        self.assertEqual(result["summary"], "Calculated summary")
        self.assertEqual(len(captured.records), 1)
        self.release.assert_called_once_with("reservation")
        self.settle.assert_not_called()
        self.cache.assert_not_called()
        for private in (self.secret, self.runtime.ai_api_url, "private-customer-data", "private-business-context", "private-workspace", "private-actor"):
            self.assertNotIn(private, log)
        return log

    def test_http_failure_records_status_safe_code_and_request_id_without_secrets(self):
        body = BytesIO(json.dumps({"error": {"code": "insufficient_quota", "message": self.secret}}).encode())
        self.remote.side_effect = HTTPError(self.runtime.ai_api_url, 429, self.secret,
            {"x-request-id": "req_0123456789abcdef"}, body)
        log = self.failure()
        self.assertIn("reason=provider_http_error", log)
        self.assertIn("status=429 code=insufficient_quota", log)
        self.assertIn("request_id=req_0123456789abcdef", log)
        self.assertTrue(body.closed)
        self.remote.assert_called_once()

    def test_an_invalid_key_is_identified_without_claiming_the_provider_is_down(self):
        body = BytesIO(json.dumps({"error": {"code": "invalid_api_key", "message": self.secret}}).encode())
        self.remote.side_effect = HTTPError(self.runtime.ai_api_url, 401, self.secret, {}, body)
        self.assertIn("status=401 code=invalid_api_key", self.failure())

    def test_unknown_error_codes_and_untrusted_request_headers_are_not_logged(self):
        body = BytesIO(json.dumps({"error": {"code": self.secret, "type": "private-customer-data",
            "message": "private-customer-data"}}).encode())
        self.remote.side_effect = HTTPError(self.runtime.ai_api_url, 400, self.secret,
            {"x-request-id": f"req_{self.secret}\nprivate-customer-data"}, body)
        log = self.failure()
        self.assertIn("status=400 code=unrecognized request_id=None", log)
        self.assertIn("error_type=unrecognized", log)

    def test_quota_and_spend_codes_are_distinguished_from_temporary_throttling(self):
        for code in (
            "credit_balance_exhausted", "organization_spend_limit_exceeded",
            "project_spend_limit_exceeded", "organization_usage_limit_exceeded",
        ):
            with self.subTest(code=code):
                self.release.reset_mock()
                self.remote.reset_mock()
                body = BytesIO(json.dumps({"error": {"code": code, "type": "insufficient_quota",
                    "message": self.secret}}).encode())
                self.remote.side_effect = HTTPError(self.runtime.ai_api_url, 429, self.secret, {}, body)
                log = self.failure()
                self.assertIn(f"status=429 code={code}", log)
                self.assertIn("error_type=insufficient_quota", log)
                self.assertTrue(body.closed)
                self.remote.assert_called_once()

    def test_slow_down_and_overload_keep_the_specific_error_type_and_code(self):
        for status, code, error_type in (
            (429, "slow_down", "rate_limit_error"),
            (503, "server_is_overloaded", "service_unavailable_error"),
        ):
            with self.subTest(code=code):
                self.release.reset_mock()
                self.remote.reset_mock()
                body = BytesIO(json.dumps({"error": {"code": code, "type": error_type}}).encode())
                self.remote.side_effect = HTTPError(self.runtime.ai_api_url, status, self.secret,
                    {"Retry-After": "60"}, body)
                log = self.failure()
                self.assertIn(f"status={status} code={code}", log)
                self.assertIn(f"error_type={error_type}", log)
                self.assertIn('"retry-after":"60"', log)
                self.remote.assert_called_once()

    def test_null_error_code_still_records_the_provider_error_type(self):
        body = BytesIO(json.dumps({"error": {"code": None, "type": "insufficient_quota"}}).encode())
        self.remote.side_effect = HTTPError(self.runtime.ai_api_url, 429, self.secret, {}, body)
        log = self.failure()
        self.assertIn("status=429 code=None", log)
        self.assertIn("error_type=insufficient_quota", log)

    def test_unrecognized_error_code_does_not_hide_a_known_error_type(self):
        body = BytesIO(json.dumps({"error": {"code": self.secret, "type": "rate_limit_error"}}).encode())
        self.remote.side_effect = HTTPError(self.runtime.ai_api_url, 429, self.secret, {}, body)
        log = self.failure()
        self.assertIn("status=429 code=unrecognized", log)
        self.assertIn("error_type=rate_limit_error", log)

    def test_request_throttling_is_recorded_separately_from_token_throttling(self):
        body = BytesIO(json.dumps({"error": {"code": "rate_limit_exceeded", "type": "requests"}}).encode())
        self.remote.side_effect = HTTPError(self.runtime.ai_api_url, 429, self.secret,
            {"x-ratelimit-remaining-requests": "0"}, body)
        log = self.failure()
        self.assertIn("error_type=requests", log)
        self.assertIn('"x-ratelimit-remaining-requests":0', log)

    def test_rate_limit_headers_and_token_type_are_logged_without_raw_error_text(self):
        headers = Message()
        headers["X-Request-ID"] = "req_0123456789abcdef"
        headers["Retry-After"] = "2.5"
        headers["X-RateLimit-Limit-Requests"] = "10"
        headers["X-RateLimit-Remaining-Requests"] = "9"
        headers["X-RateLimit-Reset-Requests"] = "6s"
        headers["X-RateLimit-Limit-Tokens"] = "60000"
        headers["X-RateLimit-Remaining-Tokens"] = "0"
        headers["X-RateLimit-Reset-Tokens"] = "1m2.5s"
        headers["X-RateLimit-Limit-Project-Tokens"] = "30000"
        headers["X-RateLimit-Remaining-Project-Tokens"] = "0"
        headers["X-RateLimit-Reset-Project-Tokens"] = "250ms"
        headers["Authorization"] = self.secret
        body = BytesIO(json.dumps({"error": {"code": "rate_limit_exceeded", "type": "tokens",
            "message": "private-customer-data"}}).encode())
        self.remote.side_effect = HTTPError(self.runtime.ai_api_url, 429, self.secret, headers, body)
        log = self.failure()
        self.assertIn("error_type=tokens", log)
        self.assertIn('"retry-after":"2.5"', log)
        for name in service.RATE_LIMIT_COUNT_HEADERS:
            self.assertIn(f'"{name}":{headers[name]}', log)
        for name in service.RATE_LIMIT_RESET_HEADERS:
            self.assertIn(f'"{name}":"{headers[name]}"', log)
        self.assertNotIn("authorization", log.lower())

    def test_untrusted_header_values_are_filtered_even_for_approved_header_names(self):
        headers = {
            "Retry-After": self.secret,
            "X-RateLimit-Limit-Requests": "10\nprivate-customer-data",
            "X-RateLimit-Remaining-Requests": "9" * 41,
            "X-RateLimit-Reset-Requests": "private-customer-data",
            "X-RateLimit-Limit-Tokens": ["private-customer-data"],
            "X-RateLimit-Remaining-Tokens": "1e9",
            "X-RateLimit-Reset-Tokens": "60s\n",
            "X-Private-Data": "private-customer-data",
        }
        self.remote.side_effect = HTTPError(self.runtime.ai_api_url, 429, self.secret, headers, BytesIO(b"{}"))
        self.assertIn("rate_limits={}", self.failure())

    def test_retry_after_http_date_is_normalized_without_logging_arbitrary_header_text(self):
        self.remote.side_effect = HTTPError(self.runtime.ai_api_url, 429, self.secret,
            {"Retry-After": "Wed, 11 Nov 2026 20:00:00 GMT"}, BytesIO(b"{}"))
        self.assertIn('"retry-after":"2026-11-11T20:00:00+00:00"', self.failure())

    def test_request_size_and_estimated_input_are_logged_without_the_request_contents(self):
        self.runtime.ai_model = "gpt-4.1-mini-2025-04-14"
        self.remote.side_effect = HTTPError(self.runtime.ai_api_url, 429, self.secret, {}, BytesIO(b"{}"))
        log = self.failure(facts={"customer_note": "private-customer-data" * 20000})
        request = self.remote.call_args.args[0]
        payload = json.loads(request.data)
        expected_input = service.estimate_analysis_tokens(payload["messages"], 0)
        self.assertGreater(expected_input, 60000)
        self.assertIn(f"request_bytes={len(request.data)}", log)
        self.assertIn(f"estimated_input_tokens={expected_input}", log)
        self.assertIn("max_output_tokens=500", log)
        self.assertEqual(payload["max_tokens"], 500)
        self.assertEqual(payload["model"], self.runtime.ai_model)
        self.reserve.assert_called_once_with(
            workspace_id="private-workspace", operation="private-business-context",
            estimated_tokens=expected_input + 500, actor_user_id="private-actor",
        )
        self.remote.assert_called_once()

    def test_malformed_provider_error_fields_cannot_break_failure_logging(self):
        for payload in (
            {"error": {"code": ["private-customer-data"], "type": {"private": self.secret}}},
            {"error": "private-customer-data"},
            ["private-customer-data"],
        ):
            with self.subTest(payload_shape=type(payload).__name__):
                self.release.reset_mock()
                self.remote.side_effect = HTTPError(self.runtime.ai_api_url, 429, self.secret, {},
                    BytesIO(json.dumps(payload).encode()))
                self.assertIn("reason=provider_http_error", self.failure())

    def test_unreadable_or_missing_http_error_body_cannot_break_fallback(self):
        self.remote.side_effect = HTTPError(self.runtime.ai_api_url, 503, self.secret, None, None)
        self.assertIn("reason=provider_http_error", self.failure())

    def test_direct_timeout_is_distinguished_from_an_invalid_response(self):
        self.remote.side_effect = TimeoutError(self.secret)
        self.assertIn("reason=provider_timeout phase=provider_request", self.failure())
        self.remote.assert_called_once()
        self.assertEqual(self.remote.call_args.kwargs["timeout"], 20)

    def test_url_wrapped_timeout_is_identified_without_logging_the_exception(self):
        self.remote.side_effect = URLError(TimeoutError(self.secret))
        self.assertIn("reason=provider_timeout", self.failure())

    def test_connection_errors_are_distinguished_from_timeouts(self):
        self.remote.side_effect = URLError(self.secret)
        self.assertIn("reason=provider_network_error", self.failure())

    def test_interrupted_http_body_keeps_the_fallback_without_exposing_partial_data(self):
        class InterruptedResponse(FakeAIResponse):
            def read(self):
                raise IncompleteRead(b"private-customer-data", 100)
        self.remote.return_value = InterruptedResponse({})
        self.assertIn("reason=provider_network_error phase=response_body", self.failure())

    def test_interrupted_error_body_cannot_replace_the_original_http_failure(self):
        class InterruptedBody(BytesIO):
            def read(self, *args):
                raise IncompleteRead(b"private-customer-data", 100)
        body = InterruptedBody()
        self.remote.side_effect = HTTPError(self.runtime.ai_api_url, 502, self.secret, {}, body)
        self.assertIn("reason=provider_http_error", self.failure())
        self.assertTrue(body.closed)

    def test_token_limited_json_is_identified_without_repeating_a_billable_request(self):
        self.remote.return_value = self.response('{"summary":"private-customer-data', finish_reason="length")
        log = self.failure()
        self.assertIn("reason=response_incomplete", log)
        self.assertIn("finish_reason=length", log)
        self.remote.assert_called_once()
        request = json.loads(self.remote.call_args.args[0].data)
        self.assertEqual(request["max_tokens"], 500)

    def test_invalid_outer_response_shape_is_logged_without_its_body(self):
        self.remote.return_value = FakeAIResponse({"choices": [], "private": "private-customer-data"})
        self.assertIn("reason=invalid_response phase=analysis_payload", self.failure())

    def test_malformed_generated_json_is_not_mislabelled_as_a_timeout(self):
        self.remote.return_value = self.response("private-customer-data")
        log = self.failure()
        self.assertIn("reason=invalid_response", log)
        self.assertIn("finish_reason=stop", log)

    def test_refused_output_is_identified_without_logging_the_refusal_text(self):
        self.remote.return_value = self.response(None, refusal="private-customer-data")
        self.assertIn("reason=response_refused", self.failure())

    def test_invalid_analysis_shape_is_logged_after_normalization(self):
        self.remote.return_value = self.response(json.dumps({"summary": "", "private": "private-customer-data"}))
        self.assertIn("reason=invalid_response phase=analysis_validation", self.failure())

    def test_invalid_timeout_setting_is_identified_before_any_provider_request(self):
        with patch.dict(os.environ, {"AI_REQUEST_TIMEOUT_SECONDS": "invalid"}):
            self.assertIn("reason=invalid_request_settings phase=request_settings", self.failure())
        self.remote.assert_not_called()

    def test_invalid_finish_reason_cannot_break_logging_or_expose_response_data(self):
        self.remote.return_value = self.response("not JSON", finish_reason={"private": "private-customer-data"})
        self.assertIn("finish_reason=None", self.failure())

    def test_successful_response_preserves_the_original_request_and_credit_settlement(self):
        self.remote.return_value = self.response(json.dumps({"summary": "A useful explanation.",
            "recommendations": ["Review the results"], "risks": [], "confidence": "medium"}))
        with self.assertNoLogs(service.logger, level="WARNING"):
            result = self.generate()
        self.assertEqual(result["source"], "openai")
        self.settle.assert_called_once_with("reservation", None)
        self.release.assert_not_called()
        self.cache.assert_called_once()
        self.remote.assert_called_once()

    def test_unchanged_settings_can_succeed_then_receive_a_truncated_response(self):
        complete = self.response(json.dumps({"summary": "A useful explanation.",
            "recommendations": [], "risks": [], "confidence": "medium"}))
        incomplete = self.response('{"summary":"private-customer-data', finish_reason="length")
        self.remote.side_effect = [complete, incomplete]
        self.assertEqual(self.generate()["source"], "openai")
        self.settle.reset_mock()
        self.cache.reset_mock()
        self.assertIn("reason=response_incomplete", self.failure())
        self.assertEqual(self.remote.call_count, 2)
        first, second = [call.args[0] for call in self.remote.call_args_list]
        self.assertEqual(first.data, second.data)
        self.assertEqual(first.full_url, second.full_url)
        self.assertEqual(first.headers, second.headers)
        self.assertEqual(self.remote.call_args_list[0].kwargs, self.remote.call_args_list[1].kwargs)


if __name__ == "__main__":
    unittest.main()
