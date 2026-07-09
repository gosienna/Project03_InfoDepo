
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { GoogleMapView } from './GoogleMapView.js';
import { loadGoogleScript, searchPlaces, resolvePlace, getPlaceLocation } from '../utils/placesSearch.js';
import { searchLocation } from '../utils/nominatimSearch.js';

const MAP_MIME = 'application/geo+json';
const GOOGLE_API_KEY_STORAGE = 'infodepo_google_maps_key';

export const MapView = ({ items, onAddMap, onUpdateItem }) => {
  const leafletContainerRef = useRef(null);
  const mapRef = useRef(null);
  const layersRef = useRef({});
  // Populated by GoogleMapView on map init; lets us pan/add-landmark imperatively.
  const mapActionsRef = useRef(null);
  const searchTimerRef = useRef(null);
  const searchMarkersRef = useRef([]);       // Leaflet search-result markers
  const handleSelectResultRef = useRef(null); // always-current handleSelectResult for marker clicks
  const geojsonDataRef = useRef({});         // Leaflet in-memory GeoJSON { [driveId]: parsedGeoJSON }

  const mapItems = (items || []).filter((i) => i.type === MAP_MIME);
  const [activeIds, setActiveIds] = useState(() => new Set(mapItems.map((i) => i.driveId)));
  const [provider, setProvider] = useState('osm');
  const [selectedId, setSelectedId] = useState(null);
  const [googleApiKey, setGoogleApiKey] = useState(() => localStorage.getItem(GOOGLE_API_KEY_STORAGE) || '');
  const [apiKeyDraft, setApiKeyDraft] = useState('');
  const [editingApiKey, setEditingApiKey] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  // Places API ready — true once the Google script is loaded (any provider).
  const [placesReady, setPlacesReady] = useState(() => !!(window.google?.maps?.places));
  // Search
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const [showResults, setShowResults] = useState(false);
  // Landmark editor: null when closed, or { driveId, featureIdx, name, description }
  const [editingLandmark, setEditingLandmark] = useState(null);

  // Auto-select first layer when switching to Google mode
  useEffect(() => {
    if (provider === 'google' && !selectedId && mapItems.length > 0) {
      setSelectedId(mapItems[0].driveId);
    }
  }, [provider]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-add newly imported items to activeIds
  useEffect(() => {
    setActiveIds((prev) => {
      const next = new Set(prev);
      mapItems.forEach((i) => { if (!prev.has(i.driveId)) next.add(i.driveId); });
      return next;
    });
  }, [mapItems.map((i) => i.driveId).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  // Leaflet initialization (only when provider='osm')
  useEffect(() => {
    if (provider !== 'osm') return;
    if (!leafletContainerRef.current || !window.L || mapRef.current) return;

    const map = window.L.map(leafletContainerRef.current).setView([35, 135], 5);
    mapRef.current = map;

    window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);

    return () => {
      Object.values(layersRef.current).forEach((l) => l.remove());
      layersRef.current = {};
      geojsonDataRef.current = {};
      searchMarkersRef.current.forEach((m) => { try { m.remove(); } catch (_) {} });
      searchMarkersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
  }, [provider]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync Leaflet GeoJSON layers when activeIds/items change
  useEffect(() => {
    if (provider !== 'osm') return;
    const map = mapRef.current;
    if (!map || !window.L) return;

    const loadLayer = async (item) => {
      if (!item.data) return;
      const capturedMap = map;
      try {
        const text = await item.data.text();
        if (!mapRef.current || mapRef.current !== capturedMap) return;
        const geojson = JSON.parse(text);
        geojsonDataRef.current[item.driveId] = JSON.parse(JSON.stringify(geojson));
        const layer = makeLeafletLayer(item.driveId, geojson, capturedMap);
        if (!layer) return;
        layersRef.current[item.driveId] = layer;
        if (layer.getLayers().length > 0) {
          try { capturedMap.fitBounds(layer.getBounds(), { padding: [20, 20] }); } catch (_) {}
        }
      } catch (err) {
        console.warn('[MapView] Leaflet load failed for', item.name, err);
      }
    };

    mapItems.forEach((item) => {
      if (activeIds.has(item.driveId) && !layersRef.current[item.driveId]) {
        loadLayer(item);
      }
    });

    Object.keys(layersRef.current).forEach((id) => {
      if (!activeIds.has(id)) {
        layersRef.current[id].remove();
        delete layersRef.current[id];
        delete geojsonDataRef.current[id];
      }
    });
  }, [provider, activeIds, mapItems.map((i) => i.driveId).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleItem = useCallback((driveId) => {
    setActiveIds((prev) => {
      const next = new Set(prev);
      if (next.has(driveId)) next.delete(driveId);
      else next.add(driveId);
      return next;
    });
  }, []);

  const fitAll = useCallback(() => {
    const map = mapRef.current;
    if (!map || provider !== 'osm') return;
    const allLayers = Object.values(layersRef.current);
    if (!allLayers.length) return;
    const group = window.L.featureGroup(allLayers);
    try { map.fitBounds(group.getBounds(), { padding: [20, 20] }); } catch (_) {}
  }, [provider]);

  const saveApiKey = () => {
    const key = apiKeyDraft.trim();
    if (!key) return;
    localStorage.setItem(GOOGLE_API_KEY_STORAGE, key);
    setGoogleApiKey(key);
    setEditingApiKey(false);
    setApiKeyDraft('');
  };

  const clearApiKey = () => {
    localStorage.removeItem(GOOGLE_API_KEY_STORAGE);
    setGoogleApiKey('');
    setEditingApiKey(false);
    setProvider('osm');
  };

  const handleProviderChange = (p) => {
    setProvider(p);
    if (p === 'google' && !googleApiKey) {
      // No key yet — open settings so the user can enter one immediately.
      setShowSettings(true);
      setEditingApiKey(true);
    }
  };

  // Load Places API as soon as an API key is available — independently of
  // which map renderer is active. Once loaded, search uses Google Places (New)
  // with viewport bias in any provider mode; falls back to Nominatim otherwise.
  useEffect(() => {
    if (!googleApiKey || placesReady) return;
    loadGoogleScript(googleApiKey)
      .then(() => setPlacesReady(true))
      .catch(() => {}); // silently fall back to Nominatim
  }, [googleApiKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Returns a LatLngBoundsLiteral from whichever map is currently active.
  const getCurrentBounds = () => {
    if (mapRef.current) {
      const b = mapRef.current.getBounds(); // Leaflet LatLngBounds
      if (b) return { north: b.getNorth(), south: b.getSouth(), east: b.getEast(), west: b.getWest() };
    }
    return mapActionsRef.current?.getBounds?.() ?? null;
  };

  // ── Leaflet layer helpers ────────────────────────────────────────────────────

  // Build a Leaflet GeoJSON layer. Each Point feature gets click-to-edit and
  // hover-to-preview. Uses setEditingLandmark (stable setter) directly.
  const makeLeafletLayer = (driveId, geojson, map) => {
    if (!map || !window.L) return null;
    let featureIdx = 0;
    return window.L.geoJSON(geojson, {
      onEachFeature: (feature, lyr) => {
        const idx = featureIdx++;
        const p = feature.properties || {};
        lyr.on('click', (e) => {
          setEditingLandmark({
            driveId, featureIdx: idx,
            name: p.name || '', description: p.description || '',
            anchorX: e.containerPoint?.x ?? 0,
            anchorY: e.containerPoint?.y ?? 0,
          });
        });
        if (p.name || p.description) {
          const popupHtml = `${p.name ? `<strong>${p.name}</strong>` : ''}${p.description ? `<br/><span style="font-size:11px;color:#6b7280">${p.description}</span>` : ''}`;
          lyr.bindPopup(popupHtml, { closeButton: false, autoPan: false });
          lyr.on('mouseover', () => lyr.openPopup());
        }
      },
    }).addTo(map);
  };

  // Remove and recreate a Leaflet layer from updated in-memory GeoJSON.
  // Does NOT fitBounds — keeps the viewport stable after edit/delete.
  const reloadLeafletLayer = (driveId, geojson) => {
    const map = mapRef.current;
    if (!map) return;
    if (layersRef.current[driveId]) {
      layersRef.current[driveId].remove();
      delete layersRef.current[driveId];
    }
    const layer = makeLeafletLayer(driveId, geojson, map);
    if (layer) layersRef.current[driveId] = layer;
  };

  // ── Search marker helpers ────────────────────────────────────────────────────

  const clearLeafletSearchMarkers = () => {
    searchMarkersRef.current.forEach((m) => { try { m.remove(); } catch (_) {} });
    searchMarkersRef.current = [];
  };

  // Place numbered orange pins for every result that has coordinates.
  // Detects the active renderer from refs rather than `provider` state so that
  // async callbacks that close over this function don't see stale state.
  const showMarkersOnMap = (results) => {
    const pts = results.filter((r) => r.lat != null && r.lng != null);
    if (pts.length === 0) return;

    if (mapRef.current && window.L) {
      clearLeafletSearchMarkers();
      pts.forEach((result, i) => {
        const icon = window.L.divIcon({
          className: '',
          html: `<div style="background:#f97316;color:#fff;border-radius:50%;width:22px;height:22px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:bold;border:2px solid #fff;box-shadow:0 2px 4px rgba(0,0,0,.4)">${i + 1}</div>`,
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        });
        const popup = window.L.popup({ offset: [0, -8], closeButton: false, autoPan: false }).setContent(
          `<div style="font-family:system-ui;font-size:12px;line-height:1.4"><strong>${result.shortName}</strong>${result.name && result.name !== result.shortName ? `<br><span style="color:#6b7280;font-size:11px">${result.name}</span>` : ''}</div>`
        );
        const marker = window.L.marker([result.lat, result.lng], { icon }).addTo(mapRef.current);
        marker.bindPopup(popup);
        marker.on('mouseover', () => marker.openPopup());
        marker.on('click', () => handleSelectResultRef.current?.(result));
        searchMarkersRef.current.push(marker);
      });
    } else if (mapActionsRef.current?.showSearchMarkers) {
      mapActionsRef.current.showSearchMarkers(pts, (result) => handleSelectResultRef.current?.(result));
    }
  };

  const clearSearchMarkers = () => {
    clearLeafletSearchMarkers();
    mapActionsRef.current?.clearSearchMarkers?.();
  };

  // ── Search ──────────────────────────────────────────────────────────────────

  const handleSearchInput = (e) => {
    const q = e.target.value;
    setSearchQuery(q);
    setSearchError(null);
    clearTimeout(searchTimerRef.current);
    if (!q.trim()) { setSearchResults([]); setShowResults(false); clearSearchMarkers(); return; }
    searchTimerRef.current = setTimeout(async () => {
      setIsSearching(true);
      clearSearchMarkers();
      try {
        // Google Places (New) when script is loaded — works in any provider mode.
        // Falls back to Nominatim if no API key is set or script hasn't loaded yet.
        const raw = placesReady
          ? await searchPlaces(q, getCurrentBounds())
          : await searchLocation(q);

        // Nominatim results already carry lat/lng.  Places predictions don't —
        // resolve each one with getPlaceLocation (no session token consumed) so
        // we can place preview markers on the map immediately.
        const withCoords = await Promise.all(
          raw.map(async (r) => {
            if (r.lat != null) return r;
            const loc = await getPlaceLocation(r.placeId).catch(() => null);
            return loc ? { ...r, ...loc } : r;
          })
        );

        setSearchResults(withCoords);
        setShowResults(withCoords.length > 0);
        showMarkersOnMap(withCoords);
      } catch (err) {
        setSearchError(err.message);
        setShowResults(false);
      } finally {
        setIsSearching(false);
      }
    }, 500);
  };

  const handleSelectResult = async (result) => {
    setShowResults(false);
    setSearchQuery(result.shortName);
    clearSearchMarkers();
    try {
      let lat, lng;
      if (result.placeId) {
        ({ lat, lng } = await resolvePlace(result.placeId));
      } else {
        ({ lat, lng } = result);
      }
      if (provider === 'osm' && mapRef.current) {
        mapRef.current.setView([lat, lng], 14);
      } else {
        mapActionsRef.current?.panTo(lat, lng);
      }
    } catch (err) {
      console.warn('[MapView] select result failed:', err);
    }
  };

  const handleAddLandmark = async (result) => {
    clearSearchMarkers();
    try {
      let lat, lng, name;
      if (result.placeId) {
        ({ lat, lng, name } = await resolvePlace(result.placeId));
      } else {
        ({ lat, lng } = result);
        name = result.shortName;
      }
      mapActionsRef.current?.addLandmark(lat, lng, name);
    } catch (err) {
      console.warn('[MapView] add landmark failed:', err);
    }
    setShowResults(false);
    setSearchQuery('');
    setSearchResults([]);
  };

  // Keep handleSelectResultRef current so Leaflet marker click handlers always
  // call the latest version (avoids stale closure over `provider` state).
  useEffect(() => { handleSelectResultRef.current = handleSelectResult; });

  // ── Landmark editor ──────────────────────────────────────────────────────────

  const closeEditor = () => setEditingLandmark(null);

  const handleSaveLandmark = async () => {
    if (!editingLandmark) return;
    const { driveId, featureIdx, name, description } = editingLandmark;
    closeEditor();
    if (mapActionsRef.current?.updateLandmark) {
      // Google Maps — delegate to the engine (updates marker title + saves blob)
      mapActionsRef.current.updateLandmark(driveId, featureIdx, { name, description });
    } else {
      // Leaflet — update in-memory data, re-render layer, save blob
      const geojson = geojsonDataRef.current[driveId];
      if (!geojson?.features[featureIdx]) return;
      geojson.features[featureIdx].properties = { ...geojson.features[featureIdx].properties, name, description };
      reloadLeafletLayer(driveId, geojson);
      const blob = new Blob([JSON.stringify(geojson)], { type: MAP_MIME });
      await onUpdateItem?.(driveId, blob, MAP_MIME);
    }
  };

  const handleDeleteLandmark = async () => {
    if (!editingLandmark) return;
    const { driveId, featureIdx } = editingLandmark;
    closeEditor();
    if (mapActionsRef.current?.deleteLandmark) {
      // Google Maps — delegate to the engine (re-renders layer to fix indices + saves)
      mapActionsRef.current.deleteLandmark(driveId, featureIdx);
    } else {
      // Leaflet — splice feature, re-render, save
      const geojson = geojsonDataRef.current[driveId];
      if (!geojson) return;
      geojson.features.splice(featureIdx, 1);
      reloadLeafletLayer(driveId, geojson);
      const blob = new Blob([JSON.stringify(geojson)], { type: MAP_MIME });
      await onUpdateItem?.(driveId, blob, MAP_MIME);
    }
  };

  // ── Sidebar sections ────────────────────────────────────────────────────────

  const sidebarSearch = React.createElement(
    'div',
    { className: 'p-3 border-b border-gray-700' },
    React.createElement(
      'div',
      { className: 'relative' },
      React.createElement('input', {
        type: 'text',
        value: searchQuery,
        onChange: handleSearchInput,
        onKeyDown: (e) => {
          if (e.key === 'Escape') { setShowResults(false); setSearchQuery(''); setSearchResults([]); }
        },
        placeholder: 'Search location…',
        className: 'w-full bg-gray-900 border border-gray-600 text-white text-sm rounded-md pl-8 pr-8 py-1.5 focus:outline-none focus:border-indigo-500 placeholder-gray-500',
      }),
      React.createElement(
        'svg',
        {
          className: 'absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-500 pointer-events-none',
          fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor',
        },
        React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z' })
      ),
      isSearching && React.createElement('div', {
        className: 'absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin',
      })
    ),
    showResults && searchResults.length > 0 && React.createElement(
      'div',
      { className: 'mt-1 bg-gray-900 border border-gray-600 rounded-md overflow-hidden' },
      searchResults.map((result, i) =>
        React.createElement(
          'div',
          {
            key: i,
            className: 'flex items-center gap-1 px-2 py-1.5 hover:bg-gray-700 border-b border-gray-700/50 last:border-0 group cursor-pointer',
            onClick: () => handleSelectResult(result),
          },
          React.createElement(
            'span',
            { className: 'flex-1 text-xs text-gray-200 truncate min-w-0', title: result.name },
            result.shortName
          ),
          provider === 'google' && selectedId && React.createElement(
            'button',
            {
              onClick: (e) => { e.stopPropagation(); handleAddLandmark(result); },
              className: 'flex-shrink-0 text-xs text-indigo-400 hover:text-indigo-300 opacity-0 group-hover:opacity-100 transition-opacity pl-1 whitespace-nowrap',
              title: 'Add as landmark to selected layer',
            },
            '+ Add'
          )
        )
      )
    ),
    searchError && React.createElement('p', { className: 'mt-1 text-red-400 text-xs' }, searchError)
  );

  const sidebarControls = React.createElement(
    'div',
    { className: 'p-3 border-b border-gray-700 flex flex-col gap-2' },

    // Provider toggle
    React.createElement(
      'div',
      { className: 'flex gap-1 bg-gray-900 rounded-lg p-1' },
      React.createElement(
        'button',
        {
          onClick: () => handleProviderChange('osm'),
          className: `flex-1 text-xs py-1.5 rounded-md transition-colors font-medium ${provider === 'osm' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700'}`,
        },
        'OSM'
      ),
      React.createElement(
        'button',
        {
          onClick: () => handleProviderChange('google'),
          className: `flex-1 text-xs py-1.5 rounded-md transition-colors font-medium ${provider === 'google' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700'}`,
          title: 'Google Maps — requires API key in Settings',
        },
        'Google'
      )
    ),

    provider === 'google' && googleApiKey && React.createElement(
      'p',
      { className: 'text-gray-500 text-xs px-1' },
      React.createElement('span', { className: 'text-indigo-300 font-medium' }, 'Tip: '),
      'Click map to add · Click marker to edit/delete'
    ),

    React.createElement(
      'button',
      {
        onClick: onAddMap,
        className: 'flex items-center gap-2 w-full bg-gray-700 hover:bg-gray-600 text-white text-sm font-semibold py-2 px-3 rounded-lg transition-colors',
      },
      React.createElement(
        'svg',
        { xmlns: 'http://www.w3.org/2000/svg', className: 'h-4 w-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
        React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M12 4v16m8-8H4' })
      ),
      'Import Map'
    ),

    provider === 'osm' && mapItems.length > 0 && React.createElement(
      'button',
      {
        onClick: fitAll,
        className: 'flex items-center gap-2 w-full bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs font-medium py-1.5 px-3 rounded-lg transition-colors',
      },
      'Fit All Layers'
    )
  );

  const sidebarLayers = React.createElement(
    'div',
    { className: 'flex-1 overflow-y-auto p-2' },
    mapItems.length === 0
      ? React.createElement('p', { className: 'text-gray-500 text-xs text-center mt-6 px-3' }, 'No map items yet. Import a KMZ, KML, or GeoJSON file.')
      : mapItems.map((item) => {
          const isSelected = selectedId === item.driveId && provider === 'google';
          return React.createElement(
            'div',
            {
              key: item.driveId,
              className: `flex items-center gap-2 px-2 py-2 rounded-lg group ${isSelected ? 'bg-indigo-900/40 border border-indigo-600/50' : 'hover:bg-gray-700'}`,
            },
            React.createElement('input', {
              type: 'checkbox',
              checked: activeIds.has(item.driveId),
              onChange: () => toggleItem(item.driveId),
              className: 'rounded border-gray-600 bg-gray-700 text-indigo-500 flex-shrink-0 cursor-pointer',
              onClick: (e) => e.stopPropagation(),
            }),
            React.createElement(
              'svg',
              {
                xmlns: 'http://www.w3.org/2000/svg',
                className: `h-4 w-4 flex-shrink-0 ${isSelected ? 'text-indigo-400' : 'text-green-400'}`,
                fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor',
              },
              React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z' }),
              React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M15 11a3 3 0 11-6 0 3 3 0 016 0z' })
            ),
            React.createElement(
              'span',
              {
                className: `text-xs truncate flex-1 cursor-pointer ${isSelected ? 'text-indigo-300 font-medium' : 'text-gray-300 group-hover:text-white'}`,
                title: provider === 'google' ? 'Click to select for editing' : item.name,
                onClick: () => {
                  if (provider === 'google') {
                    setSelectedId(item.driveId);
                    if (!activeIds.has(item.driveId)) {
                      setActiveIds((prev) => { const next = new Set(prev); next.add(item.driveId); return next; });
                    }
                  }
                },
              },
              item.name.replace(/\.geojson$/i, '')
            ),
            isSelected && React.createElement('span', { className: 'text-xs text-indigo-400 flex-shrink-0 font-medium', title: 'Active editing layer' }, '✎')
          );
        })
  );

  // Settings panel — always accessible regardless of active provider
  const sidebarSettings = React.createElement(
    'div',
    { className: 'border-t border-gray-700' },
    React.createElement(
      'button',
      {
        onClick: () => setShowSettings((v) => !v),
        className: 'flex items-center gap-1.5 w-full px-3 py-2 text-gray-500 hover:text-gray-300 text-xs font-medium transition-colors',
      },
      React.createElement('span', null, showSettings ? '▾' : '▸'),
      'Google Maps Settings',
      googleApiKey && React.createElement('span', { className: 'ml-auto text-green-500' }, '✓')
    ),
    showSettings && React.createElement(
      'div',
      { className: 'px-3 pb-3 flex flex-col gap-2' },
      React.createElement('p', { className: 'text-gray-400 text-xs' }, 'API Key:'),
      googleApiKey && !editingApiKey
        ? React.createElement(
            'div',
            { className: 'flex items-center justify-between gap-2' },
            React.createElement('span', { className: 'text-green-400 text-xs' }, '✓ Key set'),
            React.createElement(
              'button',
              {
                onClick: () => { setApiKeyDraft(googleApiKey); setEditingApiKey(true); },
                className: 'flex-shrink-0 text-gray-500 hover:text-gray-300 text-xs',
              },
              'Edit'
            )
          )
        : React.createElement(
            React.Fragment,
            null,
            React.createElement('input', {
              type: 'text',
              value: apiKeyDraft,
              onChange: (e) => setApiKeyDraft(e.target.value),
              onKeyDown: (e) => { if (e.key === 'Enter') saveApiKey(); },
              placeholder: 'AIza…',
              className: 'bg-gray-900 border border-gray-600 text-white text-xs rounded-md px-2 py-1.5 w-full focus:outline-none focus:border-indigo-500',
            }),
            React.createElement(
              'div',
              { className: 'flex gap-2' },
              React.createElement(
                'button',
                {
                  onClick: saveApiKey,
                  disabled: !apiKeyDraft.trim(),
                  className: 'flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-semibold py-1.5 rounded-md transition-colors',
                },
                'Save Key'
              ),
              googleApiKey && editingApiKey && React.createElement(
                'button',
                {
                  onClick: () => { setEditingApiKey(false); setApiKeyDraft(''); },
                  className: 'flex-shrink-0 text-gray-500 hover:text-gray-300 text-xs py-1.5 px-2',
                },
                'Cancel'
              )
            ),
            googleApiKey && React.createElement(
              'button',
              {
                onClick: clearApiKey,
                className: 'text-xs text-gray-500 hover:text-red-400 transition-colors text-center',
              },
              'Clear & switch to OSM'
            )
          )
    )
  );

  return React.createElement(
    'div',
    { className: 'flex flex-row h-full min-h-0 flex-1' },

    // Sidebar
    React.createElement(
      'div',
      { className: 'w-64 flex-shrink-0 bg-gray-800 border-r border-gray-700 flex flex-col' },
      sidebarSearch,
      sidebarControls,
      sidebarLayers,
      sidebarSettings
    ),

    // Map canvas + unified landmark editor overlay
    React.createElement(
      'div',
      { style: { position: 'relative', flex: 1, minWidth: 0, overflow: 'hidden' } },

      // Leaflet map
      provider === 'osm' && React.createElement(
        'div',
        { ref: leafletContainerRef, style: { position: 'absolute', inset: 0 } }
      ),

      // Google Maps (or no-key prompt)
      provider === 'google' && (!googleApiKey
        ? React.createElement(
            'div',
            { style: { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }, className: 'text-gray-400 text-sm' },
            'Add a Google Maps API key in Settings ▸ Google Maps Settings.'
          )
        : React.createElement(
            'div',
            { style: { position: 'absolute', inset: 0 } },
            React.createElement(GoogleMapView, {
              items: mapItems,
              activeIds,
              selectedId,
              onUpdateItem,
              apiKey: googleApiKey,
              mapActionsRef,
              onEditLandmark: setEditingLandmark,
            })
          )
      ),

      // Landmark editor — floats near the clicked pin
      editingLandmark && React.createElement(
        'div',
        {
          style: (() => {
            const PANEL_W = 224;
            const ax = editingLandmark.anchorX ?? 0;
            const ay = editingLandmark.anchorY ?? 0;
            // Show below the pin when near the top edge, above otherwise
            const showBelow = ay < 230;
            return {
              position: 'absolute',
              // clamp keeps the panel horizontally inside the map container
              left: `clamp(${PANEL_W / 2}px, ${ax}px, calc(100% - ${PANEL_W / 2}px))`,
              top: ay,
              transform: showBelow ? 'translate(-50%, 10px)' : 'translate(-50%, calc(-100% - 10px))',
              zIndex: 1000,
              width: PANEL_W + 'px',
              background: '#1f2937', border: '1px solid #374151',
              borderRadius: '12px', padding: '14px 14px 12px',
              boxShadow: '0 8px 32px rgba(0,0,0,.6)',
            };
          })(),
        },
        // Header
        React.createElement(
          'div',
          { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' } },
          React.createElement('span', { style: { color: '#f9fafb', fontSize: '13px', fontWeight: 600 } }, 'Edit location'),
          React.createElement(
            'button',
            { onClick: closeEditor, style: { color: '#6b7280', fontSize: '18px', lineHeight: 1, background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px' } },
            '×'
          )
        ),
        // Name
        React.createElement('label', { style: { color: '#9ca3af', fontSize: '11px', display: 'block', marginBottom: '3px' } }, 'Name'),
        React.createElement('input', {
          type: 'text',
          value: editingLandmark.name,
          onChange: (e) => setEditingLandmark((p) => ({ ...p, name: e.target.value })),
          onKeyDown: (e) => { if (e.key === 'Escape') closeEditor(); if (e.key === 'Enter') handleSaveLandmark(); },
          placeholder: 'Location name',
          autoFocus: true,
          style: {
            display: 'block', width: '100%', background: '#111827', border: '1px solid #374151',
            color: '#f9fafb', fontSize: '12px', borderRadius: '6px', padding: '5px 8px',
            marginBottom: '10px', boxSizing: 'border-box', outline: 'none',
          },
        }),
        // Description
        React.createElement('label', { style: { color: '#9ca3af', fontSize: '11px', display: 'block', marginBottom: '3px' } }, 'Description'),
        React.createElement('textarea', {
          value: editingLandmark.description,
          onChange: (e) => setEditingLandmark((p) => ({ ...p, description: e.target.value })),
          onKeyDown: (e) => { if (e.key === 'Escape') closeEditor(); },
          placeholder: 'Optional note',
          rows: 3,
          style: {
            display: 'block', width: '100%', background: '#111827', border: '1px solid #374151',
            color: '#f9fafb', fontSize: '12px', borderRadius: '6px', padding: '5px 8px',
            marginBottom: '12px', boxSizing: 'border-box', outline: 'none', resize: 'vertical',
          },
        }),
        // Actions
        React.createElement(
          'div',
          { style: { display: 'flex', gap: '6px' } },
          React.createElement(
            'button',
            {
              onClick: handleSaveLandmark,
              style: { flex: 1, background: '#4f46e5', color: '#fff', border: 'none', borderRadius: '6px', padding: '6px 0', fontSize: '12px', fontWeight: 600, cursor: 'pointer' },
            },
            'Save'
          ),
          React.createElement(
            'button',
            {
              onClick: handleDeleteLandmark,
              style: { background: '#450a0a', color: '#fca5a5', border: '1px solid #7f1d1d', borderRadius: '6px', padding: '6px 10px', fontSize: '12px', cursor: 'pointer' },
            },
            'Delete'
          )
        )
      )
    )
  );
};
