const API_URL =
  "http://localhost:8000"

export async function uploadDataset(
  file: File,
  userId: string
) {
  const formData =
    new FormData()

  formData.append(
    "file",
    file
  )

  const response =
    await fetch(
      `${API_URL}/datasets/upload`,
      {
        method: "POST",
        headers: {
          "X-User-Id": userId,
        },
        body: formData,
      }
    )

  if (!response.ok) {
    throw new Error(
      "Upload failed"
    )
  }

  return response.json()
}

export async function getDatasets(
  userId: string
) {
  const response =
    await fetch(
      `${API_URL}/datasets`,
      {
        headers: {
          "X-User-Id": userId,
        },
      }
    )

  if (!response.ok) {
    throw new Error(
      "Failed to load datasets"
    )
  }

  return response.json()
}

export async function getDatasetDetails(
  id: number,
  userId: string
) {
  const response =
    await fetch(
      `${API_URL}/datasets/${id}/details`,
      {
        headers: {
          "X-User-Id": userId,
        },
      }
    )

  if (!response.ok) {
    throw new Error(
      "Failed to load dataset"
    )
  }

  return response.json()
}

export async function deleteDataset(
  id: number,
  userId: string
) {
  const response =
    await fetch(
      `${API_URL}/datasets/${id}`,
      {
        method: "DELETE",
        headers: {
          "X-User-Id": userId,
        },
      }
    )

  if (!response.ok) {
    throw new Error(
      "Failed to delete dataset"
    )
  }

  return response.json()
}

export async function getMyOrganization(
  userId: string
) {
  const response =
    await fetch(
      `${API_URL}/organizations/me`,
      {
        headers: {
          "X-User-Id": userId,
        },
      }
    )

  if (!response.ok) {
    throw new Error(
      "Failed to load organization"
    )
  }

  return response.json()
}

export async function createOrganization(
  name: string,
  userId: string
) {
  const response =
    await fetch(
      `${API_URL}/organizations`,
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json",
          "X-User-Id": userId,
        },
        body: JSON.stringify({
          name,
        }),
      }
    )

  if (!response.ok) {
    throw new Error(
      "Failed to create organization"
    )
  }

  return response.json()
}

export async function getForecast(
  datasetId: number,
  userId: string,
  metric?: string
) {
  const response =
    await fetch(
      `${API_URL}/forecasting/${datasetId}${metric
        ? `?metric=${metric}`
        : ""
      }`,
      {
        headers: {
          "X-User-Id": userId,
        },
      }
    )

  if (!response.ok) {
    throw new Error(
      "Failed to load forecast"
    )
  }

  return response.json()
}

export async function getDatasetPreference(
  userId: string
) {
  const response =
    await fetch(
      `${API_URL}/organizations/preferences/dataset`,
      {
        headers: {
          "X-User-Id": userId,
        },
      }
    )

  if (!response.ok) {
    throw new Error(
      "Failed to load dataset preference"
    )
  }

  return response.json()
}

export async function updateDatasetPreference(
  datasetId: number,
  userId: string,
  selectedMetric?: string
) {
  const response =
    await fetch(
      `${API_URL}/organizations/preferences/dataset`,
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json",
          "X-User-Id": userId,
        },
        body: JSON.stringify({
          dataset_id: datasetId,
          selected_metric:
            selectedMetric,
        }),
      }
    )

  if (!response.ok) {
    throw new Error(
      "Failed to update dataset preference"
    )
  }

  return response.json()
}

export async function getDecisions(
  userId: string
) {
  const response =
    await fetch(
      `${API_URL}/decisions`,
      {
        headers: {
          "X-User-Id": userId,
        },
      }
    )

  if (!response.ok) {
    throw new Error(
      "Failed to load decisions"
    )
  }

  return response.json()
}

export async function createDecision(
  payload: {
    dataset_id: number
    title: string
    description?: string
  },
  userId: string
) {
  const response =
    await fetch(
      `${API_URL}/decisions`,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",

          "X-User-Id":
            userId,
        },

        body: JSON.stringify(
          payload
        ),
      }
    )

  if (!response.ok) {
    throw new Error(
      "Failed to create decision"
    )
  }

  return response.json()
}

