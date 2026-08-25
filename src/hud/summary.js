import { getBillingRuntime } from '../billing/http.js';
import { readRequestBody, rejectIfRealtimeSpendForbidden } from '../voice/openaiApi.js';

export const OPENAI_HUD_SUMMARY_MODEL_DEFAULT = 'gpt-5-nano';

const HUD_SUMMARY_INSTRUCTIONS = [
  'Write one concise intelligence-HUD summary for Meridian.',
  'Use only the supplied place, street, nearby-place, and enabled-layer text labels.',
  'Prefer the clearest named place and include a relevant enabled layer only when useful.',
  'Do not infer from coordinates or invent a place.',
  'Output exactly five words with no title, punctuation, markdown, or introductory phrase.',
].join(' ');

const HUD_LABEL_KEYS = Object.freeze([
  'place',
  'placeLabels',
  'street',
  'streetLabels',
  'nearbyPlace',
  'nearbyPlaceLabels',
  'layers',
  'enabledLayerLabels',
]);

/**
 * Five-word HUD summary via OpenAI Responses. Used by Vite middleware and
 * the Vercel Node function at /api/openai/hud-summary.
 */
export async function handleHudSummaryHttp(req, res, {
  env = process.env,
  fetchImpl = fetch,
  runtime = getBillingRuntime(),
} = {}) {
  if ((req.method || 'GET') !== 'POST') {
    writeJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  const apiKey = String(env.OPENAI_API_KEY || '').trim();
  if (!apiKey) {
    writeJson(res, 503, { error: 'OPENAI_API_KEY is not set' });
    return;
  }
  if (await rejectIfRealtimeSpendForbidden(req, res, runtime)) return;

  try {
    const raw = await readRequestBody(req, 64 * 1024);
    const context = JSON.parse(raw || '{}');
    const labels = buildHudSummaryInput(context);
    const response = await fetchImpl('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: env.OPENAI_HUD_SUMMARY_MODEL || OPENAI_HUD_SUMMARY_MODEL_DEFAULT,
        instructions: HUD_SUMMARY_INSTRUCTIONS,
        input: JSON.stringify(labels),
        reasoning: { effort: 'minimal' },
        max_output_tokens: 100,
      }),
    });
    const data = await response.json().catch(() => ({}));
    const summary = toFiveWordHudSummary(extractOpenAiResponseText(data));
    writeJson(res, response.ok && summary ? 200 : response.status || 502, {
      summary: summary || null,
      error: response.ok ? null : data.error?.message || 'OpenAI HUD summary request failed',
    });
  } catch (error) {
    writeJson(res, 502, { error: error?.message || 'OpenAI HUD summary request failed' });
  }
}

/** @deprecated Prefer handleHudSummaryHttp. Kept for existing Vite forwards. */
export const handleHudSummary = handleHudSummaryHttp;

/**
 * Labels-only prompt payload. Coordinates and invented place fields are dropped
 * so a lat/lon-only context cannot smuggle a city name into the model.
 */
export function buildHudSummaryInput(context = {}) {
  const input = {};
  for (const key of HUD_LABEL_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(context, key)) continue;
    const value = sanitizeHudLabelValue(context[key]);
    if (value !== undefined) input[key] = value;
  }
  return input;
}

export function extractOpenAiResponseText(data) {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) {
    return data.output_text.trim();
  }
  if (!Array.isArray(data?.output)) return '';
  return data.output
    .flatMap((item) => (Array.isArray(item?.content) ? item.content : []))
    .map((part) => part?.text || part?.output_text || '')
    .join(' ')
    .trim();
}

export function toFiveWordHudSummary(value) {
  return String(value || '')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5)
    .join(' ');
}

function sanitizeHudLabelValue(value) {
  if (Array.isArray(value)) {
    const labels = value.map((item) => String(item || '').trim()).filter(Boolean);
    return labels.length ? labels : undefined;
  }
  if (typeof value === 'string') {
    const text = value.trim();
    return text || undefined;
  }
  return undefined;
}

function writeJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
  return true;
}
