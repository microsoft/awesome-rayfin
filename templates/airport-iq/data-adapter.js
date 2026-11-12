/*
 * data-adapter.js — the single data seam for the Airport IQ views.
 *
 * Every view loads its data through this adapter so the *source* is a config switch,
 * not a code fork. Resolution order for the mode:
 *     ?data=<mode> URL param  →  window.AIQ_DATA_MODE  →  default 'synthetic'
 *
 * Modes:
 *   synthetic (default) — baked JSON shipped in each view's ./data folder. No network,
 *                         nothing external. This is what the template runs on out of the box.
 *   live                — Live Approach aircraft come from the public airplanes.live ADS-B
 *                         API; on failure it falls back to the baked ./data/live.json sample.
 *   fabric              — Bring-your-own data: the operations snapshot is served from *your*
 *                         Fabric warehouse / lakehouse (via a Rayfin data service or a User
 *                         Data Function that returns the same snapshot shape). v1 ships this as
 *                         a documented hook: set window.AIQ_FABRIC_SNAPSHOT_URL to your endpoint;
 *                         if unset it transparently falls back to the baked snapshot.
 *
 * Loaded as a classic <script> before each view's main script, so window.AIQ_DATA is ready
 * before either the CesiumJS (classic) or Three.js (module) view code runs.
 */
(function () {
  var params = new URLSearchParams(location.search);
  var MODE = (params.get('data') || window.AIQ_DATA_MODE || 'synthetic').toLowerCase();
  if (MODE !== 'live' && MODE !== 'fabric') MODE = 'synthetic';

  var ADSB_ENDPOINT = 'https://api.airplanes.live/v2/point';

  function loadJSON(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('fetch failed: ' + url);
      return r.json();
    });
  }

  // Live Approach aircraft. Returns { source, aircraft }.
  //   source: 'live' | 'synthetic' | 'sample' | 'none'
  function loadLiveAircraft(ap, radiusNm) {
    function baked() {
      return loadJSON('./data/live.json?t=' + Date.now()).then(function (j) {
        var arr = (j.aircraft || []).map(function (a) {
          return { hex: a.fl || Math.random().toString(36).slice(2), lat: a.lat, lon: a.lon,
            ground: false, alt: +a.alt || 0, trk: a.trk, gs: a.gs, fl: a.fl, ty: a.ty };
        });
        return { source: MODE === 'live' ? 'sample' : 'synthetic', aircraft: arr };
      }).catch(function () { return { source: 'none', aircraft: null }; });
    }
    if (MODE !== 'live') return baked();               // synthetic / fabric → no external call
    return fetch(ADSB_ENDPOINT + '/' + ap.lat + '/' + ap.lon + '/' + radiusNm)
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        var ac = ((j && j.ac) || []).filter(function (a) { return a.lat != null && a.lon != null; })
          .map(function (a) {
            return { hex: a.hex, lat: a.lat, lon: a.lon,
              ground: a.alt_baro === 'ground',
              alt: a.alt_baro === 'ground' ? 0 : (+a.alt_baro || 0),
              trk: a.track != null ? a.track : a.true_heading, gs: a.gs,
              fl: (a.flight || '').trim(), ty: a.t };
          }).slice(0, 600);
        if (ac.length) return { source: 'live', aircraft: ac };
        return baked();                                // live reachable but empty → sample
      })
      .catch(function () { return baked(); });          // live unreachable → sample
  }

  // Geometry (OSM buildings / runways / gates) — always baked; the view passes its ./data URL.
  function getGeometry(url) { return loadJSON(url); }

  // Operations snapshot — baked by default; in 'fabric' mode read your own endpoint if set.
  function getSnapshot(url) {
    if (MODE === 'fabric' && window.AIQ_FABRIC_SNAPSHOT_URL) {
      return loadJSON(window.AIQ_FABRIC_SNAPSHOT_URL).catch(function () { return loadJSON(url); });
    }
    return loadJSON(url);
  }

  window.AIQ_DATA = {
    mode: MODE,
    loadLiveAircraft: loadLiveAircraft,
    getGeometry: getGeometry,
    getSnapshot: getSnapshot
  };
})();