export async function updateDecision(
  decisionId: number,
  status: string,
  userId: string
) {
  const response =
    await fetch(
      `${API_URL}/decisions/${decisionId}`,
      {
        method: "PATCH",

        headers: {
          "Content-Type":
            "application/json",

          "X-User-Id":
            userId,
        },

        body: JSON.stringify({
          status,
        }),
      }
    )

  if (!response.ok) {
    throw new Error(
      "Failed to update decision"
    )
  }

  return response.json()
}

export async function getDecision(
  decisionId: number,
  userId: string
) {
  const response =
    await fetch(
      `${API_URL}/decisions/${decisionId}`,
      {
        headers: {
          "X-User-Id":
            userId,
        },
      }
    )

  if (!response.ok) {
    throw new Error(
      "Failed to load decision"
    )
  }

  return response.json()
}

export async function updateDecisionNotes(
  decisionId: number,
  notes: string,
  userId: string
) {
  const response =
    await fetch(
      `${API_URL}/decisions/${decisionId}/notes`,
      {
        method: "PATCH",
        headers: {
          "Content-Type":
            "application/json",

          "X-User-Id":
            userId,
        },

        body: JSON.stringify({
          notes,
        }),
      }
    )

  if (!response.ok) {
    throw new Error(
      "Failed to update notes"
    )
  }

  return response.json()
}

export async function updateDecisionOutcome(
  decisionId: number,
  payload: {
    expected_outcome?: string
    actual_outcome?: string
    outcome_status?: string
  },
  userId: string
) {
  const response =
    await fetch(
      `${API_URL}/decisions/${decisionId}/outcome`,
      {
        method: "PATCH",

        headers: {
          "Content-Type":
            "application/json",

          "X-User-Id":
            userId,
        },

        body: JSON.stringify(
          payload
        ),
      }
    )

  if (!response.ok) {
    throw new Error(
      "Failed to update outcome"
    )
  }

  return response.json()
}


export async function updateDecisionLearning(
  decisionId: number,
  lessonsLearned: string,
  userId: string
) {
  const response =
    await fetch(
      `${API_URL}/decisions/${decisionId}/learning`,
      {
        method: "PATCH",

        headers: {
          "Content-Type":
            "application/json",

          "X-User-Id":
            userId,
        },

        body: JSON.stringify({
          lessons_learned:
            lessonsLearned,
        }),
      }
    )

  if (!response.ok) {
    throw new Error(
      "Failed to update learning"
    )
  }

  return response.json()
}

export async function updateDecisionReviewDate(
  decisionId: number,
  reviewDate: string,
  userId: string
) {
  const response =
    await fetch(
      `${API_URL}/decisions/${decisionId}/review-date`,
      {
        method: "PATCH",
        headers: {
          "Content-Type":
            "application/json",
          "X-User-Id":
            userId,
        },
        body: JSON.stringify({
          review_date:
            reviewDate,
        }),
      }
    )

  if (!response.ok) {
    throw new Error(
      "Failed to update review date"
    )
  }

  return response.json()
}

export async function updateDecisionPriority(
  decisionId: number,
  priority: string,
  userId: string
) {
  const response =
    await fetch(
      `${API_URL}/decisions/${decisionId}/priority`,
      {
        method: "PATCH",

        headers: {
          "Content-Type":
            "application/json",

          "X-User-Id":
            userId,
        },

        body: JSON.stringify({
          priority,
        }),
      }
    )

  if (!response.ok) {
    throw new Error(
      "Failed to update priority"
    )
  }

  return response.json()
}

export async function updateDecisionCategory(
  decisionId: number,
  category: string,
  userId: string
) {
  const response =
    await fetch(
      `${API_URL}/decisions/${decisionId}/category`,
      {
        method: "PATCH",

        headers: {
          "Content-Type":
            "application/json",

          "X-User-Id":
            userId,
        },

        body: JSON.stringify({
          category,
        }),
      }
    )

  if (!response.ok) {
    throw new Error(
      "Failed to update category"
    )
  }

  return response.json()
}