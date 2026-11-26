"""Bound request bodies before multipart parsing can exhaust disk space."""

from asyncio import Semaphore

from starlette.responses import JSONResponse
from fastapi import HTTPException
from starlette.formparsers import MultiPartException


from app.infrastructure.ingestion_limits import UPLOAD_MAX_BYTES as UPLOAD_MAX_BYTES


REQUEST_MAX_BYTES = 10 * 1024 * 1024
MAX_CONCURRENT_UPLOADS = 4


class RequestBodyTooLarge(HTTPException, MultiPartException):
    def __init__(self):
        self.message = "Request body exceeds the size limit."
        HTTPException.__init__(self, 413, self.message)


class RequestBodyLimitMiddleware:
    def __init__(self, app):
        self.app = app
        self.upload_slots = Semaphore(MAX_CONCURRENT_UPLOADS)

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        if scope.get("method") == "POST" and scope["path"] == "/datasets/upload":
            if self.upload_slots.locked():
                return await JSONResponse(
                    {"detail": "File uploads are busy. Please try again shortly."},
                    status_code=429, headers={"Retry-After": "10"},
                )(scope, receive, send)
            async with self.upload_slots:
                return await self._bounded_request(scope, receive, send, UPLOAD_MAX_BYTES + 1024 * 1024)
        return await self._bounded_request(scope, receive, send, REQUEST_MAX_BYTES)

    async def _bounded_request(self, scope, receive, send, limit):
        headers = dict(scope.get("headers", []))
        try:
            length = int(headers.get(b"content-length", b"0"))
        except ValueError:
            length = limit + 1
        if length < 0 or length > limit:
            return await JSONResponse(
                {"detail": "Request body exceeds the size limit."}, status_code=413,
            )(scope, receive, send)

        received = 0
        exceeded = False

        async def bounded_receive():
            nonlocal received, exceeded
            message = await receive()
            received += len(message.get("body", b""))
            if received > limit:
                exceeded = True
                # Abort multipart parsing and close its spooled files.
                raise RequestBodyTooLarge()
            return message

        async def bounded_send(message):
            if exceeded and message["type"] == "http.response.start":
                message = {**message, "status": 413}
            await send(message)

        await self.app(scope, bounded_receive, bounded_send)
