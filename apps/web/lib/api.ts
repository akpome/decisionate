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