# Changelog

This changelog records public product changes. For the authoritative description
of current runtime behavior, see [`docs/CURRENT-STATE.md`](docs/CURRENT-STATE.md).

## [Unreleased] — 2026-08-25

### Fixed

- Radio Mute/Stop pauses the existing Radio Browser audio element. Disabling
  the Radio layer also silences it. Starting a station unmutes. Compact
  Context and Cockpit transports now expose the same control. No voice ducking
  and no `/api/radio` changes.

### Changed

- A first hosted visit with no lastView, share-URL layers, or saved layer
  prefs now starts with the globe plus civilian flights only. Returning
  lastView / share URLs that include layers, and saved `gev:layer-state:v2`
  prefs, keep that set. No new `/api` routes or sources. Cables, OpenSky,
  and Google News stay off.
- Hosted CCTV frames use the rest catch-all `api/cctv/[...path].js` plus dedicated `frame|stream|media/[id].js` entries so `/api/cctv/frame/:id` is not a Vercel platform 404. The client URL is unchanged. Austin / Caltrans / TfL only.
- Ships poll interval is milliseconds (`60000` when live, `max(1000, nextAttemptAt-now)` when reconnecting). Missing-key / auth-failed leaves the manager poll unarmed and shows the stable key/unavailable string with no retry suffix. Hosted still does not wrap AISStream.
- Street traffic now paints currently visible road segments before off-center extras in the same tile, and after a jump-to-city it prefetches one neighbor ring of nearby tiles into the existing client cache. `MAX_DOTS` and the center-shift gate are unchanged. No new traffic vendor or `/api` route.

### Added

- DISPLAY Grid toggle draws a local lat/lon graticule (`meridian.grid`,
  default off). The step coarsens when zoomed out so a planet view stays
  readable. Clean view may keep the lines; required credits stay on. Not a
  data layer and no `/api`.
- Added a Launches panel that lists the existing Launch Library 2 results
  the globe already fetches (`/api/launches`). Clicking a row flies to the
  pad when coordinates are present, otherwise the row is only selected.
  Empty or failed payloads use the existing unavailable/empty language and
  do not hang. No new vendor or `/api`.
- Added a DISPLAY Power control (`Normal` | `Low`). Low caps the existing
  Cesium `targetFrameRate` at 30; Normal restores the current 60 default.
  The choice persists as `meridian.power`. Data polls, the idle render
  governor, and required credits are unchanged. Clean view still keeps
  Google Maps and Data attribution on screen.
- Added a camera-center lat,lon copy control next to Copy view link. It shows
  the pose already computed from `positionCartographic` (same source as the
  share URL) and copies numeric `lat,lon` for a Slack pin. `lon,lat` is kept
  as the secondary GIS order. Height is not shown, so the units toggle is
  unused. No /api and no place names.
- Hosted WX OFF | ON chrome sits next to the HUD and cockpit clocks and
  toggles the existing cockpit weather-effects render flag
  (`godsEyeView.cockpitWeatherEffects.enabled`). Off removes globe FX;
  Local Info still fetches Open-Meteo and shows the credit when weather
  values are on screen. Hidden-tab and offline pauses still apply. No new
  weather vendor or `/api`.
- Added a bike-share system picker for the existing allowlisted GBFS city list.
  Switching a system uses the current `/api/gbfs` URL builder only, persists
  the last system locally, and does not add hosts or open the proxy.
- Added a top-center north-up compass. Click or `N` sets heading 0 and keeps
  the current target, range, and tilt. The needle tracks camera heading.
  Home still returns the full default pose. Share links keep using the
  existing `heading` field.
- Hosted `/api/military-installations` on Vercel through the existing live
  catch-all (`api/[...path].js`), forwarding the GET handler extracted to
  `src/data/militaryInstallationsHttp.js`. Keeps the non-dateline ≤10° bbox
  gate, snap-to-cache, `exact=1` after saturated tiles, element cap +
  `saturated` flag, and the independent 90/300 rate limiter. Public OSM
  Overpass mapped context only. This extract does not add a dedicated
  serverless function and does not wrap `/api/ais-live`.
- Camera chrome shows **Stop tracking** while a contact is followed. The
  control calls the existing untrack/clear-target action and leaves the camera
  where it is. Hidden when nothing is tracked. Home still does the full
  default pose reset. Roster click still tracks. No `/api`.
