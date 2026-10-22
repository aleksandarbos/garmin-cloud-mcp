import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import handler from '../api/gateway.js';

createServer(async (req, res) => {
  const request = new Request(`http://127.0.0.1:3334${req.url}`, {
    method: req.method, headers: req.headers,
    ...(!['GET', 'HEAD'].includes(req.method) ? { body: Readable.toWeb(req), duplex: 'half' } : {}),
  });
  const response = await handler.fetch(request);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  if (response.body) for await (const part of response.body) res.write(part);
  res.end();
}).listen(3334, '127.0.0.1', () => console.log('Local MCP listening on 127.0.0.1:3334'));
