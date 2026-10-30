// Simple local projection: converts lat/lon to metres around a city centre.
// x = east, z = south (so north is -z, matching three.js "forward").
// Accurate enough for a few kilometres, which is all we load at once.

const M_PER_DEG_LAT = 110540;
const M_PER_DEG_LON_EQ = 111320;

export function makeProjection(lat0, lon0) {
  const kx = M_PER_DEG_LON_EQ * Math.cos((lat0 * Math.PI) / 180);
  const kz = M_PER_DEG_LAT;
  return {
    toLocal(lat, lon) {
      return [(lon - lon0) * kx, -(lat - lat0) * kz];
    },
    toLatLon(x, z) {
      return [lat0 - z / kz, lon0 + x / kx];
    },
  };
}

// Square bounding box of +/- `half` metres around the centre.
export function bboxAround(lat0, lon0, half) {
  const dLat = half / M_PER_DEG_LAT;
  const dLon = half / (M_PER_DEG_LON_EQ * Math.cos((lat0 * Math.PI) / 180));
  return { south: lat0 - dLat, west: lon0 - dLon, north: lat0 + dLat, east: lon0 + dLon };
}

// Web-Mercator helpers for map tiles.
export function lonToPx(lon, z) {
  return ((lon + 180) / 360) * 256 * 2 ** z;
}
export function latToPx(lat, z) {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 256 * 2 ** z;
}
