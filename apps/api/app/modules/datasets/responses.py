from datetime import datetime
from pydantic import BaseModel


class DatasetResponse(BaseModel):
    id: int
    file_name: str
    row_count: int
    created_at: datetime

    class Config:
        from_attributes = True