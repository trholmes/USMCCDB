// Local calendar date as YYYY-MM-DD. The app convention is the user's local
// date everywhere (toISOString would give the UTC date, off by one for users
// east or west of UTC around midnight).
export const today = (): string => {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
