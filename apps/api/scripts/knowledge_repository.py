"""Validate and export approved support knowledge without importing the app."""

from __future__ import annotations

import argparse
import ast
import hashlib
import json
import re
import subprocess
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
KB = Path("docs/knowledge-base")
PACKAGED_CUSTOMER = Path("apps/api/app/modules/support/knowledge/customer.jsonl")
SOURCE_REGISTRY = "apps/api/app/modules/datasets/services/sources.py"
AUDIENCES = {"customer", "operator"}


class KnowledgeError(ValueError):
    pass


def safe_file(root: Path, relative: str) -> Path:
    path = Path(relative)
    if path.is_absolute() or ".." in path.parts or not path.parts:
        raise KnowledgeError(f"Unsafe repository path: {relative}")
    resolved = (root / path).resolve()
    if not resolved.is_relative_to(root.resolve()) or not resolved.is_file():
        raise KnowledgeError(f"Missing or unsafe file: {relative}")
    return resolved


def read_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise KnowledgeError(f"Cannot read JSON: {path.name}") from error


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def text_list(value, label, *, nonempty=True):
    if not isinstance(value, list) or (nonempty and not value):
        raise KnowledgeError(f"Expected a list: {label}")
    if any(not isinstance(item, str) or not item.strip() for item in value):
        raise KnowledgeError(f"Expected nonempty strings: {label}")
    if len(set(value)) != len(value):
        raise KnowledgeError(f"Duplicate values: {label}")
    return value


def read_repository(root=ROOT):
    manifest = read_json(safe_file(root, str(KB / "manifest.json")))
    if manifest.get("schema_version") != 1 or manifest.get("default_export_audience") != "customer":
        raise KnowledgeError("Unsupported schema or unsafe default audience")
    try:
        date.fromisoformat(manifest["reviewed_on"])
    except (KeyError, TypeError, ValueError) as error:
        raise KnowledgeError("A valid explicit review date is required") from error
    articles = manifest.get("articles")
    if not isinstance(articles, list) or not articles:
        raise KnowledgeError("No knowledge articles registered")
    identities, paths, documents = set(), set(), {}
    for article in articles:
        identity, path, audience = article.get("id"), article.get("path"), article.get("audience")
        if not isinstance(identity, str) or not re.fullmatch(r"[a-z][a-z0-9-]*", identity) or identity in identities:
            raise KnowledgeError(f"Invalid or duplicate article ID: {identity}")
        if audience not in AUDIENCES:
            raise KnowledgeError(f"Invalid audience: {identity}")
        if not isinstance(path, str) or path in paths or not path.startswith(audience + "/") or not path.endswith(".md"):
            raise KnowledgeError(f"Invalid audience path: {identity}")
        if not isinstance(article.get("title"), str) or not article["title"].strip():
            raise KnowledgeError(f"Missing title: {identity}")
        identities.add(identity)
        paths.add(path)
        for key in ("topics", "questions", "routes", "sources", "related"):
            text_list(article.get(key), f"{identity}.{key}", nonempty=key != "related")
        if any(not route.startswith("/") or route.startswith("//") or "?" in route or "#" in route for route in article["routes"]):
            raise KnowledgeError(f"Use application paths, not external or account URLs: {identity}")
        for source in article["sources"]:
            if not source.startswith(("apps/", "docs/")) or Path(source).suffix not in {".py", ".ts", ".tsx", ".mjs", ".md", ".json"}:
                raise KnowledgeError(f"Unapproved source reference: {source}")
            safe_file(root, source)
        body = safe_file(root / KB, path).read_text(encoding="utf-8")
        if not body.startswith("# ") or len(body.split()) < 100 or "\n## " not in body:
            raise KnowledgeError(f"Article needs a title, sections and substantive content: {identity}")
        documents[identity] = body
    by_id = {article["id"]: article for article in articles}
    for article in articles:
        for related in article["related"]:
            if related not in by_id or related == article["id"]:
                raise KnowledgeError(f"Invalid related article: {article['id']} -> {related}")
            if article["audience"] == "customer" and by_id[related]["audience"] != "customer":
                raise KnowledgeError(f"Customer article links to operator knowledge: {article['id']}")
    registered = {str(KB / article["path"]) for article in articles}
    found = {str(path.relative_to(root)) for audience in AUDIENCES for path in (root / KB / audience).rglob("*.md")}
    if found != registered:
        raise KnowledgeError("Article directories and manifest do not match")
    return manifest, documents


