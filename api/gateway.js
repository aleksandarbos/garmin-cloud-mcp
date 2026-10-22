import { readConfig, createGateway } from '../lib/gateway.js';
import { createMcpHandler } from '../lib/mcp.js';

let gateway;
export default {
  async fetch(request) {
    if (!gateway) {
      try {
        const config = readConfig();
        gateway = createGateway({ config, mcp: createMcpHandler(config.apiKey) });
      } catch {
        return Response.json({ error: 'server_not_configured' }, {
          status: 503, headers: { 'Cache-Control': 'no-store' },
        });
      }
    }
    return gateway(request);
  },
};
