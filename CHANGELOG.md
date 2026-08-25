# Changelog

This changelog records public product changes. For the authoritative description
of current runtime behavior, see [`docs/CURRENT-STATE.md`](docs/CURRENT-STATE.md).

## [Unreleased] — 2026-08-25

### Changed

- Ships poll interval is milliseconds (`60000` when live, `max(1000, nextAttemptAt-now)` when reconnecting). Missing-key / auth-failed leaves the manager poll unarmed and shows the stable key/unavailable string with no retry suffix. Hosted still does not wrap AISStream.
- Street traffic now paints currently visible road segments before off-center extras in the same tile, and after a jump-to-city it prefetches one neighbor ring of nearby tiles into the existing client cache. `MAX_DOTS` and the center-shift gate are unchanged. No new traffic vendor or `/api` route.

### Added

- Added a copy control on the selected-contact card for the visible asset
  ident (aircraft callsign, else registration/hex; vessel name or MMSI;
  satellite name or NORAD). Clicking the ident or the copy control copies it
  and toasts `Copied UAL123`. Hidden with no selection. Aircraft, vessels, and
  satellites only — no person-search and no server route.
- HUD and cockpit clocks can switch UTC | Local next to the existing time.
  Local uses the browser timezone. The choice persists as `meridian.clock`
  (`utc` default). Share URLs, units, compass, and Home are unchanged.
- Hosted `/api/google/nearby-places` on Vercel via `api/google/nearby-places.js`,
  forwarding the same GET handler extracted to `src/google/nearbyPlaces.js`.
  Reuses `GOOGLE_MAPS_API_KEY` and optional `GEV_RATELIMIT_GOOGLE_PER_MIN`.
  Place labels only — the Google key never appears in JSON.
- Added a hosted `/api/adsbdb` enrichment proxy (`api/adsbdb/[...path].js`)
  that forwards route and aircraft lookups to `api.adsbdb.com` only, with a
  24h in-memory cache, 404 negative-cache, last-good on error, and optional
  `/tmp` persist. Dev/preview still use the Vite plugin. OpenSky is not used.
- Hosted cockpit regional brief now shares one Node handler between Vite and
  Vercel (`api/regional-brief.js`). GET and POST return 200 JSON with place
  and/or weather and/or GDELT news — never a platform `NOT_FOUND`. Google News
  RSS stays off. The Local Info page shows the linked Open-Meteo credit only
  when weather values are on screen.
- Hosted `/api/route` on Vercel via `api/route.js`, forwarding the same GET
  handler extracted to `src/data/osrmRoute.js`. Public FOSSGIS OSRM only
  (foot/car/bike, 2–12 coords, span guard, rate limiter). Failures are
  `{ok:false}` JSON, not a platform 404. No commercial router.
- Added hosted commercial billing: Clerk sign-in, a capped Free demo, and
  Stripe Checkout for Pro ($29/mo). Voice and uncapped use are Pro-only when
  Clerk is configured. Stripe/Clerk secrets stay server-side; tests mock them.
- Hidden tabs and offline windows pause flight/layer poll timers and the HUD
  summary. Returning visible and online runs one refresh, then resumes
  intervals. An active voice session keeps running. Offline shows
  "Offline — showing last data". AIS is not wrapped. No service worker.

### Changed

- Hosted ships stay an honest empty state: a platform/function 404 or 503 from
  `/api/ais-live` stops the poll loop, the layer reads unavailable/empty, and
  the AISStream.io credit appears only after a live snapshot lands. Docker and
  `vite preview` still serve the BYOK Node snapshot.
- Pro accounts can save, restore, and delete up to 10 camera/style/layer
  views in `localStorage` (`meridian.savedViews.<clerkUserId>`). Share-link
  encode/decode is reused. Free and anonymous stay hidden and write nothing.
- Reload restores the last camera, style, and layers from `meridian.lastView`
  when the URL has no share params. Share links still win. One slot, no
  Clerk, no API.
- Added Vercel Node functions `api/billing/[...path].js` and
  `api/stripe/webhook.js` that forward to `handleBillingHttp`, so hosted
  Checkout is not a static-SPA 404. Missing `CLERK_*` / `STRIPE_*` env
  returns 503/400 with variable names only.
- Added hosted TomTom traffic tiles: `src/data/tomtom.js` owns the
  budget-governed proxy, the Vite plugin forwards, and
  `api/tomtom/[...path].js` serves `/api/tomtom/status` and flow tiles on
  Vercel (256-tile memory cache, optional `/tmp`, in-isolate daily
  budget, default 40k). A rewrite sends `*.pbf` tile URLs to the
  function so they are not a static 404. Keyless installs return 503
  `{error:'no_key'}` without contacting TomTom. Responses never echo
  the key or upstream URL. This extract does not wrap `/api/ais-live`;
  OpenSky stays off.
- Added Vercel Node catch-all `api/[...path].js` that runs the same live
  `/api` proxy plugins Vite uses (realtime, CCTV, TomTom, radio, launches,
  adsb.lol, HUD summary, Overpass, GBFS, weather, FIRMS, CelesTrak, AIS,
  terrain, Google Places, and the rest). No Next rewrite and no new vendors.
