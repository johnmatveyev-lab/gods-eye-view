# Changelog

This changelog records public product changes. For the authoritative description
of current runtime behavior, see [`docs/CURRENT-STATE.md`](docs/CURRENT-STATE.md).

## [Unreleased] — 2026-08-25

### Added

- Hosted Quakes list has a client-only **Hide no place** toggle after the
  Plan 236 range-ceiling chips. Default **off** keeps the current 50-row
  nearest/recent list, including named USGS places and the UNAVAILABLE
  fallback. **On** keeps a non-empty place that is not UNAVAILABLE
  (Anchorage stays) and drops empty, whitespace, missing, or UNAVAILABLE
  place. Missing / empty / UNAVAILABLE fail closed when on. The selected
  row always stays. Place is a USGS region string, never a person name.
  AND after the Plan 208 magnitude floor, Plan 216 depth ceiling, Plan
  228 age ceiling, and Plan 236 range ceiling, before the 50-row cap.
  Distinct from those chips and from hide-ground. Re-applies the
  already-fetched USGS snapshot — no extra fetch and no new `/api`.
  Preference persists as `meridian.quakeListHideNoPlace` (`1` / `0`;
  LayerStateCoordinator restore, no share-URL write).
- AIS has a client-only **Hide no heading** toggle after the Plan 200
  **All | 15m | 1h** last-position chips. Default **off** keeps the current
  fleet, including heading-null / course-null contacts. **On** keeps a
  vessel when heading or course is finite (HUD and icons already use
  `heading ?? course`). Both missing fails closed. A selected vessel
  stays if it passed the other filters. Chip changes re-filter
  already-fetched AIS rows and AND with Tanker | Cargo | Passenger |
  Fishing | Service | Other, Hide parked, min-speed, destination, Hide
  no dest, Hide unnamed, Hide no IMO, and last-pos freshness — no extra
  AISStream fetch and no `/api`. Preference persists as
  `meridian.aisHideNoHeading` (`1` / `0`; LayerStateCoordinator restore,
  no share-URL write). Distinct from type, parked, min-speed, dest,
  unnamed, IMO, last-pos, hide-ground, and flights Hide no heading.
- FIRMS globe has a client-only **Hide no sensor** toggle after Hide no
  satellite. Default **off** keeps the current overlay, including empty and
  named sensor strings. **On** keeps a non-empty trimmed sensor
  (VIIRS stays) and drops empty, whitespace, or missing sensor. The
  selected fire always stays. Chip changes re-filter the already-fetched
  `/api/firms` payload and AND with FRP, confidence, brightness, TI5, scan,
  track, version, area, Hide no day/night, Hide no satellite, Day | Night,
  age, sensor, and satellite-name chips — no extra NASA fetch and no new
  `/api`. Preference persists as `meridian.firmsHideNoSensor` (`1` / `0`;
  LayerStateCoordinator restore, no share-URL write). Distinct from the
  sensor identity chips, Plan 204 scan, 211 track, 217 version, 226 area,
  233 hide no day/night, and 238 hide no satellite. NASA FIRMS
  acknowledgement unchanged.
- Civil flights have a client-only **Hide no heading** toggle after Hide no
  callsign. Default **off** keeps the current draw, including missing heading
  plus 0 (north) and 270. On drops already-fetched contacts whose
  `true_track` is not finite. 0 stays. Missing, null, and undefined hide
  when on. The selected/tracked contact always stays. AND with
  airborne-only, Emergencies only, Identified only, Hide no squawk, Hide no
  type, Hide no registration, and Hide no callsign. Distinct from Plan 101
  NESW heading chips (those fail-open on missing) and from airborne-only /
  hide-ground. Re-applies the already-fetched adsb.lol payload — no extra
  fetch and no new `/api`. Preference persists as
  `meridian.flightHideNoHeading` (LayerStateCoordinator restore, no
  share-URL write). Military flights are unchanged.
- Hosted Quakes list has client-only exclusive **All | &lt;500 km | &lt;100 km**
  range-ceiling chips. Default **All** keeps 80 / 800 km events on the
  current 50-row nearest/recent list. **&lt;500 km** keeps 80 / 400 km
  and drops 800 km. **&lt;100 km** keeps 80 km and drops 400 km.
  Missing origin or non-finite `distanceKm` stays visible. The selected
  row always stays. AND with the Plan 208 magnitude floor, Plan 216
  depth ceiling, and Plan 228 age ceiling. Distinct from the globe SID /
  time / tsunami / felt / type / net / PAGER chips. Re-applies the
  already-fetched USGS snapshot — no extra fetch and no new `/api`.
  Preference persists as `meridian.quakeListRange`
  (LayerStateCoordinator restore, no share-URL write).
- FIRMS globe has a client-only **Hide no satellite** toggle after Hide no
  day/night. Default **off** keeps the current overlay, including empty and
  named satellite strings. **On** keeps a non-empty trimmed satellite
  (NOAA-20 stays) and drops empty, whitespace, or missing satellite. The
  selected fire always stays. Chip changes re-filter the already-fetched
  `/api/firms` payload and AND with FRP, confidence, brightness, TI5, scan,
  track, version, area, Hide no day/night, Day | Night, age, sensor, and
  satellite-name chips — no extra NASA fetch and no new `/api`. Preference
  persists as `meridian.firmsHideNoSatellite` (`1` / `0`;
  LayerStateCoordinator restore, no share-URL write). Distinct from the
  satellite identity chips, Plan 204 scan, 211 track, 217 version, 226
  area, 233 hide no day/night, and 230 list hide-no-sat. NASA FIRMS
  acknowledgement unchanged.
- AIS has client-only exclusive **All | 15m | 1h** last-position freshness
  chips. Default **All** keeps the current fleet. **15m** hides vessels whose
  last position is older than 15 minutes. **1h** hides older than 1 hour.
  Age is `lastPositionEpoch` (unix seconds or ms) with `lastPositionUtc` as
  a Date fallback. Missing both timestamps stay visible. A selected vessel
  stays even if stale. Chip changes re-filter already-fetched AIS rows and
  AND with Tanker | Cargo | Passenger | Fishing | Service | Other, Hide
  parked, min-speed, destination, Hide no dest, Hide unnamed, and Hide no
  IMO — no extra AISStream fetch and no `/api`. Preference persists as
  `meridian.aisLastPos` (LayerStateCoordinator restore, no share-URL
  write). Hidden when the AIS layer is off. Feed refresh keeps the chip
  set. Distinct from Hide parked, min-speed, dest, unnamed, and IMO.
- Dams in-view list has a client-only **River only** toggle next to the
  Plan 224 **Operator only** chip, Plan 218 **Named only**, and Plan 205
  **All | 10+ MW | 100+ MW** output-floor chips. Default **off** keeps the
  current roster, including plants whose OSM river is missing. On hides
  already-bundled list rows with an empty or whitespace river. A non-empty
  `river` / `associated_river` / `river:name` (on the record, properties,
  tags, or the existing `local-dams` context entity) stays, including
  **Colorado**. A selected row stays even if it would be filtered. AND
  with the output-floor chips, Named only, and Operator only. List/fly-to
  only — globe stems stay unchanged. No extra fetch and no `/api`.
  Preference persists as `meridian.damRiverOnly` only (not a share-link
  field). LayerStateCoordinator restore re-reads the stored toggle.
  Hidden with the dams list when the layer is off. Distinct from Plan 205
  output-floor, Plan 218 Named only, and Plan 224 Operator only.
