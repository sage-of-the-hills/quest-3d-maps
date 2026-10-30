// Quest 3D Maps — a tabletop 3D city map for Meta Quest (WebXR) and desktop browsers.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CITIES, getCity } from './cities.js';
import { makeProjection, bboxAround } from './geo.js';
import { fetchBuildings, buildBuildingGeometry } from './osm.js';
import { buildBasemapTexture } from './basemap.js';
import { Panel } from './panel.js';

// ---------------------------------------------------------------- setup

const TABLE = 0.9; // width of the tabletop map, in metres
const TABLE_HEIGHT_DESKTOP = 0.8;
const BG = new THREE.Color('#0d1320');

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
renderer.localClippingEnabled = true;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = BG;

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.01, 200);
camera.position.set(0, 1.45, 0.95);

const orbit = new OrbitControls(camera, renderer.domElement);
orbit.target.set(0, TABLE_HEIGHT_DESKTOP, 0);
orbit.enableDamping = true;
orbit.minDistance = 0.15;
orbit.maxDistance = 4;
orbit.maxPolarAngle = Math.PI * 0.49;
orbit.update();

scene.add(new THREE.HemisphereLight(0xffffff, 0x4a5568, 1.7));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(0.6, 1.2, 0.4);
scene.add(sun);

// Simple room for VR / desktop (hidden in AR so you see your real room).
const environment = new THREE.Group();
const grid = new THREE.GridHelper(20, 40, 0x2a3a55, 0x1a2538);
environment.add(grid);
scene.add(environment);

// ---------------------------------------------------------------- the table

const table = new THREE.Group();
table.position.set(0, TABLE_HEIGHT_DESKTOP, 0);
scene.add(table);

const base = new THREE.Mesh(
  new THREE.BoxGeometry(TABLE + 0.04, 0.03, TABLE + 0.04),
  new THREE.MeshLambertMaterial({ color: 0x1b2436 })
);
base.position.y = -0.0155;
table.add(base);

const handle = new THREE.Mesh(
  new THREE.CylinderGeometry(0.014, 0.014, 0.36, 20),
  new THREE.MeshLambertMaterial({ color: 0x3d7eff, emissive: 0x0b1a40 })
);
handle.rotation.z = Math.PI / 2;
handle.position.set(0, -0.01, TABLE / 2 + 0.055);
handle.name = 'handle';
table.add(handle);

const content = new THREE.Group(); // ground + buildings; panned / zoomed inside the table
table.add(content);

const panel = new Panel();
panel.mesh.position.set(0, 0.14, -TABLE / 2 - 0.04);
panel.mesh.rotation.x = -0.28;
table.add(panel.mesh);

// Clip everything in `content` to the square of the table.
const localPlanes = [
  new THREE.Plane(new THREE.Vector3(1, 0, 0), TABLE / 2),
  new THREE.Plane(new THREE.Vector3(-1, 0, 0), TABLE / 2),
  new THREE.Plane(new THREE.Vector3(0, 0, 1), TABLE / 2),
  new THREE.Plane(new THREE.Vector3(0, 0, -1), TABLE / 2),
];
const clipPlanes = localPlanes.map((p) => p.clone());
function updateClipPlanes() {
  table.updateMatrixWorld();
  localPlanes.forEach((p, i) => clipPlanes[i].copy(p).applyMatrix4(table.matrixWorld));
}

// ---------------------------------------------------------------- view state (pan / zoom / rotate)

const view = { tx: 0, tz: 0, rot: 0, scale: 1, exag: 1, half: 1000 };

function rotY(x, z, a) {
  // Same convention as three.js rotation.y
  const c = Math.cos(a), s = Math.sin(a);
  return [x * c + z * s, -x * s + z * c];
}
const angleOf = (x, z) => Math.atan2(-z, x);

function resetView() {
  view.scale = TABLE / (2 * view.half);
  view.tx = view.tz = view.rot = 0;
  applyView();
}

