/**
 * Client-safe CelesTrak GROUP token. The /api/celestrak proxy and the sats
 * picker share this regex. Keep Node I/O in celestrak.js so Vite's browser
 * build never sees fs/promises.
 */

export const CELESTRAK_GROUP_RE = /^[a-z0-9-]+$/i;
