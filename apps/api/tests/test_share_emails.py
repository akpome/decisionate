import asyncio
import json
import unittest
from types import SimpleNamespace
from urllib.parse import parse_qs, urlsplit
from unittest.mock import patch

from fastapi import HTTPException, Response

from app.db.models import DashboardShare, Dataset, DatasetJoinCache, Organization, UserPreference, WorkspaceApplication
from app.application_context import application_scope, get_application
from app.modules import share_emails as sharing
from app.modules import sharing_links
from app.modules.sharing_links import SharedLink
from app.modules.reports import public
from app.modules.reports.cleanup import cleanup_source, cleanup_workspace
from app.modules.reports.models import BusinessReport, ReportShare
from tests import test_business_reports as fixtures
from tests.test_dashboard_groups import joined_fixture


class ShareEmailTests(unittest.TestCase):
    def setUp(self):
        fixtures.BusinessReportWorkflowTests.setUp(self)
        self.client.app.include_router(sharing.router)
        self.client.app.include_router(public.router)
        for module in (sharing, sharing_links, public):
            patcher = patch.object(module, "SessionLocal", self.Session)
            patcher.start(); self.addCleanup(patcher.stop)
        replacements = (("get_auth_context", lambda request: SimpleNamespace(user_id="owner", workspace_id=request.headers.get("X-Workspace-Id", "owner"))),
                        ("require_workspace_data_manager", lambda request: None),
                        ("require_email_delivery_configured", lambda: None))
        for name, value in replacements:
            patcher = patch.object(sharing, name, value)
            patcher.start(); self.addCleanup(patcher.stop)
            if hasattr(sharing_links, name):
                self.enterContext(patch.object(sharing_links, name, value))
        self.email = self.enterContext(patch.object(sharing, "send_platform_system_email"))
        with self.Session() as db:
            db.add(Organization(name="Example Business", owner_user_id="owner"))
            db.commit()

    def dashboard(self, **updates):
        return {"kind": "dashboard", "dataset_id": 1, "dashboard": "general-business", "template": "executive",
                "recipients": ["first@example.test", "second@example.test"], **updates}

    def report(self, single=False):
        definition = fixtures.definition(scope="single", metrics=fixtures.definition()["metrics"][:1]) if single else fixtures.definition()
        result = self.client.post("/api/v2/business-reports", json=definition)
        self.assertEqual(result.status_code, 201, result.text)
        return {"kind": "report", "report_id": result.json()["report_id"], "recipients": ["reader@example.test"]}

    def send(self, payload=None, key="share-request-1", **headers):
        return self.client.post("/api/v2/share-emails", json=payload or self.dashboard(), headers={"Idempotency-Key": key, **headers})

    def emailed_url(self, index=-1):
        return next(word for word in self.email.call_args_list[index].args[2].split() if "/share/" in word)

    def emailed_token(self, index=-1):
        return parse_qs(urlsplit(self.emailed_url(index)).query)["token"][0]

    def test_dashboard_email_uses_server_owned_url_and_private_individual_messages(self):
        result = self.send()
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json()["sent_count"], 2)
        self.assertEqual(self.email.call_count, 2)
        self.assertEqual([call.args[0] for call in self.email.call_args_list], ["first@example.test", "second@example.test"])
        body = self.email.call_args_list[0].args[2]
        self.assertNotIn("second@example.test", body)
        url = next(word for word in body.split() if "/share/dashboard?" in word)
        parameters = parse_qs(urlsplit(url).query)
        self.assertEqual(parameters["dashboard"], ["general-business"])
        self.assertEqual(parameters["template"], ["executive"])
        with self.Session() as db:
            self.assertEqual(db.query(SharedLink).count(), 2)
            self.assertEqual(db.query(DashboardShare).count(), 0)
            self.assertNotEqual(self.emailed_token(0), self.emailed_token(1))
            self.assertEqual(db.query(sharing.ShareEmailDelivery).one().status, "sent")

    def test_replayed_request_does_not_resend_or_accept_different_recipients(self):
        first, replay = self.send(), self.send()
        self.assertEqual(first.json(), replay.json())
        self.assertEqual(self.email.call_count, 2)
        self.assertEqual(self.send(self.dashboard(recipients=["other@example.test"])).status_code, 409)

    def test_addresses_are_validated_normalized_and_deduplicated(self):
        response = self.send(self.dashboard(recipients=[" READER@example.test ", "reader@example.test"]))
        self.assertEqual(response.status_code, 200, response.text)
        self.email.assert_called_once()
        self.assertEqual(self.email.call_args.args[0], "reader@example.test")
        for addresses in ([], ["not-an-address"], ["x@example.test\r\nBcc:bad@example.test"], [f"a{i}@example.test" for i in range(11)]):
            with self.subTest(addresses=addresses):
                self.assertIn(self.send(self.dashboard(recipients=addresses), key="invalid-input").status_code, {400, 422})
        self.email.assert_called_once()

    def test_arbitrary_urls_and_mixed_targets_are_rejected(self):
        for value in (self.dashboard(url="https://attacker.example"), self.dashboard(report_id="another"), self.dashboard(template="attacker")):
            self.assertEqual(self.send(value).status_code, 422)
        self.email.assert_not_called()

    def test_reader_and_cross_workspace_requests_cannot_enable_sharing(self):
        with patch.object(sharing, "require_workspace_data_manager", side_effect=HTTPException(403, "Read only")):
            self.assertEqual(self.send().status_code, 403)
        self.assertIn(self.send(self.dashboard(dataset_id=3)).status_code, {403, 404})
        report = self.report()
        self.assertEqual(self.send(report, **{"X-Workspace-Id": "someone-else"}).status_code, 404)
        self.email.assert_not_called()
        with self.Session() as db:
            self.assertEqual(db.query(ReportShare).count(), 0)

    def test_partial_and_unknown_delivery_are_not_automatically_repeated(self):
        self.email.side_effect = [None, HTTPException(502, "Provider error")]
        result = self.send().json()
        self.assertEqual(result["status"], "partial")
        self.assertEqual(result["sent_count"], 1)
        replay = self.send().json()
        self.assertEqual(replay, result)
        self.assertEqual(self.email.call_count, 2)

    def test_interrupted_send_cannot_be_replayed(self):
        self.send()
        with self.Session() as db:
            record = db.query(sharing.ShareEmailDelivery).one()
            record.status = "sending"
            record.accepted = "[]"
            db.commit()
        self.email.reset_mock()
        self.assertEqual(self.send().json()["status"], "sending")
        self.email.assert_not_called()

    def test_workspace_limit_blocks_new_batches_but_allows_replaying_known_requests(self):
        for index in range(10):
            self.assertEqual(self.send(self.dashboard(recipients=["reader@example.test"]), key=f"share-limit-{index}").status_code, 200)
        self.assertEqual(self.send(key="share-limit-extra").status_code, 429)
        self.assertEqual(self.send(self.dashboard(recipients=["reader@example.test"]), key="share-limit-0").status_code, 200)
        self.assertEqual(self.email.call_count, 10)

    def test_both_report_scopes_have_read_only_public_results_without_private_records(self):
        for single in (False, True):
            with self.subTest(single=single):
                payload = self.report(single)
                with self.Session() as db:
                    record = db.get(BusinessReport, payload["report_id"])
                    snapshot = json.loads(record.snapshot)
                    snapshot.update(decisions=[{"notes": "Private decision"}], decision_drafts=[{"title": "Private draft"}],
                                    analysis_job_id="private-job", source_analysis={"run_id": "private-run"})
                    record.snapshot = json.dumps(snapshot)
                    db.commit()
                result = self.send(payload, key=f"report-email-{single}")
                self.assertEqual(result.status_code, 200, result.text)
                token = self.emailed_token()
                public_result = self.client.get(f"/public/reports/{token}")
                self.assertEqual(public_result.status_code, 200, public_result.text)
                self.assertEqual(public_result.headers["cache-control"], "no-store")
                self.assertEqual(public_result.json()["report"]["definition"]["scope"], "single" if single else "multi")
                self.assertEqual(public_result.json()["report"]["decisions"], [])
                for secret in ("Private decision", "Private draft", "private-job", "private-run", "workspace_id", "owner_user_id"):
                    self.assertNotIn(secret, public_result.text)
                with patch("app.modules.reports.service.build_report", side_effect=AssertionError("Public access must not recalculate")):
                    self.assertEqual(self.client.get(f"/public/reports/{token}").json(), public_result.json())

    def test_revoking_and_resharing_report_invalidates_previous_token(self):
        payload = self.report()
        self.send(payload)
        token = self.emailed_token()
        status_url = f"/api/v2/business-reports/{payload['report_id']}/share"
        self.assertTrue(self.client.get(status_url).json()["share_enabled"])
        self.assertEqual(self.client.delete(status_url).status_code, 200)
        self.assertEqual(self.client.get(f"/public/reports/{token}").status_code, 404)
        self.assertFalse(self.send(payload).json()["share_enabled"])
        self.email.assert_called_once()
        self.send(payload, key="reshared-report")
        self.assertEqual(self.client.get(f"/public/reports/{token}").status_code, 404)

    def test_deleted_report_or_source_revokes_public_access(self):
        for delete_source in (False, True):
            with self.subTest(delete_source=delete_source):
                payload = self.report()
                self.send(payload, key=f"deletion-{delete_source}")
                token = self.emailed_token()
                if delete_source:
                    with self.Session() as db:
                        cleanup_source(db, 1); db.commit()
                else:
                    self.assertEqual(self.client.delete(f"/api/v2/business-reports/{payload['report_id']}").status_code, 200)
                self.assertEqual(self.client.get(f"/public/reports/{token}").status_code, 404)
                with self.Session() as db:
                    self.assertIsNone(db.get(ReportShare, payload["report_id"]))

    def test_wrong_application_and_paused_workspace_have_no_public_access(self):
        payload = self.report()
        self.send(payload)
        token = self.emailed_token()
        with patch.object(public, "workspace_belongs_to_application", return_value=False):
            self.assertEqual(self.client.get(f"/public/reports/{token}").status_code, 404)
        with patch.object(public, "workspace_is_paused", return_value=True):
            self.assertEqual(self.client.get(f"/public/reports/{token}").status_code, 404)

    def test_workspace_cleanup_deletes_recipient_delivery_records(self):
        from app.modules.datasets.services import dataset_loader
        source, frame = self.frames[1]
        self.frames[1] = source, frame.assign(channel="Online")
        with patch.object(dataset_loader, "load_dataframe_from_dataset", side_effect=lambda dataset, **_: self.frames[dataset.id][1].copy()):
            result = self.send(self.dashboard(group_chart=self.group_chart()))
        self.assertEqual(result.status_code, 200, result.text)
        with self.Session() as db:
            cleanup_workspace(db, "someone-else"); db.commit()
            self.assertEqual(db.query(sharing.ShareEmailDelivery).count(), 1)
            self.assertEqual(db.query(sharing_links.SharedDashboardGroupView).count(), 1)
            cleanup_workspace(db, "owner"); db.commit()
            self.assertEqual(db.query(sharing.ShareEmailDelivery).count(), 0)
            self.assertEqual(db.query(sharing_links.SharedDashboardGroupView).count(), 0)

    def test_secondary_application_links_and_public_access_keep_their_application_scope(self):
        registration = {"id": "decisionate-ai", "name": "International", "web_url": "https://decisionate.ai",
                        "allowed_origins": ["https://decisionate.ai"], "environment_prefix": "DECISIONATE_AI_"}
        payload = self.report()
        with self.Session() as db:
            db.add(WorkspaceApplication(workspace_id="owner", application_id="decisionate-ai")); db.commit()
        observed = []
        self.email.side_effect = lambda *args, **kwargs: observed.append(get_application().id)
        with patch.dict("os.environ", {"DECISIONATE_APPLICATIONS": json.dumps([registration])}):
            result = self.send(payload)
            self.assertEqual(result.status_code, 200, result.text)
            self.assertEqual(observed, ["decisionate-ai"])
            self.assertIn("https://decisionate.ai/share/report?", self.email.call_args.args[2])
            token = self.emailed_token()
            self.assertEqual(self.client.get(f"/public/reports/{token}").status_code, 404)
            with application_scope("decisionate-ai"):
                self.assertEqual(self.client.get(f"/public/reports/{token}").status_code, 200)

    def test_hosted_portal_links_use_the_portal_origin(self):
        from app.modules.hosted_subdomains.context import PortalContext, portal_scope
        portal = PortalContext(1, "owner", "agency.decisionate.app", {"name": "Agency", "support_email": "support@example.test", "logo_url": ""})
        with portal_scope(portal):
            self.assertEqual(sharing.shared_url("/share/report", {"token": "example"}),
                             "https://agency.decisionate.app/share/report?token=example")

    def stop_dashboard(self, dashboard="general-business", *, allowed=True):
        from app.modules.datasets import router as datasets
        with patch.object(datasets, "SessionLocal", self.Session), \
             patch.object(datasets, "get_user_id", return_value="owner"), \
             patch.object(datasets, "get_workspace_id", return_value="owner"), \
             patch.object(datasets, "require_workspace_data_manager", side_effect=None if allowed else HTTPException(403, "Read only")):
            return asyncio.run(datasets.stop_dataset_sharing(SimpleNamespace(), Response(), 1, dashboard))

    def public_dashboard(self, token, dashboard=None, dataset_id=1):
        from app.modules import public_dashboard
        with patch.object(public_dashboard, "SessionLocal", self.Session), \
             patch.object(public_dashboard, "load_dataframe_from_dataset", side_effect=lambda dataset: self.frames[dataset.id][1].copy()):
            return public_dashboard.get_public_shared_dashboard(dataset_id, Response(), token, dashboard)

    def test_dashboard_revocation_disables_emailed_and_legacy_links_without_deleting_data(self):
        self.send()
        token = self.emailed_token()
        with self.Session() as db:
            dataset = db.get(Dataset, 1)
            dataset.share_token = "l" * 43
            db.add(DashboardShare(dataset_id=1, dashboard_key="retail-performance", share_token="r" * 43))
            db.commit()
        self.assertIn("dataset", self.public_dashboard(token, "general-business"))
        self.assertIn("dataset", self.public_dashboard("l" * 43))
        self.assertFalse(self.stop_dashboard()["share_enabled"])
        for old, key in ((token, "general-business"), ("l" * 43, None)):
            with self.assertRaises(HTTPException) as failure:
                self.public_dashboard(old, key)
            self.assertEqual(failure.exception.status_code, 404)
        with self.Session() as db:
            self.assertIsNotNone(db.get(Dataset, 1))
            self.assertIsNone(db.get(Dataset, 1).share_token)
            self.assertEqual(db.query(DashboardShare).one().dashboard_key, "retail-performance")
        self.assertFalse(self.send().json()["share_enabled"], "Replaying a send must not restore a revoked link")
        self.send(key="dashboard-share-again")
        with self.assertRaises(HTTPException):
            self.public_dashboard(token, "general-business")
        self.assertNotEqual(self.emailed_token(), token)

    def test_legacy_dashboard_status_is_visible_and_industry_revocation_keeps_other_links(self):
        from app.modules.datasets.router import build_dashboard_share_status
        with self.Session() as db:
            dataset = db.get(Dataset, 1)
            dataset.share_token = "l" * 43
            db.add(DashboardShare(dataset_id=1, dashboard_key="retail-performance", share_token="r" * 43))
            db.commit()
            self.assertTrue(build_dashboard_share_status(dataset, "general-business", None)["share_enabled"])
            self.assertFalse(build_dashboard_share_status(dataset, "retail-performance", None)["share_enabled"])
        self.stop_dashboard("retail-performance")
        with self.Session() as db:
            self.assertEqual(db.get(Dataset, 1).share_token, "l" * 43)
            self.assertEqual(db.query(DashboardShare).count(), 0)

    def test_readonly_access_cannot_revoke_an_existing_dashboard_share(self):
        self.send()
        with self.assertRaises(HTTPException) as failure:
            self.stop_dashboard(allowed=False)
        self.assertEqual(failure.exception.status_code, 403)
        with self.Session() as db:
            self.assertEqual(db.query(SharedLink).filter_by(revoked_at=None).count(), 2)

    def listed_links(self, **query):
        return self.client.get("/api/v2/share-emails/links", params={"kind": "dashboard", "dataset_id": 1, "dashboard": "general-business", **query})

    def group_chart(self, **query):
        return {"chart_type": "area", "scale_mode": "indexed", "metric_target": 125,
                "query": {"metric": "spend", "filter": {"column": "channel", "values": ["Online", "Store"]},
                          "date_column": "date", "start_date": "2026-01-01", "end_date": "2026-01-04",
                          "aggregation": "daily", "aggregation_type": "sum", **query}}

    def test_group_links_pin_the_chart_selection_and_only_expose_selected_totals(self):
        from app.modules.datasets.services import dataset_loader
        source, frame = self.frames[1]
        self.frames[1] = source, frame.assign(channel=[("Online", "Store", "Online", "Private")[i % 4] for i in range(len(frame))])
        self.assertEqual(self.send().status_code, 200)
        metric_token = self.emailed_token()
        with patch.object(dataset_loader, "load_dataframe_from_dataset", side_effect=lambda dataset, **_: self.frames[dataset.id][1].copy()):
            chart = self.group_chart()
            response = self.send(self.dashboard(group_chart=chart), key="share-group-comparison")
            self.assertEqual(response.status_code, 200, response.text)
            tokens = [self.emailed_token(index) for index in (2, 3)]
            self.assertEqual(self.send(self.dashboard(group_chart=chart), key="share-group-comparison").status_code, 200)
            self.assertEqual(self.email.call_count, 4)
            shared = self.public_dashboard(tokens[0], "general-business")
            self.assertEqual(shared["dataset"], {"file_name": "Source 1.csv", "metrics": []})
            self.assertEqual(shared["preference"], {})
            self.assertEqual({key: shared["group_chart"][key] for key in chart}, chart)
            self.assertEqual(shared["group_chart"]["data"]["series"], [
                {"value": "Online", "points": [{"period": "2026-01-01", "amount": 1}, {"period": "2026-01-03", "amount": 3}]},
                {"value": "Store", "points": [{"period": "2026-01-02", "amount": 2}]},
            ])
            self.assertNotIn("Private", json.dumps(shared))
            self.assertNotIn("group_chart", self.public_dashboard(metric_token, "general-business"))
            group_links = [item for item in self.listed_links().json()["items"] if item["title"].endswith("/ Group comparison")]
            self.assertEqual(len(group_links), 2)
            first = next(item for item in group_links if item["recipient"] == "first@example.test")
            self.assertEqual(self.client.delete(f"/api/v2/share-emails/links/{first['id']}").status_code, 200)
            with self.assertRaises(HTTPException) as failure:
                self.public_dashboard(tokens[0], "general-business")
            self.assertEqual(failure.exception.status_code, 404)
            self.assertEqual(self.public_dashboard(tokens[1], "general-business"), shared)

    def test_group_email_rejects_wrong_dashboard_empty_selection_and_cross_workspace_data(self):
        from app.modules.datasets.services import dataset_loader
        source, frame = self.frames[1]
        self.frames[1] = source, frame.assign(channel="Online")
        with patch.object(dataset_loader, "load_dataframe_from_dataset", side_effect=lambda dataset, **_: self.frames[dataset.id][1].copy()):
            chart = self.group_chart()
            self.assertEqual(self.send(self.dashboard(dashboard="retail-performance", group_chart=chart)).status_code, 422)
            self.assertIn(self.send(self.dashboard(dataset_id=3, group_chart=chart)).status_code, {403, 404})
            empty = self.group_chart(filter={"column": "channel", "values": ["Not present"]})
            self.assertEqual(self.send(self.dashboard(group_chart=empty)).status_code, 422)
        self.email.assert_not_called()

    def test_joined_group_email_shares_only_the_comparison_and_can_be_revoked(self):
        from app.modules.datasets.services import dataset_loader
        from app.modules.datasets.services.dashboard_groups import joined_dashboard_dimension_options
        joined, frame, sources, metric = joined_fixture()
        self.frames.update(sources)
        self.frames[joined.id] = joined, frame
        with self.Session() as db:
            for identity in (17, 18, 21):
                source, records = self.frames[identity]
                db.add(Dataset(id=identity, user_id="owner", workspace_id="owner", file_name=source.file_name,
                               file_path="unused.csv", source_type=source.source_type, source_config=source.source_config,
                               row_count=len(records), column_count=len(records.columns)))
            db.commit()

        with patch.object(dataset_loader, "load_dataframe_from_dataset", side_effect=lambda dataset, **_: self.frames[dataset.id][1].copy()):
            with self.Session() as db:
                options = joined_dashboard_dimension_options(db, db.get(Dataset, 21), frame, metric, None, "", 0)
            campaign = next(item["column"] for item in options["columns"] if item["label"] == "ads.csv / campaign")
            chart = self.group_chart(metric=metric, date_column="period", aggregation="monthly", end_date="2026-03-31",
                                     filter={"column": campaign, "values": ["Spring"]})
            result = self.send(self.dashboard(dataset_id=21, group_chart=chart, recipients=["reader@example.test"]))
            self.assertEqual(result.status_code, 200, result.text)
            token = self.emailed_token()
            shared = self.public_dashboard(token, "general-business", dataset_id=21)
            data = shared["group_chart"]["data"]
            self.assertEqual(data["series"], [{"value": "Spring", "points": [{"period": "2026-01-01", "amount": 45}]}])
            self.assertEqual(data["dimension_label"], "ads.csv / campaign")
            self.assertEqual(shared["dataset"]["metrics"], [])
            self.assertNotIn("Summer", json.dumps(shared))
            self.assertNotIn("channel", json.dumps(shared))
            link = self.listed_links(dataset_id=21).json()["items"][0]
            self.assertEqual(self.client.delete(f"/api/v2/share-emails/links/{link['id']}").status_code, 200)
            with self.assertRaises(HTTPException) as failure:
                self.public_dashboard(token, "general-business", dataset_id=21)
            self.assertEqual(failure.exception.status_code, 404)

    def test_each_recipient_has_an_independent_link_and_revoking_one_preserves_the_other(self):
        self.assertEqual(self.send().status_code, 200)
        tokens = [self.emailed_token(index) for index in (0, 1)]
        listed = self.listed_links()
        self.assertEqual(listed.status_code, 200, listed.text)
        self.assertEqual(listed.headers["cache-control"], "no-store")
        items = listed.json()["items"]
        self.assertEqual({item["recipient"] for item in items}, {"first@example.test", "second@example.test"})
        self.assertNotIn("token", listed.text)
        first = next(item for item in items if item["recipient"] == "first@example.test")
        stopped = self.client.delete(f"/api/v2/share-emails/links/{first['id']}")
        self.assertEqual(stopped.status_code, 200, stopped.text)
        with self.assertRaises(HTTPException) as unavailable:
            self.public_dashboard(tokens[0], "general-business")
        self.assertEqual(unavailable.exception.status_code, 404)
        self.assertIn("dataset", self.public_dashboard(tokens[1], "general-business"))
        self.assertEqual(len(self.listed_links().json()["items"]), 1)
        self.assertEqual(self.client.delete(f"/api/v2/share-emails/links/{first['id']}").status_code, 200)

    def test_a_later_send_to_the_same_email_is_a_separate_revocable_link(self):
        self.send(self.dashboard(recipients=["reader@example.test"]))
        original = self.emailed_token()
        self.send(self.dashboard(recipients=["reader@example.test"]), key="second-email-link")
        second = self.emailed_token()
        self.assertNotEqual(original, second)
        links = self.listed_links().json()["items"]
        with self.Session() as db:
            original_id = sharing_links.find_shared_link(db, original).id
        self.assertEqual(len(links), 2)
        self.assertEqual(self.client.delete(f"/api/v2/share-emails/links/{original_id}").status_code, 200)
        self.assertIn("dataset", self.public_dashboard(second, "general-business"))

    def test_single_and_multi_report_links_are_independent_for_each_recipient(self):
        for single in (True, False):
            payload = {**self.report(single), "recipients": ["first@example.test", "second@example.test"]}
            self.send(payload, key=f"individual-report-{single}")
            first, second = self.emailed_token(-2), self.emailed_token(-1)
            links = self.client.get("/api/v2/share-emails/links", params={"kind": "report", "report_id": payload["report_id"]})
            self.assertEqual(links.status_code, 200, links.text)
            item = next(item for item in links.json()["items"] if item["recipient"] == "first@example.test")
            self.assertEqual(self.client.delete(f"/api/v2/share-emails/links/{item['id']}").status_code, 200)
            self.assertEqual(self.client.get(f"/public/reports/{first}").status_code, 404)
            self.assertEqual(self.client.get(f"/public/reports/{second}").status_code, 200)

    def test_legacy_links_are_labeled_and_only_the_chosen_legacy_token_is_removed(self):
        self.send()
        with self.Session() as db:
            dataset = db.get(Dataset, 1)
            dataset.share_token = "l" * 43
            db.add(DashboardShare(dataset_id=1, dashboard_key="general-business", share_token="d" * 43))
            db.commit()
        items = self.listed_links().json()["items"]
        self.assertEqual(len(items), 4)
        original = next(item for item in items if item["id"].startswith("legacy-dataset:"))
        self.assertTrue(original["legacy"])
        self.assertEqual(self.client.delete(f"/api/v2/share-emails/links/{original['id']}").status_code, 200)
        with self.assertRaises(HTTPException):
            self.public_dashboard("l" * 43)
        self.assertIn("dataset", self.public_dashboard("d" * 43, "general-business"))
        self.assertIn("dataset", self.public_dashboard(self.emailed_token(), "general-business"))

    def test_readers_other_workspaces_and_wrong_applications_cannot_list_or_remove_links(self):
        self.send()
        item = self.listed_links().json()["items"][0]
        with patch.object(sharing_links, "require_workspace_data_manager", side_effect=HTTPException(403, "Read only")):
            self.assertEqual(self.listed_links().status_code, 403)
            self.assertEqual(self.client.delete(f"/api/v2/share-emails/links/{item['id']}").status_code, 403)
        wrong = self.client.delete(f"/api/v2/share-emails/links/{item['id']}", headers={"X-Workspace-Id": "someone-else"})
        self.assertEqual(wrong.status_code, 404)
        with self.Session() as db:
            self.assertIsNone(db.get(SharedLink, item["id"]).revoked_at)

    def test_link_listing_is_paginated_and_does_not_mix_dashboard_and_report_targets(self):
        from hashlib import sha256
        with self.Session() as db:
            for index in range(57):
                db.add(SharedLink(workspace_id="owner", user_id="owner", delivery_id="fixture", kind="dashboard", dataset_id=1,
                    dashboard_key="general-business", recipient=f"reader{index}@example.test", token_hash=sha256(str(index).encode()).hexdigest()))
            db.commit()
        first = self.listed_links().json()
        self.assertEqual(len(first["items"]), 50)
        self.assertEqual(first["next_offset"], 50)
        second = self.listed_links(offset=50).json()
        self.assertEqual(len(second["items"]), 7)
        self.assertIsNone(second["next_offset"])
        self.assertFalse({item["id"] for item in first["items"]} & {item["id"] for item in second["items"]})

    def test_public_chart_uses_the_saved_date_column_and_metric_selection(self):
        import pandas as pd
        frame = pd.DataFrame({"date": ["2023-01-01", "2023-01-02"], "sale_day": ["2026-11-01", "2026-11-02"],
                              "spend": [100, 120], "private_amount": [999, 888]})
        self.frames[1] = (self.frames[1][0], frame)
        with self.Session() as db:
            dataset = db.get(Dataset, 1)
            dataset.source_config = json.dumps({"selected_metric_columns": ["spend"]})
            db.add(UserPreference(clerk_user_id="owner", workspace_id="owner", dashboard_views=json.dumps({"1": {
                "general-business": {"selectedMetrics": ["spend"], "startDate": "2026-11-01", "endDate": "2026-11-02",
                                     "metricMappings": {"general-business": {"date": "sale_day"}}}}})))
            db.commit()
        self.send(self.dashboard(recipients=["reader@example.test"]))
        result = self.public_dashboard(self.emailed_token(), "general-business")
        self.assertEqual(result["dataset"]["chart"]["x_key"], "sale_day")
        self.assertEqual([item["spend"] for item in result["dataset"]["chart"]["data"]], [100, 120])
        self.assertNotIn("private_amount", result["dataset"]["chart"]["data"][0])
        self.assertEqual([item["column"] for item in result["dataset"]["metrics"]], ["spend"])

    def saved_join(self, derived_id):
        from app.modules.datasets.services.joins import JOIN_RESULT_VERSION
        return {"join_version": JOIN_RESULT_VERSION, "primary_dataset_id": 1, "derived_dataset_id": derived_id,
                "dataset_ids": [1, 2], "datasets": [{"dataset_id": 1, "file_name": "sales.csv", "date_column": "date",
                    "metric_column": "spend", "label": "sales.csv · spend", "column_type": "numeric"}],
                "rows": [{"period": "2024-01-01", "sales.csv · spend": 999}], "dimension_filters": []}

    def test_unfiltered_share_is_scoped_to_the_named_view(self):
        shared, sibling = "sales-performance", "retail-performance"
        titles = {shared: {"trend": "Sales trend"}, sibling: {"trend": "Sibling chart"}}
        with self.Session() as db:
            db.add(UserPreference(clerk_user_id="owner", workspace_id="owner", selected_metric="other_dataset_only",
                metric_targets=json.dumps({"1": {"other_dataset_only": 100}}),
                dashboard_preferences=json.dumps({"1": {"title": "Default dashboard", "chartTitles": titles, "targetMetric": "spend"}}),
                dashboard_views=json.dumps({"1": {shared: {"title": "Sales", "chartTitles": titles, "targetMetric": "spend"},
                                                   sibling: {"title": "Other workspace view"}}})))
            db.commit()
        self.assertEqual(self.send(self.dashboard(dashboard=shared)).status_code, 200)
        result = self.public_dashboard(self.emailed_token(), shared)
        self.assertNotIn("source_config", result["dataset"])
        prefs = result["preference"]
        self.assertEqual(prefs["dashboard_preferences"], {"1": {"chartTitles": {shared: titles[shared]}}})
        self.assertEqual(prefs["dashboard_views"], {"1": {shared: {"title": "Sales", "chartTitles": {shared: titles[shared]}}}})
        self.assertIsNone(prefs["selected_metric"])
        self.assertIsNone(prefs["target_metric"])
        self.assertIsNone(prefs["metric_targets"])

    def test_existing_dashboard_link_uses_only_an_explicit_public_target_metric(self):
        with self.Session() as db:
            db.add(UserPreference(clerk_user_id="owner", workspace_id="owner", selected_metric="spend",
                metric_targets=json.dumps({"1": {"spend": 300}}),
                dashboard_views=json.dumps({"1": {"general-business": {"selectedMetrics": ["spend"]}}})))
            db.commit()
        self.assertEqual(self.send().status_code, 200)
        token = self.emailed_token()

        def preferences():
            return self.public_dashboard(token, "general-business")["preference"]

        initial = preferences()
        self.assertEqual(initial["selected_metric"], "spend")
        self.assertEqual(initial["metric_targets"], {"1": {"spend": 300}})
        self.assertIsNone(initial["target_metric"])

        for saved, expected in (("spend", "spend"), (None, None), ("private_column", None)):
            with self.subTest(saved=saved), self.Session() as db:
                state = db.query(UserPreference).filter_by(clerk_user_id="owner", workspace_id="owner").one()
                state.dashboard_preferences = json.dumps({"1": {"targetMetric": "spend"}})
                state.dashboard_views = json.dumps({"1": {"general-business": {"targetMetric": saved}}})
                db.commit()
                updated = preferences()
                self.assertEqual(updated["target_metric"], expected)
                self.assertNotIn("targetMetric", json.dumps(updated))

    def test_shared_source_does_not_restore_an_unrelated_join_from_cache_or_preferences(self):
        import pandas as pd
        self.frames[1] = (self.frames[1][0], pd.DataFrame({"date": ["2026-11-01", "2026-11-02"], "spend": [100, 120]}))
        joined = self.saved_join(4)
        view = {"joinedDatasetResult": joined, "selectedMetrics": ["spend"], "startDate": "2025-11-19", "endDate": "2026-11-19"}
        with self.Session() as db:
            db.add(DatasetJoinCache(user_id="owner", workspace_id="owner", dashboard_key="general-business",
                dataset_ids="[1, 2]", definition="{}", result=json.dumps(joined), source_fingerprint="fixture"))
            db.add(UserPreference(clerk_user_id="owner", workspace_id="owner",
                dashboard_preferences=json.dumps({"1": view}), dashboard_views=json.dumps({"1": {"general-business": view}})))
            db.commit()
        self.send()
        result = self.public_dashboard(self.emailed_token(), "general-business")
        self.assertIsNone(result["preference"]["joined_dataset_result"])
        self.assertNotIn("joinedDatasetResult", result["preference"]["dashboard_preferences"]["1"])
        self.assertNotIn("joinedDatasetResult", result["preference"]["dashboard_views"]["1"]["general-business"])
        self.assertEqual(result["dataset"]["chart"]["x_key"], "date")
        self.assertEqual([row["spend"] for row in result["dataset"]["chart"]["data"]], [100, 120])
        self.assertEqual([metric["column"] for metric in result["dataset"]["metrics"]], ["spend"])

    def test_shared_joined_dataset_restores_only_its_own_cache_without_source_membership(self):
        joined = self.saved_join(1)
        joined["dataset_ids"] = [2, 3]
        stored = {**joined, "derived_dataset": {"id": 1, "source_config": "internal", "workspace_id": "owner"},
                  "rows": [{**joined["rows"][0], "unlisted_column": 100}],
                  "datasets": [{**joined["datasets"][0], "internal_notes": "private"}]}
        with self.Session() as db:
            db.get(Dataset, 1).source_type = "joined"
            db.add(DatasetJoinCache(user_id="owner", workspace_id="owner", dashboard_key="general-business",
                dataset_ids="[2, 3]", definition="{}", result=json.dumps(stored), source_fingerprint="fixture"))
            db.commit()
        self.send()
        result = self.public_dashboard(self.emailed_token(), "general-business")
        self.assertEqual(result["preference"]["joined_dataset_result"], joined)
        self.assertEqual(result["dataset"]["chart"]["x_key"], "period")
        self.assertEqual(result["dataset"]["chart"]["data"], joined["rows"])
        self.assertEqual([metric["column"] for metric in result["dataset"]["metrics"]], ["sales.csv · spend"])
