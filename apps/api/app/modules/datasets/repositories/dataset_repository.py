from sqlalchemy.orm import Session

from app.db.models import Dataset


def get_dataset(
    db: Session,
    dataset_id: int,
):
    return (
        db.query(Dataset)
        .filter(
            Dataset.id == dataset_id
        )
        .first()
    )
