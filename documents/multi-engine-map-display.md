# Multi-Engine Map Provider Adapter — Implementation Guide

A reference architecture for building a map platform where the base map (OpenStreetMap, Mapbox, Google Maps, etc.) is swappable at runtime, while a single neutral data layer (user landmarks, KML/GeoJSON annotations) renders consistently on top regardless of which engine is active.

---

## 1. Core Concept

Two concerns that are normally tangled together get fully separated:

1. **Rendering engine** — Leaflet, Mapbox GL JS, Google Maps JS API. Each has its own map object, marker API, and event system.
2. **Your data layer** — landmarks, polygons, popups — stored in a neutral format (GeoJSON) that never changes when the engine swaps.

You write your app logic against a single interface. Swapping providers means tearing down the old engine instance and re-initializing a new one, then replaying your neutral data into it.

```
┌─────────────────────────────────────┐
│         Your App / UI Layer          │
├─────────────────────────────────────┤
│   Custom Data Layer (always same)    │
│   - User landmarks (GeoJSON/KML)     │
│   - Markers, polygons, popups        │
├─────────────────────────────────────┤
│      Map Provider Adapter (swap)     │
│  ┌─────────┬─────────┬────────────┐  │
│  │   OSM   │ Mapbox  │ Google Maps│  │
│  │(Leaflet)│(GL JS)  │  (JS API)  │  │
│  └─────────┴─────────┴────────────┘  │
└─────────────────────────────────────┘
```

---

## 2. The Adapter Interface

Define one contract every provider must implement. This is the only API the rest of your app should ever call directly.

```typescript
interface MapProvider {
  init(containerId: string, center: [number, number], zoom: number): void;
  destroy(): void; // tear down before switching providers

  addMarker(lat: number, lng: number, options?: MarkerOptions): MarkerHandle;
  removeMarker(handle: MarkerHandle): void;

  addGeoJSON(geojson: GeoJSON.FeatureCollection): LayerHandle;
  removeLayer(handle: LayerHandle): void;

  setCenter(lat: number, lng: number): void;
  setZoom(zoom: number): void;

  on(event: 'click' | 'moveend' | 'zoomend', callback: (e: any) => void): void;
}
```

Each concrete provider wraps a different underlying library but exposes this exact shape.

```javascript
class LeafletProvider implements MapProvider { /* wraps Leaflet */ }
class MapboxProvider implements MapProvider { /* wraps Mapbox GL JS */ }
class GoogleMapsProvider implements MapProvider { /* wraps google.maps.Map */ }
```

---

## 3. Switching Providers

A `switchTo()` controller method on your app (not on any one adapter) handles the transition:

```javascript
class MapController {
  constructor(containerId) {
    this.containerId = containerId;
    this.currentProvider = null;
    this.landmarks = null; // GeoJSON FeatureCollection, kept independent of engine
  }

  switchTo(providerName, apiKey = null) {
    const center = this.currentProvider?.getCenter() ?? [22.6273, 120.3014];
    const zoom = this.currentProvider?.getZoom() ?? 13;

    this.currentProvider?.destroy();

    switch (providerName) {
      case 'osm':
        this.currentProvider = new LeafletProvider();
        break;
      case 'mapbox':
        this.currentProvider = new MapboxProvider(apiKey);
        break;
      case 'google':
        this.currentProvider = new GoogleMapsProvider(apiKey);
        break;
    }

    this.currentProvider.init(this.containerId, center, zoom);

    if (this.landmarks) {
      this.currentProvider.addGeoJSON(this.landmarks);
    }
  }

  loadLandmarks(geojson) {
    this.landmarks = geojson;
    this.currentProvider?.addGeoJSON(geojson);
  }
}
```

The landmark data is never owned by an adapter — it lives in the controller and gets replayed into whichever adapter is currently active.

---

## 4. Data Format Strategy

| Concern | Recommendation |
|---|---|
| Internal representation | **GeoJSON** — closest thing to a universal standard, native to Leaflet/Mapbox, easy to convert for Google's marker API |
| Import/export for sharing | Support **KML/KMZ** import, convert to GeoJSON on load |
| Per-feature metadata | Use GeoJSON `properties` object — maps cleanly to KML's `<ExtendedData>` and to Google's marker `title`/`info` fields |
| Storage | LocalStorage/IndexedDB for client-only persistence, or a static JSON file — keeps a serverless/static deployment model intact |

