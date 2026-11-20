// Distance between two points on Earth ("as the crow flies"), in km.
export function haversineKm(a, b) {
  if (a?.lat == null || b?.lat == null) return null;
  const R = 6371;
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Village roads are not straight: multiply by a road factor and round to 0.1 km.
export function roadKm(a, b, factor = 1.3) {
  const km = haversineKm(a, b);
  return km == null ? null : Math.max(0.5, Math.round(km * factor * 10) / 10);
}
