// Project geographic features into SVG path strings for paper-map views.
//
// Two layers shipped:
//   us-states.json — Polygon/MultiPolygon outlines (50 + DC + PR)
//   na-rivers.json — LineString/MultiLineString centerlines for major
//     North American rivers (Natural Earth 1:50m, NA bbox filter)
//
// Each helper filters features whose bbox overlaps the projection's
// bbox (with a configurable pad), then projects each ring/line into
// SVG path strings.

import usStates from '../data/us-states.json';
import naRivers from '../data/na-rivers.json';

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

function flattenCoords(geometry) {
  // Returns a flat array of [lon, lat] pairs across any geometry type.
  switch (geometry.type) {
    case 'Polygon': return geometry.coordinates.flat(1);
    case 'MultiPolygon': return geometry.coordinates.flat(2);
    case 'LineString': return geometry.coordinates;
    case 'MultiLineString': return geometry.coordinates.flat(1);
    default: return [];
  }
}

function featureBbox(feature) {
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const [lon, lat] of flattenCoords(feature.geometry)) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return [minLon, minLat, maxLon, maxLat];
}

function lineToPath(line, project) {
  if (!line?.length) return '';
  return line
    .map(([lon, lat], i) => {
      const [x, y] = project(lat, lon);
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
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

/**
 * Return river path strings + metadata (name, min_zoom) for rivers that
 * overlap the projection's bbox. `maxZoom` lets callers hide smaller
 * streams on tighter maps where they'd clutter the picture.
 */
export function riverPaths(projection, { padDegrees = 0.8, maxZoom = 5 } = {}) {
  if (!projection?.bbox) return [];
  const rivers = [];
  for (const feature of naRivers.features) {
    const z = feature.properties?.min_zoom;
    if (typeof z === 'number' && z > maxZoom) continue;
    const fbbox = featureBbox(feature);
    if (!bboxIntersects(projection.bbox, fbbox, padDegrees)) continue;
    const g = feature.geometry;
    if (g.type === 'LineString') {
      rivers.push({
        name: feature.properties?.name,
        zoom: z,
        path: lineToPath(g.coordinates, projection.project),
      });
    } else if (g.type === 'MultiLineString') {
      for (const line of g.coordinates) {
        rivers.push({
          name: feature.properties?.name,
          zoom: z,
          path: lineToPath(line, projection.project),
        });
      }
    }
  }
  return rivers;
}
