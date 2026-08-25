# OpenSky is disabled

Meridian does not use the OpenSky Network. OpenSky's research/education license is non-commercial, so this commercial fork never fetches `opensky-network.org` or `auth.opensky-network.org`.

Civilian flights use **adsb.lol** (ODbL 1.0) only:

- `/api/opensky` is a compatibility path. It serves a bounded 250 nm adsb.lol snapshot around the current view `lat`/`lon`. It does not contact OpenSky.
- `/api/opensky-track` returns HTTP 410 without contacting OpenSky. Trails keep locally accumulated history.

`OPENSKY_*` environment variables and `scripts/opensky-import-client.sh` are unused leftovers from the upstream project. Do not configure OpenSky credentials for this fork.

See [DATA_SOURCES.md](../DATA_SOURCES.md).
