import unittest

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.modules.ai.learning import (
    build_dataset_decision_learning_filter,
    build_workspace_decision_learning_context,
)
from app.modules.decisions.models import Decision


class AILearningScopeTests(unittest.TestCase):
    def test_incomplete_outcome_is_not_evaluated_as_learning_evidence(self):
        engine = create_engine("sqlite:///:memory:")
        Decision.__table__.create(engine)
        session = sessionmaker(bind=engine)()

        try:
            session.add(
                Decision(
                    clerk_user_id="user-1",
                    workspace_id="workspace-1",
                    dataset_id=10,
                    title="Incomplete outcome decision",
                    recommendation_text="Repeat the campaign",
                    recommendation_source="openai",
                    actual_outcome="Unknown",
                    outcome_status="successful",
                    lessons_learned="Capture a measurable target first.",
                )
            )
            session.commit()

            context = build_workspace_decision_learning_context(
                session,
                "user-1",
                "workspace-1",
                learning_scope="workspace",
            )

            self.assertEqual(
                context["recorded_outcome_count"],
                0,
            )
            self.assertEqual(
                context["recorded_recommendation_count"],
                0,
            )
            self.assertEqual(
                context["recorded_lesson_count"],
                1,
            )
            self.assertEqual(
                context["examples"][0]["outcome_status"],
                "unclassified",
            )
            self.assertEqual(
                context["examples"][0]["actual_outcome"],
                "",
            )
        finally:
            session.close()
            engine.dispose()

    def test_dataset_metric_learning_scope_excludes_unrelated_evidence(self):
        engine = create_engine("sqlite:///:memory:")
        Decision.__table__.create(engine)
        session = sessionmaker(bind=engine)()

        try:
            session.add_all([
                Decision(
                    clerk_user_id="user-1",
                    workspace_id="workspace-1",
                    dataset_id=10,
                    metric_column="revenue",
                    title="Relevant revenue decision",
                    recommendation_text="Keep the tested offer.",
                    recommendation_source="openai",
                    recommendation_context="revenue campaign",
                    expected_outcome="Improve revenue",
                    actual_outcome="Improved",
                    lessons_learned="Keep the tested offer.",
                ),
                Decision(
                    clerk_user_id="user-1",
                    workspace_id="workspace-1",
                    dataset_id=10,
                    metric_column=None,
                    title="Relevant general decision",
                    lessons_learned="Review seasonality first.",
                ),
                Decision(
                    clerk_user_id="user-1",
                    workspace_id="workspace-1",
                    dataset_id=10,
                    metric_column="revenue",
                    title="Classified revenue decision",
                    expected_outcome="Increase revenue",
                    outcome_status="successful",
                ),
                Decision(
                    clerk_user_id="user-1",
                    workspace_id="workspace-1",
                    dataset_id=10,
                    metric_column="customers",
                    title="Different metric decision",
                    lessons_learned="Keep this out of revenue analysis.",
                ),
                Decision(
                    clerk_user_id="user-1",
                    workspace_id="workspace-1",
                    dataset_id=20,
                    metric_column="revenue",
                    title="Unrelated revenue decision",
                    lessons_learned="Do not use this evidence.",
                ),
            ])
            session.commit()

            context = build_workspace_decision_learning_context(
                session,
                "user-1",
                "workspace-1",
                base_filter=build_dataset_decision_learning_filter(
                    10,
                    "revenue",
                ),
                learning_scope="metric",
            )

            self.assertEqual(
                context["learning_scope"],
                "metric",
            )
            titles = {
                example["title"]
                for example in context["examples"]
            }
            self.assertEqual(
                context["recorded_lesson_count"],
                2,
            )
            self.assertEqual(
                context["recorded_outcome_count"],
                2,
            )
            self.assertEqual(
                context["recorded_recommendation_count"],
                1,
            )
            self.assertEqual(
                context["outcome_counts"],
                {
                    "unclassified": 1,
                    "successful": 1,
                },
            )
            self.assertEqual(
                titles,
                {
                    "Relevant revenue decision",
                    "Relevant general decision",
                    "Classified revenue decision",
                },
            )
            revenue_example = next(
                example
                for example in context["examples"]
                if example["title"] == "Relevant revenue decision"
            )
            self.assertEqual(
                revenue_example["recommendation_source"],
                "openai",
            )
            self.assertEqual(
                revenue_example["recommendation_context"],
                "revenue campaign",
            )
        finally:
            session.close()
            engine.dispose()


if __name__ == "__main__":
    unittest.main()