- Global Context has a client-only **Aircraft only** toggle on the Contacts
  roster, next to Identified only and the All | &lt;50 km | &lt;10 km range
  chips. Default **off** keeps all four cohorts. **On** keeps flights +
  military and drops AIS vessels and mapped sites from the already-fetched
  `getNearby` roster and NEXT walk. The current subject always stays, even
  when it is a vessel or site. Missing `layerId` stays. AND with Identified
  only and the range chips. Chip changes re-filter already-fetched records
  — no extra fetch and no `/api`. The 250 km ring (`AWARENESS_RADIUS_M`)
  is unchanged. Preference persists as `meridian.awarenessAircraftOnly`
  (`1` / `0`; LayerStateCoordinator restore, no share-URL write). Distinct
  from Identified only, the range-floor chips, and hide-ground.
- Hosted Quakes list has client-only exclusive **All | &lt;6 h | &lt;1 h**
  age-ceiling chips. Default **All** keeps 20 min / 3 h / 12 h events on
  the current 50-row nearest/recent list. **&lt;6 h** drops 12 h and keeps
  3 h. **&lt;1 h** keeps 20 min and drops 3 h. Missing or non-finite
  `timeMs` stays visible. The selected row always stays. AND with the
  Plan 208 magnitude floor and Plan 216 depth ceiling. Distinct from the
  globe 1h / 6h / 24h time-window chips. Re-applies the already-fetched
  USGS snapshot — no extra fetch and no new `/api`. Preference persists
  as `meridian.quakeListAge` (LayerStateCoordinator restore, no
  share-URL write).
- Civil flights have a client-only **Hide no callsign** toggle after Hide no
  registration. Default **off** keeps the current draw, including missing
  and present callsigns. On drops already-fetched contacts whose `callsign`
  is missing, empty, or whitespace after trim. A published callsign such as
  DAL123 stays. The selected/tracked contact always stays. AND with
  airborne-only, Emergencies only, Identified only, Hide no squawk, Hide no
  type, and Hide no registration. Distinct from Identified only (callsign
  OR registration) and Hide no registration. Re-applies the already-fetched
  adsb.lol payload — no extra fetch and no new `/api`. Preference persists
  as `meridian.flightHideNoCallsign` (LayerStateCoordinator restore, no
  share-URL write). Military flights are unchanged.
- FIRMS globe has client-only exclusive **All | <2 km² | <1 km²** pixel-area
  chips after the Plan 217 version row. Area is `scanKm × trackKm` on the
  already-adapted fire. Default **All** keeps 0.4×0.4 / 1×1 / 2×2.
  **<2 km²** keeps 1×1 and drops 2×2. **<1 km²** keeps 0.4×0.4 and drops
  1×1. Missing or non-finite scan or track fails open. The selected fire
  always stays. Chip changes re-filter the already-fetched `/api/firms`
  payload and AND with FRP, confidence, brightness, scan, track, version,
  day-night, age, sensor, and satellite — no extra NASA fetch and no new
  `/api`. Preference persists as `meridian.firmsArea` (LayerStateCoordinator
  restore, no share-URL write). Distinct from Plan 204 scan, 211 track,
  217 version, and 155/192 brightness. NASA FIRMS acknowledgement
  unchanged.
- Global Context has client-only exclusive **All | <50 km | <10 km** range
  chips on the Contacts roster, next to Identified only. Default **All**
  keeps the current 250 km window. **<50 km** drops 200 km contacts and
  keeps 40 km. **<10 km** keeps 8 km and drops 40 km. Missing or
  non-finite `distanceM` stays. The current subject always stays. AND with
  Identified only. Chip changes re-filter already-fetched `getNearby`
  records — no extra fetch and no `/api`. The 250 km ring
  (`AWARENESS_RADIUS_M`) is unchanged. Preference persists as
  `meridian.awarenessRange` (LayerStateCoordinator restore, no share-URL
  write).
- The hosted FIRES list has client-only exclusive **All | &lt;6 h | &lt;1 h**
  age-floor chips. Default **All** keeps 20 min / 3 h / 12 h on the current
  50-nearest ranking. **&lt;6 h** drops 12 h and keeps 3 h. **&lt;1 h**
  keeps 20 min and drops 3 h. Missing or non-finite `acqMs` stays visible.
  A selected fire always stays. Chips AND with Plan 210 list confidence
  and Plan 219 list FRP and apply before the 50-row cap on the
  already-fetched `/api/firms` snapshot — no extra NASA fetch and no new
  `/api`. Distinct from the globe 6 / 12 / 24 h age window. Preference
  persists as `meridian.firmsListAge` (LayerStateCoordinator restore, no
  share-URL write). NASA FIRMS acknowledgement is unchanged.
- Dams in-view list has a client-only **Operator only** toggle next to the
  Plan 218 **Named only** chip and the Plan 205 **All | 10+ MW | 100+ MW**
  output-floor chips. Default **off** keeps the current roster, including
  plants whose OSM operator is missing. On hides already-bundled list rows
  with an empty or whitespace operator. A non-empty `operator` /
  `operator:short` (on the record, properties, tags, or the existing
  `local-dams` context entity) stays, including **Reclamation**. A selected
  row stays even if it would be filtered. AND with the output-floor chips
  and Named only. List/fly-to only — globe stems stay unchanged. No extra
  fetch and no `/api`. Preference persists as `meridian.damOperatorOnly`
  only (not a share-link field). LayerStateCoordinator restore re-reads
  the stored toggle. Hidden with the dams list when the layer is off.
  Distinct from Plan 205 output-floor, Plan 218 Named only, and Plan 193
  datacenter hide-no-operator.
- Hosted Quakes list has client-only exclusive **All | &lt;70 km | &lt;20 km**
  depth-ceiling chips. Default **All** keeps 15 / 80 / 400 km events on the
  current 50-row nearest/recent list. **&lt;70 km** drops 80 and 400 km.
  **&lt;20 km** keeps 15 km and drops 70 km. Missing or non-finite `depthKm`
  stays visible. The selected row always stays. AND with the Plan 208
  magnitude floor. Distinct from the globe SID depth bands (default all-on).
  Re-applies the already-fetched USGS snapshot — no extra fetch and no new
  `/api`. Preference persists as `meridian.quakeListDepth`
  (LayerStateCoordinator restore, no share-URL write).
- FIRMS globe has client-only exclusive **All | 2.0NRT | Other** product-version
  chips after the Plan 211 track-size row. Default **All** keeps C2 NRT
  (`2.0NRT`) and older `1.0NRT`. **2.0NRT** drops `1.0NRT`. **Other** keeps
  `1.0NRT` and missing versions. Missing version fails open on All. The
  selected fire always stays. Chip changes re-filter the already-fetched
  `/api/firms` CSV and AND with FRP, confidence, brightness, scan, track,
  day-night, age, sensor, and satellite — no extra NASA fetch and no new
  `/api`. Preference persists as `meridian.firmsVersion` (LayerStateCoordinator
  restore, no share-URL write). Distinct from Plan 155/192 brightness, 163
  satellite, 204 scan, 211 track, 210 list confidence, and 219 list FRP.
  NASA FIRMS acknowledgement unchanged.
- The hosted FIRES list has client-only exclusive **All | 10+ MW | 100+ MW**
  FRP-floor chips. Default **All** keeps 1 / 10 / 100 MW on the current
  50-nearest ranking. **10+ MW** drops 1 MW. **100+ MW** keeps 100 and
  drops 10. Missing or non-finite FRP stays visible. A selected fire
  always stays. Chips AND with Plan 210 list confidence and apply before
  the 50-row cap on the already-fetched `/api/firms` snapshot — no extra
  NASA fetch and no new `/api`. Distinct from the globe FRP 10 / 50 / 100
  chips. Preference persists as `meridian.firmsListFrp`
  (LayerStateCoordinator restore, no share-URL write). NASA FIRMS
  acknowledgement is unchanged.
