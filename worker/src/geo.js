// Straight-line distance (haversine) and the check-in location status. Every screen that shows one says it is straight-line.

export const EARTH_RADIUS_M = 6371008.8
export const NEAR_METRES = 250

const rad = deg => (deg * Math.PI) / 180

/** Haversine metres on a sphere of radius 6 371 008.8 m, rounded half up to whole metres. */
export function distanceM (lat1, lng1, lat2, lng2) {
  const dLat = rad(lat2 - lat1)
  const dLng = rad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2
  const metres = 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)))
  return Math.floor(metres + 0.5)
}

/** "28.6" from 28612 m: tenths = floor((metres + 50) / 100). */
export function kmText (metres) {
  const tenths = Math.floor((metres + 50) / 100)
  return `${Math.floor(tenths / 10)}.${tenths % 10}`
}

/** `{ location, location_label }` for a check-in's distance from the client's pin (null = not shared). */
export function locationStatus (metres) {
  if (metres === null || metres === undefined) return { location: 'not_shared', location_label: 'Location not shared' }
  if (metres <= NEAR_METRES) return { location: 'near', location_label: 'Within 250 m of the client' }
  const d = metres < 1000 ? `${metres} m` : `${kmText(metres)} km`
  return { location: 'far', location_label: `More than 250 m from the client (${d})` }
}

export const LOCATION_LABELS = {
  near: 'Within 250 m of the client',
  not_shared: 'Location not shared'
}

/** The label for a stored location and distance. */
export const locationLabel = (location, metres) =>
  location === 'far' ? locationStatus(metres).location_label : LOCATION_LABELS[location] ?? null
