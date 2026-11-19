import json
import unittest
from types import SimpleNamespace
from urllib.parse import parse_qs, urlsplit
from unittest.mock import patch

from fastapi import HTTPException

from app.db.models import DashboardShare, Organization, WorkspaceApplication
from app.application_context import application_scope, get_application
from app.modules import share_emails as sharing
from app.modules.reports import public
from app.modules.reports.cleanup import cleanup_source, cleanup_workspace
from app.modules.reports.models import BusinessReport, ReportShare
from tests import test_business_reports as fixtures


class ShareEmailTests(unittest.TestCase):
    def setUp(self):
        fixtures.BusinessReportWorkflowTests.setUp(self)
        self.client.app.include_router(sharing.router)
        self.client.app.include_router(public.router)
        for module in (sharing, public):
            patcher = patch.object(module, "SessionLocal", self.Session)
            patcher.start(); self.addCleanup(patcher.stop)
        replacements = (("get_auth_context", lambda request: SimpleNamespace(user_id="owner", workspace_id=request.headers.get("X-Workspace-Id", "owner"))),
                        ("require_workspace_data_manager", lambda request: None),
                        ("require_email_delivery_configured", lambda: None))
        for name, value in replacements:
            patcher = patch.object(sharing, name, value)
            patcher.start(); self.addCleanup(patcher.stop)
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
            self.assertEqual(parameters["token"], [db.query(DashboardShare).one().share_token])
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
                with self.Session() as db:
                    token = db.get(ReportShare, payload["report_id"]).token
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
        with self.Session() as db:
            token = db.get(ReportShare, payload["report_id"]).token
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
                with self.Session() as db:
                    token = db.get(ReportShare, payload["report_id"]).token
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
        with self.Session() as db:
            token = db.get(ReportShare, payload["report_id"]).token
        with patch.object(public, "workspace_belongs_to_application", return_value=False):
            self.assertEqual(self.client.get(f"/public/reports/{token}").status_code, 404)
        with patch.object(public, "workspace_is_paused", return_value=True):
            self.assertEqual(self.client.get(f"/public/reports/{token}").status_code, 404)

    def test_workspace_cleanup_deletes_recipient_delivery_records(self):
        self.send()
        with self.Session() as db:
            cleanup_workspace(db, "someone-else"); db.commit()
            self.assertEqual(db.query(sharing.ShareEmailDelivery).count(), 1)
            cleanup_workspace(db, "owner"); db.commit()
            self.assertEqual(db.query(sharing.ShareEmailDelivery).count(), 0)

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
            with self.Session() as db:
                token = db.get(ReportShare, payload["report_id"]).token
            self.assertEqual(self.client.get(f"/public/reports/{token}").status_code, 404)
            with application_scope("decisionate-ai"):
                self.assertEqual(self.client.get(f"/public/reports/{token}").status_code, 200)

    def test_hosted_portal_links_use_the_portal_origin(self):
        from app.modules.hosted_subdomains.context import PortalContext, portal_scope
        portal = PortalContext(1, "owner", "agency.decisionate.app", {"name": "Agency", "support_email": "support@example.test", "logo_url": ""})
        with portal_scope(portal):
            self.assertEqual(sharing.shared_url("/share/report", {"token": "example"}),
                             "https://agency.decisionate.app/share/report?token=example")
