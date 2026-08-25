/**
 * Production (`vite preview`) only runs configurePreviewServer hooks.
 * Several layer proxies historically registered only configureServer — mirror
 * those onto preview so a built deploy keeps the same /api/* surface as dev.
 * Plugins that already define configurePreviewServer are left unchanged.
 *
 * @param {import('vite').PluginOption[]} plugins
 * @returns {import('vite').PluginOption[]}
 */
export function ensurePreviewApiProxies(plugins) {
  return plugins.map((plugin) => {
    if (!plugin || typeof plugin !== 'object' || Array.isArray(plugin)) return plugin;
    /** @type {import('vite').Plugin} */
    const p = plugin;
    if (typeof p.configureServer === 'function' && typeof p.configurePreviewServer !== 'function') {
      return { ...p, configurePreviewServer: p.configureServer };
    }
    return p;
  });
}
