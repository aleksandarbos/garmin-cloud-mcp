import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from 'jose';
import { readConfig, tokenVerifier, createGateway } from '../lib/gateway.js';
import { createMcpHandler } from '../lib/mcp.js';
import entry from '../api/gateway.js';

const env = {
  GARMIN_PERSONAL_API_KEY: 'fake-key-for-local-tests',
  AUTHKIT_ISSUER: 'https://example.authkit.app',
  AUTHKIT_USER_ID: 'user_owner',
  MCP_RESOURCE_URL: 'https://example.vercel.app/mcp',
};
const config = readConfig(env);
const { privateKey, publicKey } = await generateKeyPair('RS256');
const jwks = createLocalJWKSet({ keys: [{ ...await exportJWK(publicKey), kid: 'test-key', alg: 'RS256' }] });
const verifyToken = tokenVerifier(config, jwks);
let called = 0;
const gateway = createGateway({ config, verifyToken, mcp: async () => {
  called++; return Response.json({ ok: true });
} });
const request = (token, path = '/mcp') => new Request(`https://example.vercel.app${path}`, {
  method: path === '/mcp' ? 'POST' : 'GET',
  headers: token ? { Authorization: `Bearer ${token}` } : {},
});
const token = (overrides = {}) => new SignJWT({ scope: 'openid', ...overrides })
  .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
  .setIssuer(overrides.iss ?? config.issuer)
  .setAudience(overrides.aud ?? config.resource)
  .setSubject(overrides.sub ?? config.userId)
  .setIssuedAt().setExpirationTime(overrides.exp ?? '5m').sign(privateKey);

test('incomplete configuration fails closed without disclosing environment values', async () => {
  assert.throws(() => readConfig({}), /Missing/);
  assert.throws(() => readConfig({ ...env, MCP_RESOURCE_URL: 'http://example.com/mcp' }), /Invalid/);
  assert.throws(() => readConfig({ ...env, AUTHKIT_ISSUER: 'https://name:secret@example.com' }), /Invalid/);
  const response = await entry.fetch(request());
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'server_not_configured' });
});

test('OAuth discovery publishes canonical audience and issuer without secrets', async () => {
  for (const path of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp']) {
    const response = await gateway(request(null, path));
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.resource, config.resource);
    assert.deepEqual(data.authorization_servers, [config.issuer]);
    assert.equal(JSON.stringify(data).includes(config.apiKey), false);
  }
});

test('missing and malformed credentials never reach Garmin', async () => {
  const before = called;
  for (const value of [undefined, 'not-a-jwt']) {
    const response = await gateway(request(value));
    assert.equal(response.status, 401);
    assert.match(response.headers.get('www-authenticate'), /resource_metadata=/);
  }
  assert.equal(called, before);
});

test('bad signature, issuer, audience, and expired tokens are rejected', async () => {
  const before = called;
  const { privateKey: otherKey } = await generateKeyPair('RS256');
  const forged = await new SignJWT({ scope: 'openid' }).setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setSubject(config.userId).setIssuer(config.issuer).setAudience(config.resource)
    .setIssuedAt().setExpirationTime('5m').sign(otherKey);
  for (const value of [forged, await token({ iss: 'https://attacker.example' }),
    await token({ aud: 'https://other.example/mcp' }), await token({ exp: 1 })]) {
    assert.equal((await gateway(request(value))).status, 401);
  }
  assert.equal(called, before);
});

test('other users and missing scope cannot read the owner’s Garmin account', async () => {
  const before = called;
  assert.equal((await gateway(request(await token({ sub: 'user_someone_else' })))).status, 403);
  assert.equal((await gateway(request(await token({ scope: 'profile' })))).status, 403);
  assert.equal(called, before);
});

test('valid owner token succeeds and data responses cannot be cached', async () => {
  const before = called;
  const response = await gateway(request(await token()));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(called, before + 1);
});

test('real Garmin MCP initializes and advertises 25 OAuth-protected tools without an API request', async () => {
  const handler = createGateway({ config, verifyToken, mcp: createMcpHandler(config.apiKey) });
  const accessToken = await token();
  const rpc = async (method, params = {}) => {
    const response = await handler(new Request(config.resource, {
      method: 'POST', headers: { Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }));
    assert.equal(response.status, 200);
    return response.json();
  };
  const initialized = await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {},
    clientInfo: { name: 'test-client', version: '1.0.0' } });
  assert.equal(initialized.result.serverInfo.name, 'personal-garmin');
  const listed = await rpc('tools/list');
  assert.equal(listed.result.tools.length, 25);
  assert.ok(listed.result.tools.some(t => t.name === 'list_activities'));
  assert.ok(listed.result.tools.every(t => t._meta.securitySchemes[0].type === 'oauth2'));
  assert.ok(listed.result.tools.every(t => t.securitySchemes[0].type === 'oauth2'));
});
