from datetime import date
from typing import Annotated, Literal

from pydantic import Field, TypeAdapter, model_validator

from app.modules.correlation.schemas import DateRange, StrictModel
from app.modules.datasets.services.dimension_filters import DimensionFilter
from .schemas import AmountSelection, PerformanceDefinition, selections


class RecordSource(StrictModel):
    dataset_id: int = Field(ge=1)
    date_column: str = Field(min_length=1, max_length=200)
    dimension_filter: DimensionFilter | None = None


class RetentionDefinition(StrictModel):
    kind: Literal["retention"]
    source: RecordSource
    customer_column: str = Field(min_length=1, max_length=200)
    order_column: str = Field(min_length=1, max_length=200)
    date_range: DateRange
    return_days: Literal[30, 60, 90] = 90
    amounts_confirmed: bool = False

    @model_validator(mode="after")
    def distinct_columns(self):
        if len({self.customer_column, self.order_column, self.source.date_column}) != 3:
            raise ValueError("Choose different columns for the customer, purchase and purchase date.")
        if (self.date_range.end - self.date_range.start).days > 1096:
            raise ValueError("Choose up to three years of purchase history.")
        return self


class ConversionStep(StrictModel):
    name: str = Field(min_length=1, max_length=80)
    metric_key: str = Field(min_length=1, max_length=200)


class ConversionDefinition(StrictModel):
    kind: Literal["conversion"]
    source: RecordSource
    date_range: DateRange
    records: Literal["daily", "monthly", "transactions"] = "daily"
    steps: list[ConversionStep] = Field(min_length=2, max_length=5)
    group_column: str | None = Field(default=None, min_length=1, max_length=200)
    amounts_confirmed: bool = False

    @model_validator(mode="after")
    def distinct_steps(self):
        if len({step.metric_key for step in self.steps}) != len(self.steps):
            raise ValueError("Choose a different count for each step.")
        if len({step.name.strip().casefold() for step in self.steps}) != len(self.steps) or any(not step.name.strip() for step in self.steps):
            raise ValueError("Give each step a different name.")
        if (self.date_range.end - self.date_range.start).days > 1096:
            raise ValueError("Choose up to three years for the comparison.")
        return self


class CashFlowDefinition(StrictModel):
    kind: Literal["cashflow"]
    source: RecordSource
    outgoing_source: RecordSource | None = None
    incoming_metric: str = Field(min_length=1, max_length=200)
    outgoing_metric: str = Field(min_length=1, max_length=200)
    start_date: date
    weeks: Literal[4, 8, 13, 26] = 13
    currency: str = Field(pattern=r"^[A-Z]{3}$")
    opening_balance: float = Field(ge=-1e12, le=1e12, allow_inf_nan=False)
    reserve: float = Field(default=0, ge=0, le=1e12, allow_inf_nan=False)
    income_change_percent: float = Field(default=0, ge=-100, le=100, allow_inf_nan=False)
    cost_change_percent: float = Field(default=0, ge=-100, le=100, allow_inf_nan=False)
    collection_delay_days: int = Field(default=0, ge=0, le=90)
    amounts_confirmed: bool = False

    @model_validator(mode="after")
    def distinct_amounts(self):
        if self.outgoing_source is not None:
            if self.source.dataset_id == self.outgoing_source.dataset_id:
                raise ValueError("Choose different datasets for incoming and outgoing payments, or use both in the same dataset.")
        elif self.incoming_metric == self.outgoing_metric:
            raise ValueError("Choose separate amounts for money coming in and going out.")
        return self


ToolDefinition = Annotated[PerformanceDefinition | RetentionDefinition | ConversionDefinition | CashFlowDefinition, Field(discriminator="kind")]
definition_adapter = TypeAdapter(ToolDefinition)


def references(definition):
    if isinstance(definition, PerformanceDefinition):
        return selections(definition)
    if isinstance(definition, RetentionDefinition):
        return [definition.source]
    if isinstance(definition, CashFlowDefinition):
        return [AmountSelection(**source.model_dump(), metric_key=key, records="transactions") for source, key in (
            (definition.source, definition.incoming_metric),
            (definition.outgoing_source or definition.source, definition.outgoing_metric),
        )]
    keys = [step.metric_key for step in definition.steps]
    return [AmountSelection(**definition.source.model_dump(), metric_key=key,
                            records=getattr(definition, "records", "transactions")) for key in keys]
