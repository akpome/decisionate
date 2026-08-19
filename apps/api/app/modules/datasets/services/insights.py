import re

import pandas as pd

from app.modules.ai.service import (
    generate_structured_analysis,
)
from app.modules.datasets.services.numeric import (
    get_numeric_columns,
)
from app.modules.datasets.services.serialization import (
    to_json_number,
)


def generate_insights(
    dataframe: pd.DataFrame
):
    insights = []

    for column, series in get_numeric_columns(
        dataframe
    ):
        column_key = str(column)
        column_label = format_insight_column_label(
            column_key
        )

        total = to_json_number(series.sum())
        average = to_json_number(series.mean())
        maximum = to_json_number(series.max())
        minimum = to_json_number(series.min())

        insights.append({
            "type": "summary",
            "column": column_key,
            "title": f"{column_label} Summary",
            "description":
                f"Average {column_label} is "
                f"{average:,.2f}. "
                f"Maximum is {maximum:,.2f} "
                f"and minimum is {minimum:,.2f}."
        })

        if maximum > (average * 2):
            insights.append({
                "type": "opportunity",
                "column": column_key,
                "title": f"High Peak in {column_label}",
                "description":
                    f"{column_label} contains values "
                    f"significantly above average. "
                    f"Investigate what drove "
                    f"the peak performance."
            })

        if minimum < (average * 0.5):
            insights.append({
                "type": "risk",
                "column": column_key,
                "title": f"Low Performance in {column_label}",
                "description":
                    f"Some values are significantly "
                    f"below average. Review possible "
                    f"causes for underperformance."
            })

        insights.append({
            "type": "metric",
            "column": column_key,
            "title": f"Total {column_label}",
            "description":
                f"Total {column_label} is "
                f"{total:,.2f}."
        })

    return insights


def format_insight_column_label(
    column: str
):
    readable_column = re.sub(
        r"[_-]+",
        " ",
        column,
    )
    readable_column = re.sub(
        r"\s+",
        " ",
        readable_column,
    ).strip()

    return " ".join(
        word[:1].upper() + word[1:]
        for word in readable_column.split(" ")
    )


def generate_dataset_ai_analysis(
    dataframe: pd.DataFrame,
    metric: str | None = None,
    learning_context: dict | None = None,
    workspace_id: str | None = None,
    actor_user_id: str | None = None,
):
    all_metric_facts = []

    for column, series in get_numeric_columns(dataframe):
        all_metric_facts.append({
            "column": str(column),
            "total": to_json_number(series.sum()),
            "average": to_json_number(series.mean()),
            "minimum": to_json_number(series.min()),
            "maximum": to_json_number(series.max()),
        })

    clean_metric = (
        str(metric).strip()
        if metric is not None
        else ""
    )
    focused_metric_facts = [
        fact
        for fact in all_metric_facts
        if fact["column"] == clean_metric
    ]
    metric_facts = (
        focused_metric_facts
        if clean_metric and focused_metric_facts
        else all_metric_facts
    )

    metric_labels = [
        format_insight_column_label(
            metric["column"]
        )
        for metric in metric_facts[:5]
    ]
    fallback_summary = (
        f"{metric_labels[0] if clean_metric and metric_labels else 'The dataset'} "
        f"has {len(metric_facts)} numeric metric"
        f"{'s' if len(metric_facts) != 1 else ''} available for review."
    )
    fallback_recommendations = [
        f"Review {label} against its latest period and target."
        for label in metric_labels
    ]

    facts = {
        "row_count": int(len(dataframe.index)),
        "metric_count": len(metric_facts),
        "available_metric_count": len(all_metric_facts),
        "selected_metric": clean_metric or None,
        "metrics": metric_facts[:10],
    }

    if learning_context:
        facts["historical_decision_learning"] = learning_context

    return generate_structured_analysis(
        context="dataset insights and business report analysis",
        facts=facts,
        fallback_summary=fallback_summary,
        fallback_recommendations=fallback_recommendations,
        workspace_id=workspace_id,
        actor_user_id=actor_user_id,
    )
