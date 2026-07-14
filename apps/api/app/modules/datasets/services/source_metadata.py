from app.modules.datasets.services.sources import (
    get_dataset_source,
    normalize_dataset_source_type,
)


def build_dataset_source_metadata(
    dataset,
):
    source_type = normalize_dataset_source_type(
        getattr(
            dataset,
            "source_type",
            None,
        )
    )
    source = get_dataset_source(
        source_type
    )

    return {
        "source_type": source_type,
        "source_label": (
            source["label"]
            if source
            else source_type
        ),
        "source_config": getattr(
            dataset,
            "source_config",
            None,
        ),
    }
