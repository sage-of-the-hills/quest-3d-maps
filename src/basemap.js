// Builds the flat "ground" of the map by stitching raster map tiles into one canvas.
// Tiles: the standard OpenStreetMap tile server (free, no key; please keep usage light
// and keep the attribution visible — see https://operations.osmfoundation.org/policies/tiles/).

import * as THREE from 'three';
import { lonToPx, latToPx } from './geo.js';

const TILE_SOURCES = [
  (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
];

const MAX_CANVAS = 2048;

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('tile failed: ' + url));
    img.src = url;
  });
}

async function loadTile(z, x, y) {
  for (const src of TILE_SOURCES) {
    try {
      return await loadImage(src(z, x, y));
    } catch (e) {
      /* try next source */
    }
  }
  return null;
}

// Returns a THREE.CanvasTexture covering exactly the given bbox.
export async function buildBasemapTexture(bbox, onProgress = () => {}) {
  // Pick the most detailed zoom that still fits in MAX_CANVAS pixels.
  let z = 18;
  while (z > 10 && lonToPx(bbox.east, z) - lonToPx(bbox.west, z) > MAX_CANVAS) z--;

  const x0 = lonToPx(bbox.west, z);
  const x1 = lonToPx(bbox.east, z);
  const y0 = latToPx(bbox.north, z);
  const y1 = latToPx(bbox.south, z);

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(x1 - x0);
  canvas.height = Math.ceil(y1 - y0);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#e8e4dc';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const tiles = [];
  for (let ty = Math.floor(y0 / 256); ty <= Math.floor(y1 / 256); ty++) {
    for (let tx = Math.floor(x0 / 256); tx <= Math.floor(x1 / 256); tx++) tiles.push([tx, ty]);
  }

  let done = 0;
  await Promise.all(
    tiles.map(async ([tx, ty]) => {
      const img = await loadTile(z, tx, ty);
      if (img) ctx.drawImage(img, tx * 256 - x0, ty * 256 - y0, 256, 256);
      onProgress(++done / tiles.length);
    })
  );

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