function clampView() {
  const s0 = TABLE / (2 * view.half);
  view.scale = THREE.MathUtils.clamp(view.scale, s0 * 0.7, s0 * 30);
  // keep the centre of the table inside the loaded area
  let [mx, mz] = rotY(-view.tx, -view.tz, -view.rot);
  mx /= view.scale;
  mz /= view.scale;
  mx = THREE.MathUtils.clamp(mx, -view.half, view.half);
  mz = THREE.MathUtils.clamp(mz, -view.half, view.half);
  const [tx, tz] = rotY(mx * view.scale, mz * view.scale, view.rot);
  view.tx = -tx;
  view.tz = -tz;
}

function applyView() {
  clampView();
  content.position.set(view.tx, 0.0006, view.tz);
  content.rotation.y = view.rot;
  content.scale.set(view.scale, view.scale * view.exag, view.scale);
}

// zoom by `f` and rotate by `da` around table-local point (cx, cz)
function zoomRotateAround(cx, cz, f, da, ncx = cx, ncz = cz) {
  const [rx, rz] = rotY((view.tx - cx) * f, (view.tz - cz) * f, da);
  view.tx = ncx + rx;
  view.tz = ncz + rz;
  view.rot += da;
  view.scale *= f;
}

// ---------------------------------------------------------------- loading cities

const ui = {
  status: document.getElementById('status'),
  cityName: document.getElementById('city-name'),
  cityButtons: document.getElementById('city-buttons'),
  heightBtn: document.getElementById('btn-height'),
  resetBtn: document.getElementById('btn-reset'),
  arBtn: document.getElementById('btn-ar'),
  vrBtn: document.getElementById('btn-vr'),
  xrNote: document.getElementById('xr-note'),
};

let currentCity = null;
let loadToken = 0;
let abortCtl = null;
const cache = new Map(); // city id → { osm, texture } (memory only, nothing stored on the device)

function setStatus(text) {
  ui.status.textContent = text;
  refreshPanel(text);
}

function refreshPanel(statusText = ui.status.textContent) {
  panel.setText(currentCity ? currentCity.name : 'Quest 3D Maps', statusText);
}

function clearContent() {
  for (const child of [...content.children]) {
    content.remove(child);
    child.geometry?.dispose();
    child.material?.dispose();
  }
}

async function loadCity(id) {
  const city = getCity(id);
  const token = ++loadToken;
  abortCtl?.abort();
  abortCtl = new AbortController();

  currentCity = city;
  view.half = city.half;
  resetView();
  clearContent();
  updateCityButtons();
  ui.cityName.textContent = `${city.name} — ${city.subtitle}`;
  history.replaceState(null, '', `?city=${city.id}`);
  setStatus('Loading map…');

  const projection = makeProjection(city.lat, city.lon);
  const bbox = bboxAround(city.lat, city.lon, city.half);
  const cached = cache.get(city.id) || {};
  cache.set(city.id, cached);

  // 1) ground map tiles
  const groundPromise = (async () => {
    cached.texture ||= await buildBasemapTexture(bbox, (p) => {
      if (token === loadToken && !cached.osm) setStatus(`Loading map… ${Math.round(p * 100)}%`);
    });
    if (token !== loadToken) return;
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(city.half * 2, city.half * 2).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: cached.texture, clippingPlanes: clipPlanes })
    );
    ground.name = 'ground';
    content.add(ground);
  })();

  // 2) buildings
  try {
    if (!cached.osm) {
      setStatus('Downloading buildings…');
      cached.osm = await fetchBuildings(bbox, { signal: abortCtl.signal });
    }
    if (token !== loadToken) return;
    setStatus('Building 3D city…');
    await new Promise((r) => setTimeout(r, 30)); // let the status repaint
    const { geometry, count, tallest } = buildBuildingGeometry(cached.osm, projection, city.defaultHeight);
    if (token !== loadToken) return;
    const buildings = new THREE.Mesh(
      geometry,
      new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, clippingPlanes: clipPlanes })
    );
    buildings.name = 'buildings';
    content.add(buildings);
    await groundPromise;
    setStatus(`${count.toLocaleString()} buildings · tallest ${Math.round(tallest.h)} m`);
  } catch (e) {
    if (token !== loadToken) return;
    console.error(e);
    await groundPromise.catch(() => {});
    setStatus('Could not load buildings — try again');
  }
}

