"""Current Resend REST API; reuse platform credentials, not deprecated audiences."""

import json
import time
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from app.modules.alerts.email_delivery import get_platform_email_settings


class ProviderError(RuntimeError):
    def __init__(self, code, *, retry_after=0, uncertain=False):
        self.code = code
        self.retry_after = retry_after
        self.uncertain = uncertain
        self.retryable = uncertain or code in {"network", 429, 500, 502, 503, 504}
        super().__init__(f"Resend request failed ({code})")


class ResendMarketing:
    def __init__(self, heartbeat=None):
        self.config = get_platform_email_settings()
        self.heartbeat = heartbeat or (lambda: None)

    def request(self, method, path, payload=None, key=None, missing_ok=False):
        if not self.config["resend_api_key"]:
            raise ProviderError("unconfigured")
        self.heartbeat()
        # The shared worker is single-consumer. Leave headroom under Resend's
        # default rate limit; 429 responses still receive persistent backoff.
        time.sleep(0.6)
        headers = {"Authorization": f"Bearer {self.config['resend_api_key']}", "Content-Type": "application/json"}
        if key:
            headers["Idempotency-Key"] = key
        request = Request("https://api.resend.com" + path, method=method,
                          headers=headers, data=json.dumps(payload).encode() if payload is not None else None)
        try:
            with urlopen(request, timeout=10) as response:
                body = response.read()
            return json.loads(body) if body else {}
        except HTTPError as error:
            if missing_ok and error.code == 404:
                return None
            try:
                retry_after = int(error.headers.get("Retry-After", "0"))
            except (TypeError, ValueError):
                retry_after = 60
            raise ProviderError(error.code, retry_after=retry_after) from None
        except (URLError, OSError, TimeoutError):
            raise ProviderError("network", uncertain=bool(key)) from None
        except ValueError:
            raise ProviderError("invalid_response", uncertain=bool(key)) from None

    def get_contact(self, identifier):
        return self.request("GET", "/contacts/" + quote(identifier, safe=""), missing_ok=True)

    def segments(self, identifier):
        records, after = [], None
        while True:
            path = f"/contacts/{quote(identifier, safe='')}/segments?limit=100"
            if after:
                path += "&after=" + quote(after, safe="")
            result = self.request("GET", path)
            records.extend(result["data"])
            if not result.get("has_more") or not result["data"]:
                return {record["id"] for record in records}
            after = result["data"][-1]["id"]