- Hosted `/api/terrain/heights` on Vercel via `api/terrain/heights.js`,
  forwarding the Re:Earth handler extracted to `src/data/terrainHeights.js`
  / `terrainHeightsProxy.js`. Memory plus optional `/tmp` cache, single-flight,
  serve-stale. No new elevation vendor. This extract does not wrap
  `/api/military-installations`.
- Added `api/opensky.js` for hosted civilian flights. The path stays
  `/api/opensky`; the handler is the extracted 250 nm adsb.lol snapshot
  (`COMMERCIAL_FLIGHT_SOURCE='adsb.lol'`, `OPENSKY_ENABLED=false`).
  `/api/opensky-track` stays 410. No `OPENSKY_*` env.
- Added hosted aircraft-trace functions `api/adsblol/trace.js` (real
  adsb.lol tar1090 proxy) and `api/opensky-track.js` (hard 410, no OpenSky
  fetch). Vite forwards to `src/data/trackBackfill.js`.
- Added dedicated hosted `GET /api/adsblol/mil` (`api/adsblol/mil.js`) for
  the adsb.lol military feed (ODbL). The Vite plugin forwards to
  `src/data/adsblolMil.js`: 12s memory cache, stale-on-error, User-Agent
  `Meridian-adsblol-proxy/1.0`. This extract does not wrap AIS or enable OpenSky.
- Added dedicated Vercel Node function `api/cctv/[...path].js` for the
  existing public CCTV catalog/proxy (`sources`, `health`, `stream`,
  `frame`/`media`). Helpers live in `src/data/cctvProxy.js`; Vite still
  forwards the same plugin. Does not wrap AIS or Google text-search.
- Hosted `GET /api/weather-effects` now lives in `src/data/weatherEffects.js`
  with a Vercel Node entry at `api/weather-effects.js`. Vite and the live
  proxy plugin forward to the same handler. Cache, rate limit, and the
  Open-Meteo-only credit are unchanged. This change does not wrap
  `/api/terrain/heights`.
- Added hosted CelesTrak TLE function `api/celestrak/[...group].js` with a
  6-hour memory + optional `/tmp` cache and stale-on-failure. Vite forwards
  through `src/data/celestrak.js`. User-Agent is
  `Meridian-celestrak-proxy/1.0 (+https://github.com/johnmatveyev-lab/gods-eye-view)`.

### Changed

- TeleGeography submarine cables stay registered as a commercial no-op and are
  now unselectable: the Data Layers panel hides the enable control, manager
  enable is a no-op, and voice `set_layer` refuses undersea/submarine cables
  with “layer is a commercial no-op”. No cable geometry is fetched.
- Voice “OpenSky” is refused with “OpenSky is disabled”. Civilian flights stay
  labeled Live Flights / adsb.lol; `/api/opensky` remains the adsb.lol
  compatibility path and never contacts opensky-network.org.

### Fixed

- Hosted billing no longer writes a local JSON store on Vercel (read-only FS).
  `createBillingRuntime` defaults `getUserRecord` to Clerk `users.getUser`
  when `CLERK_SECRET_KEY` is set, so `/me` reads `publicMetadata.meridianPlan`
  in production. Webhook still awaits that Clerk write and returns non-2xx
  if it fails. `GET /api/billing/me` and checkout `ALREADY_PRO` read
  `publicMetadata.meridianPlan` from Clerk (`users.getUser`) so Pro survives
  an empty isolate. Webhook `checkout.session.completed` awaits that Clerk
  write (including `stripeCustomerId` / `stripeSubscriptionId`) and returns
  non-2xx if it fails so Stripe retries. Portal no longer 409s after a cold
  start when those ids are on Clerk metadata.

## [Unreleased] — 2026-08-24

### Added

- Added honest aircraft identity narration: callsign, operator, registration,
  type, and route come only from selected-contact context, and missing operator,
  route, or type enrichment is named explicitly.
- Added local, publication-compatible copies of the two README PNGs, with source
  records and third-party-license boundaries in `docs/media/README.md`.
- Added regression coverage for aircraft identity narration and optional-key
  loading feedback.

### Changed

- First-run presentation now opens with Detection `DENSE` at 75%, `ELASTIC`
  allocation, Fade 7%, Outside 1%, scope feather 11%, and aircraft 3D models in
  `PROXIMITY`. Stored state and share links still override these baselines.
- The 17 selected README GIFs remain unchanged and are documented separately
  from the two owner-published PNGs.
- Bundled datacenter and dam snapshots now omit contact-oriented fields and
  note values containing email or phone identifiers. Feature geometry, names,
  operator/capacity/river metadata, counts, and ODbL terms are unchanged.
- Public documentation and the L9 release matrix no longer reference non-public
  planning material or repository history.

### Fixed

- A missing optional FIRMS key no longer turns the complete Environmental
  mission into `LOAD FAILED`. The FIRMS row still reports `KEY REQUIRED`, while
  earthquakes continue to load. Real lifecycle and fetch failures retain
  failure priority.
