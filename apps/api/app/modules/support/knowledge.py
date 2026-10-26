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


@lru_cache(maxsize=1)
def load_knowledge():
    records = tuple(json.loads(line) for line in CORPUS.read_text(encoding="utf-8").splitlines() if line)
    if not records or len(records) > 500:
        raise ValueError("Invalid customer knowledge bundle")
    seen = set()
    for record in records:
        if (record.get("audience") != "customer" or record["article_id"].startswith("operator-")
                or record["chunk_id"] in seen or len(record["content"]) > 12000):
            raise ValueError("Unapproved customer knowledge")
        if any(not re.fullmatch(r"/(?:dashboard(?:/[a-z0-9-]+)*|privacy|terms|security)", route)
               for route in record["routes"]):
            raise ValueError("Unapproved knowledge link")
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
    documents = [Counter(tokens(f"{r['title']} {r['section']} {' '.join(r['topics'])} {r['content']}")) for r in records]
    frequencies = Counter(word for document in documents for word in document)
    average_length = sum(sum(document.values()) for document in documents) / len(documents)
    ranked = []
    for record, document in zip(records, documents):
        matched = query & document.keys()
        if not matched or (len(query) > 1 and len(matched) < 2):
            continue
        score = 0.0
        length = sum(document.values())
        heading = set(tokens(f"{record['title']} {record['section']}"))
        for word in matched:
            weight = math.log(1 + (len(records) - frequencies[word] + 0.5) / (frequencies[word] + 0.5))
            score += weight * document[word] * 2.2 / (document[word] + 1.2 * (0.25 + 0.75 * length / average_length))
            if word in heading:
                score += weight * 0.8
        if record["section"] == "Overview":
            score *= 0.75
        ranked.append((score, record))
    ranked.sort(key=lambda item: (-item[0], item[1]["chunk_id"]))
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