- Dams in-view list has a client-only **Named only** toggle next to the
  Plan 205 **All | 10+ MW | 100+ MW** output-floor chips. Default **off**
  keeps the current roster, including fallback **Dam** rows when OSM left
  the plant unnamed. On hides already-bundled list rows whose painted
  label is empty, whitespace, or the exact **Dam** fallback. Named plants
  such as Hoover Dam stay. A selected row stays even if it would be
  filtered. AND with the output-floor chips. List/fly-to only — globe
  stems stay unchanged. No extra fetch and no `/api`. Preference persists
  as `meridian.damNamedOnly` only (not a share-link field).
  LayerStateCoordinator restore re-reads the stored toggle. Hidden with
  the dams list when the layer is off. Distinct from Plan 186 military
  Named only and Plan 193 datacenter hide-no-operator.
- The hosted Launches panel has a client-only **Mapped only** toggle after the
  All | Commercial | Government LSP-type chips. Default **off** keeps the
  current list, including missions with no pad coords so they stay selectable.
  On hides already-fetched rows missing finite pad lat/lon. A selected row
  always stays. AND with Plan 207 LSP-type chips. List only — globe Space
  Missions markers are unchanged. No extra fetch and no `/api`. Preference
  persists as `meridian.launchListMappedOnly` only (not a share-link field).
  LayerStateCoordinator restore re-reads the persist key.
- The hosted Sites list has a client-only **Mapped only** toggle after the
  globe chips (class, Footprints only, Named only, OSM type, Mapped only).
  Default **off** keeps the current 50-row list. On drops already-fetched
  `kind === 'place_candidate'` Google Places extras; missing `kind` and
  `installation` stay. List/fly-to only — globe stems and the globe
  Mapped only chip are unchanged. No extra fetch and no `/api`. Preference
  persists as `meridian.sitesMappedOnly` only (not a share-link field).
  Hidden when the installations layer is off.
- Dams in-view list has client-only exclusive **All | 10+ MW | 100+ MW**
  output-floor chips. Default **All** matches the current in-view roster.
  **10+ MW** hides sites whose bundled OSM `properties.output` parses below
  10 MW (KW ÷ 1000, MW as-is). **100+ MW** keeps Itaipu-class plants.
  Missing or unparseable output (`yes`, blank) stays visible. Globe stems
  stay unchanged. Chip changes re-filter the already-bundled OSM / ODbL
  snapshot — no extra fetch and no `/api`. Preference persists as
  `meridian.damOutput` and is not a share-link field.
  LayerStateCoordinator restore re-applies the stored floor. Hidden with
  the dams list when the layer is off. Distinct from Plan 193 datacenter
  hide-no-operator.
- Hosted Quakes list has client-only exclusive **All | 5+ | 6+** magnitude-floor
  chips. Default **All** matches the current 50-row nearest/recent list.
  **5+** keeps rows whose `magnitude` is at least 5, then applies the existing
  50-row cap. **6+** keeps large events only. Missing magnitude still drops.
  Distinct from the globe 2.5+ floor and Plan 183 significance chips. Re-applies
  the already-fetched USGS snapshot — no extra fetch and no new `/api`.
  Preference persists as `meridian.quakeListMag` (LayerStateCoordinator restore,
  no share-URL write).
- Mapped Installations has client-only exclusive **All | Way | Node | Relation**
  chips on the Mapped Sites list, next to class chips, Footprints only, and
  Named only. Default **All** matches the current named + class-labeled view.
  **Way** keeps `record.osmType === 'way'`. **Node** keeps nodes. **Relation**
  keeps relations. Missing `osmType` (Google Places candidates) stays visible.
  A selected installation stays even if its type is not the active chip.
  Chip changes re-filter already-fetched OSM/Places rows and AND with
  Airfield | Naval | Range | Land | Places, Footprints only, and Named only —
  no extra Overpass or Places fetch and no `/api`. Preference persists as
  `meridian.milOsmType` only (not a share-link field). Hidden when the
  installations layer is off. Viewport refresh keeps the chip set.
- Mapped Installations has a client-only **Named only** toggle next to the
  Plan 151 class chips and Plan 165 Footprints only. Default off matches
  the current named + class-labeled view. On hides in-memory records whose
  `hasName` is false — Overpass ways that only received a class label
  (Airfield, Range) because `tags.name` / `name:en` were empty after trim.
  Places search rows already have a name and stay. A selected installation
  stays even if it is unlabeled. Chip changes re-filter already-fetched
  OSM/Places rows and AND with Airfield | Naval | Range | Land | Places
  and Footprints only — no extra Overpass or Places fetch and no `/api`.
  Preference persists as `meridian.militaryNamedOnly` and
  `military-installations.namedOnly` (`i.n.1`). Hidden when the
  installations layer is off. Viewport refresh keeps the toggle.
- AIS has a client-only **Hide no IMO** toggle next to Hide unnamed.
  Default off matches the current harbor view. On skips in-memory vessels
  whose `imo` is missing, empty, or whitespace-only (trim first). Vessels
  with an IMO stay. A selected vessel stays even if it would be filtered.
  Chip changes re-filter already fetched AIS rows and AND with Tanker |
  Cargo | Passenger | Fishing | Service | Other, Hide parked, min-speed,
  destination, Hide no dest, and Hide unnamed — no extra AISStream fetch
  and no `/api`. Preference persists as `meridian.aisHideNoImo` and
  `ais-live-vessels.hideNoImo` (`a.i.1`). Hidden when the AIS layer is
  off. Feed refresh keeps the toggle. Existing AIS layer only.
- Satellites row has client-only **All | 2020s | 2010s | older** launch-year
  chips next to eccentricity chips. Default All matches the current catalog.
  The chips filter already-fetched CelesTrak satrecs by `satrec.intldesg`
  using the existing international-designator year decode (57–99 → 1900s,
  else 2000s). **2020s** keeps 2020–2029. **2010s** keeps 2010–2019.
  **older** keeps pre-2010. Missing or unparseable designators stay visible.
  The tracked satellite stays. Chip changes re-filter in memory and AND with
  Core | Dense, class chips, POINTS, ORBITS, period, inclination, and
  eccentricity — no extra `/api/celestrak` fetch and no new endpoint.
  Preference persists as `meridian.satLaunchYear` and is not a share-link
  field. Catalog refresh and group switch keep the chip set. Hidden when the
  Satellites layer is off. Distinct from Plan 164 period chips, Plan 169
  inclination chips, and Plan 177 eccentricity chips.
- Bikeshare has client-only **All | 15m | 60m** last-reported chips next to
  Hide empty / Hide full / Hide closed / E-bikes only / min-bikes /
  min-docks. Default **All** matches the current dots. **15m** hides
  stations whose cached GBFS `last_reported` (POSIX seconds, already on
  the status map) is older than 15 minutes. **60m** is looser. Missing or
  non-finite `lastReported` stays visible. A selected station stays. Chip
  changes re-filter in memory and AND with hide empty, hide full, hide
  closed, min-available, min-docks, and E-bikes only — no extra
  `/api/gbfs` fetch and no new endpoint. Preference persists as
  `meridian.bikeshareLastReported`. Hidden when the bike layer is off.
  Refresh keeps the chip set.
