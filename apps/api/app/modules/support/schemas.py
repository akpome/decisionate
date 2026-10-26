from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class SupportRequestCreate(BaseModel):
    request_type: Literal["support", "bug", "feature"] = "support"
    requester_email: str
    subject: str
    message: str
    page_url: str = ""


class SupportRequestResponse(BaseModel):
    accepted: bool
    message: str


class GuidanceTurn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=2000)


class GuidanceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    question: str = Field(min_length=1, max_length=2000)
    history: list[GuidanceTurn] = Field(default_factory=list, max_length=6)


class GuidanceSource(BaseModel):
    chunk_id: str
    title: str
    section: str
    content: str
    route: str
    reviewed_on: str


class GuidanceResponse(BaseModel):
    answer: str
    mode: Literal["ai", "documentation", "unavailable"]
    sources: list[GuidanceSource] = Field(default_factory=list)
    contact_support: bool = False
