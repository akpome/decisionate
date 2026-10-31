from datetime import date
from typing import Literal

from pydantic import Field, model_validator

from app.modules.correlation.schemas import StrictModel
from app.modules.datasets.services.dimension_filters import DimensionFilter


class SeriesSelection(StrictModel):
    dataset_id: int = Field(ge=1)
    metric_key: str = Field(min_length=1, max_length=200)
    date_column: str = Field(min_length=1, max_length=200)
    dimension_filter: DimensionFilter | None = None
    data_grain: Literal["daily", "weekly"] = "daily"


class SpendingOption(SeriesSelection):
    name: str = Field(min_length=1, max_length=80)
    minimum: float | None = Field(default=None, ge=0, le=1e12, allow_inf_nan=False)
    maximum: float | None = Field(default=None, ge=0, le=1e12, allow_inf_nan=False)

    @model_validator(mode="after")
    def bounds(self):
        if not self.name.strip() or self.minimum is not None and self.maximum is not None and self.minimum > self.maximum:
            raise ValueError("Name each spending option and keep its minimum below its maximum")
        return self


class BudgetDefinition(StrictModel):
    name: str = Field(default="Budget plan", min_length=1, max_length=120)
    outcome: SeriesSelection
    options: list[SpendingOption] = Field(min_length=2, max_length=6)
    controls: list[SeriesSelection] = Field(default_factory=list, max_length=3)
    budget: float = Field(gt=0, le=1e12, allow_inf_nan=False)
    currency: str = Field(pattern=r"^[A-Z]{3}$")
    start_date: date
    weeks: int = Field(default=4, ge=1, le=13)
    comparable_spend_confirmed: bool = False
    business_context_confirmed: bool = False

    @model_validator(mode="after")
    def distinct_options(self):
        if len({option.name.strip().casefold() for option in self.options}) != len(self.options):
            raise ValueError("Give each spending option a different name")
        if abs(round(self.budget, 2) - self.budget) > 1e-6:
            raise ValueError("Enter a budget with at most two decimal places")
        for index, option in enumerate(self.options):
            for other in self.options[:index]:
                if (option.dataset_id, option.metric_key) != (other.dataset_id, other.metric_key):
                    continue
                left, right = option.dimension_filter, other.dimension_filter
                if (option.date_column != other.date_column or not left or not right or left.column != right.column
                        or set(left.values) & set(right.values)):
                    raise ValueError("Options using the same spending metric must select non-overlapping values of the same dimension")
            if (option.dataset_id, option.metric_key) == (self.outcome.dataset_id, self.outcome.metric_key):
                raise ValueError("The result to improve must be different from a spending metric")
        for control in self.controls:
            if any((control.dataset_id, control.metric_key) == (item.dataset_id, item.metric_key)
                   for item in [self.outcome, *self.options]):
                raise ValueError("Business context must be separate from spending and the result")
        return self


class BudgetDecision(StrictModel):
    title: str = Field(min_length=3, max_length=200)
    action: str = Field(min_length=8, max_length=5000)
    expected_outcome: str = Field(min_length=8, max_length=3000)
    review_date: date


def selections(definition: BudgetDefinition):
    return [definition.outcome, *definition.options, *definition.controls]
