import json
import os
import unittest
from unittest.mock import patch

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


if __name__ == "__main__":
    unittest.main()
