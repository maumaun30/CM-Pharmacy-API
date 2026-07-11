// Google ID-token verification for staff Google sign-in / linking.
//
// Both the web app (Google Identity Services) and the Expo mobile app obtain a
// Google *ID token* client-side and POST it here. We verify it against Google's
// public keys, checking signature, expiry, and — critically — that `aud` is one
// of OUR OAuth client ids. Expo issues a different client id per platform
// (web / iOS / Android), so GOOGLE_CLIENT_IDS is a comma-separated allow-list.

const { OAuth2Client } = require("google-auth-library");

const AUDIENCE = (process.env.GOOGLE_CLIENT_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const client = new OAuth2Client();

/**
 * Verify a Google ID token and return its payload.
 * @param {string} idToken - the raw Google ID token (JWT) from the client
 * @returns {Promise<import("google-auth-library").TokenPayload>}
 * @throws if the token is invalid, expired, or `aud` is not an allowed client id
 */
exports.verifyGoogleIdToken = async (idToken) => {
  if (!AUDIENCE.length) {
    throw new Error(
      "GOOGLE_CLIENT_IDS is not configured — cannot verify Google tokens"
    );
  }
  const ticket = await client.verifyIdToken({ idToken, audience: AUDIENCE });
  return ticket.getPayload();
};
