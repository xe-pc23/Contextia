import { describe, expect, it, vi } from 'vitest';
import type { PlacesProvider, RecommendationModel } from '@contextia/providers';
import { createChatWithRecommendation } from '../src/application/chatWithRecommendation.js';
import { createAccountServices } from '../src/application/account.js';
import { createRequestHandler } from '../src/handler.js';
import { publicPlace } from '../src/application/references.js';
import { NOW, ok, place, record, repository } from './support/repository.js';

function setup() {
  const state = repository();
  const model = { followUp: vi.fn<RecommendationModel['followUp']>(async () => ok({ reply: 'A shorter rest is possible.', recommendations: [] })) };
  let failStorage = false;
  const places: PlacesProvider = {
    searchNearby: vi.fn(async () => ok([])),
    async getPlace(input) { return failStorage ? { status: 'error', data: null } : ok({ persistenceIntent: input.persistenceIntent, place }); }
  };
  let seq = 0;
  const chat = createChatWithRecommendation({ state, places, model, clock: () => NOW, newId: prefix => `${prefix}-${++seq}` });
  const log = vi.fn();
  const handler = createRequestHandler({ version: 'test', log, clients: { webClientId: 'web', mobileClientId: 'mobile' }, account: createAccountServices(state, () => NOW), chat });
  const request = (message: unknown = 'Can I rest briefly?', userId = 'user-1') => handler({
    method: 'POST', path: '/v1/recommendations/rec-owned/chat', requestId: 'req-chat',
    claims: { sub: userId, clientId: 'web' }, body: JSON.stringify({ message })
  });
  return { state, model, chat, request, log, failStorage: () => { failStorage = true; } };
}

describe('recommendation chat', () => {
  it('denies cross-user access before reading profile, context or history', async () => {
    const { request, state, model } = setup();
    expect((await request('Private question', 'another-user')).statusCode).toBe(404);
    expect(state.getProfile).not.toHaveBeenCalled();
    expect(state.getConversation).not.toHaveBeenCalled();
    expect(state.getContextSnapshot).not.toHaveBeenCalled();
    expect(model.followUp).not.toHaveBeenCalled();
  });
  it('passes null for missing context and starts a two-hour conversation', async () => {
    const { request, model, state } = setup();
    expect((await request()).statusCode).toBe(200);
    expect(model.followUp.mock.calls[0]?.[0].context).toBeNull();
    expect(state.appendConversationTurn.mock.calls[0]?.[0]).toMatchObject({
      userId: 'user-1', recommendationId: record.id, maxUserTurns: 8, nowEpochSeconds: NOW.getTime() / 1000,
      expiresAt: NOW.getTime() / 1000 + 7200
    });
  });
  it('keeps the initial expiry while appending a later turn', async () => {
    const { request, state } = setup();
    const expiresAt = NOW.getTime() / 1000 + 120;
    state.getConversation.mockResolvedValue(ok({ conversationId: 'conv-original', recommendationId: record.id, turnCount: 7, expiresAt, messages: [] }));
    expect((await request()).statusCode).toBe(200);
    expect(state.appendConversationTurn.mock.calls[0]?.[0]).toMatchObject({ conversationId: 'conv-original', expiresAt });
  });
  it('rejects the ninth user turn before calling the model', async () => {
    const { request, state, model } = setup();
    state.getConversation.mockResolvedValue(ok({ conversationId: 'conv-original', recommendationId: record.id, turnCount: 8, expiresAt: NOW.getTime() / 1000 + 120, messages: [] }));
    expect((await request()).statusCode).toBe(429);
    expect(model.followUp).not.toHaveBeenCalled();
  });
  it.each(['', 'x'.repeat(1001), 4, null])('rejects invalid message %s without model access', async message => {
    const { request, model } = setup();
    expect((await request(message)).statusCode).toBe(400);
    expect(model.followUp).not.toHaveBeenCalled();
  });
  it('rejects fabricated places and routes before saving a turn', async () => {
    const { request, state, model } = setup();
    model.followUp.mockResolvedValue(ok({ reply: 'Try this.', recommendations: [{ title: 'Invented', reason: 'Invented facts',
      place: { ...publicPlace(place), placeId: 'unknown-place' }, action: { type: 'MAP' } }] }));
    expect((await request()).statusCode).toBe(502);
    expect(state.appendConversationTurn).not.toHaveBeenCalled();
    model.followUp.mockResolvedValue(ok({ reply: 'Try this.', recommendations: [{ title: 'Invented', reason: 'Invented transit',
      route: { mode: 'transit', durationMinutes: 12 }, action: { type: 'TRANSIT' } }] }));
    expect((await request()).statusCode).toBe(502);
    expect(state.appendConversationTurn).not.toHaveBeenCalled();
  });
  it('requires Storage retrieval and atomically appends only stored place cards', async () => {
    const { request, state, model, failStorage } = setup();
    model.followUp.mockResolvedValue(ok({ reply: 'Try a short break.', recommendations: record.recommendations.map(({ id, ...item }) => { void id; return item; }) }));
    expect((await request()).statusCode).toBe(200);
    expect(state.appendConversationTurn.mock.calls[0]?.[0].recommendations[0]?.place).toMatchObject({ persistenceIntent: 'storage', place: { placeId: place.placeId } });
    state.appendConversationTurn.mockClear();
    failStorage();
    expect((await request()).statusCode).toBe(503);
    expect(state.appendConversationTurn).not.toHaveBeenCalled();
  });
  it('maps an atomic turn-limit race and sanitized model failures', async () => {
    const { request, state, model, log } = setup();
    state.appendConversationTurn.mockResolvedValue({ status: 'error', data: null, code: 'TURN_LIMIT_REACHED' });
    expect((await request()).statusCode).toBe(429);
    model.followUp.mockRejectedValue(new Error('private upstream data'));
    const response = await request('private question');
    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain('private');
    expect(JSON.stringify(log.mock.calls)).not.toContain('private');
  });
});
