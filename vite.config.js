/**
 * Vite configuration for Meridian — a cinematic geospatial app.
 *
 * Live /api proxies live in `src/server/liveApiProxies.js` so Vercel Node
 * functions can reuse the same handlers without bundling Vite or Cesium.
 *
 * Also exposes Cesium and Google 3D Tiles API keys to the
 * client via `import.meta.env.*` defines.
 *
 * @module vite.config
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import cesium from 'vite-plugin-cesium';
import { ensurePreviewApiProxies } from './scripts/ensurePreviewApiProxies.js';
import { meridianBillingPlugin } from './src/billing/plugin.js';
import { createLiveApiPlugins } from './src/server/liveApiProxies.js';

export * from './src/server/liveApiProxies.js';

/** Resolve __dirname for ESM context. */
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Main Vite configuration factory.
 *
 * Loads .env files via Vite's loadEnv, registers Cesium + local proxy
 * plugins, configures the dev server host/port, and exposes selected
 * API keys to the client as import.meta.env defines.
 */
export default defineConfig(({ mode }) => {
  // Load only this checkout's dotenv files. Shell/Keychain values still win,
  // and no sibling workspace is consulted implicitly.
  const loaded = loadEnv(mode, __dirname, '');
  for (const [key, val] of Object.entries(loaded)) {
    if (process.env[key] === undefined) process.env[key] = val;
  }
  const env = { ...process.env };
  const host = env.HOST || 'localhost';
  const port = parseInt(env.PORT, 10) || 5173;
  const allowedHosts = (host === '0.0.0.0' || host === '::')
    ? true
    : ['localhost', '127.0.0.1', '.local'];
  return {
    plugins: ensurePreviewApiProxies([
      cesium(),
      ...createLiveApiPlugins(),
      meridianBillingPlugin(),
    ]),
    server: {
      host,
      port,
      // When binding to all interfaces, allow any host; otherwise restrict to local names
      allowedHosts,
    },
    preview: {
      host,
      port,
      allowedHosts,
    },
    // Expose selected API keys to the browser via import.meta.env.*
    define: {
      'import.meta.env.GOOGLE_MAPS_API_KEY': JSON.stringify(env.GOOGLE_MAPS_API_KEY),
      'import.meta.env.CESIUM_ION_TOKEN': JSON.stringify(env.CESIUM_ION_TOKEN),
      'import.meta.env.CLERK_PUBLISHABLE_KEY': JSON.stringify(
        env.CLERK_PUBLISHABLE_KEY || env.VITE_CLERK_PUBLISHABLE_KEY || '',
      ),
    },
    build: {
      // The Cesium engine bundle is inherently large; raise the warning ceiling
      // so the build log isn't dominated by an expected chunk-size notice.
      chunkSizeWarningLimit: 1500,
    },
  };
});
