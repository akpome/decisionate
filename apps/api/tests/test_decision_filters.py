import unittest
import asyncio
from datetime import datetime
from datetime import timezone
from typing import Literal
from typing import get_args
from unittest.mock import patch

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import create_engine, select
from sqlalchemy.dialects import sqlite
from sqlalchemy.orm import sessionmaker

from app.modules.decisions.router import (
    DECISION_ACTIVITY_MESSAGES,
    archive_decision,
    apply_decision_list_filters,
    apply_decision_list_pagination,
    apply_decision_list_sort,
    clean_optional_multiline_text,
    clean_optional_single_line_text,
    clean_required_decision_expected_outcome,
    clean_required_decision_title,
    ensure_decision_is_editable,
    filter_dataset_for_workspace,
    filter_decision_activities_for_workspace,
    filter_decision_activity_feed_for_workspace,
    filter_decision_for_workspace,
    get_accessible_dataset,
    get_accessible_decision_or_404,
    get_active_user_id,
    get_active_workspace_id,
    create_decision as create_decision_route,
    has_meaningful_text,
    has_pending_learning,
    has_pending_notes,
    has_pending_outcome,
    has_recorded_outcome,
    is_active_decision_record,
    get_decision_count_map,
    get_decision_month_count_map,
    get_overview_activity_type,
    normalize_decision_datetime,
    record_decision_activity,
    restore_decision,
    update_decision as update_decision_route,
    update_decision_outcome,
    utc_now,
    validate_optional_decision_controlled_value,
)
from app.db.models import Dataset
from app.modules.decisions.activity_models import (
    DecisionActivity,
    utc_now as activity_utc_now,
)
from app.modules.decisions.models import Decision
from app.modules.decisions.schemas import (
    ACTIVE_DECISION_LIST_LIFECYCLE,
    ARCHIVE_DECISION_ACTIVITY,
    ARCHIVED_DECISION_LIST_LIFECYCLE,
    ARCHIVED_DECISION_STATUS,
    CATEGORY_DECISION_ACTIVITY,
    CONFIDENCE_DECISION_ACTIVITY,
    CREATED_DECISION_ACTIVITY,
    build_literal_pattern,
    DECISION_ATTENTION_WORKFLOW_STATE_PATTERN,
    DECISION_LEARNING_WORKFLOW_STATE_PATTERN,
    DECISION_LIST_LIFECYCLE_PATTERN,
    DECISION_NOTES_WORKFLOW_STATE_PATTERN,
    DECISION_OUTCOME_WORKFLOW_STATE_PATTERN,
    DECISION_REVIEW_WORKFLOW_STATE_PATTERN,
    DECISION_LIST_SORT_PATTERN,
    DEFAULT_DECISION_LIST_LIFECYCLE,
    DEFAULT_DECISION_LIST_SORT,
    DEFAULT_DECISION_CATEGORY,
    DEFAULT_DECISION_PRIORITY,
    DEFAULT_DECISION_STATUS,
    CREATED_ASC_DECISION_LIST_SORT,
    DETAILS_DECISION_ACTIVITY,
    HIGH_DECISION_CONFIDENCE,
    DecisionActivityResponse,
    DecisionActivityFeedResponse,
    DecisionCategory,
    DecisionCategoryUpdate,
    DecisionAttentionWorkflowState,
    DecisionCreate,
    DecisionDetailsUpdate,
    DecisionLearningWorkflowState,
    DecisionListLifecycle,
    DecisionNotesWorkflowState,
    DecisionOutcomeWorkflowState,
    DecisionReviewWorkflowState,
    DecisionListSort,
    DecisionConfidenceUpdate,
    DecisionLearningUpdate,
    DecisionNotesUpdate,
    DecisionOutcomeUpdate,
    DecisionOverviewUpdate,
    DecisionPriorityUpdate,
    DecisionReviewUpdate,
    DecisionStatus,
    DecisionUpdate,
    LEARNING_DECISION_ACTIVITY,
    LOW_DECISION_CONFIDENCE,
    MEDIUM_DECISION_CONFIDENCE,
    NOTES_DECISION_ACTIVITY,
    OUTCOME_DECISION_ACTIVITY,
    OVERVIEW_DECISION_ACTIVITY,
    PRIORITY_DECISION_ACTIVITY,
    REVIEW_ASC_DECISION_LIST_SORT,
    REVIEW_DECISION_ACTIVITY,
    REVIEW_DESC_DECISION_LIST_SORT,
    RESTORE_DECISION_ACTIVITY,
    STATUS_DECISION_ACTIVITY,
    UPDATED_DECISION_LIST_SORT,
    VALID_DECISION_ATTENTION_WORKFLOW_STATES,
    VALID_DECISION_CATEGORIES,
    VALID_DECISION_ACTIVITY_TYPES,
    VALID_DECISION_CONFIDENCE_SCORES,
    VALID_DECISION_LEARNING_WORKFLOW_STATES,
    VALID_DECISION_LIST_LIFECYCLES,
    VALID_DECISION_LIST_SORTS,
    VALID_DECISION_NOTES_WORKFLOW_STATES,
    VALID_DECISION_OUTCOME_STATUSES,
    VALID_DECISION_OUTCOME_WORKFLOW_STATES,
    VALID_DECISION_REVIEW_WORKFLOW_STATES,
    VALID_DECISION_PRIORITIES,
    VALID_DECISION_STATUSES,
)


