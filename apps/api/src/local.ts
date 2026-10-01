import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createRequestHandler } from './handler.js';

// Local server has no JWT authorizer, so authenticated routes answer 401 here.
const handle = createRequestHandler({
  version: process.env.BUILD_ID ?? 'development',
  log: (entry) => { console.log(JSON.stringify(entry)); }
});

const server = createServer((request, response) => {
  const chunks: Buffer[] = [];
  request.on('data', (chunk: Buffer) => { chunks.push(chunk); });
  request.on('end', () => {
    void handle({
      method: request.method ?? 'GET',
      path: new URL(request.url ?? '/', 'http://localhost').pathname,
      requestId: randomUUID(),
      body: chunks.length > 0 ? Buffer.concat(chunks).toString('utf8') : null,
      claims: null
    }).then((result) => {
      response.writeHead(result.statusCode, result.headers);
      response.end(result.body);
    });
  });
});

server.listen(3001, '127.0.0.1', () => {
  console.log(JSON.stringify({ event: 'local_api_started', url: 'http://127.0.0.1:3001/health' }));
});