Each adapter needs a small translation function: `geojsonFeatureToNativeMarker(feature)` — this is the only per-provider code that touches your actual data.

See [Section 5](#5-stored-data-schema-markers-center-polygons-lines) for the exact schema to use for each shape type.

---

## 5. Stored Data Schema — Markers, Center, Polygons, Lines

This is the concrete shape of the data that flows through `addGeoJSON()` and gets persisted to storage. Everything is plain JSON — no XML, no zip handling — so it drops straight into LocalStorage/IndexedDB or a flat `.geojson` file.

### 5.1 Marker (Point)

```json
{
  "type": "Feature",
  "geometry": {
    "type": "Point",
    "coordinates": [120.3014, 22.6273]
  },
  "properties": {
    "id": "marker_001",
    "name": "My House",
    "description": "Free text, can include basic HTML for popups",
    "icon": "home",
    "color": "#e74c3c",
    "createdAt": "2026-06-27T10:00:00Z",
    "tags": ["home", "favorite"]
  }
}
```

> **Coordinate order gotcha:** GeoJSON is always `[longitude, latitude]` — the reverse of how most people instinctively write lat/lng. Worth a comment wherever your code reads/writes coordinates.

### 5.2 Center / Viewport

Not a geometric `Feature` — this is view state, not data, so keep it as a plain object alongside (not inside) your `FeatureCollection`:

```json
{
  "center": [120.3014, 22.6273],
  "zoom": 13,
  "bearing": 0,
  "pitch": 0
}
```

`bearing`/`pitch` only matter for Mapbox GL's 3D tilt/rotation — omit them for a Leaflet-only MVP.

### 5.3 Polygon (area / boundary)

```json
{
  "type": "Feature",
  "geometry": {
    "type": "Polygon",
    "coordinates": [
      [
        [120.300, 22.625],
        [120.305, 22.625],
        [120.305, 22.630],
        [120.300, 22.630],
        [120.300, 22.625]
      ]
    ]
  },
  "properties": {
    "id": "polygon_001",
    "name": "Survey Area A",
    "fillColor": "#3498db",
    "fillOpacity": 0.3,
    "strokeColor": "#2980b9",
    "strokeWidth": 2
  }
}
```

Notes:
- The first and last coordinate **must be identical** (closes the ring) — common bug source.
- The outer array wraps one or more "rings": index `[0]` is the outer boundary; any further rings (`[1]`, `[2]`...) are holes cut out of it.
- Winding order matters in strict GeoJSON (outer ring counter-clockwise, holes clockwise), though Leaflet/Mapbox are usually forgiving about this.

### 5.4 Line / Path (route, track)

```json
{
  "type": "Feature",
  "geometry": {
    "type": "LineString",
    "coordinates": [
      [120.300, 22.625],
      [120.302, 22.627],
      [120.305, 22.630]
    ]
  },
  "properties": {
    "id": "line_001",
    "name": "Hiking Trail",
    "strokeColor": "#27ae60",
    "strokeWidth": 3
  }
}
```

### 5.5 Top-Level Wrapper — Everything Together

Store the full user dataset as one `FeatureCollection`, with view state alongside it (not inside it, since view state isn't geometry):

```json
{
  "viewState": {
    "center": [120.3014, 22.6273],
    "zoom": 13
  },
  "data": {
    "type": "FeatureCollection",
    "features": [
      { "type": "Feature", "geometry": { "type": "Point", "...": "..." }, "properties": {} },
      { "type": "Feature", "geometry": { "type": "Polygon", "...": "..." }, "properties": {} },
      { "type": "Feature", "geometry": { "type": "LineString", "...": "..." }, "properties": {} }
    ]
  },
  "meta": {
    "version": 1,
    "lastModified": "2026-06-27T10:00:00Z"
  }
}
```

This is exactly what you'd `JSON.stringify()` straight into LocalStorage/IndexedDB, or save as a downloadable `.geojson` file.

### 5.6 Geometry Type → Native Engine Mapping

Each adapter's `addGeoJSON()` walks the `FeatureCollection` and translates `Feature.geometry.type` into its native equivalent:

| GeoJSON type | Leaflet | Mapbox GL JS | Google Maps |
|---|---|---|---|
| `Point` | `L.marker()` | `new mapboxgl.Marker()` | `new google.maps.Marker()` |
| `Polygon` | `L.polygon()` | GL style layer (`fill`) | `new google.maps.Polygon()` |
| `LineString` | `L.polyline()` | GL style layer (`line`) | `new google.maps.Polyline()` |

Leaflet and Mapbox GL JS both have built-in `geoJSON()`/`addSource()` methods that consume this format almost directly. Google's adapter needs a manual per-feature loop — consistent with the extra implementation work already flagged for that adapter in Section 6.

### 5.7 Optional: Geometry-less Feature

GeoJSON technically permits `"geometry": null` on a Feature — useful for a "placeholder" annotation not tied to a location (e.g., a general note about the whole map). Not essential for v1, but valid GeoJSON if the need comes up later.

---

## 6. Licensing Constraint — Read Before Building

This is the part that determines what "Google" can legitimately mean in your provider list.

- ✅ **Legitimate**: A `GoogleMapsProvider` adapter that wraps the **actual Google Maps JavaScript API** (`google.maps.Map`), using a real API key and Google's own marker/layer objects.
- ❌ **Not legitimate**: Loading Google's raw map tiles into Leaflet or Mapbox GL as a raster/vector source. This violates Google's Terms of Service regardless of how clean your adapter abstraction is — the abstraction layer doesn't change the underlying ToS violation, it just makes it easier to trigger consistently.

**Practical implication for the adapter pattern:** the `GoogleMapsProvider` class cannot be "just another tile layer" like the OSM or Mapbox adapters — it must instantiate a real `google.maps.Map` object, with its own DOM container, its own marker API (`google.maps.Marker` / `AdvancedMarkerElement`), and its own event model. Budget for this adapter to require meaningfully different internal code from the other two, even though it exposes the same external interface.

---

## 6. Suggested Stack

| Layer | Choice | Why |
|---|---|---|
| Default/free engine | **Leaflet** | Lightweight, ToS-clean default experience |
| Default tile source | **MapTiler or OSM** | Free, no licensing friction |
| Alt engine — styling | **Mapbox GL JS** | Vector tiles, generous free tier, swap-in via adapter |
| Alt engine — Google | **Google Maps JS API** | Only legitimate way to include Google; needs its own adapter class |
| Data interchange | **GeoJSON** internally, **KML/KMZ** import/export | Neutral format across all adapters |
| API key handling | User supplies their own key for Mapbox/Google (stored client-side) | Preserves a static/serverless deployment model — you never absorb per-visitor billing |

---

## 7. Build Order (Suggested)

1. Build the `MapProvider` interface and a single `LeafletProvider` implementation first — get markers/GeoJSON rendering working end-to-end.
2. Add KML → GeoJSON import so landmarks can be loaded from real files.
3. Add `MapboxProvider` as the second adapter — proves the abstraction holds across a genuinely different rendering engine (raster → vector tiles).
4. Add the provider-switcher UI (dropdown/toggle) and confirm landmarks correctly replay across switches.
5. Add `GoogleMapsProvider` last, since it requires the most divergent internal implementation and a user-supplied API key flow.
6. Persist landmark data (LocalStorage/IndexedDB) and the user's last-selected provider + API keys (if any) across sessions.

---

## 8. Known Limitations to Design Around

- **Style parity isn't guaranteed.** Mapbox Studio custom styles do not export to other platforms — if you let users customize basemap styling, that customization is provider-specific and won't carry over on switch.
- **Marker visuals will differ slightly per engine** unless you explicitly normalize icon/popup styling in each adapter's translation layer.
- **Google adapter requires its own script loading.** The Google Maps JS API must be loaded via its own `<script>` tag with the user's key; this should be loaded lazily (only when the user actually selects Google) to avoid unnecessary requests/billing triggers. Re