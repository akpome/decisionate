from fastapi import HTTPException

from app.db.models import Dataset


def verify_dataset_owner(
    dataset: Dataset,
    user_id: str,
    workspace_id: str | None = None,
):
    clean_user_id = str(user_id or "").strip()
    clean_workspace_id = (
        str(workspace_id).strip()
        if workspace_id is not None
        else ""
    )

    if (
        clean_workspace_id
        and dataset.workspace_id == clean_workspace_id
    ):
        return

    if (
        dataset.workspace_id is None
        and dataset.user_id == clean_user_id
    ):
        return

    raise HTTPException(
        status_code=403,
        detail="Access denied",
    )
