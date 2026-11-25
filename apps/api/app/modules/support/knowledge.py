"""Retrieve only the reviewed customer corpus shipped in the API image."""

import json
import math
import re
from collections import Counter
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

CORPUS = Path(__file__).with_name("knowledge") / "customer.jsonl"
KNOWLEDGE_ROUTE = re.compile(
    r"/(?:(?:dashboard|action-needed|alerts|billing|budget-planner|business-impact|business-analysis|"
    r"connections|dashboards|datasets|decisions|entity-matching|forecasts|help|hosted-portal|insights|"
    r"relationships|reports|settings|weekly-reports|white-label)(?:/[a-z0-9-]+)*|privacy|terms|security)"
)
STOP_WORDS = frozenset(["a", "an", "and", "are", "as", "at", "be", "been", "but", "by", "can", "could", "did", "do", "does", "for", "from", "had", "has", "have", "how", "i", "if", "in", "is", "it", "its", "me", "my", "of", "on", "or", "our", "please", "should", "so", "than", "that", "the", "their", "them", "there", "these", "they", "this", "to", "use", "using", "was", "we", "what", "when", "where", "which", "why", "will", "with", "would", "you", "your"])
USAGE_REQUEST = re.compile(
    r"\b(?:how (?:do|can|should) (?:i |we )?use|how to use|walk me through|guide me (?:on|through)|get started with)\b"
)


@dataclass(frozen=True)
class SearchSection:
    record: dict
    terms: Counter[str]
    headings: frozenset[str]
    section_questions: frozenset[tuple[str, ...]]
    usage_topics: tuple[str, ...]
    length: int


@dataclass(frozen=True)
class KnowledgeIndex:
    sections: tuple[SearchSection, ...]
    direct_answers: dict[tuple[str, ...], dict]
    weights: dict[str, float]
    average_length: float

    def direct_answer(self, question):
        return self.direct_answers.get(question_key(question))


def tokens(text):
    normalized = text.lower().replace("anomalies", "anomaly")
    normalized = re.sub(r"\b(correlation|correlations)\b", "relationship", normalized)
    normalized = re.sub(r"\b(caused|causal)\b", "causation", normalized)
    words = re.findall(r"[a-z0-9]+", normalized)
    return [word[:-1] if word.endswith("s") and len(word) > 4 else word
            for word in words if word not in STOP_WORDS and len(word) > 1]


def question_key(text):
    # Ignore only case, whitespace and punctuation, never qualifiers or negation.
    return tuple(re.findall(r"\w+", text.casefold()))


def build_knowledge(records):
    if not records or len(records) > 500:
        raise ValueError("Invalid customer knowledge bundle")
    seen, direct_answers, sections = set(), {}, []
    for record in records:
        if (record.get("audience") != "customer" or record["article_id"].startswith("operator-")
                or record["chunk_id"] in seen or len(record["content"]) > 12000):
            raise ValueError("Unapproved customer knowledge")
        if any(not KNOWLEDGE_ROUTE.fullmatch(route)
               for route in record["routes"]):
            raise ValueError("Unapproved knowledge link")
        for field in ("section_questions", "direct_questions"):
            questions = record.get(field, [])
            if (not isinstance(questions, list) or len(questions) > 12
                    or any(not isinstance(question, str) or not question_key(question) or len(question) > 300 for question in questions)):
                raise ValueError("Invalid section questions")
        usage_topics = []
        for question in record.get("direct_questions", []):
            key = question_key(question)
            if key in direct_answers:
                raise ValueError("Ambiguous direct question")
            direct_answers[key] = record
            if key[:4] == ("how", "do", "i", "use") and key[4:]:
                usage_topics.append(f" {' '.join(key[4:])} ")
        seen.add(record["chunk_id"])

        # Only section-specific hints count as search evidence.
        hints = " ".join([*record.get("section_questions", []), *record.get("direct_questions", [])])
        heading = f"{record['title']} {record['section']}"
        terms = Counter(tokens(f"{heading} {' '.join(record['topics'])} {record['content']}"))
        terms.update(set(tokens(hints)))
        sections.append(SearchSection(
            record, terms, frozenset(tokens(f"{heading} {hints}")),
            frozenset(map(question_key, record.get("section_questions", []))),
            tuple(usage_topics), sum(terms.values()),
        ))

    frequencies = Counter(word for section in sections for word in section.terms)
    weights = {
        word: math.log(1 + (len(sections) - count + 0.5) / (count + 0.5))
        for word, count in frequencies.items()
    }
    return KnowledgeIndex(
        tuple(sections), direct_answers, weights,
        sum(section.length for section in sections) / len(sections),
    )


@lru_cache(maxsize=1)
def load_knowledge():
    records = [json.loads(line) for line in CORPUS.read_text(encoding="utf-8").splitlines() if line]
    return build_knowledge(records)


def retrieve(question, history=(), limit=5):
    index = load_knowledge()
    query = set(tokens(question))
    # Only dependent follow-ups borrow context; a new short question starts fresh.
    dependent = re.search(r"\b(this|that|these|those|it|they|them|same|above|earlier)\b", question, re.IGNORECASE)
    if len(query) < 4 and dependent:
        for turn in list(history)[-2:]:
            if turn.role == "user":
                query.update(tokens(turn.content))
    if not query:
        return []
    key = question_key(question)
    direct = index.direct_answers.get(key)
    normalized = f" {' '.join(key)} "
    guides = [
        section.record for section in index.sections if any(topic in normalized for topic in section.usage_topics)
    ] if USAGE_REQUEST.search(normalized) else []
    guide = guides[0] if len(guides) == 1 else None
    ranked = []
    for section in index.sections:
        matched = query & section.terms.keys()
        if not matched or (len(query) > 1 and len(matched) < 2):
            continue
        score = 0.0
        length_weight = 1.2 * (0.25 + 0.75 * section.length / index.average_length)
        for word in matched:
            weight, count = index.weights[word], section.terms[word]
            score += weight * count * 2.2 / (count + length_weight)
            if word in section.headings:
                score += weight * 0.8
        if section.record["section"] == "Overview":
            score *= 0.75
        ranked.append((score, section))
    ranked.sort(key=lambda item: (
        item[1].record is not direct, item[1].record is not guide,
        key not in item[1].section_questions, -item[0], item[1].record["chunk_id"],
    ))
    selected, per_article, characters = [], Counter(), 0
    for score, section in ranked:
        record = section.record
        if score < 2.0 or per_article[record["article_id"]] >= 2:
            continue
        if characters + len(record["content"]) > 16000:
            continue
        selected.append(record)
        characters += len(record["content"])
        per_article[record["article_id"]] += 1
        if len(selected) == limit:
            break
    return selected
