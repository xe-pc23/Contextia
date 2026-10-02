import { describe, expect, it } from 'vitest';
import { ScenarioContextInputSchema, ScenarioIdSchema } from '@contextia/contracts';
import { getScenarioInput } from '@contextia/test-fixtures';
import { createScenarioApiClient } from '../src/execution/scenarioApiClient.js';
import { buildScenarioRequest, formFromScenarioInput, scenarioFormReducer } from '../src/scenario/form.js';
import { CONSOLE_PRESETS, createPresetInput } from '../src/scenario/presets.js';
import { envelope, silentResult } from './support/evaluation.js';

const now = new Date('2026-10-02T14:10:42.900+09:00');
const presetTimes = {
  'upcoming-transit': '15:10',
  'step-goal': '14:10',
  'free-time': '14:10',
  'weather-adaptation': '14:30',
  'early-arrival': '15:20'
};

describe('all five console presets', () => {
  it('covers every canonical scenario exactly once', () => {
    expect(CONSOLE_PRESETS.map(preset => preset.id).sort()).toEqual([...ScenarioIdSchema.options].sort());
  });

  it.each(CONSOLE_PRESETS)('$id loads valid preview inputs on today\'s local date at its fixed time', ({ id }) => {
    const input = createPresetInput(id, now);
    const at = `2026-10-02T${presetTimes[id]}:00+09:00`;
    expect(ScenarioContextInputSchema.parse(input)).toEqual(input);
    expect(input).toMatchObject({ mode: 'simulation', deliveryMode: 'preview', capturedAt: at, scenarioTime: at });
    expect(input.location.capturedAt).toBe(at);
    expect(Object.keys(input).sort()).toEqual(['activity', 'calendar', 'capturedAt', 'deliveryMode', 'location', 'mode', 'preferencesOverride', 'scenarioTime']);
    expect(buildScenarioRequest(formFromScenarioInput(input))).toEqual({ ok: true, request: input });
  });

  it.each(CONSOLE_PRESETS)('$id preserves fixture event offsets and other device inputs', ({ id }) => {
    const template = getScenarioInput(id);
    const input = createPresetInput(id, now);
    const templateAt = Date.parse(template.scenarioTime ?? template.capturedAt);
    const at = input.capturedAt;
    expect(input.activity).toEqual(template.activity);
    expect(input.preferencesOverride).toEqual(template.preferencesOverride);
    expect(input.location).toEqual({ ...template.location, capturedAt: at });
    expect(input.calendar).toHaveLength(template.calendar.length);
    for (const [index, event] of input.calendar.entries()) {
      const original = template.calendar[index];
      if (!original) throw new Error('Missing fixture event');
      expect(event).toMatchObject({ id: original.id, title: original.title, location: original.location, allDay: original.allDay });
      expect(Date.parse(event.startAt) - Date.parse(at)).toBe(Date.parse(original.startAt) - templateAt);
      expect(Date.parse(event.endAt) - Date.parse(at)).toBe(Date.parse(original.endAt) - templateAt);
    }
  });

  it.each(CONSOLE_PRESETS)('$id can be edited without mutating the shared fixture or the next load', ({ id }) => {
    const original = getScenarioInput(id);
    const input = createPresetInput(id, now);
    input.location.latitude = 0;
    input.preferencesOverride?.interests?.push('edited');
    input.calendar.splice(0);
    expect(getScenarioInput(id)).toEqual(original);
    const next = createPresetInput(id, now);
    expect(next.location.latitude).toBe(original.location.latitude);
    expect(next.preferencesOverride).toEqual(original.preferencesOverride);
    expect(next.calendar).toHaveLength(original.calendar.length);
  });

  it.each(CONSOLE_PRESETS)('$id exactly matches the canonical fixture inputs on the fixture date', ({ id }) => {
    const template = getScenarioInput(id);
    expect(createPresetInput(id, new Date(template.capturedAt))).toEqual(template);
  });

  it.each(CONSOLE_PRESETS)('$id keeps its daytime conditions when loaded overnight', ({ id }) => {
    const input = createPresetInput(id, new Date('2026-10-02T02:25:59+09:00'));
    expect(input.scenarioTime).toBe(`2026-10-02T${presetTimes[id]}:00+09:00`);
    expect(input).toEqual(createPresetInput(id, now));
  });

  it('keeps the same upcoming-event scenario when loaded later on the same day', () => {
    const input = createPresetInput('upcoming-transit', new Date('2026-10-02T23:50:59+09:00'));
    expect(input).toEqual(createPresetInput('upcoming-transit', now));
    expect(input.scenarioTime).toBe('2026-10-02T15:10:00+09:00');
    expect(input.calendar[0]).toMatchObject({ startAt: '2026-10-02T16:00:00+09:00', endAt: '2026-10-02T17:00:00+09:00' });
  });

  it.each([
    { now: '2026-12-31T14:59:59Z', date: '2026-12-31' },
    { now: '2026-12-31T15:00:00Z', date: '2027-01-01' }
  ])('uses the preset timezone\'s local date at the year boundary: $now', ({ now, date }) => {
    const input = createPresetInput('upcoming-transit', new Date(now));
    expect(input.scenarioTime).toBe(`${date}T15:10:00+09:00`);
    expect(input.calendar[0]).toMatchObject({ startAt: `${date}T16:00:00+09:00`, endAt: `${date}T17:00:00+09:00` });
  });

  it('rejects an invalid injected clock', () => {
    expect(() => createPresetInput('step-goal', new Date(Number.NaN))).toThrow(RangeError);
  });
});

