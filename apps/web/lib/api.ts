const API_URL =
  "http://localhost:8000"

export async function uploadDataset(
  file: File
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

export async function getDatasets() {
  const response =
    await fetch(
      `${API_URL}/datasets`
    )

  if (!response.ok) {
    throw new Error(
      "Failed to load datasets"
    )
  }

  return response.json()
}

export async function getDatasetDetails(
  id: number
) {
  const response =
    await fetch(
      `${API_URL}/datasets/${id}/details`
    )

  if (!response.ok) {
    throw new Error(
      "Failed to load dataset"
    )
  }

  return response.json()
}