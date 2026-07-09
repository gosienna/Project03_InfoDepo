
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { loadGoogleScript } from '../utils/placesSearch.js';

const MAP_MIME = 'application/geo+json';
const SELECTED_COLOR = '#4f46e5';
const UNSELECTED_COLOR = '#6b7280';

function makeMarkerIcon(isSelected) {
  const G = window.google.maps;
  return {
    path: G.SymbolPath.CIRCLE,
    scale: isSelected ? 9 : 7,
    fillColor: isSelected ? SELECTED_COLOR : UNSELECTED_COLOR,
    fillOpacity: 1,
    strokeColor: '#ffffff',
    strokeWeight: 2,
  };
}

// mapActionsRef — ref populated on map init; lets MapView drive the map imperatively.
// Fields set: panTo, addLandmark, getBounds, showSearchMarkers, clearSearchMarkers,
//             updateLandmark, deleteLandmark
export const GoogleMapView = ({ items, activeIds, selectedId, onUpdateItem, apiKey, mapActionsRef, onEditLandmark }) => {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef({});
  const geojsonRef = useRef({});
  const infoWindowRef = useRef(null);
  const selectedIdRef = useRef(selectedId);
  const onUpdateItemRef = useRef(onUpdateItem);
  const onEditLandmarkRef = useRef(onEditLandmark);
  const openInfoWindowRef = useRef(null);
  const saveLayerRef = useRef(null);
  const renderLayerRef = useRef(null);

  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);
  useEffect(() => { onUpdateItemRef.current = onUpdateItem; }, [onUpdateItem]);
  useEffect(() => { onEditLandmarkRef.current = onEditLandmark; }, [onEditLandmark]);

  const [apiLoaded, setApiLoaded] = useState(() => !!(window.google?.maps?.places));
  const [loadError, setLoadError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!apiKey) return;
    loadGoogleScript(apiKey)
      .then(() => setApiLoaded(true))
      .catch((e) => setLoadError(e.message));
  }, [apiKey]);

  const saveLayer = useCallback(async (driveId) => {
    const geojson = geojsonRef.current[driveId];
    if (!geojson || !onUpdateItemRef.current) return;
    setSaving(true);
    try {
      const blob = new Blob([JSON.stringify(geojson)], { type: MAP_MIME });
      await onUpdateItemRef.current(driveId, blob, MAP_MIME);
    } catch (e) {
      console.error('[GoogleMapView] save failed:', e);
    } finally {
      setSaving(false);
    }
  }, []);

  // Opens the shared landmark editor in MapView by calling the onEditLandmark callback.
  // x/y are pixel coordinates relative to the map container — used to float the
  // editor panel near the clicked pin. e.pixel from MapMouseEvent gives this directly.
  const openInfoWindow = useCallback((driveId, featureIdx, x = 0, y = 0) => {
    const feature = geojsonRef.current[driveId]?.features[featureIdx];
    if (!feature) return;
    onEditLandmarkRef.current?.({
      driveId,
      featureIdx,
      name: feature.properties?.name || '',
      description: feature.properties?.description || '',
      anchorX: x,
      anchorY: y,
    });
  }, []);

  // Render Point features from a GeoJSON layer as Google Maps markers.
  // noFit: skip the fitBounds call (used when re-rendering after edit/delete).
  const renderLayer = useCallback((driveId, geojson, { noFit = false } = {}) => {
    if (!mapRef.current) return;
    const isSelected = driveId === selectedIdRef.current;
    const entries = [];

    (geojson.features || []).forEach((feature, idx) => {
      if (feature.geometry?.type !== 'Point') return;
      const [lng, lat] = feature.geometry.coordinates;
      const name = feature.properties?.name || '';
      const marker = new window.google.maps.Marker({
        position: { lat, lng },
        map: mapRef.current,
        title: name || 'Landmark',
        icon: makeMarkerIcon(isSelected),
      });
      // All saved markers open the unified editor on click.
      // e.pixel is a Point relative to the map container — use it to float the panel near the pin.
      marker.addListener('click', (e) => openInfoWindowRef.current?.(driveId, idx, e.pixel?.x ?? 0, e.pixel?.y ?? 0));
      // Show name + description on hover
      if (name || feature.properties?.description) {
        const desc = feature.properties?.description || '';
        const iwHtml = `<div style="font-family:system-ui;font-size:12px;line-height:1.5"><strong>${name || 'Landmark'}</strong>${desc ? `<br><span style="color:#6b7280;font-size:11px">${desc}</span>` : ''}</div>`;
        marker.addListener('mouseover', () => {
          infoWindowRef.current?.setContent(iwHtml);
          infoWindowRef.current?.open(mapRef.current, marker);
        });
        marker.addListener('mouseout', () => infoWindowRef.current?.close());
      }
      entries.push({ marker, idx });
    });

    markersRef.current[driveId] = entries;

    if (!noFit && entries.length > 0) {
      const bounds = new window.google.maps.LatLngBounds();
      entries.forEach(({ marker }) => bounds.extend(marker.getPosition()));
      mapRef.current.fitBounds(bounds, 60);
      if (entries.length === 1) mapRef.current.setZoom(14);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps — reads everything via refs

  const loadItemMarkers = useCallback(async (item) => {
    if (!item.data || !mapRef.current) return;
    try {
      const text = await item.data.text();
      const geojson = JSON.parse(text);
      geojsonRef.current[item.driveId] = JSON.parse(JSON.stringify(geojson));
      renderLayer(item.driveId, geojsonRef.current[item.driveId]);
    } catch (e) {
      console.warn('[GoogleMapView] load failed for', item.name, e);
    }
  }, [renderLayer]);

  useEffect(() => { openInfoWindowRef.current = openInfoWindow; }, [openInfoWindow]);
  useEffect(() => { saveLayerRef.current = saveLayer; }, [saveLayer]);
  useEffect(() => { renderLayerRef.current = renderLayer; }, [renderLayer]);

  // Initialize Google Map once the API is ready.
  // Depends ONLY on apiLoaded so map-init never re-runs when selectedId changes.
  useEffect(() => {
    if (!apiLoaded || !containerRef.current || mapRef.current) return;
    if (!window.google?.maps?.Map) {
      console.error('[GoogleMapView] google.maps not available despite apiLoaded=true');
      return;
    }

    const map = new window.google.maps.Map(containerRef.current, {
      center: { lat: 35, lng: 135 },
      zoom: 5,
      mapTypeControl: true,
      streetViewControl: false,
      fullscreenControl: false,
    });
    mapRef.current = map;
    infoWindowRef.current = new window.google.maps.InfoWindow();

    let searchMarkers = [];

    const addMarkerToLayer = (lat, lng, name, sid) => {
      if (!sid || !geojsonRef.current[sid]) return;
      const geojson = geojsonRef.current[sid];
      const featureIdx = geojson.features.length;
      geojson.features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lng, lat] },
        properties: { name: name || '', description: '' },
      });
      const marker = new window.google.maps.Marker({
        position: { lat, lng },
        map,
        title: name || 'Landmark',
        icon: makeMarkerIcon(true),
      });
      marker.addListener('click', (e) => openInfoWindowRef.current?.(sid, featureIdx, e.pixel?.x ?? 0, e.pixel?.y ?? 0));
      if (!markersRef.current[sid]) markersRef.current[sid] = [];
      markersRef.current[sid].push({ marker, idx: featureIdx });
      saveLayerRef.current?.(sid);
    };

    map.addListener('click', (e) => {
      const sid = selectedIdRef.current;
      if (!sid || !geojsonRef.current[sid]) return;
      const name = window.prompt('Landmark name (leave blank to skip):') ?? null;
      if (name === null) return;
      addMarkerToLayer(e.latLng.lat(), e.latLng.lng(), name, sid);
    });

    if (mapActionsRef) {
      mapActionsRef.current = {
        panTo: (lat, lng) => { map.setCenter({ lat, lng }); map.setZoom(15); },
        addLandmark: (lat, lng, name) => addMarkerToLayer(lat, lng, name, selectedIdRef.current),
        getBounds: () => {
          const b = map.getBounds();
          if (!b) return null;
          return {
            north: b.getNorthEast().lat(),
            south: b.getSouthWest().lat(),
            east: b.getNorthEast().lng(),
            west: b.getSouthWest().lng(),
          };
        },

        // Update name/description of a saved landmark and re-save.
        updateLandmark: (driveId, featureIdx, { name, description }) => {
          const geojson = geojsonRef.current[driveId];
          if (!geojson?.features[featureIdx]) return;
          geojson.features[featureIdx].properties = { ...geojson.features[featureIdx].properties, name, description };
          const entry = (markersRef.current[driveId] || []).find((e) => e.idx === featureIdx);
          if (entry) entry.marker.setTitle(name || 'Landmark');
          saveLayerRef.current?.(driveId);
        },

        // Delete a saved landmark, re-render the layer with corrected indices, re-save.
        deleteLandmark: (driveId, featureIdx) => {
          const geojson = geojsonRef.current[driveId];
          if (!geojson) return;
          geojson.features.splice(featureIdx, 1);
          (markersRef.current[driveId] || []).forEach(({ marker }) => marker.setMap(null));
          markersRef.current[driveId] = [];
          renderLayerRef.current?.(driveId, geojson, { noFit: true });
          saveLayerRef.current?.(driveId);
        },

        showSearchMarkers: (results, onSelect) => {
          searchMarkers.forEach((m) => m.setMap(null));
          searchMarkers = [];
          results.forEach((result, i) => {
            const marker = new window.google.maps.Marker({
              position: { lat: result.lat, lng: result.lng },
              map,
              title: result.shortName,
              label: { text: String(i + 1), color: '#fff', fontSize: '11px', fontWeight: 'bold' },
              icon: {
                path: window.google.maps.SymbolPath.CIRCLE,
                scale: 12,
                fillColor: '#f97316',
                fillOpacity: 1,
                strokeColor: '#ffffff',
                strokeWeight: 2,
              },
              zIndex: 100,
            });
            const iwContent = `<div style="font-family:system-ui;font-size:12px;line-height:1.4"><strong>${result.shortName}</strong>${result.name && result.name !== result.shortName ? `<br><span style="color:#6b7280;font-size:11px">${result.name}</span>` : ''}</div>`;
            marker.addListener('mouseover', () => {
              infoWindowRef.current?.setContent(iwContent);
              infoWindowRef.current?.open(map, marker);
            });
            marker.addListener('mouseout', () => infoWindowRef.current?.close());
            marker.addListener('click', () => {
              infoWindowRef.current?.setContent(iwContent);
              infoWindowRef.current?.open(map, marker);
              onSelect?.(result);
            });
            searchMarkers.push(marker);
          });
        },

        clearSearchMarkers: () => {
          searchMarkers.forEach((m) => m.setMap(null));
          searchMarkers = [];
        },
      };
    }

    return () => {
      if (mapActionsRef) mapActionsRef.current = null;
      searchMarkers.forEach((m) => m.setMap(null));
      searchMarkers = [];
      Object.values(markersRef.current).forEach((arr) => arr.forEach(({ marker }) => marker.setMap(null)));
      markersRef.current = {};
      geojsonRef.current = {};
      mapRef.current = null;
    };
  }, [apiLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync visible layers when activeIds changes
  useEffect(() => {
    if (!mapRef.current) return;
    const mapItems = (items || []).filter((i) => i.type === MAP_MIME);
    Object.keys(markersRef.current).forEach((driveId) => {
      if (!activeIds.has(driveId)) {
        markersRef.current[driveId].forEach(({ marker }) => marker.setMap(null));
        delete markersRef.current[driveId];
        delete geojsonRef.current[driveId];
      }
    });
    mapItems.forEach((item) => {
      if (activeIds.has(item.driveId) && !markersRef.current[item.driveId]) {
        loadItemMarkers(item);
      }
    });
  }, [activeIds, items, loadItemMarkers]);

  // Update marker icon colors when selected layer changes
  useEffect(() => {
    if (!mapRef.current) return;
    Object.entries(markersRef.current).forEach(([driveId, entries]) => {
      const isSelected = driveId === selectedId;
      entries.forEach(({ marker }) => marker.setIcon(makeMarkerIcon(isSelected)));
    });
  }, [selectedId]);

  if (loadError) {
    return React.createElement(
      'div',
      { className: 'flex items-center justify-center h-full text-red-400 text-sm p-8 text-center' },
      loadError
    );
  }

  if (!apiLoaded) {
    return React.createElement(
      'div',
      { className: 'flex items-center justify-center h-full text-gray-400 text-sm' },
      'Loading Google Maps…'
    );
  }

  return React.createElement(
    'div',
    { style: { position: 'relative', width: '100%', height: '100%' } },
    saving && React.createElement(
      'div',
      {
        style: {
          position: 'absolute', bottom: '20px', left: '50%', transform: 'translateX(-50%)',
          zIndex: 10, background: 'rgba(0,0,0,0.72)', color: '#fff',
          padding: '4px 14px', borderRadius: '20px', fontSize: '12px',
        },
      },
      'Saving…'
    ),
    React.createElement('div', { ref: containerRef, style: { width: '100%', height: '100%' } })
  );
};
