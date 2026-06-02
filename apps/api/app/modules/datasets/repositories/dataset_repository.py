from sqlalchemy.orm import Session

from app.db.models import Dataset


def create_dataset(
    db: Session,
    file_name: str,
    file_path: str,
    row_count: int,
    column_count: int,
):
    dataset = Dataset(
        file_name=file_name,
        file_path=file_path,
        row_count=row_count,
        column_count=column_count,
    )

    db.add(dataset)
    db.commit()
    db.refresh(dataset)

    return dataset


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


def list_datasets(
    db: Session,
):
    return (
        db.query(Dataset)
        .order_by(
            Dataset.created_at.desc()
        )
        .all()
    )


def delete_dataset(
    db: Session,
    dataset: Dataset,
):
    db.delete(dataset)
    db.commit()