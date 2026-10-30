# Quest 3D Maps

A tabletop **3D city map** for the **Meta Quest 3**, running in the Quest Browser with WebXR.
Open a link, press **Enter mixed reality**, and a miniature 3D city sits in your room. You can pan,
zoom and rotate it with your controllers or your bare hands.

Nothing is installed on the headset. The app is a web page, and map data is streamed and kept in
memory only.

**Cities:** London (City of London & Southwark) · Chicago (The Loop) · Thane West, Mumbai

## Try it

1. On your Quest 3, open the **Meta Quest Browser**.
2. Go to the GitHub Pages URL for this repo (`https://<your-user>.github.io/quest-3d-maps/`).
3. Press **Enter mixed reality** (passthrough) or **Enter VR**.

It also works in any desktop browser. Drag to orbit and scroll to zoom.

## Controls in the headset

| Action | Controllers | Hands |
| --- | --- | --- |
| Pan the map | Point at the map, hold trigger and drag | Point, pinch and drag |
| Zoom & rotate | Hold trigger with **both** controllers on the map and pull apart / twist | Pinch with both hands and pull apart / twist |
| Zoom / rotate (quick) | Right thumbstick: up/down zoom, left/right rotate | — |
| Pan (quick) | Left thumbstick | — |
| Move the whole table | Point at the blue bar on the front edge, hold trigger and move | Pinch the blue bar and move |
| Buttons (city, heights, reset, recentre, exit) | Point and press trigger on the panel | Point and pinch |

## How it works

- **Buildings:** footprints and heights from [OpenStreetMap](https://www.openstreetmap.org), fetched live
  from the [Overpass API](https://overpass-api.de). Heights come from the `height` and `building:levels` tags.
  Where these are missing, a per-city default is used (common in Thane, where many buildings don't have
  heights mapped yet).
- **Ground:** standard OpenStreetMap raster tiles stitched into one texture.
- **Rendering:** [three.js](https://threejs.org) with WebXR. All buildings are merged into one mesh for speed, and
  clipping planes keep the city inside the table edges while you pan and zoom.

No build step and no API keys. It's plain HTML and JavaScript modules, with three.js vendored in `vendor/`.

```
index.html          page + import map
style.css           2D page styling
src/main.js         scene, table, XR sessions, controller & hand interaction
src/cities.js       list of cities (add your own here)
src/osm.js          Overpass download + building mesh generation
src/basemap.js      ground map tiles → texture
src/geo.js          lat/lon ↔ metres projection
src/panel.js        in-headset button panel
vendor/three/       three.js (MIT)
```

## Run locally

WebXR needs HTTPS (or `localhost`), so serve the folder rather than opening the file directly:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

To test on the headset from your PC, either push to GitHub Pages or use the Quest's USB debugging with
`adb reverse tcp:8000 tcp:8000` and open `http://localhost:8000` in the Quest Browser.

## Add a city

Add an entry to `src/cities.js`:

```js
{ id: 'paris', name: 'Paris', subtitle: 'Centre', lat: 48.8566, lon: 2.3522, half: 1000, defaultHeight: 18 }
```

`half` is half the width of the loaded square in metres. Keep it around 1,000 for dense cities, because larger
areas mean bigger downloads.

## Ideas / roadmap

- Photorealistic 3D buildings (Google 3D Tiles / Cesium) with an optional API key
- Search for any place, and street-level "walk inside" mode
- Labels for landmarks, satellite ground texture, real-table placement with WebXR hit-test

## Credits & licence

- Code: MIT (see `LICENSE`).
- Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), available under the ODbL.
- three.js © three.js authors, MIT.