def connector_inventory(root=ROOT):
    tree = ast.parse(safe_file(root, SOURCE_REGISTRY).read_text(encoding="utf-8"))
    names = {"DATASET_SOURCES", "IMPLEMENTED_CONNECTOR_TYPES", "FORCED_PLANNED_CONNECTOR_TYPES"}
    values = {}
    for node in tree.body:
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id in names:
                    try:
                        if target.id == "DATASET_SOURCES":
                            fields = {"type", "label", "category", "status", "connection_type", "sync_modes", "required_config_keys", "config_keys"}
                            # Read only exported literal fields, not computed provider options.
                            if not isinstance(node.value, ast.List) or any(not isinstance(item, ast.Dict) for item in node.value.elts):
                                raise ValueError("Expected source dictionaries")
                            values[target.id] = [{ast.literal_eval(key): ast.literal_eval(value)
                                                  for key, value in zip(item.keys, item.values)
                                                  if ast.literal_eval(key) in fields} for item in node.value.elts]
                        else:
                            values[target.id] = ast.literal_eval(node.value)
                    except (ValueError, TypeError) as error:
                        raise KnowledgeError(f"Registry constant is no longer literal: {target.id}") from error
    if values.keys() != names:
        raise KnowledgeError("Cannot locate source-registry constants")
    sources = []
    for item in values["DATASET_SOURCES"]:
        sources.append({
            "type": item["type"], "label": item["label"], "category": item["category"],
            "connection_type": item["connection_type"], "declared_status": item["status"],
            "implemented_connector_flag": item["type"] in values["IMPLEMENTED_CONNECTOR_TYPES"],
            "forced_planned": item["type"] in values["FORCED_PLANNED_CONNECTOR_TYPES"],
            "sync_modes": item.get("sync_modes", []),
            "required_config_keys": item.get("required_config_keys", item.get("config_keys", [])),
            "runtime_availability": "not_checked",
        })
    return {"schema_version": 1, "source": SOURCE_REGISTRY,
            "scope": "Literal source-registry inventory; implemented flags and declared statuses do not certify runtime availability, permissions, emitted metrics or provider history",
            "sources": sources}


def markdown_sections(body):
    section, lines = "Overview", []
    for line in body.splitlines():
        if line.startswith("## "):
            if lines:
                yield section, "\n".join(lines).strip()
            section, lines = line[3:].strip(), []
        else:
            lines.append(line)
    if lines:
        yield section, "\n".join(lines).strip()


def export_records(manifest, documents, audience="customer"):
    if audience not in AUDIENCES:
        raise KnowledgeError("Export exactly one authorized audience")
    seen = set()
    for article in manifest["articles"]:
        if article["audience"] != audience:
            continue
        for section, body in markdown_sections(documents[article["id"]]):
            slug = re.sub(r"[^a-z0-9]+", "-", section.lower()).strip("-")
            identity = f"{article['id']}:{slug}"
            if not slug or identity in seen or not body:
                raise KnowledgeError(f"Empty or duplicate retrieval section: {identity}")
            seen.add(identity)
            yield {"chunk_id": identity, "article_id": article["id"], "title": article["title"],
                   "section": section, "content": body, "audience": audience,
                   "routes": article["routes"], "topics": article["topics"], "questions": article["questions"],
                   "related_article_ids": [value for value in article["related"] if any(item["id"] == value and item["audience"] == audience for item in manifest["articles"])],
                   "reviewed_on": manifest["reviewed_on"], "verification": "source_reviewed_not_live_state"}


def jsonl(manifest, documents, audience="customer"):
    return "".join(json.dumps(item, ensure_ascii=True, sort_keys=True) + "\n" for item in export_records(manifest, documents, audience))


def source_hashes(root, manifest):
    sources = sorted({source for article in manifest["articles"] for source in article["sources"]})
    return {source: sha256(safe_file(root, source)) for source in sources}


def check(root=ROOT):
    manifest, documents = read_repository(root)
    policy = read_json(safe_file(root, str(KB / "assistant-policy.json")))
    if policy.get("default_audience") != "customer" or not policy.get("retrieval_boundaries", {}).get("never_customer_index"):
        raise KnowledgeError("Missing safe retrieval policy")
    inventory = connector_inventory(root)
    if read_json(safe_file(root, str(KB / "connector-catalog.json"))) != inventory:
        raise KnowledgeError("Connector inventory is stale; review and snapshot")
    snapshot = read_json(safe_file(root, str(KB / "source-snapshot.json")))
    if snapshot.get("reviewed_on") != manifest["reviewed_on"] or snapshot.get("source_sha256") != source_hashes(root, manifest):
        raise KnowledgeError("Referenced implementation changed; review articles before refreshing the snapshot")
    article_hashes = {article["path"]: sha256(safe_file(root / KB, article["path"])) for article in manifest["articles"]}
    if snapshot.get("article_sha256") != article_hashes:
        raise KnowledgeError("Article content changed since source review")
    cases = read_json(safe_file(root, str(KB / "evaluation-cases.json"))).get("cases", [])
    if not cases:
        raise KnowledgeError("Missing future-chatbot acceptance cases")
    seen, by_id = set(), {article["id"]: article for article in manifest["articles"]}
    for case in cases:
        if not isinstance(case.get("id"), str) or case["id"] in seen or case.get("audience") not in AUDIENCES or not case.get("prompt"):
            raise KnowledgeError("Invalid evaluation identity, audience or prompt")
        seen.add(case["id"])
        for key in ("articles", "required_points", "forbidden_claims"):
            text_list(case.get(key), f"{case['id']}.{key}")
        if any(identity not in by_id or by_id[identity]["audience"] != case["audience"] for identity in case["articles"]):
            raise KnowledgeError(f"Evaluation references the wrong knowledge audience: {case['id']}")
    exported = safe_file(root, str(KB / "generated/customer.jsonl")).read_text(encoding="utf-8")
    if exported != jsonl(manifest, documents):
        raise KnowledgeError("Customer export is stale; regenerate after review")
    if safe_file(root, str(PACKAGED_CUSTOMER)).read_text(encoding="utf-8") != exported:
        raise KnowledgeError("Packaged customer knowledge is stale; export it for the API image")
    return {"articles": len(manifest["articles"]),
            "customer_articles": sum(item["audience"] == "customer" for item in manifest["articles"]),
            "operator_articles": sum(item["audience"] == "operator" for item in manifest["articles"]),
            "customer_chunks": len(list(export_records(manifest, documents))),
            "connectors": len(inventory["sources"]), "evaluation_cases": len(cases)}


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")


