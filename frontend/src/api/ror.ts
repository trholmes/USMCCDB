// Browser-side ROR (ror.org) lookups and record parsing, shared by the
// institution edit form and the bulk "Fill from ROR" flow. The lookups run
// in the admin's browser (not the backend), so an air-gapped server still
// works. Mirrors backend/app/services/ror.py.

const ROR_API = 'https://api.ror.org/v2/organizations'
const ID_RE = /(0[a-z0-9]{8})$/

/** The fields we can pull out of a ROR v2 organization record. */
export interface RorParsed {
  rorId: string | null
  name: string
  acronym: string | null // candidate short name
  address: string | null // draft author-list address
  latitude: number | null
  longitude: number | null
  location: string | null // "Knoxville, United States" — for display only
  isUS: boolean | null
  score: number | null // affiliation-matcher confidence, when it came from one
}

export function parseRorRecord(rec: any, score: number | null = null): RorParsed {
  const names: any[] = rec.names ?? []
  const display: string | null =
    names.find((n) => n.types?.includes('ror_display'))?.value ?? names[0]?.value ?? null
  const acronym: string | null =
    names.find((n) => n.types?.includes('acronym'))?.value ?? null
  const geo = rec.locations?.[0]?.geonames_details ?? {}
  const city: string | null = geo.name ?? null
  // Same draft-address shape the backend builds: "Name, City, ST, USA" for
  // US records (ROR has no street/zip), "Name, City, Country" elsewhere.
  let address: string | null = null
  if (display && city) {
    const parts = [display, city]
    if (geo.country_code === 'US') {
      if (geo.country_subdivision_code) parts.push(geo.country_subdivision_code)
      parts.push('USA')
    } else if (geo.country_name) {
      parts.push(geo.country_name)
    }
    address = parts.join(', ')
  }
  return {
    rorId: String(rec.id ?? '').match(ID_RE)?.[1] ?? null,
    name: display ?? '(unnamed)',
    acronym,
    address,
    latitude: geo.lat ?? null,
    longitude: geo.lng ?? null,
    location: city ? `${city}${geo.country_name ? `, ${geo.country_name}` : ''}` : null,
    isUS: geo.country_code ? geo.country_code === 'US' : null,
    score,
  }
}

export async function fetchRorRecord(rorId: string): Promise<RorParsed> {
  const resp = await fetch(`${ROR_API}/${rorId}`)
  if (!resp.ok) throw new Error(`ROR lookup failed (${resp.status})`)
  return parseRorRecord(await resp.json())
}

export interface RorAffiliationResult {
  /** ROR's single confident match, if it flagged one. */
  chosen: RorParsed | null
  /** Best candidates (chosen or not) for a human to pick from. */
  candidates: RorParsed[]
}

/** Query ROR's affiliation matcher with a free-text institution string. */
export async function matchRorAffiliation(query: string): Promise<RorAffiliationResult> {
  const resp = await fetch(`${ROR_API}?affiliation=${encodeURIComponent(query)}`)
  if (!resp.ok) throw new Error(`ROR lookup failed (${resp.status})`)
  const items: any[] = (await resp.json()).items ?? []
  const chosen = items.find((it) => it.chosen)
  return {
    chosen: chosen ? parseRorRecord(chosen.organization, chosen.score ?? null) : null,
    candidates: items
      .slice(0, 5)
      .map((it) => parseRorRecord(it.organization, it.score ?? null)),
  }
}
