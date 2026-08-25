/**
 * @module selectedContactCard
 * @description Copy the selected-contact readout as a short plain-text card.
 * Fields are the public ADS-B values already shown from the describe() →
 * context path (ident, registration, hex, type, alt, speed, heading, lat/lon).
 * Missing values are omitted — never "unknown". No origin/destination, news,
 * snapshot, or /api.
 */

export const SELECTED_CONTACT_CARD_COPY_ID = 'selected-contact-card-copy';
export const CONTACT_CARD_COORD_DECIMALS = 4;

const MISSING_FIELD = /unknown|\bn\/a\b/i;

/**
 * Visible card value, or '' when the field is absent / a placeholder.
 * @param {unknown} value
 * @returns {string}
 */
export function presentCardField(value) {
  const text = String(value ?? '').trim();
  if (!text || MISSING_FIELD.test(text)) return '';
  return text;
}

/**
 * Share-link / Slack-pin order. Same decimal count as copy-coords, but this
 * writes the selected contact, not the camera center.
 * @param {number} latitude
 * @param {number} longitude
 * @param {number} [decimals=CONTACT_CARD_COORD_DECIMALS]
 * @returns {string}
 */
export function formatContactCardLatLon(latitude, longitude, decimals = CONTACT_CARD_COORD_DECIMALS) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return '';
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return '';
  return `${latitude.toFixed(decimals)},${longitude.toFixed(decimals)}`;
}

/**
 * Short labeled card. Extra keys (route, news, operator, status) are ignored.
 * Commercial and military flights use this same shape.
 * @param {object} [input]
 * @returns {string}
 */
export function formatSelectedContactCard(input = {}) {
  const ident = presentCardField(input.ident);
  const registration = presentCardField(input.registration);
  const hex = presentCardField(input.hex ?? input.icao24);
  const type = presentCardField(input.type);
  const altitude = presentCardField(input.altitude ?? input.alt);
  const speed = presentCardField(input.speed);
  const heading = presentCardField(input.heading);
  const latLon = formatContactCardLatLon(
    input.latitude ?? input.lat,
    input.longitude ?? input.lon,
  );

  const lines = [];
  if (ident) lines.push(`Ident: ${ident}`);
  if (registration) lines.push(`Registration: ${registration}`);
  if (hex) lines.push(`Hex: ${hex}`);
  if (type) lines.push(`Type: ${type}`);
  if (altitude) lines.push(`Alt: ${altitude}`);
  if (speed) lines.push(`Speed: ${speed}`);
  if (heading) lines.push(`Heading: ${heading}`);
  if (latLon) lines.push(`Lat/Lon: ${latLon}`);
  return lines.join('\n');
}

/**
 * Pick only the public fields already on the selected-contact readout.
 * Route / origin / destination / news / operator / status stay off the card.
 * @param {object|null} [context] Selected-entity context from describe().
 * @param {string} [ident] Visible ident already shown on the card.
 * @returns {object}
 */
export function contactCardFieldsFromContext(context, ident = '') {
  const props = context?.properties || {};
  return {
    ident: ident
      || presentCardField(context?.label)
      || presentCardField(props.callsign)
      || presentCardField(props.name),
    registration: props.registration,
    hex: props.icao24,
    type: props.type,
    altitude: props.altitude,
    speed: props.speed,
    heading: props.heading,
    latitude: context?.latitude,
    longitude: context?.longitude,
  };
}

/**
 * Toast copy for a successful card copy. Distinct from ident / coords.
 * @returns {string}
 */
export function copiedCardToast() {
  return 'Copied card';
}

/**
 * Copy the formatted card via clipboard.writeText.
 * @param {object|string} input Card fields or already-formatted text.
 * @param {object} [options]
 * @returns {Promise<boolean>}
 */
export async function copySelectedContactCard(input, options = {}) {
  const text = typeof input === 'string' ? input : formatSelectedContactCard(input);
  if (!text) return false;
  const toast = options.showToast;
  const ok = await writeClipboardText(text, options.clipboard);
  if (typeof toast === 'function') toast(ok ? copiedCardToast() : 'Copy failed');
  return ok;
}

async function writeClipboardText(text, clipboard) {
  try {
    if (clipboard?.writeText) {
      await clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to execCommand */
  }
  const documentRef = globalThis.document;
  if (!documentRef?.body || typeof documentRef.execCommand !== 'function') return false;
  const field = documentRef.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.left = '-9999px';
  documentRef.body.appendChild(field);
  field.select();
  let ok = false;
  try {
    ok = documentRef.execCommand('copy');
  } catch {
    ok = false;
  }
  field.remove();
  return ok;
}