def snapshot(root, reviewed_on):
    date.fromisoformat(reviewed_on)
    manifest, _ = read_repository(root)
    manifest["reviewed_on"] = reviewed_on
    sources = source_hashes(root, manifest)
    revision = subprocess.run(["git", "rev-parse", "HEAD"], cwd=root, capture_output=True, text=True, check=True).stdout.strip()
    modified = subprocess.run(["git", "diff", "HEAD", "--name-only", "--", *sources], cwd=root, capture_output=True, text=True, check=True).stdout.splitlines()
    untracked = subprocess.run(["git", "ls-files", "--others", "--exclude-standard", "--", *sources], cwd=root, capture_output=True, text=True, check=True).stdout.splitlines()
    write_json(root / KB / "manifest.json", manifest)
    write_json(root / KB / "connector-catalog.json", connector_inventory(root))
    write_json(root / KB / "source-snapshot.json", {
        "schema_version": 1, "reviewed_on": reviewed_on, "base_git_revision": revision,
        "referenced_sources_modified_in_worktree": sorted(set(modified + untracked)),
        "deployment_verification": "Not performed; snapshot describes source, including listed local modifications",
        "source_sha256": sources,
        "article_sha256": {item["path"]: sha256(safe_file(root / KB, item["path"])) for item in manifest["articles"]},
    })


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("check")
    freeze = commands.add_parser("snapshot")
    freeze.add_argument("--reviewed-on", required=True, help="Explicit source review date, YYYY-MM-DD")
    export = commands.add_parser("export")
    export.add_argument("--audience", choices=sorted(AUDIENCES), default="customer")
    export.add_argument("--output", type=Path)
    args = parser.parse_args()
    try:
        if args.command == "check":
            print(json.dumps(check(), indent=2))
        elif args.command == "snapshot":
            snapshot(ROOT, args.reviewed_on)
            print("Source snapshot and literal connector inventory regenerated; export and check next.")
        else:
            manifest, documents = read_repository()
            # Export is a publication boundary: source/content drift must fail closed.
            snapshot_data = read_json(safe_file(ROOT, str(KB / "source-snapshot.json")))
            if snapshot_data.get("source_sha256") != source_hashes(ROOT, manifest) or snapshot_data.get("reviewed_on") != manifest["reviewed_on"]:
                raise KnowledgeError("Source snapshot is stale; review before exporting")
            if snapshot_data.get("article_sha256") != {item["path"]: sha256(safe_file(ROOT / KB, item["path"])) for item in manifest["articles"]}:
                raise KnowledgeError("Article review snapshot is stale")
            result = jsonl(manifest, documents, args.audience)
            if args.output:
                output = args.output.resolve()
                if output.suffix != ".jsonl":
                    raise KnowledgeError("Knowledge exports require a .jsonl output file")
                if args.audience == "operator" and any(output.is_relative_to((ROOT / KB / directory).resolve()) for directory in ("generated", "customer")):
                    raise KnowledgeError("Operator output must stay outside the customer generated directory")
                if args.audience == "operator" and output.is_relative_to((ROOT / "apps/api/app").resolve()):
                    raise KnowledgeError("Operator knowledge must not be packaged in the customer API")
                inputs = {safe_file(ROOT / KB, item["path"]) for item in manifest["articles"]}
                inputs.update(safe_file(ROOT, source) for source in snapshot_data["source_sha256"])
                inputs.update((ROOT / KB / name).resolve() for name in ("manifest.json", "assistant-policy.json", "evaluation-cases.json", "connector-catalog.json", "source-snapshot.json"))
                if output in inputs:
                    raise KnowledgeError("Export cannot overwrite repository inputs")
                output.parent.mkdir(parents=True, exist_ok=True)
                output.write_text(result, encoding="utf-8")
                print(f"Exported {args.audience} knowledge to {args.output}")
            else:
                sys.stdout.write(result)
    except (KnowledgeError, ValueError, OSError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"Knowledge validation failed: {error}\n")


if __name__ == "__main__":
    main()
