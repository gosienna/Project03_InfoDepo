
// Geocoding via Nominatim (OpenStreetMap). Free, no API key required.
// Nominatim usage policy: one request per second max; we debounce in the UI.
export async function searchLocation(query) {
  if (!query || !query.trim()) return [];
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query.trim())}&format=json&limit=5`,
    { headers: { Accept: 'application/json', 'Accept-Language': 'en' } }
  );
  if (!res.ok) throw new Error(`Location search failed (${res.status})`);
  const data = await res.json();
  return data.map((r) => ({
    lat: parseFloat(r.lat),
    lng: parseFloat(r.lon),
    name: r.display_name,
    shortName: r.display_name.split(',')[0].trim(),
  }));
}
