"""Bound request bodies before multipart parsing can exhaust disk space."""

from starlette.responses import JSONResponse
from fastapi import HTTPException
from starlette.formparsers import MultiPartException


UPLOAD_MAX_BYTES = 100 * 1024 * 1024
REQUEST_MAX_BYTES = 10 * 1024 * 1024


class RequestBodyTooLarge(HTTPException, MultiPartException):
    def __init__(self):
        self.message = "Request body exceeds the size limit."
        HTTPException.__init__(self, 413, self.message)


class RequestBodyLimitMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        limit = (
            UPLOAD_MAX_BYTES + 1024 * 1024
            if scope["path"] == "/datasets/upload"
            else REQUEST_MAX_BYTES
        )
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
