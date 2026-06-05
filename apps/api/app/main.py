from fastapi import FastAPI

from app.db.database import Base
from app.db.database import engine
from fastapi.middleware.cors import CORSMiddleware

from app.modules.datasets.router import (
    router as datasets_router,
)

from app.modules.organizations.router import (
    router as organization_router,
)

from app.modules.forecasting.router import (
    router as forecasting_router,
)

Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="Decisionate API"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(
    datasets_router,
    prefix="/datasets",
    tags=["datasets"],
)

app.include_router(
    organization_router,
    prefix="/organizations",
    tags=["organizations"],
)


app.include_router(
    forecasting_router,
    prefix="/forecasting",
    tags=["forecasting"],
)


@app.get("/")
def root():
    return {
        "message": "Decisionate API"
    }