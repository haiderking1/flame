import { generateKeyPairSync, sign } from 'node:crypto';
import { JWKS_URL, ISSUER } from '../../dist/backend/auth/chatgpt/id-token.js';

const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
export const PLAN_SCOPES = 'chatgpt.tokens.use.direct email offline_access openid profile resource.invoke';

/**
 * OpenAI's sign-in endpoints for Sign in with ChatGPT: a real RSA signing key published as a JWKS, ID tokens signed with
 * it, and a token endpoint whose replies a test can change. Every request is recorded.
 */
export function fakeOpenAIAuth() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  const requests = [];
  let refreshCount = 0;
  const auth = {
    requests, subject: 'user-subject', email: 'plan@example.com', scope: PLAN_SCOPES, nonce: null,
    idToken(claims = {}, key = privateKey) {
      const header = { alg: 'RS256', kid: 'key-1', typ: 'JWT' };
      const payload = { iss: ISSUER, aud: claims.aud ?? auth.lastClient, sub: auth.subject, email: auth.email, exp: Math.floor(Date.now() / 1000) + 3600,
        ...(auth.nonce ? { nonce: auth.nonce } : {}), ...claims };
      const data = `${b64(header)}.${b64(payload)}`;
      return `${data}.${sign('sha256', Buffer.from(data), key).toString('base64url')}`;
    },
    foreignKey: other,
    lastClient: null,
    // Overrides the next token reply.
    reply: null,
    async fetch(url, init) {
      if (url === JWKS_URL) return Response.json({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'key-1', alg: 'RS256', use: 'sig' }] });
      const body = init.body;
      requests.push({ url, body: Object.fromEntries(body.entries()) });
      auth.lastClient = body.get('client_id');
      if (auth.reply) { const reply = auth.reply; auth.reply = null; return typeof reply === 'function' ? reply() : reply; }
      const refreshing = body.get('grant_type') === 'refresh_token';
      if (refreshing) refreshCount++;
      return Response.json({ access_token: `access-${refreshCount}`, refresh_token: `refresh-${refreshCount}`, token_type: 'Bearer', expires_in: 3600,
        scope: auth.scope, ...(refreshing ? {} : { id_token: auth.idToken() }) });
    },
  };
  return auth;
}
