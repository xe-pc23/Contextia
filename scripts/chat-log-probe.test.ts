import { expect, it, vi } from 'vitest';
import * as smoke from './smoke-checks.js';

function chatServer(invalidStatus = 400, invalidRequestId = 'invalid-id') {
  return vi.fn<typeof fetch>(async (_url, init) => {
    const body: unknown = JSON.parse(String(init?.body));
    const invalid = typeof body === 'object' && body !== null && 'unexpected' in body;
    return invalid ? Response.json({ requestId: invalidRequestId, error: { code: 'VALIDATION_ERROR', message: 'Invalid body' } }, { status: invalidStatus })
      : Response.json({ requestId: 'success-id', data: { conversationId: 'conversation', reply: '近くの候補です。', recommendations: [], expiresAt: new Date(Date.now() + 60_000).toISOString() } });
  });
}
it('captures successful and invalid chat IDs with distinct canaries from actual HTTP probes', async () => {
  expect(smoke).toHaveProperty('probeChatLogs');
  const server = chatServer();
  const proof = await smoke.probeChatLogs('https://api.example.com/v1/recommendations/owned/chat', { authorization: 'Bearer synthetic-token' }, server);
  expect(proof.successRequestId).toBe('success-id'); expect(proof.invalidRequestId).toBe('invalid-id');
  expect(proof.canaries[0]).not.toBe(proof.canaries[1]);
  expect(server.mock.calls[0]?.[1]?.body).toContain(proof.canaries[0]);
  expect(server.mock.calls[1]?.[1]?.body).toContain(proof.canaries[1]);
});
it.each([401, 200])('rejects non-validation HTTP status %s as redaction proof', async invalidStatus => {
  expect(smoke).toHaveProperty('probeChatLogs');
  await expect(smoke.probeChatLogs('https://api.example.com/chat', {}, chatServer(invalidStatus))).rejects.toThrow();
});
it('rejects reused app request IDs so one log cannot satisfy both probes', async () => {
  expect(smoke).toHaveProperty('probeChatLogs');
  await expect(smoke.probeChatLogs('https://api.example.com/chat', {}, chatServer(400, 'success-id'))).rejects.toThrow();
});
