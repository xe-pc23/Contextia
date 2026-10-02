import { describe, expect, it, vi } from 'vitest';
import type { DynamoDbClient, DynamoDbRequest } from '../src/adapters/dynamodb.js';
import { DynamoDbStateRepository } from '../src/adapters/dynamodb.js';

const at = '2026-10-01T01:00:00.000Z';
const nowEpochSeconds = Date.parse(at) / 1_000;
const expiresAt = nowEpochSeconds + 7_200;
const owner = { userId: 'user-1', recommendationId: 'rec-1', nowEpochSeconds };
const metadata = {
  PK: 'RECOMMENDATION#rec-1', SK: 'CONVERSATION', entityType: 'Conversation',
  userId: 'user-1', recommendationId: 'rec-1', conversationId: 'conv-1', turnCount: 1,
  expiresAt, createdAt: at, updatedAt: at, schemaVersion: 1
};
const messages = [
  { PK: metadata.PK, SK: `CHAT#conv-1#${at}#msg-1#0`, entityType: 'ChatMessage', userId: 'user-1',
    recommendationId: 'rec-1', conversationId: 'conv-1', messageId: 'msg-1', role: 'user',
    content: '静かな場所は？', expiresAt, createdAt: at, updatedAt: at, schemaVersion: 1 },
  { PK: metadata.PK, SK: `CHAT#conv-1#${at}#msg-1#1`, entityType: 'ChatMessage', userId: 'user-1',
    recommendationId: 'rec-1', conversationId: 'conv-1', messageId: 'msg-1', role: 'assistant',
    content: '近くの公園です。', recommendations: [], expiresAt, createdAt: at, updatedAt: at, schemaVersion: 1 }
];

function repository(responses: unknown[]) {
  const requests: DynamoDbRequest[] = [];
  const client: DynamoDbClient = { send: vi.fn(async request => {
    requests.push(request);
    const response = responses.shift();
    if (response instanceof Error) throw response;
    return response ?? {};
  }) };
  return { repository: new DynamoDbStateRepository({ client, tableName: 'contextia-dev-main', timeoutMs: 100 }), requests };
}

describe('DynamoDB recommendation conversation', () => {
  it('returns only an owned, unexpired conversation with both messages', async () => {
    const owned = repository([{ Item: metadata }, { Items: messages }]);
    expect(await owned.repository.getConversation(owner)).toMatchObject({ status: 'ok', data: {
      conversationId: 'conv-1', recommendationId: 'rec-1', turnCount: 1,
      messages: [{ role: 'user', content: '静かな場所は？' }, { role: 'assistant', content: '近くの公園です。', recommendations: [] }]
    } });
    expect(owned.requests.map(request => request.operation)).toEqual(['get', 'query']);
    expect(owned.requests[1]).toMatchObject({ operation: 'query', input: {
      ExpressionAttributeValues: { ':prefix': 'CHAT#conv-1#' }, Limit: 17
    } });
    const other = repository([{ Item: { ...metadata, userId: 'user-2' } }]);
    expect(await other.repository.getConversation(owner)).toMatchObject({ status: 'ok', data: null });
    expect(other.requests).toHaveLength(1);
    const expired = repository([{ Item: { ...metadata, expiresAt: nowEpochSeconds } }]);
    expect(await expired.repository.getConversation(owner)).toMatchObject({ status: 'ok', data: null });
    expect(expired.requests).toHaveLength(1);
  });

  it('atomically verifies recommendation ownership, increments the turn count and stores the message pair', async () => {
    const fake = repository([{}, {}, { Item: metadata }, { Items: messages }]);
    const result = await fake.repository.appendConversationTurn({ ...owner, conversationId: 'conv-1', messageId: 'msg-1',
      userMessage: '静かな場所は？', reply: '近くの公園です。', recommendations: [], at, expiresAt, maxUserTurns: 8 });
    expect(result).toMatchObject({ status: 'ok', data: { turnCount: 1, conversationId: 'conv-1' } });
    const request = fake.requests[1];
    if (request?.operation !== 'transactWrite') throw new Error('Expected one transaction');
    expect(request.input.TransactItems).toHaveLength(4);
    const pointerCheck = request.input.TransactItems.find(item => 'ConditionCheck' in item);
    const metadataPut = request.input.TransactItems.find(item => 'Put' in item && item.Put.Item.entityType === 'Conversation');
    const puts = request.input.TransactItems.flatMap(item => 'Put' in item ? [item.Put] : []);
    expect(pointerCheck).toMatchObject({ ConditionCheck: { Key: { PK: 'USER#user-1', SK: 'RECOMMENDATION_REF#rec-1' } } });
    expect(metadataPut).toMatchObject({ Put: { Item: { PK: 'RECOMMENDATION#rec-1', SK: 'CONVERSATION', turnCount: 1 } } });
    expect(puts.filter(put => put.Item.entityType === 'ChatMessage').map(put => put.Item.role)).toEqual(['user', 'assistant']);
    expect(puts.filter(put => put.Item.entityType === 'ChatMessage')
      .every(put => put.ConditionExpression === 'attribute_not_exists(PK)')).toBe(true);
  });

  it('conditionally increments an existing conversation without extending its fixed expiry', async () => {
    const nextAt = '2026-10-01T01:01:00.000Z';
    const nextMessages = [
      { ...messages[0], SK: `CHAT#conv-1#${nextAt}#msg-2#0`, messageId: 'msg-2', content: '次は？', createdAt: nextAt, updatedAt: nextAt },
      { ...messages[1], SK: `CHAT#conv-1#${nextAt}#msg-2#1`, messageId: 'msg-2', content: 'こちらです。', createdAt: nextAt, updatedAt: nextAt }
    ];
    const fake = repository([{ Item: metadata }, {}, { Item: { ...metadata, turnCount: 2, updatedAt: nextAt } },
      { Items: [...messages, ...nextMessages] }]);
    const result = await fake.repository.appendConversationTurn({ ...owner, nowEpochSeconds: Date.parse(nextAt) / 1_000,
      conversationId: 'conv-1', messageId: 'msg-2', userMessage: '次は？', reply: 'こちらです。',
      recommendations: [], at: nextAt, expiresAt, maxUserTurns: 8 });
    expect(result).toMatchObject({ status: 'ok', data: { turnCount: 2, expiresAt } });
    const request = fake.requests[1];
    if (request?.operation !== 'transactWrite') throw new Error('Expected one transaction');
    const update = request.input.TransactItems.find(item => 'Update' in item);
    if (!update || !('Update' in update)) throw new Error('Expected a conditional count update');
    expect(update.Update.ConditionExpression).toContain('#turnCount < :max');
    expect(update.Update.ConditionExpression).toContain('#expiresAt = :expiresAt');
    expect(update.Update.UpdateExpression).not.toContain('#expiresAt =');
  });

  it('reports the turn limit after an atomic condition failure', async () => {
    const cancelled = Object.assign(new Error('condition failed'), { name: 'TransactionCanceledException',
      CancellationReasons: [{ Code: 'None' }, { Code: 'ConditionalCheckFailed' }, { Code: 'None' }, { Code: 'None' }] });
    const fake = repository([{ Item: { ...metadata, turnCount: 7 } }, cancelled, { Item: { ...metadata, turnCount: 8 } }]);
    const result = await fake.repository.appendConversationTurn({ ...owner, conversationId: 'conv-1', messageId: 'msg-2',
      userMessage: '次は？', reply: '以上です。', recommendations: [], at, expiresAt, maxUserTurns: 8 });
    expect(result).toMatchObject({ status: 'error', data: null, code: 'TURN_LIMIT_REACHED' });
  });
});
