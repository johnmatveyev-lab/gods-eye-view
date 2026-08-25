/** Build a share URL from the current page and a hash snapshot. */
export function encodeShareViewUrl(href, hash) {
  const url = new URL(href);
  url.hash = String(hash || '').replace(/^#/, '');
  return url.href;
}

/** Read the share-hash payload stored on a saved-view URL. */
export function decodeShareViewUrl(urlString) {
  try {
    const parsed = new URL(urlString, 'http://localhost/');
    return parsed.hash.replace(/^#/, '');
  } catch {
    return '';
  }
}