// ---------------------------------------------------------------- buttons (web page + in-headset panel)

function cycleHeight() {
  view.exag = view.exag >= 3 ? 1 : view.exag + 1;
  applyView();
  updateCityButtons();
}

function updateCityButtons() {
  ui.cityButtons.querySelectorAll('button').forEach((b) =>
    b.classList.toggle('active', b.dataset.city === currentCity?.id)
  );
  ui.heightBtn.textContent = `Heights ×${view.exag}`;
  panel.setButtons([
    ...CITIES.map((c) => ({ id: 'city:' + c.id, label: c.name, row: 0, active: c.id === currentCity?.id })),
    { id: 'height', label: `Heights ×${view.exag}`, row: 1 },
    { id: 'reset', label: 'Reset map', row: 1 },
    { id: 'recentre', label: 'Recentre', row: 1 },
    { id: 'exit', label: 'Exit', row: 1 },
  ]);
  refreshPanel();
}

function onPanelButton(id) {
  if (id.startsWith('city:')) loadCity(id.slice(5));
  else if (id === 'height') cycleHeight();
  else if (id === 'reset') resetView();
  else if (id === 'recentre') needsPlacement = 3;
  else if (id === 'exit') renderer.xr.getSession()?.end();
}

for (const c of CITIES) {
  const b = document.createElement('button');
  b.textContent = c.name;
  b.dataset.city = c.id;
  b.onclick = () => loadCity(c.id);
  ui.cityButtons.appendChild(b);
}
ui.heightBtn.onclick = cycleHeight;
ui.resetBtn.onclick = resetView;

// ---------------------------------------------------------------- XR sessions

let needsPlacement = 0;

async function startSession(mode) {
  try {
    const session = await navigator.xr.requestSession(mode, {
      requiredFeatures: ['local-floor'],
      optionalFeatures: ['hand-tracking'],
    });
    renderer.xr.setReferenceSpaceType('local-floor');
    await renderer.xr.setSession(session);
    const ar = mode === 'immersive-ar';
    scene.background = ar ? null : BG;
    environment.visible = !ar;
    needsPlacement = 3;
    session.addEventListener('end', () => {
      scene.background = BG;
      environment.visible = true;
      table.position.set(0, TABLE_HEIGHT_DESKTOP, 0);
      table.rotation.set(0, 0, 0);
    });
  } catch (e) {
    console.error(e);
    alert('Could not start ' + (mode === 'immersive-ar' ? 'mixed reality' : 'VR') + ': ' + e.message);
  }
}

async function setupXRButtons() {
  if (!navigator.xr) {
    ui.xrNote.hidden = false;
    return;
  }
  const [ar, vr] = await Promise.all([
    navigator.xr.isSessionSupported('immersive-ar').catch(() => false),
    navigator.xr.isSessionSupported('immersive-vr').catch(() => false),
  ]);
  ui.arBtn.hidden = !ar;
  ui.vrBtn.hidden = !vr;
  ui.xrNote.hidden = ar || vr;
  ui.arBtn.onclick = () => startSession('immersive-ar');
  ui.vrBtn.onclick = () => startSession('immersive-vr');
}

const _camPos = new THREE.Vector3();
const _camDir = new THREE.Vector3();
function placeTableInFrontOfUser() {
  const xrCam = renderer.xr.getCamera();
  xrCam.getWorldPosition(_camPos);
  xrCam.getWorldDirection(_camDir);
  _camDir.y = 0;
  if (_camDir.lengthSq() < 1e-4) _camDir.set(0, 0, -1);
  _camDir.normalize();
  const yaw = Math.atan2(-_camDir.x, -_camDir.z);
  table.position.set(_camPos.x + _camDir.x * 0.7, Math.max(0.45, _camPos.y - 0.6), _camPos.z + _camDir.z * 0.7);
  table.rotation.set(0, yaw, 0);
}

