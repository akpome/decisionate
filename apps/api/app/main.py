from fastapi import FastAPI

from app.db.database import Base
from app.db.database import engine

from app.modules.datasets.router import (
    router as datasets_router,
)

Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="Decisionate API"
)

app.include_router(
    datasets_router,
    prefix="/datasets",
    tags=["datasets"],
)


@app.get("/")
def root():
    return {
        "message": "Decisionate API"
    }