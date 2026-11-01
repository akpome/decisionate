"""Retrieve only the reviewed customer corpus shipped in the API image."""

import json
import math
import re
from collections import Counter
from functools import lru_cache
from pathlib import Path

CORPUS = Path(__file__).with_name("knowledge") / "customer.jsonl"
STOP_WORDS = frozenset(["a", "an", "and", "are", "as", "at", "be", "been", "but", "by", "can", "could", "did", "do", "does", "for", "from", "had", "has", "have", "how", "i", "if", "in", "is", "it", "its", "me", "my", "of", "on", "or", "our", "please", "should", "so", "than", "that", "the", "their", "them", "there", "these", "they", "this", "to", "use", "using", "was", "we", "what", "when", "where", "which", "why", "will", "with", "would", "you", "your"])


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


def direct_answer_record(question, records):
    key = question_key(question)
    matches = [record for record in records if key and any(
        question_key(approved) == key for approved in record.get("direct_questions", [])
    )]
    return matches[0] if len(matches) == 1 else None


def usage_guide_record(question, records):
    normalized = " ".join(question_key(question))
    if not re.search(r"\b(?:how (?:do|can|should) (?:i |we )?use|how to use|walk me through|guide me (?:on|through)|get started with)\b", normalized):
        return None
    matches = []
    for record in records:
        for approved in record.get("direct_questions", []):
            words = question_key(approved)
            if words[:4] == ("how", "do", "i", "use") and words[4:] and " " + " ".join(words[4:]) + " " in " " + normalized + " ":
                matches.append(record)
                break
    # This prioritizes instructions for retrieval, not complete answer coverage.
    return matches[0] if len(matches) == 1 else None


@lru_cache(maxsize=1)
def load_knowledge():
    records = tuple(json.loads(line) for line in CORPUS.read_text(encoding="utf-8").splitlines() if line)
    if not records or len(records) > 500:
        raise ValueError("Invalid customer knowledge bundle")
    seen, direct_questions = set(), set()
    for record in records:
        if (record.get("audience") != "customer" or record["article_id"].startswith("operator-")
                or record["chunk_id"] in seen or len(record["content"]) > 12000):
            raise ValueError("Unapproved customer knowledge")
        if any(not re.fullmatch(r"/(?:dashboard(?:/[a-z0-9-]+)*|privacy|terms|security)", route)
               for route in record["routes"]):
            raise ValueError("Unapproved knowledge link")
        for field in ("section_questions", "direct_questions"):
            questions = record.get(field, [])
            if (not isinstance(questions, list) or len(questions) > 12
                    or any(not isinstance(question, str) or not question_key(question) or len(question) > 300 for question in questions)):
                raise ValueError("Invalid section questions")
        for question in record.get("direct_questions", []):
            key = question_key(question)
            if key in direct_questions:
                raise ValueError("Ambiguous direct question")
            direct_questions.add(key)
        seen.add(record["chunk_id"])
    return records


def retrieve(question, history=(), limit=5):
    records = load_knowledge()
    query = set(tokens(question))
    # Only dependent follow-ups borrow context; a new short question starts fresh.
    dependent = re.search(r"\b(this|that|these|those|it|they|them|same|above|earlier)\b", question, re.IGNORECASE)
    if len(query) < 4 and dependent:
        for turn in list(history)[-2:]:
            if turn.role == "user":
                query.update(tokens(turn.content))
    if not query:
        return []
    # Article-wide questions are not evidence that every section answers them.
    hints = [' '.join([*r.get("section_questions", []), *r.get("direct_questions", [])]) for r in records]
    headings = [set(tokens(f"{r['title']} {r['section']} {hint}")) for r, hint in zip(records, hints)]
    documents = [Counter(tokens(f"{r['title']} {r['section']} {' '.join(r['topics'])} {r['content']}"))
                 + Counter(set(tokens(hint))) for r, hint in zip(records, hints)]
    frequencies = Counter(word for document in documents for word in document)
    average_length = sum(sum(document.values()) for document in documents) / len(documents)
    ranked = []
    for record, document, heading in zip(records, documents, headings):
        matched = query & document.keys()
        if not matched or (len(query) > 1 and len(matched) < 2):
            continue
        score = 0.0
        length = sum(document.values())
        for word in matched:
            weight = math.log(1 + (len(records) - frequencies[word] + 0.5) / (frequencies[word] + 0.5))
            score += weight * document[word] * 2.2 / (document[word] + 1.2 * (0.25 + 0.75 * length / average_length))
            if word in heading:
                score += weight * 0.8
        if record["section"] == "Overview":
            score *= 0.75
        ranked.append((score, record))
    direct = direct_answer_record(question, records)
    guide = usage_guide_record(question, records)
    ranked.sort(key=lambda item: (item[1] is not direct, item[1] is not guide, -item[0], item[1]["chunk_id"]))
    selected, per_article, characters = [], Counter(), 0
    for score, record in ranked:
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
