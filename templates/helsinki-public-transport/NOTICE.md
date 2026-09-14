# Third-party data and software notices

This sample is licensed under the MIT License (see [LICENSE](LICENSE)). It renders data it
does not own. Everything below is public open data or open source, fetched at runtime
directly from the publisher - nothing is redistributed in this repository.

## Data

### HSL real-time vehicle positions and trip updates

- Publisher: Helsingin seudun liikenne / Helsinki Region Transport (HSL)
- Endpoints: `https://realtime.hsl.fi/realtime/vehicle-positions/v2/hsl`,
  `https://realtime.hsl.fi/realtime/trip-updates/v2/hsl`
- Format: GTFS Realtime (protocol buffers)
- Licence: Creative Commons Attribution 4.0 International (CC BY 4.0)
- Attribution: "Contains data from HSL, licensed under CC BY 4.0."
- No API key is required. The feed is polled by the ingestion notebook in `fabric/notebook/`,
  never by the browser.

### City of Helsinki 3D city model, terrain and orthophoto

- Publisher: Helsingin kaupunki / City of Helsinki
- Endpoints: `https://kartta.hel.fi/3d/...` (textured LoD2 CityGML buildings, quantized-mesh
  terrain) and `https://kartta.hel.fi/ws/geoserver/avoindata/wms` (orthophoto)
- Licence: Creative Commons Attribution 4.0 International (CC BY 4.0)
- Attribution: "Imagery & 3D models (c) City of Helsinki (CC BY 4.0)." - shown in the app
  whenever the 3D view is active.
- The endpoints are CORS-enabled and require no key or token. The app streams the tiles
  directly from the city; no copy is stored here.

## Software

| Component | Licence |
| --- | --- |
| [CesiumJS](https://cesium.com/platform/cesiumjs/) | Apache-2.0 |
| [Leaflet](https://leafletjs.com/) | BSD-2-Clause |
| [React](https://react.dev/) | MIT |
| [MSAL for JavaScript](https://github.com/AuthJS/microsoft-authentication-library-for-js) | MIT |
| [Tailwind CSS](https://tailwindcss.com/) | MIT |
| [Vite](https://vite.dev/) | MIT |

CesiumJS is used **without a Cesium ion account**. `Ion.defaultAccessToken` is deliberately
left empty and every tileset, terrain provider and imagery layer points at a City of Helsinki
endpoint, so the app has no dependency on a commercial basemap subscription.

OpenStreetMap tiles are used for the 2D map view - (c) OpenStreetMap contributors,
[ODbL](https://www.openstreetmap.org/copyright).