- Space Missions roster has a client-only **Hide unknown site** toggle next
  to the probability chips. Default off matches the current 30-day roster.
  On hides missions whose normalized `launchSite` is missing, whitespace
  only, or the exact fallback **Unknown launch site**. Named pads stay.
  Selected mission stays. Toggle changes re-filter the already-fetched
  window and AND with status, provider, orbit, site, 7d|30d, rocket,
  webcast, and probability. No extra `/api/launches` fetch and no new
  endpoint. Preference persists as `meridian.launchHideUnknownSite`.
  Hidden when the launches layer is off.
- AIS has a client-only **Hide unnamed** toggle next to Hide no dest.
  Default off matches the current harbor view. On skips in-memory vessels
  whose `name` is missing, whitespace-only, the generic `VESSEL` label,
  the live-feed `MMSI n` fallback, or the MMSI string itself. Named
  vessels stay. A selected vessel stays even if it would be filtered.
  Chip changes re-filter already fetched AIS rows and AND with Tanker |
  Cargo | Passenger | Fishing | Service | Other, Hide parked, min-speed,
  destination, and Hide no dest — no extra AISStream fetch and no `/api`.
  Preference persists as `ais-live-vessels.hideUnnamed` (`a.u.1`). Hidden
  when the AIS layer is off. Feed refresh keeps the toggle. Existing AIS
  layer only.
- Earthquake **US | AK | CI | NC | Other** chips sit next to the event-type
  row. Default all on matches the current USGS all_day discs. Chips filter
  cached `properties.net`: `us`, `ak`, `ci`, and `nc` each have a chip;
  missing, empty, or other contributing networks (tx, hv, uw, …) are Other
  so the row stays compact. A selected event stays. Chip changes re-filter
  in memory and AND with mag / depth / time / tsunami / PAGER / reviewed /
  type / felt — no extra USGS fetch and no `/api`. Preference travels with
  `earthquakes.networks`. Hidden when the Earthquakes layer is off. Refresh
  keeps the chip set.
- Space Missions roster has client-only **All | 50+ | 80+** probability
  chips next to Webcast only. Default **All** matches the current 30-day
  roster. **50+** hides missions whose normalized Launch Library 2
  `probability` is a finite value under 50. **80+** is stricter (finite
  under 80 hide). Missing, null, non-finite, or the historical `-1`
  unknown flag stay visible. Selected mission stays. Chip changes
  re-filter the already-fetched window and AND with status, provider,
  orbit, site, 7d|30d, rocket, and webcast. No extra `/api/launches`
  fetch and no new endpoint. Preference persists as
  `meridian.launchProbability`. Hidden when the launches layer is off.
- Satellites row has client-only **All | <0.01 | <0.05** eccentricity chips
  next to inclination chips. Default All matches the current catalog. The
  chips filter already-fetched CelesTrak satrecs by `satrec.ecco` (unitless
  0–1). **<0.01** keeps near-circular orbits. **<0.05** is looser. Missing
  or non-finite eccentricity stays visible. The tracked satellite stays.
  Chip changes re-filter in memory and AND with Core | Dense, class chips,
  POINTS, ORBITS, period, and inclination — no extra `/api/celestrak` fetch
  and no new endpoint. Preference persists as `meridian.satEccentricity`
  and is not a share-link field. Catalog refresh and group switch keep the
  floor. Hidden when the Satellites layer is off. Distinct from Plan 164
  period chips and Plan 169 inclination chips.
- Space Missions roster has a client-only **Webcast only** toggle next to
  the 7d | 30d chips. Default off matches the current 30-day roster. On
  keeps missions whose normalized `webcastLive` is true — `webcast_live
  === true` or a non-empty Launch Library 2 `vid_urls` list (2.3.0 name;
  legacy `vidURLs` still counts). Missing or false hide. Selected mission
  stays. Toggle changes re-filter the already-fetched window and AND with
  status, provider, orbit, site, 7d|30d, and rocket. No extra
  `/api/launches` fetch and no new endpoint. Preference persists as
  `meridian.launchWebcastOnly`. Hidden when the launches layer is off.
- Satellites row has client-only **Eq | Mid | Polar** inclination chips
  next to period chips. Default all on matches the current catalog. The
  chips filter already-fetched CelesTrak satrecs by `satrec.inclo`
  converted from SGP4 radians to degrees: **Eq** &lt; 30°, **Mid** 30–80°,
  **Polar** ≥ 80°. Missing or non-finite inclination stays visible. The
  tracked satellite stays. Chip changes re-filter in memory and AND with
  Core | Dense, class chips, POINTS, ORBITS, and period — no extra
  `/api/celestrak` fetch and no new endpoint. Preference persists as
  `meridian.satInclination` and is not a share-link field. Catalog refresh
  and group switch keep the chip set. Hidden when the Satellites layer is
  off. Distinct from Plan 164 period chips (minutes, not plane).
- Mapped Installations has a client-only **Footprints only** toggle next to
  the Plan 151 class chips. Default off matches the current points +
  polygons view. On skips in-memory records whose `footprint` is missing,
  empty, or not a usable 3+ vertex `[lon, lat]` ring. A selected
  installation stays even if it is a point-only pin. Chip changes re-filter
  already-fetched OSM/Places rows and AND with Airfield | Naval | Range |
  Land | Places — no extra Overpass or Places fetch and no `/api`.
  Preference persists as `military-installations.footprintsOnly` (`i.f.1`).
  Hidden when the installations layer is off. Viewport refresh keeps the
  toggle.
- Satellites row has client-only **All | <100m | <128m** period chips next
  to class chips. Default All matches the current catalog. The chips filter
  already-fetched CelesTrak satrecs by `orbitalPeriodSeconds(satrec) / 60`
  — the same mean-motion helper orbit rings already use. **<128m** hides
  satellites whose period is 128 minutes or more (typical GEO). **<100m**
  is tighter LEO (100 minutes or more). Missing or non-finite period stays
  visible. The tracked satellite stays. Chip changes re-filter in memory
  and AND with Core | Dense, class chips, POINTS, and ORBITS — no extra
  `/api/celestrak` fetch and no new endpoint. Preference persists as
  `meridian.satPeriod` and is not a share-link field. Catalog refresh keeps
  the floor. Hidden when the Satellites layer is off. Distinct from Plan
  132 class chips.
- Radio operators can narrow the already-fetched Radio Browser roster by
  state/region (`CA`, Bavaria, Ontario) next to country/search. Empty keeps
  the current view. Case-insensitive exact or contains match on
  `station.state`; empty-state rows hide when the field is set. Invalid
  input fails closed. The playing station stays visible. Persists as
  `meridian.radioState`. Hidden while Radio is off. Client-only; no `/api`.

### Fixed

- Mapped Installations now keep Overpass ways that arrive as `geometry`
  rings with no `center` (Austin Camp Mabry and the other geom-only
  barracks). `pointFrom` derives the display pin from the ring so
  `footprintFrom` can store the outline the **Footprints only** chip
  already filters. Nodes without a ring still hide when the chip is on.
  Selected installation and class-chip AND are unchanged. No Overpass
  query change and no new `/api`.
- Space Missions PREV/NEXT and the N/M index walk the chip-filtered roster
  (status AND provider), not the full 30-day launch list. Rocket Lab-only is
  `1 / 2` then `2 / 2`; NEXT from Grain Goddess is Lightning God, never the
  next SpaceX row. Ends of the filtered list disable. Client-only; no `/api`.
- Hosted CelesTrak disk cache writes `/tmp/meridian-celestrak` on Netlify /
  Vercel / Lambda instead of `cwd/.gev-cache` (`/var/task` is read-only). A
  seeded body plus upstream miss is 200 `STALE-ERROR`, not 502 `NONE`. Write
  failures stay memory-only. Distinct from the debug-log `/tmp` fix.
