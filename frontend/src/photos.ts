// Client-side preparation of a member photo for the registration form
// (issue #165): the form sends the photo inline as a base64 data URL, so the
// image is downsized here first to keep the request small. The backend
// re-encodes and strips metadata regardless (see services/photos.py).

export const ACCEPTED_PHOTO_TYPES = 'image/jpeg,image/png,image/webp,image/gif'
const MAX_EDGE = 768
const JPEG_QUALITY = 0.85

const readAsDataUrl = (file: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file'))
    reader.readAsDataURL(file)
  })

const loadImage = (url: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not decode the image'))
    img.src = url
  })

// Returns a JPEG data URL with the longest edge capped at MAX_EDGE. Falls back
// to the untouched file when the browser cannot draw it (e.g. an animated GIF
// in an old browser); the backend applies its own size limit either way.
export async function preparePhoto(file: File): Promise<string> {
  const original = await readAsDataUrl(file)
  try {
    const img = await loadImage(original)
    const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height))
    if (scale === 1 && file.type === 'image/jpeg') return original
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(img.width * scale))
    canvas.height = Math.max(1, Math.round(img.height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) return original
    ctx.fillStyle = '#fff' // flatten transparency before JPEG
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', JPEG_QUALITY)
  } catch {
    return original
  }
}
