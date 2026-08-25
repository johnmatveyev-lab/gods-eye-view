<div align="center">

# Meridian

### A photorealistic 3D globe and live-signal console.

Live aircraft, ships, satellites, earthquakes, traffic, and public cameras, with clearly labeled modeled views where a live feed is unavailable. Hands-free voice control powered by a realtime AI agent.

Meridian is an **independent commercial product** based on the MIT-licensed [God's Eye View](https://github.com/bilawalsidhu/gods-eye-view) project. It is **not affiliated with, endorsed by, or an official continuation of** Bilawal Sidhu or the God's Eye View series.

</div>

---

## Legal cleanup in this fork

This commercial fork removes or disables sources that are not safe for hosted commercial use:

- **TeleGeography submarine cables** (CC BY-NC-SA 3.0 NonCommercial) — dataset deleted; the layer is a registered no-op.
- **OpenSky Network** — never contacted. Civilian flights use **adsb.lol** (ODbL 1.0) only.
- **Google News RSS** — never contacted. Cockpit headlines use **GDELT** only, with citation.

Required attributions remain visible: Google Maps credits, OpenStreetMap, TfL, Open-Meteo, CC BY 4.0 model credits, and the in-app Data attribution popover (`src/data/dataCredits.js`). See [DATA_SOURCES.md](DATA_SOURCES.md) and [LICENSE](LICENSE).

This product does not add person-search, face recognition, or named-person tracking.

---

## Quick Start

Requires Node.js 24.14.x or 26.x (enforced by `package.json`).

1. Copy `.env.example` → `.env` and set `GOOGLE_MAPS_API_KEY`.
2. Install and run:

```bash
npm install
npm run dev -- --host localhost --port 4173
```

3. Open **`http://localhost:4173`**.

**That one key is the whole entry fee.** Google Maps buys the photorealistic planet. Restrict the key (see [SECURITY.md](SECURITY.md)). Full source map in [DATA_SOURCES.md](DATA_SOURCES.md).

The dev server binds to **localhost** — your keys stay on your machine.

---

## What's on the globe

- **Cockpit view:** Ride inside a tracked flight.
- **Contacts:** A 250 km roster of nearby live aircraft.
- **Click-to-track:** Camera locks on, draws a fading trail, surfaces metadata.
- **Voice whiteboard:** Speak annotations onto the world. Clear them from the globe chrome when marks are present.
- **3D hangar:** Per-class aircraft models as you close in.
- **Sensor looks:** CRT, NVG, FLIR/thermal, Noir, Snow.
- **Share links:** Camera, style, layers, and one tracked target serialize into a URL.

---

## Hosted billing (Clerk + Stripe)

Meridian can run as a **hosted service**: users sign in, get a capped Free demo, and upgrade to Pro through Stripe Checkout. This is hosted access to the console, not a data resale.

Leave the billing keys unset for self-host / BYOK. The globe still works when `GOOGLE_MAPS_API_KEY` is set, and voice still works when `OPENAI_API_KEY` is set.

| Plan | What you get |
|------|----------------|
| **Free** (signed in) | Globe works. No voice. Hard daily cap: **15 minutes** of session time and a request budget. Remaining budget is shown in the account chip. |
| **Pro** ($29/mo) | Voice (OpenAI Realtime via the **server** `OPENAI_API_KEY`, never a ChatGPT consumer subscription). Higher daily cap (8 hours). Up to 10 saved views in this browser. |

Setup:

1. Create a Clerk application and set `CLERK_PUBLISHABLE_KEY` + `CLERK_SECRET_KEY`. `VITE_CLERK_PUBLISHABLE_KEY` is also accepted.
2. In Stripe, create a **subscription Price** for Pro and put its `price_...` ID in `STRIPE_PRICE_PRO`. Do not invent products in code.
3. Set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`.
4. Point a Stripe webhook at `https://<host>/api/stripe/webhook` for `checkout.session.completed`, `customer.subscription.updated`, and `customer.subscription.deleted`.
5. Keep `OPENAI_API_KEY` on the server. The browser only receives a short-lived Realtime session token, and only after the account is Pro.

If Stripe keys are missing, the Upgrade button explains that Checkout is not configured instead of failing silently. Unit tests mock Stripe and Clerk — they do not need live keys.

On Vercel the globe is a Vite static build. Hosted billing therefore lives in Node functions (`api/billing/[...path].js` and `api/stripe/webhook.js`) that forward to `handleBillingHttp`. The cockpit regional brief is the same pattern: `api/regional-brief.js` forwards to `handleRegionalBrief` (GDELT + Open-Meteo + Nominatim; no Google News RSS). Optional TomTom live traffic uses `api/tomtom/[...path].js` → `src/data/tomtom.js`: `/api/tomtom/status` is always JSON, and a missing `TOMTOM_API_KEY` is `503 {error:'no_key'}` without contacting TomTom. Leave Clerk/Stripe unset on a preview and billing routes still respond with `503`/`401` JSON — they must not be a Vercel platform 404. This extract does not wrap `/api/ais-live`. Docker/`vite preview` (Fly, Render) keeps the same handlers in-process.

Optional: `MERIDIAN_BILLING_STORE_PATH=.meridian-billing/accounts.json` persists plan + daily usage across process restarts (in-memory otherwise).

If you charge US or EU customers, consider enabling [Stripe Tax](https://docs.stripe.com/billing/taxes/collect-taxes) and complete a registration first. Do not turn on `automatic_tax` in Checkout until that registration is active.

---

## Keys & costs

| | Cost reality |
|---|---|
| **Most layers** | **$0, no signup.** USGS, CelesTrak, adsb.lol, city CCTV, Radio Browser, GBFS, Launch Library 2, bundled OSM extracts. |
| **Optional developer access** | AISStream, FIRMS, TomTom, and Cesium ion may offer no-cost access, but limits and permitted uses differ. |
| **Google 3D tiles** | Map Tiles usage is billed by session. Restrict the key, set quotas, and configure a budget alert. |
| **OpenAI voice** | Realtime audio is usage-metered. The app shows a live session estimate and applies an in-app session cap; provider-side usage limits remain the billing backstop. |

Cesium ion imagery must not be mixed with Google Photorealistic 3D Tiles. Use one globe imagery stack at a time.

Hosted Vercel has no live AIS; Docker and `vite preview` still do when `AISSTREAM_API_KEY` is set.

---

## Responsible use

Meridian visualizes **public and third-party data**. Data may be delayed, incomplete, modeled, inferred, or wrong. Do not use it for flight or maritime navigation, emergency response, medical or health decisions, investment decisions, or other safety-critical or operational purposes.

The product models **events, assets, infrastructure, and systems** — aircraft, vessels, satellites, fires, cameras, cities. It does not build features for named-person search, face recognition, or tracking individuals.

Released under the **[MIT License](LICENSE)**. Bundled and live datasets carry their own terms — see **[DATA_SOURCES.md](DATA_SOURCES.md)**. Security model: **[SECURITY.md](SECURITY.md)**.
