import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createRequestHandler } from './handler.js';

const handle = createRequestHandler({
  version: process.env.BUILD_ID ?? 'development',
  log: (entry) => { console.log(JSON.stringify(entry)); }
});

const server = createServer((request, response) => {
  const result = handle({
    method: request.method ?? 'GET',
    path: new URL(request.url ?? '/', 'http://localhost').pathname,
    requestId: randomUUID()
  });
  response.writeHead(result.statusCode, result.headers);
  response.end(result.body);
});

server.listen(3001, '127.0.0.1', () => {
  console.log(JSON.stringify({ event: 'local_api_started', url: 'http://127.0.0.1:3001/health' }));
});
