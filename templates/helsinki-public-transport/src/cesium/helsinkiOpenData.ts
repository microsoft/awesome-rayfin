/**
 * Open geodata published by the City of Helsinki.
 *
 * Everything here is CC BY 4.0 open data served straight from `kartta.hel.fi`, which sends CORS
 * headers - so the app streams it at runtime with **no Cesium ion token and no Google Maps key**.
 * That keeps the photorealistic mode licence-clean and free of metered third-party tiles.
 *
 * Source: 3D models of Helsinki, Helsingin kaupunginkanslia, CC BY 4.0.
 * https://hri.fi/data/en_GB/dataset/helsingin-3d-kaupunkimalli
 */

const BASE = 'https://kartta.hel.fi';

/** Photogrammetric reality mesh, as Cesium 3D Tiles. */
export const MESH_TILESETS = {
  /** Whole city, 42k aerial photos, ~7.5 cm/px ground sample distance. The safe default. */
  '2017': `${BASE}/3d/mesh/Helsinki_2017/tileset.json`,
  /**
   * Newer capture. **Not offered in the UI** - measured from an identical view on a cold cache it
   * holds 406 MB of GPU memory against 52 MB for 2017, settles in 10.6 s against 7.9 s, and costs
   * about a quarter of the frame rate, for detail that is invisible at the altitudes this app is
   * flown at. Kept here so it is one line away if a close-up ever needs the freshest survey.
   */
  '2024': `${BASE}/3d/mesh/Helsinki_2024/tileset.json`,
  /** Whole city, ~10 cm/px - the older, blurrier survey that 2017 replaced. Also not offered. */
  '2015': `${BASE}/3d/mesh/Helsinki_2015/tileset.json`,
} as const;

export type MeshVintage = keyof typeof MESH_TILESETS;

/** Semantic CityGML buildings with textures, as 3D Tiles. Useful when the mesh is switched off. */
export const LOD2_TEXTURED_TILESET =
  `${BASE}/3d/datasource-data/e5e7158a-52df-45a1-9be0-1be8f2828abd/tileset.json`;

/** Park and street trees. */
export const TREES_TILESET =
  `${BASE}/3d/datasource-data/7afdc4b9-9a23-4a6f-a1ae-cf71495a731e/tileset.json`;

/** Quantized-mesh terrain (2021). Replaces Cesium World Terrain, which would need an ion token. */
export const TERRAIN_URL = `${BASE}/3d/datasource-data/4383570b-33a3-4a9f-ae16-93373aff5ffa/`;

/** Orthophoto WMS. `Ortoilmakuva_2025_5cm` is a 5 cm/px true colour image from 2025. */
export const ORTHO_WMS_URL = `${BASE}/ws/geoserver/avoindata/wms`;
export const ORTHO_WMS_LAYER = 'avoindata:Ortoilmakuva_2025_5cm';

export const HELSINKI_ATTRIBUTION =
  'Aerial imagery &amp; 3D models &copy; City of Helsinki (CC BY 4.0) &middot; ' +
  'vehicle data &copy; <a href="https://www.hsl.fi/">HSL</a>';

/** Camera home: central Helsinki, looking north across the South Harbour. */
export const HOME_VIEW = {
  longitude: 24.9484,
  latitude: 60.1553,
  height: 1400,
  heading: 0,
  pitch: -35,
};
