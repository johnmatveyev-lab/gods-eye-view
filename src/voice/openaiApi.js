import { getBillingRuntime, rejectIfVoiceForbidden } from '../billing/http.js';
import { isKnownVoiceTier, resolveVoiceModel, VOICE_MODELS } from './voiceCost.js';
import { realtimeInstructions } from './realtimeInstructions.js';
import { GEV_REALTIME_TOOLS } from './realtimeTools.js';

export const OPENAI_REALTIME_MODEL_DEFAULT = VOICE_MODELS.standard.id;
export const OPENAI_REALTIME_MODEL_MINI_DEFAULT = VOICE_MODELS.mini.id;
export const OPENAI_REALTIME_VOICE_DEFAULT = 'marin';
export const OPENAI_REALTIME_REASONING_DEFAULT = 'low';
export const OPENAI_REALTIME_CONTEXT_TOKENS_DEFAULT = 3000;
export const OPENAI_REALTIME_CONTEXT_RETENTION_DEFAULT = 0.5;
export const OPENAI_HUD_SUMMARY_MODEL_DEFAULT = 'gpt-5-nano';

const HUD_SUMMARY_INSTRUCTIONS = [
  'Write one concise intelligence-HUD summary for Meridian.',
  'Use only the supplied place, street, nearby-place, and enabled-layer text labels.',
  'Prefer the clearest named place and include a relevant enabled layer only when useful.',
  'Do not infer from coordinates or invent a place.',
  'Output exactly five words with no title, punctuation, markdown, or introductory phrase.',
].join(' ');

/**
 * Mint an ephemeral OpenAI Realtime client secret. Used by Vite middleware
 * and the Vercel Node function at /api/realtime/token.
 */
export async function handleRealtimeToken(req, res, {
  env = process.env,
  fetchImpl = fetch,
  runtime = getBillingRuntime(),
} = {}) {
  const method = req.method || 'GET';
  if (method !== 'GET' && method !== 'POST') {
    writeJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  const apiKey = String(env.OPENAI_API_KEY || '').trim();
  if (!apiKey) {
    writeJson(res, 503, { error: 'OPENAI_API_KEY is not set' });
    return;
  }
  if (await rejectIfVoiceForbidden(req, res, runtime)) return;

  const requestedTier = readQueryParam(req, 'tier');
  const resolved = resolveVoiceModel(requestedTier);
  const tier = resolved.tier;
  const model = tier === 'mini'
    ? env.OPENAI_REALTIME_MODEL_MINI || OPENAI_REALTIME_MODEL_MINI_DEFAULT
    : env.OPENAI_REALTIME_MODEL || OPENAI_REALTIME_MODEL_DEFAULT;
  const sessionConfig = buildRealtimeSessionConfig({ env, model });

  try {
    const response = await fetchImpl('https://api.openai.com/v1/realtime/client_secrets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'OpenAI-Safety-Identifier': env.VERCEL ? 'meridian-hosted' : 'gev-local-dev',
      },
      body: JSON.stringify(sessionConfig),
    });
    const body = await response.text();
    res.statusCode = response.status;
    res.setHeader('Content-Type', headerOf(response, 'content-type') || 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-GEV-Voice-Tier', tier);
    res.setHeader('X-GEV-Voice-Model', model);
    if (requestedTier && !isKnownVoiceTier(requestedTier)) {
      res.setHeader('X-GEV-Voice-Tier-Fallback', '1');
    }
    res.end(body);
  } catch (error) {
    writeJson(res, 502, { error: error?.message || 'Failed to create Realtime token' });
  }
}

/**
 * Five-word HUD summary via OpenAI Responses. Used by Vite middleware and
 * the Vercel Node function at /api/openai/hud-summary.
 */
export async function handleHudSummary(req, res, {
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
  if (await rejectIfVoiceForbidden(req, res, runtime)) return;

  try {
    const raw = await readRequestBody(req, 64 * 1024);
    const context = JSON.parse(raw || '{}');
    const response = await fetchImpl('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: env.OPENAI_HUD_SUMMARY_MODEL || OPENAI_HUD_SUMMARY_MODEL_DEFAULT,
        instructions: HUD_SUMMARY_INSTRUCTIONS,
        input: JSON.stringify(context),
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

export function buildRealtimeSessionConfig({ env = process.env, model } = {}) {
  const voice = env.OPENAI_REALTIME_VOICE || OPENAI_REALTIME_VOICE_DEFAULT;
  const effort = env.OPENAI_REALTIME_REASONING_EFFORT || OPENAI_REALTIME_REASONING_DEFAULT;
  const contextTokenLimit = Math.round(Math.max(
    1000,
    Math.min(12000, Number(env.OPENAI_REALTIME_CONTEXT_TOKENS) || OPENAI_REALTIME_CONTEXT_TOKENS_DEFAULT),
  ));
  const contextRetentionRatio = Math.max(
    0.1,
    Math.min(1, Number(env.OPENAI_REALTIME_CONTEXT_RETENTION) || OPENAI_REALTIME_CONTEXT_RETENTION_DEFAULT),
  );
  return {
    session: {
      type: 'realtime',
      model,
      reasoning: { effort },
      truncation: {
        type: 'retention_ratio',
        retention_ratio: contextRetentionRatio,
        token_limits: {
          post_instructions: contextTokenLimit,
        },
      },
      audio: {
        input: {
          noise_reduction: { type: 'near_field' },
          turn_detection: {
            type: 'semantic_vad',
            eagerness: 'low',
            create_response: true,
            interrupt_response: false,
          },
        },
        output: { voice },
      },
      instructions: realtimeInstructions(),
      tools: GEV_REALTIME_TOOLS,
      tool_choice: 'auto',
    },
  };
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

export function readRequestBody(req, maxBytes = 1024 * 1024) {
  if (typeof req.rawBody === 'string' || Buffer.isBuffer(req.rawBody)) {
    return Promise.resolve(String(req.rawBody));
  }
  if (typeof req.body === 'string' || Buffer.isBuffer(req.body)) {
    return Promise.resolve(String(req.body));
  }
  if (req.body && typeof req.body === 'object') {
    return Promise.resolve(JSON.stringify(req.body));
  }
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error(`Request body exceeds ${maxBytes} bytes`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function writeJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
  return true;
}

function readQueryParam(req, name) {
  try {
    return new URL(req.url || '', 'http://localhost').searchParams.get(name);
  } catch {
    return null;
  }
}

function headerOf(response, name) {
  if (typeof response.headers?.get === 'function') return response.headers.get(name);
  return response.headers?.[name] || response.headers?.[name.toLowerCase()] || '';
}