- Hosted `POST /api/realtime/debug-log` writes `/tmp/meridian-gev-logs` on
  Netlify / Vercel / Lambda instead of mkdir `/var/task/.gev-logs` (400
  ENOENT). A write failure still returns empty 204 and warns, so the voice
  beacon never 400s. Radio click and AISStream are unchanged.
- Hosted `/api/ais-live` answers an honest unsupported empty snapshot (and
  `/track` → `{samples:[]}`) instead of a generic catch-all 404. No AISStream
  websocket and no `AISSTREAM_API_KEY`. Vite still owns the live feed.
- Hosted Netlify `/api/*` no longer 502s with
  `Identifier '__dirname' has already been declared`. The function wrapper
  does not declare `__dirname`, bundled sources use `repoRoot`, and
  `node_bundler = "nft"` turns off the esbuild CJS-shim inject. Vercel
  `api/*.js` is unchanged.
- Voice token mint and HUD summary fail closed unless Clerk is configured and
  the signed-in user is Pro. An unset Clerk env no longer mints an unauthenticated
  Realtime secret or HUD call.
- Hosted MIC stays locked for Free, anonymous, and exhausted sessions and
  reuses the existing upgrade / sign-in / budget modal. A 404/503 token
  response shows “Voice is not available on this host yet” or
  “Voice is not configured” instead of a generic ERROR. Self-host BYOK MIC
  is unchanged. Token and HUD mint handlers are not modified in this slice.
- Radio Mute/Stop pauses the existing Radio Browser audio element. Disabling
  the Radio layer also silences it. Starting a station unmutes. Compact
  Context and Cockpit transports now expose the same control. No voice ducking
  and no `/api/radio` changes.

### Changed

- FIRMS row chips filter already-fetched detections by sensor
  (`VIIRS` | `MODIS` | `Other`, default all on) next to the FRP floor.
  Missing/blank sensor stays visible; a non-empty unknown token is Other.
  Cells, sprites, overlay cards, and the Plan 70 FIRES list AND this with
  the existing FRP, confidence, Day | Night, and age floors without a new
  NASA fetch. The choice persists on `local-firms` (`w.s.*`). Same VIIRS
  proxy, quota, and TTL. Not an alert service.
- A first hosted visit with no lastView, share-URL layers, or saved layer
  prefs now starts with the globe plus civilian flights only. Returning
  lastView / share URLs that include layers, and saved `gev:layer-state:v2`
  prefs, keep that set. No new `/api` routes or sources. Cables, OpenSky,
  and Google News stay off.
- Hosted CCTV frames use the rest catch-all `api/cctv/[...path].js` plus dedicated `frame|stream|media/[id].js` entries so `/api/cctv/frame/:id` is not a Vercel platform 404. The client URL is unchanged. Austin / Caltrans / TfL only.
- Ships poll interval is milliseconds (`60000` when live, `max(1000, nextAttemptAt-now)` when reconnecting). Missing-key / auth-failed leaves the manager poll unarmed and shows the stable key/unavailable string with no retry suffix. Hosted still does not wrap AISStream.
- Street traffic now paints currently visible road segments before off-center extras in the same tile, and after a jump-to-city it prefetches one neighbor ring of nearby tiles into the existing client cache. `MAX_DOTS` and the center-shift gate are unchanged. No new traffic vendor or `/api` route.

### Added

- AIS has client-only **All | 5+ | 10+** min-speed chips next to Hide parked
  and the Plan 153 type chips. Default All matches the current harbor view.
  5+ skips in-memory vessels whose `speed` is a finite value under 5 kt;
  10+ is stricter (under 10 kt). Missing or non-finite speed stays visible.
  A selected vessel stays. Chip changes re-filter already fetched AIS rows
  and AND with Tanker | Cargo | Passenger | Fishing | Service | Other and
  Hide parked — no extra AISStream fetch and no `/api`. Preference persists
  as `ais-live-vessels.minSpeed` (`a.s.5` / `a.s.t`). Hidden when the AIS
  layer is off. Feed refresh keeps the floor. Existing AIS layer only.
- Earthquake **Quake | Explosion | Quarry | Other** chips sit next to the
  reviewed and PAGER rows. Default all on matches the current USGS all_day
  discs. Chips filter cached `properties.type`: `earthquake` is Quake,
  `explosion` is Explosion, `quarry` / `quarry blast` is Quarry, and
  missing or other values (including ice quake) are Other. A selected
  event stays. Chip changes re-filter in memory and AND with mag / depth /
  time / tsunami / PAGER / reviewed — no extra USGS fetch and no `/api`.
  Preference travels with `earthquakes.eventTypes`. Hidden when the
  Earthquakes layer is off. Refresh keeps the chip set.
- Space Missions roster has client-only rocket-family chips derived from the
  cached 30-day Launch Library 2 `rocket.configuration.name` (or `rocket.name`)
  via compact family labels, plus Other for blank or unknown vehicles.
  Default all on matches the current roster. Falcon 9 off hides those
  missions; Other off hides unnamed vehicles. Selected mission stays.
  Chip changes re-filter the already-fetched window and AND with status,
  provider, orbit, site, and 7d|30d. No extra `/api/launches` fetch and no
  new endpoint. Preference persists as `meridian.launchRocket`. Hidden when
  the launches layer is off.
- AIS has a client-only **Hide parked** toggle next to the Plan 153 type chips.
  Default off matches the current harbor view. On skips in-memory vessels
  whose `speed` is a finite value under 0.5 kt; missing or non-finite speed
  stays visible. A selected vessel stays. Chip changes re-filter already
  fetched AIS rows and AND with Tanker | Cargo | Passenger | Fishing |
  Service | Other — no extra AISStream fetch and no `/api`. Preference
  persists as `ais-live-vessels.hideParked` (`a.p.1`). Hidden when the AIS
  layer is off. Feed refresh keeps the toggle. Existing AIS layer only.
- Earthquake **Green | Yellow | Orange | Red | None** PAGER chips sit next to
  the tsunami toggle. Default all on matches the current USGS all_day discs.
  Chips filter cached `properties.alert`; missing/null is None and stays
  visible while None is on. A selected event stays. Chip changes re-filter
  in memory and AND with mag / depth / time / tsunami — no extra USGS fetch
  and no `/api`. Preference travels with the existing earthquake params.
  Hidden when the Earthquakes layer is off.
- Mapped Installations has client-only **Airfield | Naval | Range | Land |
  Places** chips on the Sites list. Default all on matches the current
  OSM/Places viewport. Naval off hides `naval_base` markers and keeps the
  other classes; missing or unknown `class` stays visible. A selected
  installation stays. Last-off can empty the viewport except the selection.
  Chip changes re-filter in-memory records — no extra Overpass/Places fetch
  and no new `/api`. Preference persists on `military-installations`
  (`i.k.*`). Hidden when the layer is off. Existing OSM/Places military
  layer only.
- Earthquake **Tsunami only** toggle sits next to the magnitude, time, and
  depth chips. Default off matches the current USGS all_day discs. On keeps
  events whose `properties.tsunami === 1`; missing or `0` hide. A selected
  event stays visible. Chip changes re-filter the cached GeoJSON and AND
  with mag / depth / time — no extra USGS fetch and no `/api`. Preference
  travels with the existing earthquake params. Hidden when the Earthquakes
  layer is off.
- Space Missions roster has exclusive **7d | 30d** chips next to status.
  Default **30d** matches the current Launch Library 2 roster. **7d** hides
  missions whose `launchTime` is more than seven days from now and keeps
  nearer ones; missing or non-finite times stay visible. Chip changes
  re-filter the cached 30-day payload — no extra `/api/launches` fetch and
  no new endpoint. AND with status, provider, orbit, and site. A selected
  mission stays. Preference persists as `meridian.launchTimeWindow`.
