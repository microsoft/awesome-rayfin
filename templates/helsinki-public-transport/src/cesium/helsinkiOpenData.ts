/**
 * Open geodata published by the City of Helsinki.
 *
 * Everything here is CC BY 4.0 open data served straight from `kartta.hel.fi`, which sends CORS
 * headers - so the app streams it at runtime with **no Cesium ion token and no Google Maps key**.
 * That keeps the 3D mode licence-clean and free of metered third-party tiles.
 *
 * Source: 3D models of Helsinki, Helsingin kaupunginkanslia, CC BY 4.0.
 * https://hri.fi/data/en_GB/dataset/helsingin-3d-kaupunkimalli
 */

const BASE = 'https://kartta.hel.fi';

/**
 * Textured semantic CityGML LoD2 buildings, as 3D Tiles - the only 3D surface the app offers.
 *
 * The city also publishes photogrammetric reality meshes (`/3d/mesh/Helsinki_<year>/tileset.json`
 * for 2015, 2017 and 2024). They were offered here and have been withdrawn: vehicles are clamped
 * to the *terrain*, not to the mesh, so close in they sank under the photogrammetry and vanished -
 * which is the one thing this app exists to show. The mesh is also far heavier (2024 holds 406 MB
 * of GPU memory against 52 MB for 2017) and slower to settle. These buildings load in ~2.5 s and
 * keep the vehicles visible at every altitude.
 */
export const LOD2_TEXTURED_TILESET =
  `${BASE}/3d/datasource-data/e5e7158a-52df-45a1-9be0-1be8f2828abd/tileset.json`;

/**
 * Not every building in the CityGML dataset carries facade textures. The untextured ones render as
 * pure white boxes that glare next to their textured neighbours, so the tileset is multiplied by a
 * warm stone tint: the blank buildings settle into masonry, and the textured ones only lose a
 * little brightness.
 */
export const BUILDING_TINT = '#b9b1a3';

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
