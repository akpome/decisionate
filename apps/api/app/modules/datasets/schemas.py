from typing import List, Dict, Any

from pydantic import BaseModel


class DatasetCreate(BaseModel):
    file_name: str
    rows: List[Dict[str, Any]]


class DataSourceConnectionCreate(BaseModel):
    source_type: str
    display_name: str | None = None
    connection_config: Dict[str, Any] | None = None


class DataSourceConnectionUpdate(BaseModel):
    display_name: str | None = None
    connection_config: Dict[str, Any] | None = None
