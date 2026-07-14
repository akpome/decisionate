import pandas as pd

from app.modules.datasets.services.serialization import (
    to_json_number,
)


def generate_insights(
    dataframe: pd.DataFrame
):
    insights = []

    numeric_columns = (
        dataframe
        .select_dtypes(
            include=["number"]
        )
        .columns
    )

    for column in numeric_columns:
        column_label = str(column)
        series = dataframe[column]

        total = to_json_number(series.sum())
        average = to_json_number(series.mean())
        maximum = to_json_number(series.max())
        minimum = to_json_number(series.min())

        insights.append({
            "type": "summary",
            "column": column_label,
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
                "column": column_label,
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
                "column": column_label,
                "title": f"Low Performance in {column_label}",
                "description":
                    f"Some values are significantly "
                    f"below average. Review possible "
                    f"causes for underperformance."
            })

        insights.append({
            "type": "metric",
            "column": column_label,
            "title": f"Total {column_label}",
            "description":
                f"Total {column_label} is "
                f"{total:,.2f}."
        })

    return insights
