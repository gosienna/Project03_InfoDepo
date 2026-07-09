
function parseCoordinates(coordText) {
  return coordText.trim().split(/\s+/).map((tuple) => {
    const parts = tuple.split(',').map(Number);
    return [parts[0], parts[1]]; // [lng, lat] — GeoJSON order
  });
}

// getElementsByTagNameNS('*', name) works across all namespaces including
// KML's default namespace (http://www.opengis.net/kml/2.2).
function byTag(el, localName) {
  return el.getElementsByTagNameNS('*', localName);
}

function getChildText(el, tagName) {
  const child = byTag(el, tagName)[0];
  return child ? (child.textContent || '').trim() : '';
}

function parsePlacemark(placemark) {
  const name = getChildText(placemark, 'name');
  const description = getChildText(placemark, 'description');
  const properties = {};
  if (name) properties.name = name;
  if (description) properties.description = description;

  const extData = byTag(placemark, 'ExtendedData')[0];
  if (extData) {
    const dataEls = byTag(extData, 'Data');
    for (const d of dataEls) {
      const k = d.getAttribute('name');
      const v = getChildText(d, 'value');
      if (k) properties[k] = v;
    }
  }

  const point = byTag(placemark, 'Point')[0];
  if (point) {
    const coords = parseCoordinates(getChildText(point, 'coordinates'));
    if (coords.length > 0) {
      return { type: 'Feature', geometry: { type: 'Point', coordinates: coords[0] }, properties };
    }
  }

  const lineString = byTag(placemark, 'LineString')[0];
  if (lineString) {
    const coords = parseCoordinates(getChildText(lineString, 'coordinates'));
    if (coords.length > 0) {
      return { type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties };
    }
  }

  const polygon = byTag(placemark, 'Polygon')[0];
  if (polygon) {
    const outerRing = byTag(polygon, 'outerBoundaryIs')[0];
    const ringEl = outerRing ? byTag(outerRing, 'LinearRing')[0] : null;
    if (ringEl) {
      const coords = parseCoordinates(getChildText(ringEl, 'coordinates'));
      if (coords.length > 0) {
        return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] }, properties };
      }
    }
  }

  return null;
}

export function kmlToGeoJSON(kmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(kmlText, 'application/xml');
  const placemarks = byTag(doc, 'Placemark');
  const features = [];
  for (const pm of placemarks) {
    const feature = parsePlacemark(pm);
    if (feature) features.push(feature);
  }
  return JSON.stringify({ type: 'FeatureCollection', features });
}

export async function kmzToGeoJSON(file) {
  const baseName = file.name.replace(/\.(kmz|kml)$/i, '');
  const ext = file.name.split('.').pop().toLowerCase();

  let kmlText;
  if (ext === 'kmz') {
    const zip = await window.JSZip.loadAsync(file);
    const kmlFile = Object.values(zip.files).find(
      (f) => !f.dir && f.name.toLowerCase().endsWith('.kml')
    );
    if (!kmlFile) throw new Error('No KML file found inside KMZ archive.');
    kmlText = await kmlFile.async('text');
  } else {
    kmlText = await file.text();
  }

  const geojson = kmlToGeoJSON(kmlText);
  const blob = new Blob([geojson], { type: 'application/geo+json' });
  return { blob, name: `${baseName}.geojson` };
}
