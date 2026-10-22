import { createRemoteJWKSet, jwtVerify } from 'jose';

const noStore = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const metadataPaths = new Set([
  '/.well-known/oauth-protected-resource',
  '/.well-known/oauth-protected-resource/mcp',
]);

export function readConfig(env = process.env) {
  const { GARMIN_PERSONAL_API_KEY: apiKey, AUTHKIT_ISSUER: issuer,
    AUTHKIT_USER_ID: userId, MCP_RESOURCE_URL: resource } = env;
  if (![apiKey, issuer, userId, resource].every(v => typeof v === 'string' && v.trim())) {
    throw new Error('Missing server configuration');
  }
  const issuerUrl = new URL(issuer);
  const resourceUrl = new URL(resource);
  if (issuerUrl.protocol !== 'https:' || issuerUrl.pathname !== '/' ||
      issuerUrl.search || issuerUrl.hash || issuerUrl.username || issuerUrl.password ||
      resourceUrl.protocol !== 'https:' || resourceUrl.pathname !== '/mcp' ||
      resourceUrl.search || resourceUrl.hash || resourceUrl.username || resourceUrl.password ||
      !userId.startsWith('user_')) throw new Error('Invalid server configuration');
  return { apiKey: apiKey.trim(), issuer: issuerUrl.origin, userId,
    resource: resourceUrl.href, metadataUrl: `${resourceUrl.origin}/.well-known/oauth-protected-resource` };
}

export function tokenVerifier(config, jwks = createRemoteJWKSet(new URL('/oauth2/jwks', config.issuer))) {
  return async token => {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: config.issuer, audience: config.resource,
      algorithms: ['RS256'], requiredClaims: ['exp', 'iat', 'sub'],
    });
    return payload;
  };
}

export function createGateway({ config, verifyToken = tokenVerifier(config), mcp }) {
  const challenge = `Bearer resource_metadata="${config.metadataUrl}", scope="openid"`;
  const json = (body, status = 200, headers = {}) => Response.json(body, {
    status, headers: { ...noStore, ...headers },
  });

  return async request => {
    const path = new URL(request.url).pathname;
    if (metadataPaths.has(path)) {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: {
        ...noStore, 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS',
      } });
      if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET, OPTIONS' });
      return json({ resource: config.resource, resource_name: 'Personal Garmin',
        authorization_servers: [config.issuer], bearer_methods_supported: ['header'],
        scopes_supported: ['openid', 'offline_access'] }, 200, { 'Access-Control-Allow-Origin': '*' });
    }
    if (path === '/') return json({ name: 'Personal Garmin MCP', endpoint: '/mcp', authentication: 'OAuth required' });
    if (path !== '/mcp') return json({ error: 'not_found' }, 404);
    if (!['GET', 'POST', 'DELETE'].includes(request.method)) {
      return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET, POST, DELETE' });
    }
    const token = request.headers.get('authorization')?.match(/^Bearer ([^\s]+)$/i)?.[1];
    if (!token) return json({ error: 'unauthorized' }, 401, { 'WWW-Authenticate': challenge });
    let claims;
    try { claims = await verifyToken(token); }
    catch { return json({ error: 'invalid_token' }, 401, { 'WWW-Authenticate': `${challenge}, error="invalid_token"` }); }
    // This deployment holds one person's Garmin key. A valid login alone is insufficient.
    if (claims.sub !== config.userId) return json({ error: 'forbidden' }, 403);
    if (!(typeof claims.scope === 'string' && claims.scope.split(' ').includes('openid'))) {
      return json({ error: 'insufficient_scope' }, 403, {
        'WWW-Authenticate': `${challenge}, error="insufficient_scope"`,
      });
    }
    try {
      const response = await mcp(request);
      const headers = new Headers(response.headers);
      for (const [key, value] of Object.entries(noStore)) headers.set(key, value);
      return new Response(response.body, { status: response.status, headers });
    } catch {
      // Never expose upstream errors, tokens, or configuration in public HTTP errors.
      return json({ error: 'upstream_unavailable' }, 502);
    }
  };
}
