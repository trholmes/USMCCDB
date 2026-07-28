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
    let detail = `Request failed (${resp.status})`
    if (isJson && data && typeof data.detail === 'string') {
      detail = data.detail
    } else if (isJson && Array.isArray(data?.detail)) {
      // FastAPI validation errors (422) come as a list of {loc, msg} — turn
      // them into something a user can act on instead of a bare status code.
      detail = data.detail
        .map((e: { loc?: unknown[]; msg?: string }) => {
          const loc = Array.isArray(e.loc)
            ? e.loc.filter((p) => p !== 'body' && typeof p !== 'number').join('.')
            : ''
          return loc ? `${loc}: ${e.msg}` : (e.msg ?? 'invalid value')
        })
        .join('; ')
    }
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

export const backupDownloadUrl = (category: string, filename: string) =>
  `${BASE}/backups/download/${category}/${encodeURIComponent(filename)}`

// photo_file in the URL busts caches when the photo is replaced.
export const photoUrl = (personId: number, photoFile: string) =>
  `${BASE}/people/${personId}/photo?v=${encodeURIComponent(photoFile)}`

export async function uploadFile<T>(path: string, file: File): Promise<T> {
  const body = new FormData()
  body.append('file', file)
  const resp = await fetch(`${BASE}${path}`, { method: 'POST', body, credentials: 'same-origin' })
  const data = await resp.json().catch(() => ({}))
  if (!resp.ok) throw new ApiError(resp.status, data?.detail ?? `Upload failed (${resp.status})`)
  return data as T
}
