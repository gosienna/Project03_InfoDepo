
// Shared Google Places API (New) search — independent of any map renderer.
// Loaded on demand by MapView when an API key is available; GoogleMapView
// reuses the same script via the deduplication check.

// Module-level session token: groups all autocomplete calls + one detail
// lookup into a single billing event (Autocomplete Per Session SKU).
let _sessionToken = null;

export function loadGoogleScript(apiKey) {
  return new Promise((resolve, reject) => {
    if (window.google?.maps?.places) { resolve(); return; }
    if (document.querySelector('script[src*="maps.googleapis.com/maps/api/js"]')) {
      const t = setInterval(() => { if (window.google?.maps?.places) { clearInterval(t); resolve(); } }, 50);
      setTimeout(() => { clearInterval(t); reject(new Error('Google Maps load timed out.')); }, 15000);
      return;
    }
    const cbName = '__gmapsInit' + Date.now();
    window[cbName] = () => { delete window[cbName]; resolve(); };
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places&callback=${cbName}`;
    script.async = true;
    script.defer = true;
    script.onerror = () => { delete window[cbName]; reject(new Error('Failed to load Google Maps script. Check your API key.')); };
    document.head.appendChild(script);
  });
}

// boundsLiteral: { north, south, east, west } — soft viewport bias, optional.
// Returns [{placeId, name, shortName}].
export async function searchPlaces(query, boundsLiteral) {
  const P = window.google?.maps?.places;
  if (!P?.AutocompleteSuggestion) throw new Error('Places API not available');
  if (!_sessionToken) _sessionToken = new P.AutocompleteSessionToken();
  const request = { input: query, sessionToken: _sessionToken, language: 'en' };
  if (boundsLiteral) request.locationRestriction = boundsLiteral;
  const { suggestions } = await P.AutocompleteSuggestion.fetchAutocompleteSuggestions(request);
  const results = (suggestions || []).map((s) => {
    const p = s.placePrediction;
    return { placeId: p.placeId, name: p.text.toString(), shortName: p.mainText.toString() };
  });
  console.log('[Places API (New)] searchPlaces results:', results);
  return results;
}

// Fetches only the location of a place for preview marker placement.
// Does NOT consume the session token — billed as a basic Place Details call.
export async function getPlaceLocation(placeId) {
  const P = window.google?.maps?.places;
  if (!P?.Place) return null;
  try {
    const place = new P.Place({ id: placeId });
    await place.fetchFields({ fields: ['location'] });
    if (!place.location) return null;
    return { lat: place.location.lat(), lng: place.location.lng() };
  } catch {
    return null;
  }
}

// Resolves a placeId → {lat, lng, name}. Ends and clears the billing session.
export async function resolvePlace(placeId) {
  const P = window.google?.maps?.places;
  if (!P?.Place) throw new Error('Places API not available');
  const token = _sessionToken;
  _sessionToken = null;
  const place = new P.Place({ id: placeId });
  await place.fetchFields({ fields: ['location', 'displayName'], ...(token ? { sessionToken: token } : {}) });
  if (!place.location) throw new Error('Place has no location');
  return { lat: place.location.lat(), lng: place.location.lng(), name: place.displayName || '' };
}
