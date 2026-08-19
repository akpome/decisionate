from __future__ import annotations

import json
from typing import Any

from app.configuration import get_runtime_configuration


class CacheUnavailable(RuntimeError):
    pass


def _provider() -> str:
    return get_runtime_configuration().cache_provider


def _redis_client():
    try:
        import redis
    except ModuleNotFoundError as error:
        raise CacheUnavailable("Redis caching requires the redis package") from error

    url = get_runtime_configuration().redis_url
    if not url:
        raise CacheUnavailable("REDIS_URL is required for Redis caching")
    return redis.Redis.from_url(url, decode_responses=True)


def get_json(key: str) -> Any | None:
    if _provider() != "redis":
        return None
    try:
        value = _redis_client().get(key)
    except CacheUnavailable:
        raise
    except Exception as error:
        raise CacheUnavailable("Redis cache is unavailable") from error
    return json.loads(value) if value else None


def set_json(key: str, value: Any, ttl_seconds: int) -> None:
    if _provider() != "redis":
        return
    try:
        _redis_client().setex(
            key,
            max(int(ttl_seconds), 1),
            json.dumps(value, default=str, sort_keys=True),
        )
    except CacheUnavailable:
        raise
    except Exception as error:
        raise CacheUnavailable("Redis cache is unavailable") from error


def build_cache_status() -> dict:
    runtime = get_runtime_configuration()
    provider = runtime.cache_provider
    configured = provider != "redis" or bool(runtime.redis_url)
    return {
        "provider": provider,
        "configured": configured,
        "distributed": provider == "redis",
    }
