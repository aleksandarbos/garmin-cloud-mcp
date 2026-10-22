import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TokenProvider } from 'garmin-personal-mcp/dist/auth.js';
import { GarminClient } from 'garmin-personal-mcp/dist/client.js';
import { registerTools } from 'garmin-personal-mcp/dist/tools.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';

export function createMcpHandler(apiKey) {
  const tokens = new TokenProvider({ apiKey, cacheFile: join(tmpdir(), 'personal-garmin-token.json') });
  const garmin = new GarminClient(tokens);
  return async request => {
    const server = new McpServer({ name: 'personal-garmin', version: '1.0.0' }, {
      instructions: 'Read-only access to the authenticated owner’s Garmin data. All dates are YYYY-MM-DD in the athlete’s local calendar. Page list_activities for history; split health requests according to each tool’s range limits.',
    });
    const register = server.registerTool.bind(server);
    server.registerTool = (name, toolConfig, handler) => register(name, {
      ...toolConfig, _meta: { ...toolConfig._meta,
        securitySchemes: [{ type: 'oauth2', scopes: ['openid'] }] },
    }, handler);
    registerTools(server, garmin);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined, enableJsonResponse: true,
    });
    // SDK v1 preserves extension metadata but omits top-level securitySchemes.
    // Publish both forms for ChatGPT while leaving tool execution with the SDK.
    const send = transport.send.bind(transport);
    transport.send = (message, options) => {
      if (message.result && Array.isArray(message.result.tools)) {
        return send({ ...message, result: { ...message.result,
          tools: message.result.tools.map(tool => ({ ...tool,
            securitySchemes: tool._meta.securitySchemes })),
        } }, options);
      }
      return send(message, options);
    };
    await server.connect(transport);
    try { return await transport.handleRequest(request); }
    finally { await server.close(); }
  };
}
