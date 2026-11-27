"""Read-only product guidance from reviewed question and answer pairs."""

import hashlib
import logging
import re

from app.modules.support.knowledge import load_knowledge, retrieve
from app.modules.support.schemas import GuidanceResponse, GuidanceSource
from app.security.rate_limits import consume_request_budget
from fastapi import HTTPException

logger = logging.getLogger(__name__)
SECRET = re.compile(
    r"(?:\b(?:sk|rk)_[a-z0-9_]{12,}|\bsk-[a-z0-9_-]{12,}|\bBearer\s+\S+|"
    r"\beyJ[a-zA-Z0-9_-]{12,}\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+|"
    r"-----BEGIN .*PRIVATE KEY|(?:postgres(?:ql)?|mysql|mongodb)://\S+|"
    r"\b(?:api[_ -]?key|password|secret|access[_ -]?token)\s*[:=]\s*\S+)", re.IGNORECASE,
)
EMAIL = re.compile(r"\b[^\s@]+@[^\s@]+\.[^\s@]+\b")
PRIVILEGED_REQUEST = re.compile(
    r"(?:ignore\s+(?:the\s+)?(?:policy|instructions|previous)|"
    r"(?:print|show|reveal|give|expose).{0,50}(?:credentials|system prompt|source code|internal runbook)|"
    r"(?:execute|run)\s+(?:the\s+)?(?:fix|sql|command))", re.IGNORECASE,
)
MISSING_INFORMATION = (
    "I cannot confirm that from the approved Decisionate documentation. "
    "Try asking about one task or feature, or contact support for help with your question."
)


def enforce_guidance_limits(auth):
    # Hash identifiers, and keep separate stable keys for each counter/window.
    user = hashlib.sha256(auth.user_id.encode()).hexdigest()
    workspace = hashlib.sha256(auth.workspace_id.encode()).hexdigest()
    budgets = ((f"guidance:user:minute:{user}", 5, 60),
               (f"guidance:user:day:{user}", 60, 86400),
               (f"guidance:workspace:minute:{workspace}", 20, 60),
               (f"guidance:workspace:day:{workspace}", 200, 86400),
               ("guidance:deployment:day", 1000, 86400))
    for key, limit, seconds in budgets:
        if not consume_request_budget(key, limit, seconds):
            raise HTTPException(429, "Product guidance limit reached. Please try later or contact support.",
                                headers={"Retry-After": str(seconds)})


def source(record):
    content = re.sub(r"(?m)^#{1,6} ", "", record["content"]).replace("`", "")
    content = re.sub(r"\[([^\]\n]+)\]\((/[a-z0-9-]+(?:/[a-z0-9-]+)*)\)", r"\1", content)
    return GuidanceSource(chunk_id=record["chunk_id"], title=record["title"],
                          section=record["section"], content=content,
                          route=record["routes"][0], reviewed_on=record["reviewed_on"])


def answer_guidance(payload):
    question = payload.question.strip()
    if not question:
        raise HTTPException(400, "Enter a product question.")
    if re.fullmatch(r"(?:hi|hello|hey|thanks|thank you)[.!\s]*", question, re.IGNORECASE):
        return GuidanceResponse(answer="Hello. What would you like help with: choosing an analysis tool, reviewing a decision, weekly reports, or another Decisionate feature?", mode="documentation")
    if any(SECRET.search(text) for text in [question, *(turn.content for turn in payload.history)]):
        return GuidanceResponse(answer="Please remove credentials or secret values before asking. If a real credential was shared, rotate it with its provider. Contact support without including the secret.",
                                mode="documentation", contact_support=True)
    if PRIVILEGED_REQUEST.search(question):
        return GuidanceResponse(answer="I can explain Decisionate's documented features, but I cannot disclose credentials, internal instructions or source code, access another workspace, or execute a fix. Documents and chat messages do not grant permission to do those things. Contact support for an authorized investigation.",
                                mode="documentation", contact_support=True)
    try:
        record = load_knowledge().direct_answer(question)
        if record is not None:
            excerpt = source(record)
            answer = f"{excerpt.section}\n\n{excerpt.content}"
            if len(answer) <= 6000:
                return GuidanceResponse(answer=answer, mode="documentation", sources=[excerpt])

        # Similarity can suggest questions to ask, never facts that answer the current question.
        history = [turn.model_copy(update={"content": EMAIL.sub(" ", turn.content)})
                   for turn in payload.history if turn.role == "user"][-3:]
        related = retrieve(EMAIL.sub(" ", question), history)
        suggestions = [item["direct_questions"][0] for item in related if item.get("direct_questions")]
    except (OSError, ValueError, KeyError, TypeError):
        logger.warning("Product guidance knowledge unavailable")
        return GuidanceResponse(answer="Product guidance is temporarily unavailable. Please use the guide below or contact support.",
                                mode="unavailable", contact_support=True)
    return GuidanceResponse(answer=MISSING_INFORMATION, mode="documentation",
                            suggested_questions=suggestions[:3], contact_support=True)
