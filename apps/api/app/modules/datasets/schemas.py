from pydantic import BaseModel
from typing import List, Dict, Any


class DatasetCreate(BaseModel):
    file_name: str
    rows: List[Dict[str, Any]]