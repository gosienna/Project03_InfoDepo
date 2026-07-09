
import React, { useEffect, useRef } from 'react';

export const MapViewer = ({ video }) => {
  const containerRef = useRef(null);
  const mapRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || !window.L) return;

    // Guard: Leaflet requires a non-zero container height. We call
    // invalidateSize() after a tick to handle any flex layout settling.
    const map = window.L.map(containerRef.current).setView([35, 135], 5);
    mapRef.current = map;

    window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);

    const sizeTimer = setTimeout(() => map.invalidateSize(), 0);

    const loadGeoJSON = async () => {
      if (!video.data) {
        console.warn('[MapViewer] no blob data for', video.name);
        return;
      }
      try {
        const text = await video.data.text();
        const geojson = JSON.parse(text);
        const layer = window.L.geoJSON(geojson, {
          onEachFeature: (feature, lyr) => {
            const props = feature.properties || {};
            if (props.name || props.description) {
              lyr.bindPopup(
                `${props.name ? `<strong>${props.name}</strong>` : ''}${props.description ? `<br/>${props.description}` : ''}`
              );
            }
          },
        }).addTo(map);
        if (layer.getLayers().length > 0) {
          try { map.fitBounds(layer.getBounds(), { padding: [20, 20] }); } catch (_) {}
        }
      } catch (err) {
        console.warn('[MapViewer] failed to load GeoJSON:', err);
      }
    };

    loadGeoJSON();

    return () => {
      clearTimeout(sizeTimer);
      map.remove();
      mapRef.current = null;
    };
  }, [video.driveId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!video.data) {
    return React.createElement(
      'div',
      { className: 'flex flex-1 items-center justify-center text-gray-400 text-sm' },
      'Map data not available locally.'
    );
  }

  // Use flex:1 so this div stretches to fill the Reader's flex-col container,
  // giving Leaflet a reliable non-zero height without needing height:100%.
  return React.createElement(
    'div',
    { style: { flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 } },
    React.createElement('div', {
      ref: containerRef,
      style: { flex: 1, minHeight: '400px' },
    })
  );
};
