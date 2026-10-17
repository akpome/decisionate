"""Synthetic Sales Cloud Opportunity contracts, not live customer responses."""

from copy import deepcopy
from io import BytesIO
import json
import os
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch
from urllib.error import HTTPError, URLError
from xml.etree import ElementTree

import pandas as pd

from app.modules.datasets.services import connectors
from app.modules.datasets.services.metric_policy import CONNECTOR_SCHEMA_VERSION, POLICY_VERSION
from app.modules.datasets.services.metric_recommendations import initialize_curated_selection, recommended_columns, resolve_metric_recommendations
from app.modules.datasets.services.metric_selection import build_metric_selection_profile, filter_dataframe_to_selected_metrics, get_effective_dataset_metric_columns
from app.modules.datasets.services.metric_registry import get_metric_definition
from app.modules.datasets.services.metrics import generate_metrics


OPPORTUNITY = {
    "Id": "006-test", "Name": "Expansion", "Amount": 12000, "ExpectedRevenue": 6000,
    "Probability": 50, "TotalOpportunityQuantity": 3, "CurrencyIsoCode": "CAD",
    "StageName": "Proposal", "IsClosed": False, "IsWon": False,
    "CloseDate": "2026-11-01", "CreatedDate": "2026-10-01T12:00:00Z",
    "LastModifiedDate": "2026-10-02T12:00:00Z", "OwnerId": "005-owner", "AccountId": "001-account",
    "LeadSource": "Web", "ForecastCategoryName": "Pipeline", "Type": "New Business",
    "FiscalYear": 2026, "FiscalQuarter": 4, "AgeInDays": 1, "Custom_Score__c": .85,
}
DEFAULTS = {"Amount", "ExpectedRevenue", "Probability"}
CONTEXT = {"Id", "record_id", "StageName", "IsClosed", "IsWon", "CloseDate", "CreatedDate",
           "OwnerId", "AccountId", "LeadSource", "ForecastCategoryName", "Type", "CurrencyIsoCode"}


def dataset(**config):
    return SimpleNamespace(id=1, user_id="test-user", source_type="salesforce", source_config=json.dumps({
        "resource_type": "opportunities", "api_version": "v65.0",
        "connector_schema_version": CONNECTOR_SCHEMA_VERSION, **config,
    }))


def user_info(currency="CAD", multicurrency="false"):
    return (f'<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" '
            f'xmlns="urn:partner.soap.sforce.com"><soapenv:Body><getUserInfoResponse><result>'
            f'<organizationMultiCurrency>{multicurrency}</organizationMultiCurrency>'
            f'<orgDefaultCurrencyIsoCode>{currency}</orgDefaultCurrencyIsoCode>'
            '<userDefaultCurrencyIsoCode>USD</userDefaultCurrencyIsoCode>'
            '</result></getUserInfoResponse></soapenv:Body></soapenv:Envelope>').encode()


class SalesforceMetricDefaultTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, {
            "SALESFORCE_API_VERSION": "65.0", "CURATED_METRIC_DEFAULTS_BACKEND": "true",
            "CURATED_METRIC_DEFAULTS_UI": "true", "CURATED_METRIC_DEFAULTS_NEW_DATASETS": "true",
            "CURATED_METRIC_DEFAULTS_ROLLOUT": "all", "CURATED_METRIC_DEFAULTS_DIAGNOSTICS": "false",
        })
        self.environment.start()
        self.addCleanup(self.environment.stop)

    def import_opportunities(self, records=None, *, single_currency=False, currency="CAD"):
        records = deepcopy(records if records is not None else [OPPORTUNITY])
        described = list(OPPORTUNITY)
        if single_currency:
            described.remove("CurrencyIsoCode")
            for record in records:
                record.pop("CurrencyIsoCode", None)

        def request(url, headers):
            self.assertEqual(headers, {"Authorization": "Bearer test-token"})
            if url.endswith("/Opportunity/describe"):
                return {"fields": [{"name": column} for column in described]}
            self.assertIn("/query/", url)
            return {"records": records, "done": True}

        connection = SimpleNamespace(connection_config=json.dumps({"object_type": "Opportunity", "instance_url": "https://example.my.salesforce.com"}))
        with patch.object(connectors, "get_oauth_access_token", return_value="test-token"), patch.object(
            connectors, "connector_json_request", side_effect=request,
        ), patch.object(connectors, "load_salesforce_organization_currency", return_value=currency) as currency_lookup:
            frame, report = connectors.load_salesforce_dataframe(None, connection)
        return frame, report, currency_lookup

    def test_import_contract_preserves_sales_and_custom_fields(self):
        for single_currency in (False, True):
            frame, report, _ = self.import_opportunities(single_currency=single_currency)
            self.assertTrue(DEFAULTS <= set(frame))
            self.assertEqual(frame["Custom_Score__c"].tolist(), [.85])
            self.assertEqual(report["api_version"], "v65.0")
            self.assertEqual(report["resource_type"], "opportunities")

    def test_imported_opportunities_have_sales_defaults_with_and_without_curated_rollout(self):
        frame, report, lookup = self.import_opportunities()
        lookup.assert_not_called()
        for curated in (False, True):
            with self.subTest(curated=curated):
                item = dataset(**report, curated_metric_selection=curated)
                expected = DEFAULTS | ({"__metric_record_count"} if curated else set())
                self.assertEqual(set(get_effective_dataset_metric_columns(item, frame)), expected)
                analytical = filter_dataframe_to_selected_metrics(item, frame)
                self.assertTrue(CONTEXT <= set(analytical))
                self.assertFalse({"AgeInDays", "Custom_Score__c", "FiscalYear", "FiscalQuarter"} & set(analytical))

    def test_new_curated_dataset_saves_only_reviewed_measures(self):
        frame, _, _ = self.import_opportunities()
        item = dataset()
        initialize_curated_selection(item, frame)
        config = json.loads(item.source_config)
        self.assertEqual(set(config["selected_metric_columns"]), DEFAULTS | {"__metric_record_count"})
        self.assertEqual(config["metric_selection_provenance"]["source"], "recommended")

    def test_opportunity_quantity_is_optional_not_an_automatic_default(self):
        frame, _, _ = self.import_opportunities()
        recommendations = resolve_metric_recommendations(dataset(), frame)
        quantity = next(entry for entry in recommendations["optional"] if entry["columnKey"] == "TotalOpportunityQuantity")
        self.assertEqual(quantity["semanticKey"], "opportunity_quantity")
        self.assertIn("not a per-product breakdown", quantity["reason"])
        for curated in (False, True):
            with self.subTest(curated=curated):
                item = dataset(curated_metric_selection=curated)
                profile = build_metric_selection_profile(item, frame)
                self.assertNotIn("TotalOpportunityQuantity", profile["recommended_metric_columns"])
                self.assertIn("TotalOpportunityQuantity", profile["available_metric_columns"])
                self.assertNotIn("TotalOpportunityQuantity", filter_dataframe_to_selected_metrics(item, frame))

    def test_optional_quantity_is_not_invented_when_absent_or_empty(self):
        frame, _, _ = self.import_opportunities()
        for candidate in (frame.drop(columns="TotalOpportunityQuantity"), frame.assign(TotalOpportunityQuantity=None)):
            recommendations = resolve_metric_recommendations(dataset(), candidate)
            self.assertNotIn("TotalOpportunityQuantity", [entry["columnKey"] for entry in recommendations["optional"]])
            self.assertNotIn("ProductQuantity", candidate)
            self.assertNotIn("product_quantity", candidate)

    def test_old_automatic_quantity_selection_is_removed_without_changing_other_defaults(self):
        frame, _, _ = self.import_opportunities()
        for curated in (False, True):
            item = dataset(curated_metric_selection=curated, selected_metric_columns=[*sorted(DEFAULTS), "TotalOpportunityQuantity"],
                           metric_selection_provenance={"source": "recommended", "policy_version": "2026-10-17.2"})
            before = item.source_config
            expected = DEFAULTS | ({"__metric_record_count"} if curated else set())
            self.assertEqual(set(get_effective_dataset_metric_columns(item, frame)), expected)
            self.assertEqual(item.source_config, before)

    def test_manual_quantity_selection_survives_the_default_correction(self):
        frame, _, _ = self.import_opportunities()
        for curated in (False, True):
            for version in ("2026-10-17.2", POLICY_VERSION):
                with self.subTest(curated=curated, version=version):
                    item = dataset(curated_metric_selection=curated, selected_metric_columns=["TotalOpportunityQuantity"],
                                   metric_selection_provenance={"source": "user", "policy_version": version})
                    self.assertEqual(get_effective_dataset_metric_columns(item, frame), ["TotalOpportunityQuantity"])
                    self.assertIn("TotalOpportunityQuantity", filter_dataframe_to_selected_metrics(item, frame))
                    if curated:
                        recommendations = resolve_metric_recommendations(item, frame, selection_policy=True)
                        quantity = next(entry for group in ("recommended", "optional") for entry in recommendations[group]
                                        if entry["columnKey"] == "TotalOpportunityQuantity")
                        self.assertIn("not a per-product breakdown", quantity["reason"])

    def test_existing_automatic_record_count_defaults_refresh_without_mutating_saved_config(self):
        frame, _, _ = self.import_opportunities()
        for curated in (False, True):
            item = dataset(curated_metric_selection=curated, selected_metric_columns=["__metric_record_count"],
                           metric_selection_provenance={"source": "recommended", "policy_version": "2026-10-17.1"})
            before = item.source_config
            self.assertTrue(DEFAULTS <= set(get_effective_dataset_metric_columns(item, frame)))
            self.assertEqual(item.source_config, before)

    def test_manual_choices_and_empty_opt_out_survive(self):
        frame, _, _ = self.import_opportunities()
        for selected in ([], ["Custom_Score__c"], ["Amount"]):
            for provenance in ({}, {"metric_selection_provenance": {"source": "user", "policy_version": POLICY_VERSION}}):
                with self.subTest(selected=selected, provenance=provenance):
                    item = dataset(selected_metric_columns=selected, **provenance)
                    self.assertEqual(get_effective_dataset_metric_columns(item, frame), selected)
                    analytical = filter_dataframe_to_selected_metrics(item, frame)
                    self.assertEqual(set(analytical) & (DEFAULTS | {"Custom_Score__c"}), set(selected))

    def test_curated_manual_probability_uses_average_and_remains_percent(self):
        frame = pd.DataFrame([{**OPPORTUNITY, "record_id": "1"}, {**OPPORTUNITY, "record_id": "2", "Probability": 20}])
        item = dataset(curated_metric_selection=True, selected_metric_columns=["Probability"],
                       metric_selection_provenance={"source": "user", "policy_version": POLICY_VERSION})
        analytical = filter_dataframe_to_selected_metrics(item, frame)
        metrics = generate_metrics(analytical)
        self.assertEqual(len(metrics), 1)
        self.assertEqual(metrics[0]["total"], 35)
        descriptor = resolve_metric_recommendations(item, frame)["recommended"]
        probability = next(entry for entry in descriptor if entry["columnKey"] == "Probability")
        self.assertEqual(probability["aggregation"], "AVG")
        self.assertEqual(probability["unit"], "probability")
        self.assertNotIn("win_rate", probability["semanticKey"])

    def test_manual_previous_policy_remains_pinned(self):
        frame, _, _ = self.import_opportunities()
        item = dataset(curated_metric_selection=True, selected_metric_columns=["__metric_record_count"],
                       metric_selection_provenance={"source": "user", "policy_version": "2026-10-17.1"})
        self.assertEqual(get_effective_dataset_metric_columns(item, frame), ["__metric_record_count"])
        self.assertEqual(resolve_metric_recommendations(item, frame, selection_policy=True)["policyVersion"], "2026-10-17.1")

    def test_legacy_opportunity_object_name_resolves_the_same_policy(self):
        frame, _, _ = self.import_opportunities()
        item = dataset(resource_type=None, object_type="Opportunity")
        self.assertTrue(DEFAULTS <= set(recommended_columns(resolve_metric_recommendations(item, frame))))

    def test_accounts_and_leads_do_not_use_opportunity_defaults(self):
        for resource in ("accounts", "leads"):
            profile = build_metric_selection_profile(dataset(resource_type=resource), pd.DataFrame({"Custom_Score__c": [.5]}))
            self.assertEqual(profile["recommended_metric_columns"], ["Custom_Score__c"])

    def test_missing_empty_or_nonnumeric_fields_are_not_invented(self):
        frame, _, _ = self.import_opportunities()
        frame = frame.drop(columns="ExpectedRevenue")
        frame["Amount"] = None
        frame["Probability"] = "unknown"
        for curated in (False, True):
            selected = get_effective_dataset_metric_columns(dataset(curated_metric_selection=curated), frame)
            self.assertEqual(set(selected) & DEFAULTS, set())
            self.assertNotIn("TotalOpportunityQuantity", selected)

    def test_zero_and_constant_measures_are_not_discarded_in_large_datasets(self):
        frame = pd.DataFrame([{**OPPORTUNITY, "Amount": 0, "ExpectedRevenue": 0, "Probability": 0,
                               "TotalOpportunityQuantity": 0, "record_id": str(i)} for i in range(30)])
        for curated in (False, True):
            self.assertTrue(DEFAULTS <= set(get_effective_dataset_metric_columns(dataset(curated_metric_selection=curated), frame)))

    def test_business_objectives_apply_to_salesforce_defaults(self):
        frame, _, _ = self.import_opportunities()
        for curated in (False, True):
            revenue = set(get_effective_dataset_metric_columns(dataset(curated_metric_selection=curated, business_objective="increase_revenue"), frame))
            cash = set(get_effective_dataset_metric_columns(dataset(curated_metric_selection=curated, business_objective="cash_flow"), frame))
            expenses = get_effective_dataset_metric_columns(dataset(curated_metric_selection=curated, business_objective="reduce_expenses"), frame)
            self.assertTrue(DEFAULTS <= revenue)
            self.assertEqual(cash & DEFAULTS, {"Amount", "ExpectedRevenue"})
            self.assertEqual(expenses, [])

    def test_salesforce_semantics_do_not_mislabel_estimates_as_booked_revenue(self):
        self.assertEqual(get_metric_definition("Amount", "salesforce").canonical_name, "opportunity_amount")
        self.assertEqual(get_metric_definition("ExpectedRevenue", "salesforce").aggregation, "sum")
        self.assertEqual(get_metric_definition("Probability", "salesforce").aggregation, "avg")
        self.assertIsNone(get_metric_definition("Amount", "hubspot"))

    def test_single_currency_import_supplies_verified_context(self):
        frame, report, lookup = self.import_opportunities(single_currency=True, currency="JPY")
        lookup.assert_called_once_with("https://example.my.salesforce.com", "v65.0", "test-token")
        self.assertEqual(frame["currency"].tolist(), ["JPY"])
        item = dataset(**report, curated_metric_selection=True)
        # Metadata covers older merged rows that predate the currency alias.
        result = resolve_metric_recommendations(item, frame.drop(columns="currency"))
        amount = next(entry for entry in result["recommended"] if entry["columnKey"] == "Amount")
        self.assertEqual(amount["currency"], "JPY")
        self.assertEqual(amount["multiplier"], 1)

    def test_unknown_and_mixed_currencies_fail_closed_for_curated_money(self):
        for currencies in (["CAD", "USD"], ["CAD", None], ["CAD", "invalid"]):
            frame = pd.DataFrame([{**OPPORTUNITY, "record_id": str(i), "CurrencyIsoCode": value} for i, value in enumerate(currencies)])
            selected = recommended_columns(resolve_metric_recommendations(dataset(), frame))
            self.assertFalse({"Amount", "ExpectedRevenue"} & set(selected))
        frame, report, _ = self.import_opportunities(single_currency=True, currency=None)
        self.assertNotIn("currency_source", report)
        self.assertNotIn("Amount", recommended_columns(resolve_metric_recommendations(dataset(**report), frame)))

    def test_user_info_request_uses_partner_api_and_escaped_session(self):
        response = MagicMock()
        response.__enter__.return_value.read.return_value = user_info()
        with patch.object(connectors, "urlopen", return_value=response) as requested:
            currency = connectors.load_salesforce_organization_currency("https://example.my.salesforce.com", "v65.0", "token<&>")
        self.assertEqual(currency, "CAD")
        request = requested.call_args.args[0]
        self.assertEqual(request.full_url, "https://example.my.salesforce.com/services/Soap/u/65.0")
        self.assertEqual(request.method, "POST")
        root = ElementTree.fromstring(request.data)
        self.assertEqual(root.findtext(".//{urn:partner.soap.sforce.com}sessionId"), "token<&>")
        self.assertEqual(requested.call_args.kwargs["timeout"], 30)

    def test_user_info_never_substitutes_a_user_preference_for_record_currency(self):
        for payload in (user_info(multicurrency="true"), user_info(currency=""), user_info(currency="US$"),
                        b"invalid XML", b"<result/>", b"<!DOCTYPE result><result/>", b"x" * 65537):
            with self.subTest(payload=payload[:100]):
                response = MagicMock()
                response.__enter__.return_value.read.return_value = payload
                with patch.object(connectors, "urlopen", return_value=response):
                    self.assertIsNone(connectors.load_salesforce_organization_currency("https://example.my.salesforce.com", "v65.0", "test-token"))

    def test_currency_lookup_failures_do_not_drop_opportunities(self):
        for error in (URLError("offline"), HTTPError("https://example.my.salesforce.com", 403, "forbidden", {}, BytesIO())):
            with patch.object(connectors, "urlopen", side_effect=error):
                self.assertIsNone(connectors.load_salesforce_organization_currency("https://example.my.salesforce.com", "v65.0", "test-token"))
        with patch.object(connectors, "urlopen", side_effect=HTTPError("https://example.my.salesforce.com", 401, "unauthorized", {}, BytesIO())):
            with self.assertRaisesRegex(connectors.ConnectorUnavailable, "HTTP 401"):
                connectors.load_salesforce_organization_currency("https://example.my.salesforce.com", "v65.0", "test-token")


if __name__ == "__main__":
    unittest.main()
