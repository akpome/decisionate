import unittest

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.modules.ai.learning import (
    build_dataset_decision_learning_filter,
    build_workspace_decision_learning_context,
)
from app.modules.decisions.models import Decision


class AILearningScopeTests(unittest.TestCase):
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
        finally:
            session.close()
            engine.dispose()


if __name__ == "__main__":
    unittest.main()
