const BASE = '/api/v1'

export class ApiError extends Error {
  status: number
  constructor(status: number, detail: string) {
    super(detail)
    this.status = status
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const resp = await fetch(`${BASE}${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  })
  if (resp.status === 204) return undefined as T
  const isJson = resp.headers.get('content-type')?.includes('application/json')
  const data = isJson ? await resp.json() : await resp.text()
  if (!resp.ok) {
    const detail =
      isJson && data && typeof data.detail === 'string'
        ? data.detail
        : `Request failed (${resp.status})`
    throw new ApiError(resp.status, detail)
  }
  return data as T
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
}

export const exportUrl = (listId: number, format: string) =>
  `${BASE}/author-lists/${listId}/export?format=${format}`