// ---------------------------------------------------------------- controllers & hands

const raycaster = new THREE.Raycaster();
const _m = new THREE.Matrix4();
const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
const _p = new THREE.Vector3();
const tablePlane = new THREE.Plane();

const rayGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
const controllers = [0, 1].map((i) => {
  const c = renderer.xr.getController(i);
  const line = new THREE.Line(rayGeo, new THREE.LineBasicMaterial({ color: 0x9cc3ff, transparent: true, opacity: 0.8 }));
  line.scale.z = 1.5;
  line.visible = false;
  c.add(line);
  c.userData = { line, mode: null, last: null, inputSource: null };
  c.addEventListener('connected', (e) => {
    c.userData.inputSource = e.data;
    line.visible = true;
  });
  c.addEventListener('disconnected', () => {
    c.userData.inputSource = null;
    c.userData.mode = null;
    line.visible = false;
  });
  c.addEventListener('selectstart', () => onSelectStart(c));
  c.addEventListener('selectend', () => (c.userData.mode = null));
  scene.add(c);
  return c;
});

// Show tracked hands as small spheres on each joint.
const jointGeo = new THREE.SphereGeometry(0.007, 10, 8);
const jointMat = new THREE.MeshLambertMaterial({ color: 0xdfe8ff });
const hands = [0, 1].map((i) => {
  const h = renderer.xr.getHand(i);
  scene.add(h);
  return h;
});
function updateHandVisuals() {
  for (const h of hands) {
    for (const j of Object.values(h.joints || {})) {
      if (!j.userData.sphere) {
        j.userData.sphere = new THREE.Mesh(jointGeo, jointMat);
        j.add(j.userData.sphere);
      }
    }
  }
}

function setRay(c) {
  _m.identity().extractRotation(c.matrixWorld);
  raycaster.ray.origin.setFromMatrixPosition(c.matrixWorld);
  raycaster.ray.direction.set(0, 0, -1).applyMatrix4(_m);
}

// Ray → point on the table surface, in table-local coordinates (or null)
function tableHit(c) {
  setRay(c);
  table.updateMatrixWorld();
  _o.set(0, 0, 0).applyMatrix4(table.matrixWorld);
  _d.set(0, 1, 0).transformDirection(table.matrixWorld);
  tablePlane.setFromNormalAndCoplanarPoint(_d, _o);
  if (!raycaster.ray.intersectPlane(tablePlane, _p)) return null;
  const dist = _p.distanceTo(raycaster.ray.origin);
  table.worldToLocal(_p);
  return { x: _p.x, z: _p.z, dist, inside: Math.abs(_p.x) <= TABLE / 2 && Math.abs(_p.z) <= TABLE / 2 };
}

function onSelectStart(c) {
  setRay(c);
  const hits = raycaster.intersectObjects([panel.mesh, handle], false);
  if (hits.length && hits[0].object === panel.mesh) {
    const id = panel.buttonAt(hits[0].uv);
    if (id) onPanelButton(id);
    c.userData.mode = 'button';
    return;
  }
  if (hits.length && hits[0].object === handle) {
    const cp = new THREE.Vector3().setFromMatrixPosition(c.matrixWorld);
    const cy = yawOf(c);
    const off = table.position.clone().sub(cp);
    c.userData.grab = {
      offset: off.applyAxisAngle(THREE.Object3D.DEFAULT_UP, -cy),
      yawOffset: table.rotation.y - cy,
    };
    c.userData.mode = 'moveTable';
    return;
  }
  const h = tableHit(c);
  if (h && h.inside) {
    c.userData.mode = 'drag';
    c.userData.last = h;
  }
}

