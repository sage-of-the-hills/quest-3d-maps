// Downloads building footprints from OpenStreetMap (via the Overpass API)
// and turns them into a single, efficient 3D mesh.

import * as THREE from 'three';

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

export async function fetchBuildings(bbox, { signal } = {}) {
  const b = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  const query = `[out:json][timeout:90];
(
  way["building"](${b});
  relation["building"]["type"="multipolygon"](${b});
);
out body geom qt;`;

  let lastError;
  for (const url of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        body: 'data=' + encodeURIComponent(query),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        signal,
      });
      if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (signal?.aborted) throw e;
      lastError = e;
      console.warn('Overpass endpoint failed, trying next', e);
    }
  }
  throw lastError || new Error('All Overpass servers failed');
}

// ---------- tag parsing ----------

function parseLength(v) {
  if (v == null) return NaN;
  const s = String(v).trim().toLowerCase();
  const n = parseFloat(s.replace(',', '.'));
  if (Number.isNaN(n)) return NaN;
  if (s.endsWith("'") || s.includes('ft') || s.includes('feet')) return n * 0.3048;
  return n;
}

function buildingHeights(tags, defaultHeight) {
  const LEVEL = 3.2;
  let h = parseLength(tags.height);
  const levels = parseFloat(tags['building:levels']);
  const roofLevels = parseFloat(tags['roof:levels']) || 0;
  if (Number.isNaN(h) && !Number.isNaN(levels)) h = (levels + roofLevels) * LEVEL;
  if (Number.isNaN(h) || h <= 0) h = defaultHeight;

  let min = parseLength(tags.min_height);
  const minLevel = parseFloat(tags['building:min_level']);
  if (Number.isNaN(min) && !Number.isNaN(minLevel)) min = minLevel * LEVEL;
  if (Number.isNaN(min) || min < 0 || min >= h) min = 0;

  return { min, h: Math.min(h, 900) };
}

// ---------- geometry helpers ----------

function signedArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, z1] = ring[i];
    const [x2, z2] = ring[(i + 1) % ring.length];
    a += x1 * z2 - x2 * z1;
  }
  return a / 2;
}

function cleanRing(points) {
  const ring = [];
  for (const p of points) {
    const last = ring[ring.length - 1];
    if (!last || Math.abs(last[0] - p[0]) > 1e-3 || Math.abs(last[1] - p[1]) > 1e-3) ring.push(p);
  }
  if (ring.length > 1) {
    const f = ring[0], l = ring[ring.length - 1];
    if (Math.abs(f[0] - l[0]) < 1e-3 && Math.abs(f[1] - l[1]) < 1e-3) ring.pop();
  }
  return ring.length >= 3 ? ring : null;
}

// Join the way-segments of a multipolygon relation into closed rings.
function joinRings(segments) {
  const key = (p) => `${p.lat.toFixed(7)},${p.lon.toFixed(7)}`;
  const rest = segments.filter((s) => s && s.length > 1).map((s) => s.slice());
  const rings = [];
  while (rest.length) {
    let ring = rest.shift();
    let guard = 0;
    while (key(ring[0]) !== key(ring[ring.length - 1]) && guard++ < 1000) {
      const endK = key(ring[ring.length - 1]);
      const i = rest.findIndex((s) => key(s[0]) === endK || key(s[s.length - 1]) === endK);
      if (i < 0) break;
      const seg = rest.splice(i, 1)[0];
      if (key(seg[0]) !== endK) seg.reverse();
      ring = ring.concat(seg.slice(1));
    }
    rings.push(ring);
  }
  return rings;
}

const colLow = new THREE.Color('#f1ece2');
const colMid = new THREE.Color('#c9d6e3');
const colHigh = new THREE.Color('#6f9fd8');
const tmpCol = new THREE.Color();

function colourForHeight(h) {
  if (h < 40) return tmpCol.copy(colLow).lerp(colMid, h / 40);
  return tmpCol.copy(colMid).lerp(colHigh, Math.min(1, (h - 40) / 160));
}

// Turns Overpass JSON into one BufferGeometry (in metres, y = up).
export function buildBuildingGeometry(osm, projection, defaultHeight) {
  const pos = [];
  const col = [];
  let count = 0;
  let tallest = { h: 0, name: '' };

  const toRing = (geom) => cleanRing(geom.filter(Boolean).map((g) => projection.toLocal(g.lat, g.lon)));

  const addPolygon = (outer, holes, min, h) => {
    if (signedArea(outer) > 0) outer.reverse();
    holes.forEach((r) => signedArea(r) < 0 && r.reverse());

    const c = colourForHeight(h);
    const wall = [c.r * 0.92, c.g * 0.92, c.b * 0.92];
    const roof = [Math.min(1, c.r * 1.05), Math.min(1, c.g * 1.05), Math.min(1, c.b * 1.05)];

    // walls
    for (const ring of [outer, ...holes]) {
      for (let i = 0; i < ring.length; i++) {
        const [px, pz] = ring[i];
        const [qx, qz] = ring[(i + 1) % ring.length];
        pos.push(px, min, pz, qx, min, qz, qx, h, qz, px, min, pz, qx, h, qz, px, h, pz);
        for (let k = 0; k < 6; k++) col.push(...wall);
      }
    }

    // roof
    const contour = outer.map(([x, z]) => new THREE.Vector2(x, z));
    const holeVecs = holes.map((r) => r.map(([x, z]) => new THREE.Vector2(x, z)));
    const all = contour.concat(...holeVecs);
    const tris = THREE.ShapeUtils.triangulateShape(contour, holeVecs);
    for (const [a, b, cc] of tris) {
      const A = all[a], B = all[b], C = all[cc];
      // make the roof face upwards (+y)
      const ny = (B.y - A.y) * (C.x - A.x) - (B.x - A.x) * (C.y - A.y);
      const order = ny >= 0 ? [A, B, C] : [A, C, B];
      for (const v of order) {
        pos.push(v.x, h, v.y);
        col.push(...roof);
      }
    }
  };

  for (const el of osm.elements || []) {
    const tags = el.tags || {};
    if (!tags.building || tags.building === 'no') continue;
    const { min, h } = buildingHeights(tags, defaultHeight);

    try {
      if (el.type === 'way' && el.geometry) {
        const ring = toRing(el.geometry);
        if (!ring) continue;
        addPolygon(ring, [], min, h);
      } else if (el.type === 'relation' && el.members) {
        const outers = joinRings(el.members.filter((m) => m.role === 'outer').map((m) => m.geometry))
          .map(toRing).filter(Boolean);
        const inners = joinRings(el.members.filter((m) => m.role === 'inner').map((m) => m.geometry))
          .map(toRing).filter(Boolean);
        if (!outers.length) continue;
        // Assign every inner ring to the first outer ring (good enough for buildings).
        outers.forEach((o, i) => addPolygon(o, i === 0 ? inners : [], min, h));
      } else continue;
    } catch (e) {
      continue; // skip broken shapes
    }
    count++;
    if (h > tallest.h) tallest = { h, name: tags.name || tags['addr:street'] || '' };
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals(); // non-indexed → flat face normals
  geo.computeBoundingSphere();
  return { geometry: geo, count, tallest };
}