- Added a city/provider filter on the CCTV panel list. It uses `city`,
  `cityId`, and `provider` already on `/api/cctv/sources` so hosted users can
  isolate Austin, Caltrans, or TfL. Clearing restores the full catalog.
  Selecting a camera still uses the existing stream/placeholder. Last city
  persists as `meridian.cctvCity`. Panel clamp is unchanged. No extra `/api`.
- Added a Display Trails on/off control for the existing tracked-target trail.
  The preference persists as `meridian.trails` and defaults on. Off hides the
  already-drawn path without stopping track; stop tracking still clears the
  target. No API changes.
- Street Traffic has a Traffic: Live | Sim control. Live uses the existing
  `/api/tomtom` tiles when `status.hasKey`; Sim is the built-in model and
  does not request tiles. Without a key, Live stays disabled. A 429 budget
  stop still leaves Sim available. "Traffic flow data © TomTom" is credited
  only after Live actually painted a tile. No extra `/api` route.
- Added a DISPLAY-rail Sun on/off control. On follows the existing Cesium
  clock so the terminator matches real time. Off keeps the well-lit globe
  already used when lighting is disabled. The choice persists as
  `meridian.liveSun`. The existing UTC | Local HUD toggle only changes the
  clock display. WX FX and visual looks stay independent. No new imagery
  stack and no `/api`.
- Added a Contacts control that shows or hides the existing 250 km nearby
  aircraft roster. Selecting a row still uses the current track action. Copy
  ident stays on the tracked card. Cockpit enter still requires a selected
  aircraft. Empty sky reports empty or unavailable rather than hanging. No new
  range math, `/api`, or person-search.
- Added a Look control that cycles the existing sensor styles — CRT, NVG,
  FLIR, Noir, Snow, then default — through the same setter the share URL and
  voice already use. No new looks.
- Hosted globe honors `prefers-reduced-motion` and a persistable DISPLAY
  Still toggle (`meridian.reduceMotion`). Reduce-motion cuts idle orbit,
  pulsing brackets, and trail flourish; fly-to Home and other functional
  camera moves stay live. Data polls and `/api` are unchanged.
- Added a Clear annotations control on the globe chrome. It calls the existing
  whiteboard `clear()` action so hosted users can erase voice marks without a
  spoken command. The control is disabled when the board is empty. Trails,
  models, and tracking are unchanged.
- Added a filter field at the top of the Data Layers list. It matches the
  visible layer name plus existing voice common-names (fires, ships, bikes,
  traffic, cameras, and the rest of that map). Empty query shows the full
  legal list. TeleGeography cables, OpenSky, and Google News stay off the
  list; the cables layer remains a registered no-op and is hidden from the
  panel. UI filter only — no new `/api` routes or data sources.
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
- Added a Display `km | nm | mi` control that reformats existing range, contact,
  and HUD altitude labels. The choice persists as `meridian.units`; first visit
  keeps today's kilometre labels.
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
- Added dedicated Vercel Node functions `api/realtime/token.js` and
  `api/openai/hud-summary.js` that mint ephemeral OpenAI sessions / HUD
  summaries with the server `OPENAI_API_KEY`. HUD logic lives in
  `src/hud/summary.js`. Hosted/Vercel spend fails closed without Clerk +
  Pro; local self-host BYOK stays. Hosted Free/anonymous MIC is locked to
  the existing upgrade/sign-in modal. The long-lived key is never injected
  into the client bundle.

### Changed

- TeleGeography submarine cables stay registered as a commercial no-op and are
  now unselectable: the Data Layers panel hides the enable control, manager
  enable is a no-op, and voice `set_layer` refuses undersea/submarine cables
  with “layer is a commercial no-op”. No cable geometry is fetched.
- Voice “OpenSky” is refused with “OpenSky is disabled”. Civilian flights stay
  labeled Live Flights / adsb.lol; `/api/opensky` remains the adsb.lol
  compatibility path and never contacts opensky-network.org.
- Voice “Google News” / “news RSS” is refused with “Google News RSS is
  disabled”. Cockpit headlines stay GDELT with citation and never fetch
  news.google.com. No Google News source picker.

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