- Space Missions roster now has launch-site chips derived from the cached
  30-day Launch Library 2 window via `compactLaunchSiteName(launchSite)`,
  plus Other for blank or unknown pads. Default all on. Filters the
  roster, pad markers, and ambient overlay from cache and ANDs with
  status, provider, and orbit class. Selected mission stays visible when
  its site chip is off. No extra `/api/launches` fetch and no new endpoint.
- CCTV panel has client-only High | Medium | Low heading-confidence chips
  next to the city/source filter. Default all on. Unchecking Low hides
  low-confidence headings and keeps high/medium; missing/unknown
  confidence stays visible. A selected camera stays. Chips AND with
  city/source, Hide no feed, feed type, and Hide unhealthy, and re-apply
  the in-memory catalog — no extra `/api/cctv/sources` or `/health` fetch.
  Persist as `meridian.cctvHeadingConfidence`. Same hosted CCTV catalog.
  Not an alert service.
- Satellites row has a **POINTS** on/off chip next to ORBITS over the
  existing `setParams({ showPoints })` path (default ON). Off hides the
  dots and keeps orbit rings if ORBITS is on. Tracked ISS stays. The
  choice persists in layer-state / share links (`s.p.0` when off). It
  does not change catalog Core|Dense, class chips, the CelesTrak group
  picker, or add an `/api` route.
- Bikeshare has All | 3+ | 5+ chips next to Hide empty / Hide full /
  Hide closed. Default All matches the current dots. 3+ and 5+ keep
  stations whose last-good `bikesAvailable` is at least that floor.
  Unknown counts stay visible. A selected station stays until deselected.
  Hide empty, hide full, and hide closed still AND independently. Filters
  already-fetched GBFS status only — no extra `/api/gbfs` fetch. Preference
  persists as `meridian.bikeshare.minAvailable`. The Plan 68 system picker
  is unchanged.
- Satellites DATA LAYERS row now shows a **Next ISS** readout: rise time
  (UTC | Local follows the existing clock toggle), peak elevation, and rise
  azimuth from the already-loaded ISS satrec at the camera lat/lon. Recalc is
  `moveEnd` only. No ISS / no 24h pass reads UNAVAILABLE. Hidden when the
  satellites layer is off. Client-only; not an alert service; no new `/api`.
- Radio has an English-only chip next to Favorites. Default off. When on,
  the already-fetched Radio Browser directory hides stations whose
  language is not `en` / `eng` / `english…` (same helper globe-view
  ranking already uses). Category, search, bitrate, codec, and Favorites
  still AND. A station already playing stays audible and selected even
  when it is not English. The chip re-filters from cache — no extra
  `/api/radio` fetch — and persists as `meridian.radioEnglishOnly`.
  MIT credit and the Meridian name are unchanged.
- Space Missions roster now has LEO | MEO | GEO | Polar | Other chips next
  to the existing status and provider chips. Classification uses the
  already-fetched Launch Library 2 `orbit.name` (GEO includes GTO /
  geostationary / transfer; Polar includes polar / sun-sync). Default all
  on. Filters the roster, pad-site markers, and ambient overlay from cache
  and ANDs with status and provider. Selected mission stays visible when
  its orbit chip is off. No extra `/api/launches` fetch and no new endpoint.
- Earthquake time-window chips — 1h | 6h | 24h — sit next to the magnitude
  floor and depth chips. Default 24h matches the current all_day discs.
  1h and 6h keep `properties.time >= now − window`; missing/non-finite time
  stays visible. Chip changes re-filter the cached USGS GeoJSON; no new
  fetch and no `/api`. AND with the magnitude floor and depth chips.
- Satellite class chips on the Satellites row, next to Core | Dense, in
  `SATELLITE_CLASS_ORDER` (STATION, NAV, GEO, VISUAL, COMMS). Default all
  on, so the current catalog is unchanged until a chip is unchecked. The
  chips filter already-fetched CelesTrak groups through `satelliteClassOf`
  (ISS stays STATION) and re-apply from in-memory points — no extra
  `/api/celestrak` fetch. Tracked satellites stay visible. AND with Core |
  Dense, POINTS, and ORBITS. COMMS is a no-op in Core (dense-only) and hides
  the Starlink shell in Dense. Persists on the existing satellites layerState
  option (`s.k.*`). Not an alert service. No new `/api`.
- FIRMS row chips filter already-fetched detections by age window
  (`6h` | `12h` | `24h`, default 24h). Cells, sprites, overlay cards,
  and the Plan 70 FIRES list hide older detections without a new NASA
  fetch. Missing or non-finite acquisition time stays visible. The
  window ANDs with FRP, confidence, and day/night. The choice persists on
  `local-firms` (`w.a.*`). Same VIIRS proxy, quota, and TTL. Not an
  alert service.
- FIRMS row chips filter already-fetched detections by Day | Night
  (default both on). Night off hides `N` detections and keeps day.
  Missing or unknown daynight stays visible. The chips AND with the
  existing FRP and confidence floors without a new NASA fetch. The
  choice persists on `local-firms` (`w.d.*` / `w.n.*`). Same VIIRS
  proxy, quota, and TTL. Not an alert service.
- FIRMS row chips filter already-fetched detections by confidence floor
  (`All` | `0.5+` | `0.8+`, default All). Cells, sprites, overlay cards,
  and the Plan 70 FIRES list hide below the floor without a new NASA
  fetch. Missing or non-finite confidence stays visible. The floor ANDs
  with the existing FRP chips. The choice persists on `local-firms`
  (`w.c.*`). Same VIIRS proxy, quota, and TTL. Not an alert service.
- CCTV panel has a client-only **Hide no feed** toggle next to the city/source
  filter. Off (default) keeps the current catalog. On skips cameras with
  `feedConfigured === false` before icons, cards, and coverage, ANDs with the
  city filter, and keeps a selected unconfigured camera. Re-applies from the
  in-memory catalog — no extra `/api/cctv/sources` or `/frame` fetch. Persists
  as `meridian.cctvHideNoFeed`. Same hosted CCTV catalog. Not an alert service.
- Earthquake depth chips — Shallow | Intermediate | Deep — sit next to the
  existing magnitude floor. Default all on, same buckets as the disc colors
  (shallow <70 km, intermediate 70–300, deep ≥300). Chip changes re-filter
  the cached USGS `all_day` GeoJSON; no new fetch and no `/api`. AND with the
  magnitude floor. The hosted Quakes list shows only selected depths.
- Added a Go-to field next to the camera-center readout. Operators paste
  an MGRS grid (`mgrs.toPoint`) or decimal `lat, lon` and the existing
  Home/share `camera.flyTo` helper centers on that point, keeping the
  current height, heading, and pitch unless the paste includes a height.
  Invalid or empty input does not move the camera and shows a short
  `Invalid coordinates` status. Pointer MGRS and Home are unchanged.
  Client-only; no `/api`.
- Bikeshare has a Hide full chip next to Hide empty. When on, stations
  whose last-good `docksAvailable` is exactly 0 are not drawn. Unknown
  dock counts stay visible. A selected station stays until deselected.
  Hide empty still ANDs independently. Both default off and filter
  already-fetched GBFS status only — no extra `/api/gbfs` fetch. The
  Plan 68 system picker is unchanged.
