from pydantic import BaseModel


class OrganizationCreate(BaseModel):
    name: str


class OrganizationResponse(BaseModel):
    id: int
    name: str


class DatasetPreferenceUpdate(BaseModel):
    dataset_id: int

    selected_metric: str | None = None


class DatasetPreferenceResponse(BaseModel):
    selected_dataset_id: int | None

    selected_metric: str | None = None