- The mapped-installations layer retries after an unavailable request when it is
  enabled or the camera settles.
- Aircraft trails attach to the rendered aircraft transform and remain near the
  rear center across headings. Parked aircraft do not draw a moving head
  segment.
- Grounded aircraft keep validated floor evidence through temporary terrain
  outages and wait for measured photoreal-surface evidence before a 3D model
  takes over from its billboard.
- Cockpit altitude uses aviation MSL data rather than Cesium render height.

### Security

- Production transitive dependencies resolve to patched DOMPurify and
  protobufjs releases without changing the Cesium version or application APIs.
- Production dependency audit reports no known advisories; remaining audit
  findings are confined to development and QA tooling.

## [Unreleased] — 2026-08-23

### Added

- Added a first-run mission launcher for Contacts, Space Missions,
  Environmental, and manual exploration.
- Added terrain-validity gating and bounded last-known placement for grounded
  aircraft models.

### Changed

- Environmental consistently presents both earthquakes and NASA FIRMS fires,
  with honest optional-key degradation.
- The tracked aircraft trail acceptance bar is visual: roughly rear-center,
  stable across headings, with minor hull overlap allowed and no conspicuous
  top, bottom, or lateral projection.

## [Unreleased] — 2026-08-18 to 2026-08-22

### Added

- Added the four-source Map Source tray, share-link v2 state, cockpit/context
  voice parity, MSL altitude readouts, and close-range tracked aircraft models.
- Added the L9 release-candidate matrix, AIS feed watchdog, voice cost controls,
  satellite classes, and the shared world-overlay host.
- Added deterministic first-run, map-source, floor, overlay, tracking, and
  aircraft-model regression harnesses.

### Changed

- Consolidated world labels, cards, tracked readouts, CCTV thumbnails, cable
  labels, mission labels, and detection presentation under shared allocation and
  lifecycle rules.
- Reduced idle rendering through the render governor and explicit scope mask.
- Improved cockpit layout, context restoration, keyless feed honesty, and
  aircraft 2D/3D handoffs.

### Fixed

- Fixed degenerate depth picks, map-source restore states, route-camera motion,
  bright-ground label readability, grounded display flooring, and cross-layer
  tracking cleanup.
- Fixed stale overlay callbacks, parked-idle render leaks, cable-label sweep
  starvation, and several share-link state conflicts.

## [Unreleased] — 2026-08-02 to 2026-08-16

### Added

- Added Global Context modes, Cockpit briefing surfaces, Radio context,
  satellite mission replay, and real per-class aircraft models with adjacent
  provenance records.
- Added a shared screen-space overlay system with bounded allocation for labels,
  cards, callouts, detection brackets, and selected-object presentation.

### Changed

- Unified right-side product controls and responsive cockpit/map layouts.
- Migrated public-safe neighborhood geometry to DataSF and tightened safe local
  development defaults.
- Improved proxy resilience, annotation outline bounds, CCTV enable pacing,
  contact de-emphasis, and deterministic visual stacking.

## [Unreleased] — July 2026

### Added

- Added live NASA FIRMS fires, optional live TomTom traffic, Caltrans and TfL
  CCTV packs, CCTV viewsheds and direct-manipulation calibration, citywide CCTV
  cards, Natural Earth regions, analyst queries, and voice routing QA.
- Added the end-to-end vertical-datum system for aircraft, vessels, CCTV,
  annotations, trails, and terrain-aware rendering.
- Added aircraft class silhouettes, path-derived display heading, ADSBDB
  enrichment, cached CelesTrak TLE lookup, and next-ISS-pass prediction.

### Fixed

- Fixed elevated-airport aircraft placement, vessel sea-surface placement,
  close-zoom FIRMS anchors, antimeridian region framing, annotation resolution,
  cross-layer tracking ownership, and CCTV projection lifecycle issues.

## [Unreleased] — June 2026

### Added

- Added OpenAI Realtime voice control, scene-aware entity context, viewport image
  grounding, the AI HUD summary, live AIS vessels, infrastructure layers, map
  source switching, free-text navigation, and server-side data proxies.
- Added hybrid map annotations, 3D aircraft, panoptic detection, tracking
  harnesses, and public data attribution.
- Added MIT source licensing, security guidance, contribution guidance, data
  source notices, and third-party asset boundaries.

### Changed

- Removed the experimental AI video-edit style and retained seven deterministic
  visual styles.
- Moved Realtime text-history trimming to the server-side retention policy while
  keeping only the latest viewport image in conversation context.

## [0.7.0] — 2026-02-18

- Added the Bikeshare Pulse layer and panoptic label improvements.
- Improved tracked-item boxes, post-render alignment, and CCTV projection
  quality.
- Removed the experimental shift-drag CCTV calibration interaction.

## [0.6.0] — 2026-02-10

- Added the initial multi-layer 3D globe experience, visual styles, live
  aircraft, satellites, earthquakes, CCTV, traffic, FIRMS, infrastructure, and
  performance controls.
- Added entity inspection, tracking, scenes, keyboard controls, and shareable
  views.

## [0.1.0] — 2026-02-09

- Initial project version.
