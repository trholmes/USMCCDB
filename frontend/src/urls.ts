// Stored URLs are member input and render as clickable links for everyone,
// so only http(s) may ever reach an href (a stored javascript: URL would
// execute on click).
export const safeUrl = (url: string | null | undefined): string | null => {
  if (!url) return null
  try {
    return ['http:', 'https:'].includes(new URL(url).protocol) ? url : null
  } catch {
    return null
  }
}