const _fwd = new THREE.Vector3();
function yawOf(obj) {
  _fwd.set(0, 0, -1).transformDirection(obj.matrixWorld);
  return Math.atan2(-_fwd.x, -_fwd.z);
}

function updateControllers(dt) {
  const hovered = new Set();

  for (const c of controllers) {
    if (!c.userData.inputSource) continue;
    setRay(c);
    const hits = raycaster.intersectObjects([panel.mesh, handle], false);
    let len = 1.5;
    if (hits.length) {
      len = hits[0].distance;
      if (hits[0].object === panel.mesh) {
        const id = panel.buttonAt(hits[0].uv);
        if (id) hovered.add(id);
      }
    } else {
      const th = tableHit(c);
      if (th && th.inside) len = th.dist;
    }
    c.userData.line.scale.z = len;

    // move the whole table
    if (c.userData.mode === 'moveTable') {
      const cp = new THREE.Vector3().setFromMatrixPosition(c.matrixWorld);
      const cy = yawOf(c);
      const off = c.userData.grab.offset.clone().applyAxisAngle(THREE.Object3D.DEFAULT_UP, cy);
      table.position.copy(cp.add(off));
      table.position.y = Math.max(0.1, table.position.y);
      table.rotation.set(0, cy + c.userData.grab.yawOffset, 0);
    }

    // thumbsticks
    const gp = c.userData.inputSource.gamepad;
    if (gp && gp.axes.length >= 4) {
      const ax = Math.abs(gp.axes[2]) > 0.15 ? gp.axes[2] : 0;
      const ay = Math.abs(gp.axes[3]) > 0.15 ? gp.axes[3] : 0;
      if (ax || ay) {
        if (c.userData.inputSource.handedness === 'left') {
          view.tx -= ax * dt * 0.35;
          view.tz -= ay * dt * 0.35;
        } else {
          zoomRotateAround(0, 0, Math.exp(-ay * dt * 1.6), -ax * dt * 1.4);
        }
        applyView();
      }
    }
  }
  panel.setHovered(hovered);

  // drag with one hand = pan, two hands = zoom + rotate
  const dragging = controllers.filter((c) => c.userData.mode === 'drag');
  const now = dragging.map((c) => tableHit(c));
  if (dragging.length === 1 && now[0]) {
    const p = dragging[0].userData.last;
    view.tx += now[0].x - p.x;
    view.tz += now[0].z - p.z;
    applyView();
  } else if (dragging.length === 2 && now[0] && now[1]) {
    const [p1, p2] = dragging.map((c) => c.userData.last);
    const [q1, q2] = now;
    const dp = Math.hypot(p2.x - p1.x, p2.z - p1.z);
    const dq = Math.hypot(q2.x - q1.x, q2.z - q1.z);
    if (dp > 0.01 && dq > 0.01) {
      const da = angleOf(q2.x - q1.x, q2.z - q1.z) - angleOf(p2.x - p1.x, p2.z - p1.z);
      zoomRotateAround((p1.x + p2.x) / 2, (p1.z + p2.z) / 2, dq / dp, da, (q1.x + q2.x) / 2, (q1.z + q2.z) / 2);
      applyView();
    }
  }
  dragging.forEach((c, i) => now[i] && (c.userData.last = now[i]));
}

// ---------------------------------------------------------------- render loop

let lastTime = performance.now();
renderer.setAnimationLoop((time = performance.now()) => {
  const dt = Math.min((time - lastTime) / 1000, 0.1);
  lastTime = time;
  if (renderer.xr.isPresenting) {
    if (needsPlacement > 0 && --needsPlacement === 0) placeTableInFrontOfUser();
    updateControllers(dt);
    updateHandVisuals();
  } else {
    orbit.update();
  }
  updateClipPlanes();
  renderer.render(scene, camera);
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------- start

// handy for debugging from the browser console
window.questMaps = { view, applyView, resetView, loadCity };

setupXRButtons();
const startId = new URLSearchParams(location.search).get('city') || 'london';
loadCity(startId);
updateCityButtons();
