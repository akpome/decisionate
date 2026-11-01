"""Offline knowledge checks: no app imports, database, network or model calls."""

import importlib.util
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "apps/api/scripts/knowledge_repository.py"
spec = importlib.util.spec_from_file_location("knowledge_repository", SCRIPT)
knowledge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(knowledge)


class KnowledgeRepositoryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        shutil.copytree(ROOT / knowledge.KB, self.root / knowledge.KB)
        packaged = self.root / knowledge.PACKAGED_CUSTOMER
        packaged.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / knowledge.PACKAGED_CUSTOMER, packaged)
        self.manifest = knowledge.read_json(self.root / knowledge.KB / "manifest.json")
        sources = {source for article in self.manifest["articles"] for source in article["sources"]}
        for source in sources:
            destination = self.root / source
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / source, destination)

    def save_manifest(self):
        knowledge.write_json(self.root / knowledge.KB / "manifest.json", self.manifest)

    def cli(self, *arguments):
        return subprocess.run([sys.executable, "-B", str(self.root / "apps/api/scripts/knowledge_repository.py"), *arguments],
                              capture_output=True, text=True, check=False)

    def test_repository_and_committed_customer_export_are_consistent(self):
        summary = knowledge.check(self.root)
        self.assertEqual(summary["articles"], 36)
        self.assertEqual(summary["customer_articles"], 30)
        self.assertEqual(summary["operator_articles"], 6)
        self.assertEqual(summary["connectors"], 27)
        self.assertEqual(summary["evaluation_cases"], 45)
        self.assertEqual(summary["business_questions"], 174)
        self.assertGreater(summary["customer_chunks"], 100)

    def test_default_export_contains_only_customer_content_and_safe_metadata(self):
        manifest, documents = knowledge.read_repository(self.root)
        rows = list(knowledge.export_records(manifest, documents))
        self.assertEqual({row["audience"] for row in rows}, {"customer"})
        self.assertTrue(all(not row["article_id"].startswith("operator-") for row in rows))
        self.assertTrue(all(not any(value.startswith("operator-") for value in row["related_article_ids"]) for row in rows))
        self.assertTrue(all("sources" not in row and "source_sha256" not in row for row in rows))
        self.assertNotIn("AI_API_KEY", knowledge.jsonl(manifest, documents))
        self.assertEqual(len({row["chunk_id"] for row in rows}), len(rows))

    def test_operator_export_is_explicit_and_separate(self):
        manifest, documents = knowledge.read_repository(self.root)
        rows = list(knowledge.export_records(manifest, documents, "operator"))
        self.assertEqual({row["audience"] for row in rows}, {"operator"})
        self.assertEqual(len({row["article_id"] for row in rows}), 6)
        with self.assertRaises(knowledge.KnowledgeError):
            list(knowledge.export_records(manifest, documents, "all"))

    def test_customer_export_is_deterministic_jsonl(self):
        manifest, documents = knowledge.read_repository(self.root)
        first = knowledge.jsonl(manifest, documents)
        self.assertEqual(first, knowledge.jsonl(manifest, documents))
        self.assertTrue(all(json.loads(line)["verification"] == "source_reviewed_not_live_state" for line in first.splitlines()))
        self.assertTrue(first.endswith("\n"))

    def test_section_links_open_the_relevant_tool_without_changing_article_routes(self):
        manifest, documents = knowledge.read_repository(self.root)
        original = json.dumps(manifest)
        rows = {row["chunk_id"]: row for row in knowledge.export_records(manifest, documents)}
        for slug, path in [
            ("which-advertising-platform-gave-better-value-for-my-money", "returns"),
            ("which-products-or-services-leave-the-most-money", "profitability"),
            ("are-customers-coming-back", "retention"),
            ("where-are-potential-sales-being-lost", "conversion"),
            ("when-might-cash-run-short", "cash-flow"),
        ]:
            self.assertEqual(rows[f"performance-analysis:{slug}"]["routes"][0], f"/dashboard/reports/{path}")
        self.assertEqual(rows["reports-build:where-is-business-impact-and-how-do-i-use-it"]["routes"][0], "/dashboard/reports/impact")
        self.assertEqual(rows["product-overview:what-can-ask-decisionate-do"]["routes"][0], "/dashboard/help")
        self.assertEqual(json.dumps(manifest), original)

    def test_unknown_sections_or_unapproved_destinations_fail_closed(self):
        article = self.manifest["articles"][0]
        heading = "Are customers coming back?"
        for routes in [[], {"Invented heading": article["routes"][0]}, {heading: "https://external.test"},
                       {heading: "/platform-admin"}, {heading: "/dashboard/reports?workspace=other"}]:
            with self.subTest(routes=routes):
                article["section_routes"] = routes
                self.save_manifest()
                with self.assertRaisesRegex(knowledge.KnowledgeError, "Section routes"):
                    knowledge.read_repository(self.root)

    def test_section_questions_are_scoped_and_bounded(self):
        manifest, documents = knowledge.read_repository(self.root)
        rows = {row["chunk_id"]: row for row in knowledge.export_records(manifest, documents)}
        returns = rows["performance-analysis:which-advertising-platform-gave-better-value-for-my-money"]
        self.assertIn("Which ad platform gave me more bang for my dollar?", returns["section_questions"])
        self.assertEqual(rows["performance-analysis:are-customers-coming-back"]["section_questions"], [])
        article = self.manifest["articles"][0]
        for questions in [[], {"Unknown heading": ["Question?"]}, {"Are customers coming back?": []},
                          {"Are customers coming back?": ["x" * 301]}, {"Are customers coming back?": ["Question?"] * 13}]:
            with self.subTest(questions=questions):
                article["section_questions"] = questions
                self.save_manifest()
                with self.assertRaises(knowledge.KnowledgeError):
                    knowledge.read_repository(self.root)

    def test_direct_questions_are_reviewed_separately_and_cannot_have_ambiguous_answers(self):
        manifest, documents = knowledge.read_repository(self.root)
        rows = {row["chunk_id"]: row for row in knowledge.export_records(manifest, documents)}
        direct = rows["performance-analysis:how-do-i-use-return-on-spend"]
        self.assertIn("how do use the return on spend under business analysis", direct["direct_questions"])
        self.assertEqual(direct["routes"][0], "/dashboard/reports/returns")
        self.assertEqual(rows["performance-analysis:can-i-compare-channels-with-only-ad-spend-and-total-store-revenue"]["direct_questions"], [])
        article = self.manifest["articles"][0]
        for questions in [[], {"Unknown heading": ["How do I use this?"]},
                          {"Are customers coming back?": ["How do I use Return on spend?", "HOW DO I USE RETURN ON SPEND"]},
                          {"Are customers coming back?": ["?"]},
                          {"Are customers coming back?": ["How do I use Budget Planner?"]}]:
            with self.subTest(questions=questions):
                article["direct_questions"] = questions
                self.save_manifest()
                with self.assertRaises(knowledge.KnowledgeError):
                    knowledge.read_repository(self.root)

    def test_business_question_coverage_rejects_unapproved_or_duplicate_targets(self):
        path = self.root / knowledge.KB / "analysis-question-coverage.json"
        original = path.read_text()
        manifest, documents = knowledge.read_repository(self.root)
        for change in [
            {"chunk_id": "operator-architecture:overview"}, {"chunk_id": "invented:section"},
            {"questions": []}, {"questions": ["Same question?", "Same question?"]},
            {"tool": ""}, {"id": "chat-boundary"},
        ]:
            with self.subTest(change=change):
                coverage = json.loads(original)
                coverage["cases"][0].update(change)
                knowledge.write_json(path, coverage)
                with self.assertRaises(knowledge.KnowledgeError):
                    knowledge.read_question_coverage(self.root, manifest, documents)

    def test_duplicate_id_and_wrong_audience_path_fail_closed(self):
        self.manifest["articles"][1]["id"] = self.manifest["articles"][0]["id"]
        self.save_manifest()
        with self.assertRaisesRegex(knowledge.KnowledgeError, "duplicate article"):
            knowledge.read_repository(self.root)
        self.manifest["articles"][1]["id"] = "new-identity"
        self.manifest["articles"][0]["path"] = "operator/architecture.md"
        self.save_manifest()
        with self.assertRaisesRegex(knowledge.KnowledgeError, "audience path"):
            knowledge.read_repository(self.root)

    def test_customer_related_links_cannot_reference_operator_articles(self):
        self.manifest["articles"][0]["related"] = ["operator-ai-configuration"]
        self.save_manifest()
        with self.assertRaisesRegex(knowledge.KnowledgeError, "links to operator"):
            knowledge.read_repository(self.root)

    def test_traversal_absolute_paths_and_external_symlinks_are_rejected(self):
        for relative in ("../manifest.json", "/etc/passwd", "customer/../operator/architecture.md"):
            with self.assertRaises(knowledge.KnowledgeError):
                knowledge.safe_file(self.root / knowledge.KB, relative)
        target = self.root / "private.txt"
        target.write_text("Never index this", encoding="utf-8")
        (self.root / knowledge.KB / "customer/escape.md").symlink_to(target)
        with self.assertRaises(knowledge.KnowledgeError):
            knowledge.safe_file(self.root / knowledge.KB, "customer/escape.md")

    def test_secret_files_cannot_be_source_references(self):
        self.manifest["articles"][0]["sources"] = ["apps/api/.env"]
        self.save_manifest()
        with self.assertRaisesRegex(knowledge.KnowledgeError, "Unapproved source"):
            knowledge.read_repository(self.root)

    def test_unregistered_article_is_not_silently_accepted(self):
        (self.root / knowledge.KB / "customer/unregistered.md").write_text("Unreviewed", encoding="utf-8")
        with self.assertRaisesRegex(knowledge.KnowledgeError, "do not match"):
            knowledge.read_repository(self.root)

    def test_source_change_blocks_check_and_export(self):
        source = self.root / self.manifest["articles"][0]["sources"][0]
        source.write_text(source.read_text(encoding="utf-8") + "\n// Changed source\n", encoding="utf-8")
        with self.assertRaisesRegex(knowledge.KnowledgeError, "implementation changed"):
            knowledge.check(self.root)
        result = self.cli("export")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout, "")
        self.assertIn("stale", result.stderr)

    def test_article_change_blocks_check_and_export(self):
        article = self.root / knowledge.KB / self.manifest["articles"][0]["path"]
        article.write_text(article.read_text(encoding="utf-8") + "\nUnreviewed change.\n", encoding="utf-8")
        with self.assertRaisesRegex(knowledge.KnowledgeError, "Article content changed"):
            knowledge.check(self.root)
        result = self.cli("export")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout, "")

    def test_stale_committed_export_is_detected(self):
        (self.root / knowledge.KB / "generated/customer.jsonl").write_text("{}\n", encoding="utf-8")
        with self.assertRaisesRegex(knowledge.KnowledgeError, "export is stale"):
            knowledge.check(self.root)

    def test_connector_inventory_retains_planned_and_runtime_distinctions(self):
        inventory = knowledge.connector_inventory(self.root)
        sources = {item["type"]: item for item in inventory["sources"]}
        self.assertTrue(sources["lightspeed_k"]["forced_planned"])
        self.assertTrue(sources["lightspeed_o"]["forced_planned"])
        self.assertTrue(all(item["runtime_availability"] == "not_checked" for item in sources.values()))
        self.assertEqual(sources["sage"]["label"], "Sage Cloud Accounting")
        self.assertNotIn("environment_keys", json.dumps(inventory))

    def test_evaluation_audience_crossing_is_rejected(self):
        path = self.root / knowledge.KB / "evaluation-cases.json"
        cases = knowledge.read_json(path)
        cases["cases"][0]["articles"] = ["operator-ai-configuration"]
        knowledge.write_json(path, cases)
        with self.assertRaisesRegex(knowledge.KnowledgeError, "wrong knowledge audience"):
            knowledge.check(self.root)

    def test_cli_default_exports_customer_only_and_blocks_input_overwrite(self):
        result = self.cli("export")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual({json.loads(line)["audience"] for line in result.stdout.splitlines()}, {"customer"})
        target = self.root / knowledge.KB / "manifest.json"
        before = target.read_bytes()
        blocked = self.cli("export", "--output", str(target))
        self.assertNotEqual(blocked.returncode, 0)
        self.assertEqual(target.read_bytes(), before)

    def test_cli_blocks_operator_output_in_customer_generated_directory(self):
        for path in ("generated/operator.jsonl", "customer/operator.jsonl"):
            with self.subTest(path=path):
                target = self.root / knowledge.KB / path
                result = self.cli("export", "--audience", "operator", "--output", str(target))
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(target.exists())
                self.assertIn("outside the customer", result.stderr)

    def test_cli_does_not_overwrite_non_jsonl_documents(self):
        target = self.root / knowledge.KB / "README.md"
        before = target.read_bytes()
        result = self.cli("export", "--output", str(target))
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(target.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