- Bikeshare has a Hide closed chip next to Hide empty / Hide full. When
  on, stations whose last-good `isInstalled`, `isRenting`, or
  `isReturning` is `false` are not drawn. Unknown flags stay visible.
  A selected station stays until deselected. Empty and full still AND
  independently. Default off; filters already-fetched GBFS status only
  — no extra `/api/gbfs` fetch. The Plan 68 system picker is unchanged.
- Radio can pin stations on the selected card. Ids persist as
  `meridian.radioFavorites` (cap 20). A Favorites-only chip ANDs with
  genre, search, and min-bitrate on the already-fetched Radio Browser
  directory for map dots and prev/next. Playing a non-favorite stays
  audible until Stop or Next. No `/api/radio` change.
- Street Traffic has Density and Speed sliders on the existing layer row.
  Density (0.2–2.5, default 1.0) changes dot spawn; Speed (0.3–3.0,
  default 1.0) scales ambient/live motion. Both write the existing
  `setParams({ densityScale, speedScale })` path and apply on the next
  camera-driven load. Distinct from Live | Sim, Uncovered Sim | Hide, and
  Jam viz. Prefs persist as `meridian.trafficDensity` /
  `meridian.trafficSpeed` (traffic is still enabled-only). No extra
  TomTom/Overpass fetch and no new `/api`.
- Added an MGRS line next to the camera-center lat,lon readout. It uses the
  existing `mgrs` package on the same `positionCartographic` pair Copy coords
  already shows, updates as the pointer moves, and is included on the existing
  Copy coords clipboard (no second control). Polar or undefined conversions
  stay blank — no fake grid. No `/api`.
- Added a Share view QR control next to Copy view link. It opens a popover
  with an in-page QR of the current camera+layers share URL (same
  `currentShareUrl()` helper Copy view link copies). No shortener, upload,
  or `/api`. A second click or Escape closes the popover. Copy view link
  still copies the URL text only. Credits stay on the globe.
- Added a Copy card control next to Copy ident on the selected-contact
  readout. It pastes the public ADS-B fields already shown from describe()
  (ident, registration, hex, type, alt, speed, heading, lat/lon) and omits
  missing values instead of writing "unknown". Commercial and military
  flights share that card shape. Copy ident still copies only the ident.
  Disabled when nothing is selected. Clipboard writeText only — no origin /
  destination, news, snapshot, or `/api`.
- Persistent whiteboard marks now survive a reload. `onChange` writes a compact
  snapshot of persistent marks (`id`, `type`, `label`, `color`, `anchor`, `to`,
  `ring`/`path`) to `meridian.annotations`. Boot restores once through the same
  latitude/longitude `annotate()` path as Import — no geocode, Places, or
  Overpass. TTL / expiring marks are skipped. Clear empties the key. Undo,
  Import, and Export stay the live-board source of truth. Operator-local only;
  not an alert service. No new chrome and no `/api`.
- Netlify hosting: `netlify.toml` publishes the Vite `dist`, pins Node 24, and
  serves `/api/*` through a Functions v2 catch-all that invokes the existing
  Vercel Node handlers. The SPA fallback is `/index.html` only after `/api/*`.
  Vercel `api/*.js` and `vercel.json` are unchanged. OpenSky, Google News RSS,
  and TeleGeography stay off.
- Added an Import annotations control next to Export on the globe chrome.
  Operators pick a Plan 114 `meridian-annotations.geojson` FeatureCollection
  and `annotate()` places pins/lines/areas from latitude/longitude (and
  ring/points) only — no geocode, Places, or Overpass. Appends to the live
  board, stays enabled when empty, skips features without coordinates, and
  stops at the existing 120-mark cap. A malformed file is a no-op with
  `Invalid GeoJSON`. No `/api`.
- Added a DISPLAY **Airborne only** control. Default off. When on, commercial
  and military flight layers skip contacts whose existing `onGround` flag is
  true, so parked and taxiing aircraft leave the globe. A selected or tracked
  contact that just landed stays visible until untracked. The choice persists
  with existing flight layer options and ANDs with altitude, speed, heading,
  class, hide-stale, and callsign-prefix filters. Watchlist and emergency
  highlight stay paint-only. No new ground heuristic and no `/api`.
- Added an Export annotations control next to Clear/Undo on the globe chrome.
  It builds a GeoJSON FeatureCollection from `engine.list()` (pin/highlight
  → Point, arrow/route → LineString, area → Polygon or Point) with only
  id, type, label, and color, and downloads `meridian-annotations.geojson`
  in the same tab. Disabled when the board is empty. Clear and Undo update
  enablement via the same `onChange`. No upload, no `/api`, and no
  voice/LLM change.
- Added a Copy snapshot control next to Copy view link. It captures the
  Cesium canvas plus the on-screen `#cesium-credits` strip (Google / Cesium
  / data attribution) as a local PNG. Clipboard image write first; a
  same-tab download if that is denied. Clean view still keeps credits in
  the image. Operator-local only — no upload, no `/api`, and Copy view
  link still copies the URL only.
- Satellites DATA LAYERS row now has a **Core | Dense** catalog control. Core
  is the current catalog (Plan 65 group picker). Dense calls the existing
  `setParams({ catalog: 'dense' })` Starlink path (chunked, points-only). A
  failed `/api/celestrak/starlink` load stays on Core and shows the existing
  feed-unavailable status. The choice persists through the existing layerState
  `catalog` option. Not the Plan 65 core-group picker. No new `/api`.
- Added an Undo last annotation control next to Clear on the globe chrome.
  It calls `removeLast()` so one wrong pin or area comes off without wiping
  the board. Undo does not bump the clear() generation or abort in-flight
  annotate. Disabled when the board is empty. Clear still empties all. No
  new `/api`, GeoJSON export, or voice/LLM change.
- Failed or stale Data Layers rows now expose a Retry chip that calls the
  existing `refreshLayer()` path immediately. Healthy rows stay quiet; a
  click while a refresh is in flight is ignored. Operators no longer have
  to wait on the `retry Ns` countdown or toggle the layer. No `/api`.
- Radio has a client-side min-bitrate floor (All / 64+ / 128+ / 192+ kbps)
  on the already-fetched Radio Browser directory. Default All keeps the
  current list. Null bitrate stays visible. A station already playing stays
  audible until Stop or Next. Genre and search still AND with the floor.
  Preference persists on the existing radio layer options. No `/api`.
- Added a Watch list of up to 10 public aircraft idents (callsign or hex
  already on the selected contact). Add from the selected card; remove from
  the list. When a watched ident is in the current flights payload it uses
  the existing track highlight. Clicking a row tracks that contact if
  present, otherwise toasts `not in view` without inventing a position. The
  list persists as `meridian.watchlist`. No `/api`, person-search, or OpenSky.
- Street Traffic has an Uncovered: Sim | Hide control. Sim keeps today's
  white ambient dots on roads TomTom has no flow for. Hide spawns nothing
  on those roads; colored live flow stays. Applies on the next camera-driven
  load. Distinct from Traffic: Live | Sim, which still changes the whole
  feed. The choice persists as `meridian.uncoveredRoads` (default Sim).
  Share URLs stay enabled-only. No extra `/api`.
- FIRMS row chips filter already-fetched detections by FRP floor
  (`All` | `10+` | `50+` | `100+ MW`, default All). Cells, sprites, overlay
  cards, and the Plan 70 FIRES list hide below the floor without a new NASA
  fetch. Failed/stale last-good still filters. The choice persists on
  `local-firms` (`w.f.*`). Same VIIRS proxy, quota, and TTL.
- Satellites row has an **ORBITS** on/off chip over the existing
  `setParams({ showOrbits })` path (default ON). Off hides orbit rings;
  ISS / core / dense points stay. The choice persists in layer-state /
  share links (`s.o.0` when off). It does not change catalog core|dense,
  the CelesTrak group picker, or add an `/api` route.
