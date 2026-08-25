import { formatMissingEnvError, missingClerkEnv, readBillingEnv } from './env.js';

export function readBearerToken(req) {
  const header = req?.headers?.authorization || req?.headers?.Authorization || '';
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== 'string') return '';
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

/**
 * Verify a Clerk session JWT. `verifyToken` is injectable so unit tests never
 * need live Clerk keys.
 */
export async function authenticateRequest(req, {
  env = process.env,
  verifyToken,
} = {}) {
  const config = readBillingEnv(env);
  if (!config.hosted) {
    if (config.clerkPartial) {
      const missing = missingClerkEnv(config);
      return {
        ok: false,
        hosted: true,
        status: 503,
        error: `Hosted billing is not configured. ${formatMissingEnvError(missing)}`,
        code: 'clerk_not_configured',
        missing,
      };
    }
    return { ok: true, hosted: false, user: null };
  }

  const token = readBearerToken(req);
  if (!token) {
    return { ok: false, hosted: true, status: 401, error: 'Sign in required.', code: 'auth_required' };
  }

  const verify = verifyToken || defaultVerifyToken;
  try {
    const payload = await verify(token, {
      secretKey: config.clerkSecretKey,
      jwtKey: config.clerkJwtKey || undefined,
    });
    const userId = payload?.sub;
    if (!userId) {
      return { ok: false, hosted: true, status: 401, error: 'Invalid session.', code: 'auth_required' };
    }
    return {
      ok: true,
      hosted: true,
      user: {
        id: userId,
        email: payload.email || payload.primaryEmail || null,
      },
    };
  } catch {
    return { ok: false, hosted: true, status: 401, error: 'Invalid session.', code: 'auth_required' };
  }
}

async function defaultVerifyToken(token, options) {
  const { verifyToken } = await import('@clerk/backend');
  return verifyToken(token, options);
}