class DecisionFilterTests(unittest.TestCase):
    def build_memory_decision_session_factory(self):
        engine = create_engine(
            "sqlite:///:memory:",
        )
        Dataset.__table__.create(
            engine,
        )
        Decision.__table__.create(
            engine,
        )
        DecisionActivity.__table__.create(
            engine,
        )

        return sessionmaker(
            bind=engine,
        )

    def build_memory_decision_session(self):
        Session = self.build_memory_decision_session_factory()

        return Session()

    def test_activity_feed_filter_requires_accessible_decision(self):
        expression = filter_decision_activity_feed_for_workspace(
            "user-1",
            "workspace-1",
        )

        sql = str(
            expression.compile(
                dialect=sqlite.dialect(),
                compile_kwargs={
                    "literal_binds": True,
                },
            )
        )

        self.assertIn(
            "decisions.workspace_id = 'workspace-1'",
            sql,
        )
        self.assertIn(
            "decision_activities.workspace_id = 'workspace-1'",
            sql,
        )
        self.assertNotIn(
            "decisions.id IS NULL",
            sql,
        )

    def test_decision_filter_scopes_single_decision_to_workspace_or_legacy_owner(self):
        expression = filter_decision_for_workspace(
            7,
            "user-1",
            "workspace-1",
        )

        sql = str(
            expression.compile(
                dialect=sqlite.dialect(),
                compile_kwargs={
                    "literal_binds": True,
                },
            )
        )

        self.assertIn(
            "decisions.id = 7",
            sql,
        )
        self.assertIn(
            "decisions.workspace_id = 'workspace-1'",
            sql,
        )
        self.assertIn(
            "decisions.workspace_id IS NULL",
            sql,
        )
        self.assertIn(
            "decisions.clerk_user_id = 'user-1'",
            sql,
        )

    def test_dataset_filter_scopes_create_access_to_workspace_or_legacy_owner(self):
        expression = filter_dataset_for_workspace(
            3,
            "user-1",
            "workspace-1",
        )

        sql = str(
            expression.compile(
                dialect=sqlite.dialect(),
                compile_kwargs={
                    "literal_binds": True,
                },
            )
        )

        self.assertIn(
            "datasets.id = 3",
            sql,
        )
        self.assertIn(
            "datasets.workspace_id = 'workspace-1'",
            sql,
        )
        self.assertIn(
            "datasets.workspace_id IS NULL",
            sql,
        )
        self.assertIn(
            "datasets.user_id = 'user-1'",
            sql,
        )

    def test_decision_activity_timeline_filter_allows_workspace_and_legacy_events(self):
        expression = filter_decision_activities_for_workspace(
            "user-1",
            "workspace-1",
        )

        sql = str(
            expression.compile(
                dialect=sqlite.dialect(),
                compile_kwargs={
                    "literal_binds": True,
                },
            )
        )

        self.assertIn(
            "decision_activities.workspace_id = 'workspace-1'",
            sql,
        )
        self.assertIn(
            "decision_activities.workspace_id IS NULL",
            sql,
        )

    def test_active_workspace_id_defaults_to_user_when_header_missing(self):
        self.assertEqual(
            get_active_user_id(
                "  user-1  ",
            ),
            "user-1",
        )
        self.assertEqual(
            get_active_workspace_id(
                "user-1",
                None,
            ),
            "user-1",
        )
        self.assertEqual(
            get_active_workspace_id(
                "user-1",
                "workspace-1",
            ),
            "workspace-1",
        )
        self.assertEqual(
            get_active_workspace_id(
                "user-1",
                "  workspace-1  ",
            ),
            "workspace-1",
        )
        self.assertEqual(
            get_active_workspace_id(
                "user-1",
                "   ",
            ),
            "user-1",
        )
        self.assertEqual(
            get_active_workspace_id(
                "  user-1  ",
                "   ",
            ),
            "user-1",
        )
        self.assertEqual(
            get_active_workspace_id(
                "user-1",
                123,
            ),
            "123",
        )

    def test_active_user_id_rejects_blank_header(self):
        with self.assertRaises(
            HTTPException,
        ) as context:
            get_active_user_id(
                "   ",
            )

        self.assertEqual(
            context.exception.status_code,
            400,
        )
        self.assertEqual(
            context.exception.detail,
            "User id is required",
        )

    def test_workspace_filters_trim_user_id_for_legacy_records(self):
        decision_expression = filter_decision_for_workspace(
            7,
            "  user-1  ",
            "   ",
        )
        dataset_expression = filter_dataset_for_workspace(
            3,
            "  user-1  ",
            "   ",
        )

        decision_sql = str(
            decision_expression.compile(
                dialect=sqlite.dialect(),
                compile_kwargs={
                    "literal_binds": True,
                },
            )
        )
        dataset_sql = str(
            dataset_expression.compile(
                dialect=sqlite.dialect(),
                compile_kwargs={
                    "literal_binds": True,
                },
            )
        )

        self.assertIn(
            "decisions.workspace_id = 'user-1'",
            decision_sql,
        )
        self.assertIn(
            "decisions.clerk_user_id = 'user-1'",
            decision_sql,
        )
        self.assertIn(
            "datasets.workspace_id = 'user-1'",
            dataset_sql,
        )
        self.assertIn(
            "datasets.user_id = 'user-1'",
            dataset_sql,
        )

    def test_accessible_dataset_returns_workspace_and_legacy_owner_records(self):
        db = self.build_memory_decision_session()

        try:
            workspace_dataset = Dataset(
                id=1,
                file_name="workspace.csv",
                file_path="/tmp/workspace.csv",
                row_count=10,
                column_count=2,
                created_at=datetime(
                    2026,
                    1,
                    1,
                ),
                user_id="user-2",
                workspace_id="workspace-1",
            )
            legacy_dataset = Dataset(
                id=2,
                file_name="legacy.csv",
                file_path="/tmp/legacy.csv",
                row_count=5,
                column_count=2,
                created_at=datetime(
                    2026,
                    1,
                    1,
                ),
                user_id="user-1",
                workspace_id=None,
            )
            inaccessible_dataset = Dataset(
                id=3,
                file_name="other.csv",
                file_path="/tmp/other.csv",
                row_count=5,
                column_count=2,
                created_at=datetime(
                    2026,
                    1,
                    1,
                ),
                user_id="user-2",
                workspace_id=None,
            )
            db.add_all([
                workspace_dataset,
                legacy_dataset,
                inaccessible_dataset,
            ])
            db.commit()

            self.assertEqual(
                get_accessible_dataset(
                    db,
                    1,
                    "user-1",
                    "workspace-1",
                ).id,
                workspace_dataset.id,
            )
            self.assertEqual(
                get_accessible_dataset(
                    db,
                    2,
                    "user-1",
                    "workspace-1",
                ).id,
                legacy_dataset.id,
            )
            self.assertIsNone(
                get_accessible_dataset(
                    db,
                    3,
                    "user-1",
                    "workspace-1",
                )
            )

        finally:
            db.close()

    def test_accessible_decision_returns_workspace_and_legacy_owner_records(self):
        db = self.build_memory_decision_session()

        try:
            workspace_decision = Decision(
                id=1,
                clerk_user_id="user-2",
                workspace_id="workspace-1",
                dataset_id=1,
                title="Workspace decision",
                status=DEFAULT_DECISION_STATUS,
            )
            legacy_decision = Decision(
                id=2,
                clerk_user_id="user-1",
                workspace_id=None,
                dataset_id=1,
                title="Legacy decision",
                status=DEFAULT_DECISION_STATUS,
            )
            db.add_all([
                workspace_decision,
                legacy_decision,
            ])
            db.commit()

            self.assertEqual(
                get_accessible_decision_or_404(
                    db,
                    1,
                    "user-1",
                    "workspace-1",
                ).id,
                workspace_decision.id,
            )
            self.assertEqual(
                get_accessible_decision_or_404(
                    db,
                    2,
                    "user-1",
                    "workspace-1",
                ).id,
                legacy_decision.id,
            )

        finally:
            db.close()

    def test_accessible_decision_raises_404_for_inaccessible_record(self):
        db = self.build_memory_decision_session()

        try:
            db.add(
                Decision(
                    id=1,
                    clerk_user_id="user-2",
                    workspace_id=None,
                    dataset_id=1,
                    title="Other user legacy decision",
                    status=DEFAULT_DECISION_STATUS,
                )
            )
            db.commit()

            with self.assertRaises(HTTPException) as context:
                get_accessible_decision_or_404(
                    db,
                    1,
                    "user-1",
                    "workspace-1",
                )

            self.assertEqual(
                context.exception.status_code,
                404,
            )
            self.assertEqual(
                context.exception.detail,
                "Decision not found",
            )

        finally:
            db.close()

    def seed_dataset(
        self,
        db,
        dataset_id: int = 1,
        user_id: str = "user-1",
        workspace_id: str | None = "workspace-1",
    ):
        dataset = Dataset(
            id=dataset_id,
            file_name="source.csv",
            file_path="/tmp/source.csv",
            row_count=10,
            column_count=2,
            created_at=datetime(
                2026,
                1,
                1,
            ),
            user_id=user_id,
            workspace_id=workspace_id,
        )
        db.add(
            dataset,
        )
        db.commit()

        return dataset

    def test_create_decision_route_trims_fields_assigns_workspace_and_records_activity(self):
        Session = self.build_memory_decision_session_factory()
        db = Session()

        try:
            self.seed_dataset(
                db,
            )

        finally:
            db.close()

        with patch(
            "app.modules.decisions.router.SessionLocal",
            Session,
        ):
            decision = asyncio.run(
                create_decision_route(
                    DecisionCreate(
                        dataset_id=1,
                        title="  Launch pricing  ",
                        description="  Pick starter package  ",
                        expected_outcome="  Improve margin by 4 points  ",
                        priority=DEFAULT_DECISION_PRIORITY,
                        category=DEFAULT_DECISION_CATEGORY,
                        confidence_score=HIGH_DECISION_CONFIDENCE,
                        review_date=datetime(
                            2026,
                            2,
                            3,
                            9,
                            30,
                            tzinfo=timezone.utc,
                        ),
                    ),
                    x_user_id="user-1",
                    x_workspace_id="workspace-1",
                )
            )

        db = Session()

        try:
            persisted_decision = db.query(Decision).one()
            activities = db.query(DecisionActivity).all()

            self.assertEqual(
                decision.id,
                persisted_decision.id,
            )
            self.assertEqual(
                persisted_decision.title,
                "Launch pricing",
            )
            self.assertEqual(
                persisted_decision.description,
                "Pick starter package",
            )
            self.assertEqual(
                persisted_decision.expected_outcome,
                "Improve margin by 4 points",
            )
            self.assertEqual(
                persisted_decision.workspace_id,
                "workspace-1",
            )
            self.assertEqual(
                persisted_decision.priority,
                DEFAULT_DECISION_PRIORITY,
            )
            self.assertEqual(
                persisted_decision.category,
                DEFAULT_DECISION_CATEGORY,
            )
            self.assertEqual(
                persisted_decision.confidence_score,
                HIGH_DECISION_CONFIDENCE,
            )
            self.assertEqual(
                persisted_decision.review_date,
                datetime(2026, 2, 3, 9, 30),
            )
            self.assertIsNone(
                persisted_decision.updated_at,
            )
            self.assertEqual(
                len(activities),
                1,
            )
            self.assertEqual(
                activities[0].activity_type,
                CREATED_DECISION_ACTIVITY,
            )
            self.assertEqual(
                activities[0].workspace_id,
                "workspace-1",
            )

        finally:
            db.close()

    def test_create_decision_route_trims_user_id_for_legacy_dataset(self):
        Session = self.build_memory_decision_session_factory()
        db = Session()

        try:
            self.seed_dataset(
                db,
                user_id="user-1",
                workspace_id=None,
            )

        finally:
            db.close()

        with patch(
            "app.modules.decisions.router.SessionLocal",
            Session,
        ):
            asyncio.run(
                create_decision_route(
                    DecisionCreate(
                        dataset_id=1,
                        title="Launch pricing",
                        expected_outcome="Improve margin by 4 points",
                    ),
                    x_user_id="  user-1  ",
                    x_workspace_id="   ",
                )
            )

        db = Session()

        try:
            persisted_decision = db.query(Decision).one()
            activities = db.query(DecisionActivity).all()

            self.assertEqual(
                persisted_decision.clerk_user_id,
                "user-1",
            )
            self.assertEqual(
                persisted_decision.workspace_id,
                "user-1",
            )
            self.assertEqual(
                activities[0].workspace_id,
                "user-1",
            )

        finally:
            db.close()

    def test_create_decision_route_rejects_inaccessible_dataset(self):
        Session = self.build_memory_decision_session_factory()
        db = Session()

        try:
            self.seed_dataset(
                db,
                user_id="user-2",
                workspace_id=None,
            )

        finally:
            db.close()

        with patch(
            "app.modules.decisions.router.SessionLocal",
            Session,
        ):
            with self.assertRaises(HTTPException) as context:
                asyncio.run(
                    create_decision_route(
                        DecisionCreate(
                            dataset_id=1,
                            title="Launch pricing",
                            expected_outcome="Improve margin by 4 points",
                        ),
                        x_user_id="user-1",
                        x_workspace_id="workspace-1",
                    )
                )

        self.assertEqual(
            context.exception.status_code,
            404,
        )
        self.assertEqual(
            context.exception.detail,
            "Dataset not found",
        )

    def test_status_lifecycle_routes_record_archive_restore_and_noop_events(self):
        Session = self.build_memory_decision_session_factory()
        db = Session()

        try:
            db.add(
                Decision(
                    id=1,
                    clerk_user_id="user-1",
                    workspace_id="workspace-1",
                    dataset_id=1,
                    title="Launch pricing",
                    status=DEFAULT_DECISION_STATUS,
                )
            )
            db.commit()

        finally:
            db.close()

        with patch(
            "app.modules.decisions.router.SessionLocal",
            Session,
        ):
            asyncio.run(
                update_decision_route(
                    1,
                    DecisionUpdate(
                        status=DEFAULT_DECISION_STATUS,
                    ),
                    x_user_id="user-1",
                    x_workspace_id="workspace-1",
                )
            )
            asyncio.run(
                archive_decision(
                    1,
                    x_user_id="user-1",
                    x_workspace_id="workspace-1",
                )
            )
            asyncio.run(
                restore_decision(
                    1,
                    x_user_id="user-1",
                    x_workspace_id="workspace-1",
                )
            )

        db = Session()

        try:
            decision = db.query(Decision).one()
            activities = (
                db.query(DecisionActivity)
                .order_by(DecisionActivity.id)
                .all()
            )

            self.assertEqual(
                decision.status,
                DEFAULT_DECISION_STATUS,
            )
            self.assertEqual(
                [
                    activity.activity_type
                    for activity in activities
                ],
                [
                    ARCHIVE_DECISION_ACTIVITY,
                    RESTORE_DECISION_ACTIVITY,
                ],
            )
            self.assertTrue(
                all(
                    activity.workspace_id == "workspace-1"
                    for activity in activities
                )
            )

        finally:
            db.close()

    def test_outcome_update_route_preserves_omitted_fields_and_clears_explicit_nulls(self):
        Session = self.build_memory_decision_session_factory()
        db = Session()

        try:
            db.add(
                Decision(
                    id=1,
                    clerk_user_id="user-1",
                    workspace_id="workspace-1",
                    dataset_id=1,
                    title="Launch pricing",
                    expected_outcome="Improve margin",
                    actual_outcome="Not measured",
                    outcome_status="partially_successful",
                )
            )
            db.commit()

        finally:
            db.close()

        with patch(
            "app.modules.decisions.router.SessionLocal",
            Session,
        ):
            asyncio.run(
                update_decision_outcome(
                    1,
                    DecisionOutcomeUpdate(
                        actual_outcome="  Bigger ACV  ",
                    ),
                    x_user_id="user-1",
                    x_workspace_id="workspace-1",
                )
            )

            asyncio.run(
                update_decision_outcome(
                    1,
                    DecisionOutcomeUpdate(
                        actual_outcome=None,
                    ),
                    x_user_id="user-1",
                    x_workspace_id="workspace-1",
                )
            )

        db = Session()

        try:
            decision = db.query(Decision).one()
            activities = db.query(DecisionActivity).all()

            self.assertEqual(
                decision.expected_outcome,
                "Improve margin",
            )
            self.assertIsNone(
                decision.actual_outcome,
            )
            self.assertEqual(
                decision.outcome_status,
                "partially_successful",
            )
            self.assertEqual(
                len(activities),
                2,
            )
            self.assertTrue(
                all(
                    activity.activity_type == OUTCOME_DECISION_ACTIVITY
                    for activity in activities
                )
            )

        finally:
            db.close()

    def test_decision_schema_vocabulary_includes_current_ui_values(self):
        self.assertEqual(
            VALID_DECISION_STATUSES,
            set(get_args(DecisionStatus)),
        )
        self.assertEqual(
            VALID_DECISION_STATUSES,
            {
                "planned",
                "in_progress",
                "completed",
                "cancelled",
                "archived",
            },
        )
        self.assertEqual(
            VALID_DECISION_PRIORITIES,
            {
                "high",
                "medium",
                "low",
            },
        )
        self.assertIn(
            "product",
            VALID_DECISION_CATEGORIES,
        )
        self.assertIn(
            "partially_successful",
            VALID_DECISION_OUTCOME_STATUSES,
        )
        self.assertEqual(
            VALID_DECISION_CONFIDENCE_SCORES,
            VALID_DECISION_PRIORITIES,
        )
        self.assertIn(
            "archive",
            VALID_DECISION_ACTIVITY_TYPES,
        )
        self.assertIn(
            "restore",
            VALID_DECISION_ACTIVITY_TYPES,
        )
        self.assertEqual(
            VALID_DECISION_LIST_LIFECYCLES,
            set(get_args(DecisionListLifecycle)),
        )
        self.assertEqual(
            VALID_DECISION_ATTENTION_WORKFLOW_STATES,
            set(get_args(DecisionAttentionWorkflowState)),
        )
        self.assertEqual(
            VALID_DECISION_OUTCOME_WORKFLOW_STATES,
            set(get_args(DecisionOutcomeWorkflowState)),
        )
        self.assertEqual(
            VALID_DECISION_LEARNING_WORKFLOW_STATES,
            set(get_args(DecisionLearningWorkflowState)),
        )
        self.assertEqual(
            VALID_DECISION_NOTES_WORKFLOW_STATES,
            set(get_args(DecisionNotesWorkflowState)),
        )
        self.assertEqual(
            VALID_DECISION_REVIEW_WORKFLOW_STATES,
            set(get_args(DecisionReviewWorkflowState)),
        )
        self.assertEqual(
            VALID_DECISION_LIST_SORTS,
            set(get_args(DecisionListSort)),
        )
        self.assertEqual(
            DECISION_LIST_LIFECYCLE_PATTERN,
            "^(all|active|archived)$",
        )
        self.assertEqual(
            DECISION_ATTENTION_WORKFLOW_STATE_PATTERN,
            "^(required)$",
        )
        self.assertEqual(
            DECISION_OUTCOME_WORKFLOW_STATE_PATTERN,
            "^(planned|pending|recorded|evaluated)$",
        )
        self.assertEqual(
            DECISION_LEARNING_WORKFLOW_STATE_PATTERN,
            "^(captured|pending)$",
        )
        self.assertEqual(
            DECISION_NOTES_WORKFLOW_STATE_PATTERN,
            "^(added|pending)$",
        )
        self.assertEqual(
            DECISION_REVIEW_WORKFLOW_STATE_PATTERN,
            "^(scheduled|overdue|upcoming)$",
        )
        self.assertEqual(
            DECISION_LIST_SORT_PATTERN,
            "^(created_desc|created_asc|updated_desc|review_asc|review_desc)$",
        )

    def test_literal_pattern_escapes_regex_metacharacters(self):
        SyntheticLiteral = Literal[
            "a+b",
            "value.with.dots",
        ]

        self.assertEqual(
            build_literal_pattern(
                SyntheticLiteral,
            ),
            "^(a\\+b|value\\.with\\.dots)$",
        )

    def test_decision_defaults_are_part_of_schema_vocabulary(self):
        expected_value_groups = [
            (
                "status",
                [
                    DEFAULT_DECISION_STATUS,
                    ARCHIVED_DECISION_STATUS,
                ],
                VALID_DECISION_STATUSES,
            ),
            (
                "priority",
                [
                    DEFAULT_DECISION_PRIORITY,
                ],
                VALID_DECISION_PRIORITIES,
            ),
            (
                "category",
                [
                    DEFAULT_DECISION_CATEGORY,
                ],
                VALID_DECISION_CATEGORIES,
            ),
            (
                "confidence",
                [
                    HIGH_DECISION_CONFIDENCE,
                    MEDIUM_DECISION_CONFIDENCE,
                    LOW_DECISION_CONFIDENCE,
                ],
                VALID_DECISION_CONFIDENCE_SCORES,
            ),
            (
                "lifecycle",
                [
                    DEFAULT_DECISION_LIST_LIFECYCLE,
                    ACTIVE_DECISION_LIST_LIFECYCLE,
                    ARCHIVED_DECISION_LIST_LIFECYCLE,
                ],
                VALID_DECISION_LIST_LIFECYCLES,
            ),
            (
                "sort",
                [
                    DEFAULT_DECISION_LIST_SORT,
                    UPDATED_DECISION_LIST_SORT,
                    CREATED_ASC_DECISION_LIST_SORT,
                    REVIEW_ASC_DECISION_LIST_SORT,
                    REVIEW_DESC_DECISION_LIST_SORT,
                ],
                VALID_DECISION_LIST_SORTS,
            ),
            (
                "activity",
                [
                    CREATED_DECISION_ACTIVITY,
                    STATUS_DECISION_ACTIVITY,
                    ARCHIVE_DECISION_ACTIVITY,
                    RESTORE_DECISION_ACTIVITY,
                    OVERVIEW_DECISION_ACTIVITY,
                    DETAILS_DECISION_ACTIVITY,
                    NOTES_DECISION_ACTIVITY,
                    OUTCOME_DECISION_ACTIVITY,
                    LEARNING_DECISION_ACTIVITY,
                    REVIEW_DECISION_ACTIVITY,
                    PRIORITY_DECISION_ACTIVITY,
                    CATEGORY_DECISION_ACTIVITY,
                    CONFIDENCE_DECISION_ACTIVITY,
                ],
                VALID_DECISION_ACTIVITY_TYPES,
            ),
        ]

        for group_name, values, valid_values in expected_value_groups:
            for value in values:
                with self.subTest(
                    group=group_name,
                    value=value,
                ):
                    self.assertIn(
                        value,
                        valid_values,
                    )

        self.assertEqual(
            Decision.__table__.c.status.default.arg,
            DEFAULT_DECISION_STATUS,
        )
        self.assertEqual(
            Decision.__table__.c.priority.default.arg,
            DEFAULT_DECISION_PRIORITY,
        )
        self.assertEqual(
            Decision.__table__.c.category.default.arg,
            DEFAULT_DECISION_CATEGORY,
        )
        self.assertIsNotNone(
            DecisionActivity.__table__.c.created_at.default,
        )

    def compile_decision_query(self, query):
        return str(
            query.compile(
                dialect=sqlite.dialect(),
                compile_kwargs={
                    "literal_binds": True,
                },
            )
        )

    def build_decision_list_query(
        self,
        status: DecisionStatus | None = None,
        lifecycle: DecisionListLifecycle = DEFAULT_DECISION_LIST_LIFECYCLE,
        category: DecisionCategory | None = None,
        attention_state: DecisionAttentionWorkflowState | None = None,
        outcome_state: DecisionOutcomeWorkflowState | None = None,
        learning_state: DecisionLearningWorkflowState | None = None,
        notes_state: DecisionNotesWorkflowState | None = None,
        review_state: DecisionReviewWorkflowState | None = None,
        search: str | None = None,
        sort: DecisionListSort = DEFAULT_DECISION_LIST_SORT,
    ):
        query = apply_decision_list_filters(
            select(Decision),
            status,
            lifecycle,
            category,
            attention_state,
            outcome_state,
            learning_state,
            notes_state,
            review_state,
            search,
        )

        return apply_decision_list_sort(
            query,
            sort,
        )

    def test_meaningful_text_filter_excludes_null_and_blank_values(self):
        sql = str(
            has_meaningful_text(
                Decision.notes,
            ).compile(
                dialect=sqlite.dialect(),
                compile_kwargs={
                    "literal_binds": True,
                },
            )
        )

        self.assertIn(
            "decisions.notes IS NOT NULL",
            sql,
        )
        self.assertIn(
            "trim(decisions.notes) != ''",
            sql,
        )

    def test_recorded_outcome_filter_accepts_status_or_actual_outcome(self):
        sql = str(
            has_recorded_outcome().compile(
                dialect=sqlite.dialect(),
                compile_kwargs={
                    "literal_binds": True,
                },
            )
        )

        self.assertIn(
            "decisions.outcome_status IS NOT NULL",
            sql,
        )
        self.assertIn(
            "trim(decisions.outcome_status) != ''",
            sql,
        )
        self.assertIn(
            "decisions.actual_outcome IS NOT NULL",
            sql,
        )
        self.assertIn(
            "trim(decisions.actual_outcome) != ''",
            sql,
        )
        self.assertIn(
            " OR ",
            sql,
        )

    def test_pending_outcome_filter_requires_expected_without_recorded_outcome(self):
        sql = str(
            has_pending_outcome().compile(
                dialect=sqlite.dialect(),
                compile_kwargs={
                    "literal_binds": True,
                },
            )
        )

        self.assertIn(
            "decisions.status != 'archived'",
            sql,
        )
        self.assertIn(
            "decisions.expected_outcome IS NOT NULL",
            sql,
        )
        self.assertIn(
            "trim(decisions.expected_outcome) != ''",
            sql,
        )
        self.assertIn(
            "decisions.outcome_status IS NOT NULL",
            sql,
        )
        self.assertIn(
            "decisions.actual_outcome IS NOT NULL",
            sql,
        )
        self.assertIn(
            "NOT",
            sql,
        )

    def test_pending_learning_filter_requires_recorded_outcome_without_lessons(self):
        sql = str(
            has_pending_learning().compile(
                dialect=sqlite.dialect(),
                compile_kwargs={
                    "literal_binds": True,
                },
            )
        )

        self.assertIn(
            "decisions.outcome_status IS NOT NULL",
            sql,
        )
        self.assertIn(
            "decisions.actual_outcome IS NOT NULL",
            sql,
        )
        self.assertIn(
            "decisions.lessons_learned IS NOT NULL",
            sql,
        )
        self.assertIn(
            "NOT",
            sql,
        )

    def test_decision_list_learning_state_filters_captured_and_pending_learning(self):
        captured_sql = self.compile_decision_query(
            self.build_decision_list_query(
                learning_state="captured",
            )
        )
        pending_sql = self.compile_decision_query(
            self.build_decision_list_query(
                learning_state="pending",
            )
        )

        self.assertIn(
            "decisions.lessons_learned IS NOT NULL",
            captured_sql,
        )
        self.assertIn(
            "trim(decisions.lessons_learned) != ''",
            captured_sql,
        )
        self.assertIn(
            "decisions.status != 'archived'",
            pending_sql,
        )
        self.assertIn(
            "decisions.outcome_status IS NOT NULL",
            pending_sql,
        )
        self.assertIn(
            "decisions.actual_outcome IS NOT NULL",
            pending_sql,
        )
        self.assertIn(
            "NOT",
            pending_sql,
        )

    def test_pending_notes_filter_requires_active_record_without_notes(self):
        sql = str(
            has_pending_notes().compile(
                dialect=sqlite.dialect(),
                compile_kwargs={
                    "literal_binds": True,
                },
            )
        )

        self.assertIn(
            "decisions.status != 'archived'",
            sql,
        )
        self.assertIn(
            "decisions.notes IS NOT NULL",
            sql,
        )
        self.assertIn(
            "NOT",
            sql,
        )

    def test_decision_list_notes_state_filters_added_and_pending_notes(self):
        added_sql = self.compile_decision_query(
            self.build_decision_list_query(
                notes_state="added",
            )
        )
        pending_sql = self.compile_decision_query(
            self.build_decision_list_query(
                notes_state="pending",
            )
        )

        self.assertIn(
            "decisions.notes IS NOT NULL",
            added_sql,
        )
        self.assertIn(
            "trim(decisions.notes) != ''",
            added_sql,
        )
        self.assertIn(
            "decisions.status != 'archived'",
            pending_sql,
        )
        self.assertIn(
            "NOT",
            pending_sql,
        )

    def test_active_decision_record_filter_excludes_archived_status(self):
        sql = str(
            is_active_decision_record().compile(
                dialect=sqlite.dialect(),
                compile_kwargs={
                    "literal_binds": True,
                },
            )
        )

        self.assertEqual(
            sql,
            "decisions.status != 'archived'",
        )

    def test_required_attention_filter_collects_follow_up_work_and_overdue_reviews(self):
        with patch(
            "app.modules.decisions.router.utc_now",
            return_value=datetime(2026, 1, 15, 10, 30),
        ):
            sql = self.compile_decision_query(
                self.build_decision_list_query(
                    attention_state="required",
                )
            )

        self.assertIn(
            "decisions.status != 'archived'",
            sql,
        )
        self.assertIn(
            "decisions.expected_outcome IS NOT NULL",
            sql,
        )
        self.assertIn(
            "decisions.lessons_learned IS NOT NULL",
            sql,
        )
        self.assertIn(
            "decisions.review_date IS NOT NULL",
            sql,
        )
        self.assertIn(
            "decisions.review_date <",
            sql,
        )
        self.assertIn(
            "2026-01-15 00:00:00.000000",
            sql,
        )

    def test_decision_list_review_state_filters_match_summary_urgency(self):
        with patch(
            "app.modules.decisions.router.utc_now",
            return_value=datetime(2026, 1, 15, 10, 30),
        ):
            scheduled_sql = self.compile_decision_query(
                self.build_decision_list_query(
                    review_state="scheduled",
                )
            )
            overdue_sql = self.compile_decision_query(
                self.build_decision_list_query(
                    review_state="overdue",
                )
            )
            upcoming_sql = self.compile_decision_query(
                self.build_decision_list_query(
                    review_state="upcoming",
                )
            )

        for sql in [
            scheduled_sql,
            overdue_sql,
            upcoming_sql,
        ]:
            self.assertIn(
                "decisions.status != 'archived'",
                sql,
            )
            self.assertIn(
                "decisions.review_date IS NOT NULL",
                sql,
            )

        self.assertNotIn(
            "decisions.review_date <",
            scheduled_sql,
        )
        self.assertNotIn(
            "decisions.review_date >=",
            scheduled_sql,
        )
        self.assertIn(
            "decisions.review_date < '2026-01-15 00:00:00.000000'",
            overdue_sql,
        )
        self.assertIn(
            "decisions.review_date >= '2026-01-15 00:00:00.000000'",
            upcoming_sql,
        )

    def test_decision_count_map_scopes_and_filters_controlled_values(self):
        db = self.build_memory_decision_session()

        try:
            db.add_all([
                Decision(
                    clerk_user_id="user-1",
                    workspace_id="workspace-1",
                    dataset_id=1,
                    title="Workspace decision",
                    status=DEFAULT_DECISION_STATUS,
                    created_at=datetime(
                        2026,
                        1,
                        5,
                    ),
                ),
                Decision(
                    clerk_user_id="user-1",
                    workspace_id=None,
                    dataset_id=1,
                    title="Legacy decision",
                    status="completed",
                    created_at=datetime(
                        2026,
                        1,
                        8,
                    ),
                ),
                Decision(
                    clerk_user_id="user-1",
                    workspace_id="workspace-1",
                    dataset_id=1,
                    title="Invalid status",
                    status="paused",
                    created_at=datetime(
                        2026,
                        2,
                        1,
                    ),
                ),
                Decision(
                    clerk_user_id="user-1",
                    workspace_id="workspace-2",
                    dataset_id=1,
                    title="Other workspace",
                    status=ARCHIVED_DECISION_STATUS,
                    created_at=datetime(
                        2026,
                        2,
                        2,
                    ),
                ),
                Decision(
                    clerk_user_id="user-2",
                    workspace_id=None,
                    dataset_id=1,
                    title="Other legacy user",
                    status="cancelled",
                    created_at=datetime(
                        2026,
                        2,
                        3,
                    ),
                ),
            ])
            db.commit()

            counts = get_decision_count_map(
                db,
                "user-1",
                "workspace-1",
                Decision.status,
                VALID_DECISION_STATUSES,
            )

            self.assertEqual(
                counts,
                {
                    DEFAULT_DECISION_STATUS: 1,
                    "completed": 1,
                },
            )

            padded_counts = get_decision_count_map(
                db,
                "  user-1  ",
                " workspace-1 ",
                Decision.status,
                VALID_DECISION_STATUSES,
            )

            self.assertEqual(
                padded_counts,
                counts,
            )

        finally:
            db.close()

    def test_decision_month_count_map_scopes_workspace_and_legacy_owner_records(self):
        db = self.build_memory_decision_session()

        try:
            db.add_all([
                Decision(
                    clerk_user_id="user-1",
                    workspace_id="workspace-1",
                    dataset_id=1,
                    title="January workspace decision",
                    status=DEFAULT_DECISION_STATUS,
                    created_at=datetime(
                        2026,
                        1,
                        5,
                    ),
                ),
                Decision(
                    clerk_user_id="user-1",
                    workspace_id=None,
                    dataset_id=1,
                    title="January legacy decision",
                    status="completed",
                    created_at=datetime(
                        2026,
                        1,
                        8,
                    ),
                ),
                Decision(
                    clerk_user_id="user-1",
                    workspace_id="workspace-1",
                    dataset_id=1,
                    title="February workspace decision",
                    status=DEFAULT_DECISION_STATUS,
                    created_at=datetime(
                        2026,
                        2,
                        1,
                    ),
                ),
                Decision(
                    clerk_user_id="user-1",
                    workspace_id="workspace-2",
                    dataset_id=1,
                    title="Other workspace decision",
                    status=DEFAULT_DECISION_STATUS,
                    created_at=datetime(
                        2026,
                        3,
                        1,
                    ),
                ),
            ])
            db.commit()

            counts = get_decision_month_count_map(
                db,
                "user-1",
                "workspace-1",
            )

            self.assertEqual(
                counts,
                {
                    "2026-01": 2,
                    "2026-02": 1,
                },
            )

            padded_counts = get_decision_month_count_map(
                db,
                "  user-1  ",
                " workspace-1 ",
            )

            self.assertEqual(
                padded_counts,
                counts,
            )

        finally:
            db.close()

    def test_decision_list_active_lifecycle_excludes_archived_decisions(self):
        sql = self.compile_decision_query(
            self.build_decision_list_query(
                lifecycle=ACTIVE_DECISION_LIST_LIFECYCLE,
            )
        )

        self.assertIn(
            "decisions.status != 'archived'",
            sql,
        )

    def test_decision_list_archived_lifecycle_only_includes_archived_decisions(self):
        sql = self.compile_decision_query(
            self.build_decision_list_query(
                lifecycle=ARCHIVED_DECISION_LIST_LIFECYCLE,
            )
        )

        self.assertIn(
            "decisions.status = 'archived'",
            sql,
        )

    def test_decision_list_status_filter_takes_precedence_over_lifecycle(self):
        sql = self.compile_decision_query(
            self.build_decision_list_query(
                status=ARCHIVED_DECISION_STATUS,
                lifecycle=ACTIVE_DECISION_LIST_LIFECYCLE,
            )
        )

        self.assertIn(
            "decisions.status = 'archived'",
            sql,
        )
        self.assertNotIn(
            "decisions.status != 'archived'",
            sql,
        )

    def test_decision_list_updated_sort_uses_updated_then_created_dates(self):
        sql = self.compile_decision_query(
            self.build_decision_list_query(
                sort=UPDATED_DECISION_LIST_SORT,
            )
        )

        self.assertIn(
            "decisions.updated_at IS NULL",
            sql,
        )
        self.assertIn(
            "decisions.updated_at DESC",
            sql,
        )
        self.assertIn(
            "decisions.created_at DESC",
            sql,
        )

    def test_decision_list_category_filter_limits_results_to_category(self):
        sql = self.compile_decision_query(
            self.build_decision_list_query(
                category=DEFAULT_DECISION_CATEGORY,
            )
        )

        self.assertIn(
            "decisions.category = 'general'",
            sql,
        )

    def test_decision_list_outcome_workflow_filters_use_summary_rules(self):
        planned_sql = self.compile_decision_query(
            self.build_decision_list_query(
                outcome_state="planned",
            )
        )
        pending_sql = self.compile_decision_query(
            self.build_decision_list_query(
                outcome_state="pending",
            )
        )
        recorded_sql = self.compile_decision_query(
            self.build_decision_list_query(
                outcome_state="recorded",
            )
        )
        evaluated_sql = self.compile_decision_query(
            self.build_decision_list_query(
                outcome_state="evaluated",
            )
        )

        self.assertIn(
            "trim(decisions.expected_outcome) != ''",
            planned_sql,
        )
        self.assertIn(
            "trim(decisions.expected_outcome) != ''",
            pending_sql,
        )
        self.assertIn(
            "NOT",
            pending_sql,
        )
        self.assertIn(
            "trim(decisions.actual_outcome) != ''",
            recorded_sql,
        )
        self.assertIn(
            " OR ",
            recorded_sql,
        )
        self.assertIn(
            "trim(decisions.outcome_status) != ''",
            evaluated_sql,
        )
        self.assertNotIn(
            "trim(decisions.actual_outcome)",
            evaluated_sql,
        )

    def test_decision_list_search_covers_portfolio_text_fields(self):
        sql = self.compile_decision_query(
            self.build_decision_list_query(
                search="growth",
            )
        )

        self.assertIn(
            "lower(decisions.title) LIKE lower('%growth%')",
            sql,
        )
        self.assertIn(
            "lower(decisions.description) LIKE lower('%growth%')",
            sql,
        )
        self.assertIn(
            "lower(decisions.expected_outcome) LIKE lower('%growth%')",
            sql,
        )
        self.assertIn(
            "lower(decisions.actual_outcome) LIKE lower('%growth%')",
            sql,
        )
        self.assertIn(
            "lower(decisions.status) LIKE lower('%growth%')",
            sql,
        )
        self.assertIn(
            "lower(decisions.priority) LIKE lower('%growth%')",
            sql,
        )
        self.assertIn(
            "lower(decisions.category) LIKE lower('%growth%')",
            sql,
        )
        self.assertIn(
            "lower(decisions.outcome_status) LIKE lower('%growth%')",
            sql,
        )

    def test_decision_list_blank_search_does_not_add_search_filter(self):
        sql = self.compile_decision_query(
            self.build_decision_list_query(
                search="   ",
            )
        )

        self.assertNotIn(
            "LIKE",
            sql,
        )

    def test_decision_list_review_sorts_keep_unscheduled_decisions_last(self):
        ascending_sql = self.compile_decision_query(
            self.build_decision_list_query(
                sort=REVIEW_ASC_DECISION_LIST_SORT,
            )
        )
        descending_sql = self.compile_decision_query(
            self.build_decision_list_query(
                sort=REVIEW_DESC_DECISION_LIST_SORT,
            )
        )

        self.assertIn(
            "decisions.review_date IS NULL",
            ascending_sql,
        )
        self.assertIn(
            "decisions.review_date ASC",
            ascending_sql,
        )
        self.assertIn(
            "decisions.created_at DESC",
            ascending_sql,
        )
        self.assertIn(
            "decisions.review_date IS NULL",
            descending_sql,
        )
        self.assertIn(
            "decisions.review_date DESC",
            descending_sql,
        )
        self.assertIn(
            "decisions.created_at DESC",
            descending_sql,
        )

    def test_decision_list_pagination_applies_offset_and_limit(self):
        query = apply_decision_list_pagination(
            select(Decision),
            limit=25,
            offset=50,
        )

        sql = self.compile_decision_query(
            query,
        )

        self.assertIn(
            "LIMIT 25 OFFSET 50",
            sql,
        )

    def test_decision_list_pagination_allows_unlimited_first_page(self):
        query = apply_decision_list_pagination(
            select(Decision),
            limit=None,
            offset=0,
        )

        sql = self.compile_decision_query(
            query,
        )

        self.assertNotIn(
            "LIMIT",
            sql,
        )
        self.assertNotIn(
            "OFFSET",
            sql,
        )

    def test_decision_list_pagination_rejects_negative_offset(self):
        with self.assertRaises(HTTPException) as context:
            apply_decision_list_pagination(
                select(Decision),
                limit=None,
                offset=-1,
            )

        self.assertEqual(
            context.exception.status_code,
            400,
        )
        self.assertEqual(
            context.exception.detail,
            "Decision list offset must be zero or greater",
        )

    def test_decision_list_pagination_rejects_non_positive_limit(self):
        for limit in (
            0,
            -1,
        ):
            with self.subTest(
                limit=limit,
            ):
                with self.assertRaises(HTTPException) as context:
                    apply_decision_list_pagination(
                        select(Decision),
                        limit=limit,
                        offset=0,
                    )

                self.assertEqual(
                    context.exception.status_code,
                    400,
                )
                self.assertEqual(
                    context.exception.detail,
                    "Decision list limit must be greater than zero",
                )

    def test_record_decision_activity_rejects_unknown_activity_type(self):
        with self.assertRaises(
            ValueError,
        ):
            record_decision_activity(
                db=None,
                decision=None,
                activity_type="mystery",
                message="Mystery event",
            )

    def test_record_decision_activity_sets_workspace_and_touches_decision(self):
        class FakeDb:
            def __init__(self):
                self.added = []

            def add(self, item):
                self.added.append(
                    item,
                )

        db = FakeDb()
        decision = Decision(
            id=42,
            workspace_id="workspace-1",
            updated_at=None,
        )

        activity = record_decision_activity(
            db,
            decision,
            NOTES_DECISION_ACTIVITY,
            DECISION_ACTIVITY_MESSAGES[NOTES_DECISION_ACTIVITY],
        )

        self.assertIsNotNone(
            decision.updated_at,
        )
        self.assertEqual(
            activity.decision_id,
            42,
        )
        self.assertEqual(
            activity.workspace_id,
            "workspace-1",
        )
        self.assertEqual(
            activity.activity_type,
            NOTES_DECISION_ACTIVITY,
        )
        self.assertEqual(
            db.added,
            [
                activity,
            ],
        )

    def test_record_decision_activity_can_skip_touching_decision_timestamp(self):
        class FakeDb:
            def add(self, item):
                self.activity = item

        existing_updated_at = datetime(
            2026,
            1,
            1,
            12,
            0,
        )
        decision = Decision(
            id=42,
            updated_at=existing_updated_at,
        )

        record_decision_activity(
            FakeDb(),
            decision,
            CREATED_DECISION_ACTIVITY,
            DECISION_ACTIVITY_MESSAGES[CREATED_DECISION_ACTIVITY],
            touch_decision_record=False,
        )

        self.assertEqual(
            decision.updated_at,
            existing_updated_at,
        )

    def test_utc_now_returns_naive_utc_timestamp_for_database_columns(self):
        timestamp = utc_now()

        self.assertIsNone(
            timestamp.tzinfo,
        )
        self.assertIsInstance(
            timestamp,
            datetime,
        )

    def test_decision_activity_model_default_uses_naive_utc_timestamp(self):
        timestamp = activity_utc_now()

        self.assertIsNone(
            timestamp.tzinfo,
        )
        self.assertIsInstance(
            timestamp,
            datetime,
        )

    def test_decision_activity_messages_cover_every_activity_type(self):
        self.assertEqual(
            set(DECISION_ACTIVITY_MESSAGES.keys()),
            VALID_DECISION_ACTIVITY_TYPES,
        )

        for activity_type, message in DECISION_ACTIVITY_MESSAGES.items():
            with self.subTest(activity_type=activity_type):
                self.assertIsInstance(
                    message,
                    str,
                )
                self.assertTrue(
                    message.strip(),
                )

    def test_overview_activity_type_uses_specific_event_for_single_change(self):
        self.assertEqual(
            get_overview_activity_type([
                PRIORITY_DECISION_ACTIVITY,
            ]),
            PRIORITY_DECISION_ACTIVITY,
        )
        self.assertEqual(
            get_overview_activity_type([
                REVIEW_DECISION_ACTIVITY,
            ]),
            REVIEW_DECISION_ACTIVITY,
        )

    def test_overview_activity_type_uses_overview_for_multiple_changes(self):
        self.assertEqual(
            get_overview_activity_type([
                PRIORITY_DECISION_ACTIVITY,
                CONFIDENCE_DECISION_ACTIVITY,
            ]),
            OVERVIEW_DECISION_ACTIVITY,
        )

    def test_overview_activity_type_skips_event_when_nothing_changed(self):
        self.assertIsNone(
            get_overview_activity_type([]),
        )

    def test_required_decision_title_is_trimmed(self):
        self.assertEqual(
            clean_required_decision_title("  Launch pricing  "),
            "Launch pricing",
        )

    def test_required_decision_title_rejects_blank_titles(self):
        with self.assertRaises(HTTPException) as context:
            clean_required_decision_title("   ")

        self.assertEqual(
            context.exception.status_code,
            400,
        )
        self.assertEqual(
            context.exception.detail,
            "Decision title is required",
        )

    def test_required_decision_title_rejects_non_string_values(self):
        with self.assertRaises(HTTPException) as context:
            clean_required_decision_title(123)

        self.assertEqual(
            context.exception.status_code,
            400,
        )
        self.assertEqual(
            context.exception.detail,
            "Decision title must be a string",
        )

    def test_optional_text_cleaners_trim_and_clear_blank_values(self):
        self.assertEqual(
            clean_optional_single_line_text("  Short note  "),
            "Short note",
        )
        self.assertEqual(
            clean_optional_multiline_text("  Line one\nLine two  "),
            "Line one\nLine two",
        )
        self.assertIsNone(
            clean_optional_single_line_text("   "),
        )
        self.assertIsNone(
            clean_optional_multiline_text("\n  "),
        )
        self.assertIsNone(
            clean_optional_single_line_text(None),
        )

    def test_required_expected_outcome_trims_text(self):
        self.assertEqual(
            clean_required_decision_expected_outcome(
                "  Improve margin by 4 points  ",
            ),
            "Improve margin by 4 points",
        )

    def test_required_expected_outcome_rejects_blank_values(self):
        for value in (
            None,
            "   ",
            "\n  ",
        ):
            with self.subTest(
                value=value,
            ):
                with self.assertRaises(HTTPException) as context:
                    clean_required_decision_expected_outcome(
                        value,
                    )

                self.assertEqual(
                    context.exception.status_code,
                    400,
                )
                self.assertEqual(
                    context.exception.detail,
                    "Expected outcome is required",
                )

    def test_optional_text_cleaners_reject_non_string_values(self):
        for cleaner in (
            clean_optional_single_line_text,
            clean_optional_multiline_text,
        ):
            with self.subTest(
                cleaner=cleaner.__name__,
            ):
                with self.assertRaises(HTTPException) as context:
                    cleaner(
                        [
                            "not text",
                        ]
                    )

                self.assertEqual(
                    context.exception.status_code,
                    400,
                )
                self.assertEqual(
                    context.exception.detail,
                    "Decision text fields must be strings",
                )

    def test_optional_controlled_value_trims_and_validates_values(self):
        self.assertEqual(
            validate_optional_decision_controlled_value(
                " high ",
                VALID_DECISION_PRIORITIES,
                "priority",
            ),
            "high",
        )

        self.assertIsNone(
            validate_optional_decision_controlled_value(
                "   ",
                VALID_DECISION_PRIORITIES,
                "priority",
            )
        )

    def test_optional_controlled_value_rejects_unknown_values(self):
        with self.assertRaises(HTTPException) as context:
            validate_optional_decision_controlled_value(
                "urgent",
                VALID_DECISION_PRIORITIES,
                "priority",
            )

        self.assertEqual(
            context.exception.status_code,
            400,
        )
        self.assertEqual(
            context.exception.detail,
            "Invalid decision priority",
        )

    def test_controlled_value_rejects_non_string_values(self):
        with self.assertRaises(HTTPException) as context:
            validate_optional_decision_controlled_value(
                123,
                VALID_DECISION_PRIORITIES,
                "priority",
            )

        self.assertEqual(
            context.exception.status_code,
            400,
        )
        self.assertEqual(
            context.exception.detail,
            "Decision priority must be a string",
        )

    def test_archived_decision_edit_guard_rejects_historical_records(self):
        with self.assertRaises(HTTPException) as context:
            ensure_decision_is_editable(
                Decision(
                    status=ARCHIVED_DECISION_STATUS,
                )
            )

        self.assertEqual(
            context.exception.status_code,
            400,
        )
        self.assertEqual(
            context.exception.detail,
            "Restore this decision before editing it",
        )

    def test_archived_decision_edit_guard_allows_active_records(self):
        self.assertIsNone(
            ensure_decision_is_editable(
                Decision(
                    status=DEFAULT_DECISION_STATUS,
                )
            )
        )

    def test_decision_update_rejects_unknown_status(self):
        with self.assertRaises(
            ValidationError,
        ):
            DecisionUpdate(
                status="paused",
            )

    def test_decision_create_rejects_unknown_confidence_score(self):
        with self.assertRaises(
            ValidationError,
        ):
            DecisionCreate(
                dataset_id=1,
                title="Launch pricing",
                confidence_score="certain",
            )

    def test_decision_create_rejects_unknown_priority(self):
        with self.assertRaises(
            ValidationError,
        ):
            DecisionCreate(
                dataset_id=1,
                title="Launch pricing",
                priority="urgent",
            )

    def test_decision_create_rejects_unknown_category(self):
        with self.assertRaises(
            ValidationError,
        ):
            DecisionCreate(
                dataset_id=1,
                title="Launch pricing",
                category="strategy",
            )

    def test_overview_update_rejects_unknown_priority(self):
        with self.assertRaises(
            ValidationError,
        ):
            DecisionOverviewUpdate(
                priority="urgent",
            )

    def test_overview_update_rejects_unknown_status_category_and_confidence(self):
        invalid_payloads = [
            {
                "status": "paused",
            },
            {
                "category": "legal",
            },
            {
                "confidence_score": "certain",
            },
        ]

        for payload in invalid_payloads:
            with self.subTest(payload=payload):
                with self.assertRaises(
                    ValidationError,
                ):
                    DecisionOverviewUpdate(
                        **payload,
                    )

    def test_details_update_accepts_null_description_for_clearing(self):
        payload = DecisionDetailsUpdate(
            description=None,
        )

        self.assertIsNone(
            payload.description,
        )

    def test_outcome_update_rejects_unknown_outcome_status(self):
        with self.assertRaises(
            ValidationError,
        ):
            DecisionOutcomeUpdate(
                outcome_status="mixed",
            )

    def test_confidence_update_rejects_unknown_confidence_score(self):
        with self.assertRaises(
            ValidationError,
        ):
            DecisionConfidenceUpdate(
                confidence_score="certain",
            )

    def test_priority_update_rejects_unknown_priority(self):
        with self.assertRaises(
            ValidationError,
        ):
            DecisionPriorityUpdate(
                priority="urgent",
            )

    def test_category_update_rejects_unknown_category(self):
        with self.assertRaises(
            ValidationError,
        ):
            DecisionCategoryUpdate(
                category="legal",
            )

    def test_activity_response_rejects_unknown_activity_type(self):
        with self.assertRaises(
            ValidationError,
        ):
            DecisionActivityResponse(
                id=1,
                decision_id=1,
                activity_type="mystery",
                message="Mystery event",
                created_at="2026-01-01T00:00:00",
            )

    def test_activity_feed_response_rejects_unknown_activity_type(self):
        with self.assertRaises(
            ValidationError,
        ):
            DecisionActivityFeedResponse(
                id=1,
                decision_id=1,
                decision_title="Demo",
                activity_type="mystery",
                message="Mystery event",
                created_at="2026-01-01T00:00:00",
            )

    def test_notes_update_accepts_null_for_clearing_notes(self):
        payload = DecisionNotesUpdate(
            notes=None,
        )

        self.assertIsNone(
            payload.notes,
        )

    def test_outcome_update_accepts_nulls_for_clearing_fields(self):
        payload = DecisionOutcomeUpdate(
            expected_outcome=None,
            actual_outcome=None,
            outcome_status=None,
        )

        self.assertIsNone(
            payload.expected_outcome,
        )
        self.assertIsNone(
            payload.actual_outcome,
        )
        self.assertIsNone(
            payload.outcome_status,
        )

    def test_learning_update_accepts_null_for_clearing_learning(self):
        payload = DecisionLearningUpdate(
            lessons_learned=None,
        )

        self.assertIsNone(
            payload.lessons_learned,
        )

    def test_review_update_accepts_null_for_clearing_review_date(self):
        payload = DecisionReviewUpdate(
            review_date=None,
        )

        self.assertIsNone(
            payload.review_date,
        )

    def test_review_date_normalization_converts_aware_datetime_to_naive_utc(self):
        review_date = datetime.fromisoformat(
            "2026-07-06T08:30:00-04:00"
        )

        normalized_date = normalize_decision_datetime(
            review_date,
        )

        self.assertEqual(
            normalized_date,
            datetime(
                2026,
                7,
                6,
                12,
                30,
            ),
        )
        self.assertIsNone(
            normalized_date.tzinfo,
        )

    def test_review_date_normalization_removes_naive_timezone_marker(self):
        review_date = datetime(
            2026,
            7,
            6,
            12,
            30,
            tzinfo=timezone.utc,
        )

        normalized_date = normalize_decision_datetime(
            review_date,
        )

        self.assertEqual(
            normalized_date,
            datetime(
                2026,
                7,
                6,
                12,
                30,
            ),
        )

    def test_confidence_update_accepts_null_for_clearing_confidence(self):
        payload = DecisionConfidenceUpdate(
            confidence_score=None,
        )

        self.assertIsNone(
            payload.confidence_score,
        )


if __name__ == "__main__":
    unittest.main()