- Emergency highlight paints contacts whose current public ADS-B squawk is
  7500, 7600, or 7700 using the existing annotation alert-red token. DISPLAY
  **Emergency** defaults on and persists as `meridian.emergencyHighlight`.
  Off removes the special paint only; click still tracks. Altitude-band
  visibility still hides out-of-band contacts even when the squawk is
  emergency. Client-side current payload only — not an alert service and
  not a verified emergency. No `/api`.
- Double-click on empty globe terrain flies to the pick with the existing
  landmark helper (reasonable height and tilt). Double-click on a contact or
  contact card still tracks. Wheel zoom-to-pointer is unchanged. Optional
  persist is `meridian.doubleClickFly` (default on). No `/api`.
- Added a hosted Quakes list from the existing USGS 24h M2.5+ payload. Click
  a row to fly to that event (cap 50). Empty or failed feed shows
  UNAVAILABLE. No new `/api` route, and the FIRMS list stays independent.
- Added a two-click Measure mode on the globe: two terrain picks draw a
  geodesic line and show the distance in the current `km | nm | mi` units.
  Escape or Clear exits. Does not call `/api/route` or OSRM. User-picked
  points only — no person-search, OpenSky, Google News, or TeleGeography.
- Hosted Data Layers now list in-view OSM dams from the existing bundled
  payload (cap 50). Clicking a row flies to those coords using the layer's
  current stem-click camera. Empty or off yields an empty list. The
  datacenter roster stays independent. No new Overpass fetch. © OpenStreetMap
  credit is unchanged.
- Flights and military flight rows share a PREFIX field for 3-letter
  callsign tokens (UAL AAL BAW). Empty shows all. Matching is the already
  ingested callsign prefix only — not the exact-ident watchlist and not
  airline-name or IATA↔ICAO lookup. A selected/tracked contact stays
  visible if its callsign misses. Composes as AND with the flights
  altitude band, ground-speed band, heading-sector chips, Hide stale, and
  class chips. Persists with existing flight layer options (`f.c.*`; speed
  already owns `f.p`). No `/api`.
- Flights layer has a client-side altitude band (All / Surface / &lt;10k /
  10–30k / &gt;30k) on the current adsb.lol payload. Units relabel the stops;
  the meter thresholds stay 10,000 ft and 30,000 ft. The choice persists as
  `meridian.altBand`. Empty bands show an empty layer. No `/api`.
- Added a DISPLAY-rail Crosshair on/off overlay: a CSS plus at the same
  camera-center aim point copy-coords and measure already use. Default off.
  Persists as `meridian.crosshair`. Clean view may keep it; credits stay
  on. Not a Cesium layer, not a geo entity, and no `/api`.
- Added a left-stack **FIRES** list from the existing trailing-24h NASA FIRMS
  payload (`/api/firms` `fires[]`). Up to 50 detections nearest the camera;
  clicking a row flies there with the current world-focus helper. Keyless 503
  or an empty payload shows unavailable copy and does not fetch NASA from the
  client. The required FIRMS acknowledgement stays on the panel. Traffic
  Live/Sim is unchanged. No extra `/api` route.
- Added a Sites control that lists mapped installations already returned for
  the current 10° view. Clicking a row flies to that feature through the
  existing `focusById` path. Empty bbox stays empty. No new `/api`, person
  search, or bbox-cap change. Measure mode is independent.
- Keyboard users can yaw with **Q/E** and pitch with **R / Page Up / Page Down**.
  WASD still pans. Lock tilt (the DISPLAY control flag) blocks the pitch
  keys. **F** still opens the data panel (fullscreen stays the button +
  Escape). The shortcuts overlay (`?` and the chrome keyboard button) lists
  these keys.
- Added a DISPLAY-rail Lock tilt control. When on, user rotate changes
  heading only and pitch stays (keep horizon). Unlock restores free tumble.
  The choice persists as `meridian.lockTilt` and defaults off. Home and
  cockpit still set their own pitch. Wheel zoom / invert scroll stay
  wheel-only. No `/api`.
- Added a DISPLAY-rail Keep above ground control. After the camera moves, if
  `globe.getHeight` or the warm `/api/terrain/heights` floor says the eye is
  below terrain plus a small margin, the camera is lifted. The preference
  persists as `meridian.keepAbove` and defaults on. Cockpit interior still
  owns the camera. A terrain 503 skips the lift. No new API.
- Added a Clean view control on the globe chrome that toggles the existing
  `ui-clean-view` hide-chrome path. Esc or a second click restores panels.
  Google Maps and Data attribution stay on. No new hide system and no `/api`.
- Contact Labels on/off (declutter) hides ambient callsign billboards on
  busy FIRs. Dots, models, and trails stay. Selected/tracked ident cards stay.
  Density still only changes detections. Persists `meridian.contactLabels`
  (default on). Display only; no `/api`.
- DISPLAY Grid toggle draws a local lat/lon graticule (`meridian.grid`,
  default off). The step coarsens when zoomed out so a planet view stays
  readable. Clean view may keep the lines; required credits stay on. Not a
  data layer and no `/api`.
- Added a Launches panel that lists the existing Launch Library 2 results
  the globe already fetches (`/api/launches`). Clicking a row flies to the
  pad when coordinates are present, otherwise the row is only selected.
  Empty or failed payloads use the existing unavailable/empty language and
  do not hang. No new vendor or `/api`.
- Satellites row can pick a CelesTrak TLE group (stations, weather, visual, GPS, GLONASS, Galileo, GEO). Changing the group refetches `/api/celestrak/<group>` and replaces the layer. The choice persists as `meridian.satGroup` (`stations` default). Invalid groups are not listed. Space Missions still uses `/api/celestrak/active` independently; the Launches panel stays on `/api/launches`. No new `/api`.
- Added a DISPLAY Power control (`Normal` | `Low`). Low caps the existing
  Cesium `targetFrameRate` at 30; Normal restores the current 60 default.
  The choice persists as `meridian.power`. Data polls, the idle render
  governor, and required credits are unchanged. Clean view still keeps
  Google Maps and Data attribution on screen.
- Added a DISPLAY Zoom to pointer control. On, the wheel zooms about the
  globe pick under the cursor so a city stays under the pointer. Off keeps
  today's center zoom. No pick falls back to center. Invert scroll still
  only flips direction. The choice persists as `meridian.zoomToPointer`
  and defaults off.
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
- Added a panic **All off** control on the existing Clear Layers chrome.
  It disables every live data layer and keeps the globe, credits, and
  camera. `meridian.lastView` is not cleared. The next enable is manual.
  First-visit layer defaults still apply only on a fresh profile. Banned
  layers stay off. No `/api`.
- **Restore** sits next to All off and reapplies the enabled-layer snapshot
  taken immediately before All off. Hidden until All off has been used this
  session. Does not move the camera. Banned cables / OpenSky / GNews never
  restore on. No `/api`.
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
- Radio volume is a 0–100 slider on the existing Radio Browser audio element.
  The level persists as `meridian.radioVolume`. Mute sets 0 and unmute
  restores the prior level. Disabling the Radio layer still stops audio.
  Station search and play are unchanged. No new `/api` and no voice ducking.

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

### Changed

- Remaining runtime preference keys now write `meridian.*`. A first read of a
  known `godsEyeView.*` layout or settings key copies it once and leaves the
  older key in place. Proxy User-Agents identify as Meridian; the window
  handle is `window.__meridian`. LICENSE credit and the UI title are unchanged.

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
