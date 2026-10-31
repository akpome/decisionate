from datetime import date
from typing import Literal

from pydantic import Field, field_validator, model_validator

from app.modules.correlation.schemas import DateRange, StrictModel
from app.modules.datasets.services.dimension_filters import DimensionFilter


class AmountSelection(StrictModel):
    dataset_id: int = Field(ge=1)
    metric_key: str = Field(min_length=1, max_length=200)
    date_column: str = Field(min_length=1, max_length=200)
    dimension_filter: DimensionFilter | None = None
    records: Literal["daily", "monthly", "transactions"] = "daily"


class PerformanceItem(StrictModel):
    name: str = Field(min_length=1, max_length=100)
    revenue: AmountSelection
    costs: list[AmountSelection] = Field(min_length=1, max_length=4)

    @field_validator("name", mode="before")
    @classmethod
    def trim_name(cls, value):
        return value.strip() if isinstance(value, str) else value


def overlaps(left, right):
    if (left.dataset_id, left.metric_key) != (right.dataset_id, right.metric_key):
        return False
    a, b = left.dimension_filter, right.dimension_filter
    return not a or not b or a.column != b.column or bool(set(a.values) & set(b.values))


class PerformanceDefinition(StrictModel):
    kind: Literal["return", "profit"]
    date_range: DateRange
    currency: str = Field(pattern=r"^[A-Z]{3}$")
    items: list[PerformanceItem] = Field(min_length=1, max_length=6)
    group_column: str | None = Field(default=None, min_length=1, max_length=200)
    revenue_basis: Literal["assigned_sales", "platform_reported"] = "assigned_sales"
    amounts_confirmed: bool = False

    @model_validator(mode="after")
    def comparable_inputs(self):
        if (self.date_range.end - self.date_range.start).days > 1096:
            raise ValueError("Choose up to three years for this comparison.")
        if len({item.name.casefold() for item in self.items}) != len(self.items):
            raise ValueError("Give each comparison a different name.")
        if self.group_column:
            if len(self.items) != 1:
                raise ValueError("Choose one dataset when comparing its groups.")
            sources = selections(self)
            first = sources[0]
            if any((source.dataset_id, source.date_column, source.dimension_filter, source.records) !=
                   (first.dataset_id, first.date_column, first.dimension_filter, first.records) for source in sources):
                raise ValueError("Group comparisons need amounts from the same dataset, dates and rows.")
        for index, item in enumerate(self.items):
            if self.kind == "return" and len(item.costs) != 1:
                raise ValueError("Choose one total spending amount for each return comparison.")
            for at, cost in enumerate(item.costs):
                if overlaps(item.revenue, cost) or any(overlaps(cost, other) for other in item.costs[:at]):
                    raise ValueError("Choose separate revenue and cost amounts without counting a cost twice.")
            for other in self.items[:index]:
                if overlaps(item.revenue, other.revenue) or any(overlaps(a, b) for a in item.costs for b in other.costs):
                    raise ValueError("Each comparison needs its own sales and costs. Select different groups instead of reusing a business total.")
        return self


def selections(definition):
    return [source for item in definition.items for source in [item.revenue, *item.costs]]


class PerformanceDecision(StrictModel):
    title: str = Field(min_length=3, max_length=200)
    action: str = Field(min_length=8, max_length=5000)
    expected_outcome: str = Field(min_length=8, max_length=3000)
    review_date: date

    @field_validator("title", "action", "expected_outcome", mode="before")
    @classmethod
    def trim_text(cls, value):
        return value.strip() if isinstance(value, str) else value
