// middleware/cacheControl.js
//
// Lets the client's HTTP cache answer repeat GETs for rarely-changing lists so
// they never reach the droplet at all. Only mount this on endpoints where a few
// seconds of staleness is harmless (categories, branches) -- never on stock,
// sales or dashboard numbers.
//
// `private`  -> keeps authenticated responses out of shared caches (Caddy/CDN).
// `Vary: Authorization` -> one user's copy is never served to another user.
// `stale-while-revalidate` -> the client paints the cached copy instantly and
//   refreshes in the background, so at most one render is stale.
//
// Only GET/HEAD are tagged; the header is skipped on writes so a POST/PUT
// response is never cached.
function cacheFor(maxAgeSeconds, staleWhileRevalidateSeconds = maxAgeSeconds * 4) {
  return (req, res, next) => {
    if (req.method === "GET" || req.method === "HEAD") {
      res.set(
        "Cache-Control",
        `private, max-age=${maxAgeSeconds}, stale-while-revalidate=${staleWhileRevalidateSeconds}`,
      );
      // res.vary() appends -- cors() may already have set Vary: Origin.
      res.vary("Authorization");
    }
    next();
  };
}

module.exports = { cacheFor };
