import pandas as pd


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
        series = dataframe[column]

        total = float(series.sum())
        average = float(series.mean())
        maximum = float(series.max())
        minimum = float(series.min())

        insights.append({
            "type": "summary",
            "column": column,
            "title": f"{column} Summary",
            "description":
                f"Average {column} is "
                f"{average:,.2f}. "
                f"Maximum is {maximum:,.2f} "
                f"and minimum is {minimum:,.2f}."
        })

        if maximum > (average * 2):
            insights.append({
                "type": "opportunity",
                "column": column,
                "title": f"High Peak in {column}",
                "description":
                    f"{column} contains values "
                    f"significantly above average. "
                    f"Investigate what drove "
                    f"the peak performance."
            })

        if minimum < (average * 0.5):
            insights.append({
                "type": "risk",
                "column": column,
                "title": f"Low Performance in {column}",
                "description":
                    f"Some values are significantly "
                    f"below average. Review possible "
                    f"causes for underperformance."
            })

        insights.append({
            "type": "metric",
            "column": column,
            "title": f"Total {column}",
            "description":
                f"Total {column} is "
                f"{total:,.2f}."
        })

    return insights