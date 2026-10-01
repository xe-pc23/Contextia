import { describe, expect, it } from 'vitest';
import { PlaceSchema, providerResultSchema } from '../src/index.js';

const schema = providerResultSchema(PlaceSchema.array());
const place = { provider: 'amazon-location', placeId: 'synthetic-place', name: 'Synthetic cafe', latitude: 35, longitude: 139 };

describe('normalized provider results', () => {
  it.each(['ok', 'degraded'])('allows usable %s data', status => {
    expect(schema.safeParse({ status, data: [place], latencyMs: 10 }).success).toBe(true);
  });
  it.each(['unavailable', 'timeout', 'error', 'not_requested'])('requires null data for %s', status => {
    expect(schema.safeParse({ status, data: null }).success).toBe(true);
    expect(schema.safeParse({ status, data: [place] }).success).toBe(false);
  });
  it('rejects raw upstream objects and incomplete successful data', () => {
    expect(schema.safeParse({ status: 'ok', data: null }).success).toBe(false);
    expect(schema.safeParse({ status: 'ok', data: [{ PlaceId: 'sdk-id', Position: [139, 35] }] }).success).toBe(false);
    expect(schema.safeParse({ status: 'error', data: null, exception: { requestBody: 'private' } }).success).toBe(false);
  });
});
