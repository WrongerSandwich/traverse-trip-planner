// Project US state outlines into SVG path strings for a paper-map view.
//
// usStates.json is a GeoJSON FeatureCollection of state polygons (50 +
// DC + Puerto Rico) sourced from US Census Bureau public-domain
// cartographic boundary files. We filter to states whose bbox overlaps
// the projection's bbox (with a generous pad), then project each ring
// into SVG path strings.

import usStates from '../data/us-states.json';

function ringPath(ring, project) {
  // GeoJSON rings are [[lon, lat], …]. The first/last point repeats.
  if (!ring?.length) return '';
  return ring
    .map(([lon, lat], i) => {
      const [x, y] = project(lat, lon);
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ') + ' Z';
}

/**
 * Cheap rectangle-overlap test in [lon, lat] space, padded so we keep
 * states that are close enough to the viewport to read as terrain.
 */
function bboxIntersects(bbox, [minLon, minLat, maxLon, maxLat], pad) {
  return !(
    maxLon < bbox.minLon - pad ||
    minLon > bbox.maxLon + pad ||
    maxLat < bbox.minLat - pad ||
    minLat > bbox.maxLat + pad
  );
}

function featureBbox(feature) {
  const coords = feature.geometry.type === 'MultiPolygon'
    ? feature.geometry.coordinates.flat(2)
    : feature.geometry.coordinates.flat(1);
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const [lon, lat] of coords) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return [minLon, minLat, maxLon, maxLat];
}

/**
 * Return an array of SVG path strings (one per polygon ring) for all
 * US state outlines that overlap the projection's bbox.
 */
export function stateOutlinePaths(projection, { padDegrees = 1.5 } = {}) {
  if (!projection?.bbox) return [];
  const paths = [];
  for (const feature of usStates.features) {
    const fbbox = featureBbox(feature);
    if (!bboxIntersects(projection.bbox, fbbox, padDegrees)) continue;
    const g = feature.geometry;
    if (g.type === 'Polygon') {
      for (const ring of g.coordinates) paths.push(ringPath(ring, projection.project));
    } else if (g.type === 'MultiPolygon') {
      for (const poly of g.coordinates) for (const ring of poly) paths.push(ringPath(ring, projection.project));
    }
  }
  return paths;
}
