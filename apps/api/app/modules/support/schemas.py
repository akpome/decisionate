from typing import Literal

from pydantic import BaseModel


class SupportRequestCreate(BaseModel):
    request_type: Literal["support", "bug", "feature"] = "support"
    requester_email: str
    subject: str
    message: str
    page_url: str = ""


class SupportRequestResponse(BaseModel):
    accepted: bool
    message: str