describe('preset editing and API submission (test transport only)', () => {
  it.each(CONSOLE_PRESETS)('$id resets validation and supports multiple calendar edits before preview submission', async ({ id }) => {
    const input = createPresetInput(id, now);
    const invalidForm = scenarioFormReducer(formFromScenarioInput(createPresetInput('step-goal', now)), { type: 'setText', field: 'latitude', value: '91' });
    expect(buildScenarioRequest(invalidForm).ok).toBe(false);
    let form = scenarioFormReducer(invalidForm, { type: 'loadInput', input });
    expect(buildScenarioRequest(form)).toEqual({ ok: true, request: input });
    form = scenarioFormReducer(form, { type: 'addEvent' });
    form = scenarioFormReducer(form, { type: 'addEvent' });
    form = scenarioFormReducer(form, { type: 'updateEvent', id: 'scenario-event-2', patch: { title: '次の打ち合わせ', location: ' 大阪駅 ' } });
    form = scenarioFormReducer(form, { type: 'removeEvent', id: 'scenario-event-1' });
    form = scenarioFormReducer(form, { type: 'setText', field: 'latitude', value: '34.702485' });
    form = scenarioFormReducer(form, { type: 'setText', field: 'longitude', value: '135.495951' });
    form = scenarioFormReducer(form, { type: 'setText', field: 'scenarioTime', value: '2026-10-03T10:30' });
    const build = buildScenarioRequest(form);
    if (!build.ok) throw new Error('Expected valid edited preset');
    expect(build.request.scenarioTime).toBe('2026-10-03T10:30:00+09:00');
    expect(build.request.calendar).toHaveLength(input.calendar.length + 1);
    expect(build.request.calendar.at(-1)).toMatchObject({ id: 'scenario-event-2', title: '次の打ち合わせ', location: '大阪駅' });
    for (const event of build.request.calendar) {
      expect(Object.keys(event).sort()).toEqual(['allDay', 'endAt', 'id', 'location', 'startAt', 'title']);
    }

    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const fetchDouble: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify(envelope(silentResult())), { status: 200 });
    };
    const evaluator = createScenarioApiClient({ baseUrl: 'https://api.example.test', getAccessToken: () => 'test-access-token', fetch: fetchDouble });
    expect(await evaluator.evaluate(build.request)).toMatchObject({ kind: 'success', result: { decision: 'silent' } });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://api.example.test/v1/context/evaluate');
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual(build.request);
    expect(build.request).toMatchObject({ mode: 'simulation', deliveryMode: 'preview' });
  });
});
