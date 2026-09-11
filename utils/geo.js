// utils/geo.js
// Distance between two WGS84 coordinates, in metres (haversine).
//
// Used by the clock-in presence check. Accuracy is plenty for a 150 m geofence:
// haversine assumes a spherical earth and is off by ~0.3% worst case, which at
// this radius is well under a phone's own GPS error.

const EARTH_RADIUS_M = 6371008.8;

const toRad = (deg) => (deg * Math.PI) / 180;

function distanceMeters(lat1, lon1, lat2, lon2) {
  if ([lat1, lon1, lat2, lon2].some((v) => v === null || v === undefined || Number.isNaN(Number(v)))) {
    return null;
  }

  const dLat = toRad(Number(lat2) - Number(lat1));
  const dLon = toRad(Number(lon2) - Number(lon1));
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(Number(lat1))) * Math.cos(toRad(Number(lat2))) * Math.sin(dLon / 2) ** 2;

  return Math.round(EARTH_RADIUS_M * 2 * Math.asin(Math.sqrt(a)));
}

// BSSIDs arrive in inconsistent shapes across Android/iOS APIs (case, and
// sometimes '-' instead of ':'). Compare canonically or a router match fails.
function normalizeBssid(bssid) {
  if (!bssid || typeof bssid !== "string") return null;
  const cleaned = bssid.trim().toLowerCase().replace(/-/g, ":");
  return /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(cleaned) ? cleaned : null;
}

module.exports = { distanceMeters, normalizeBssid };
