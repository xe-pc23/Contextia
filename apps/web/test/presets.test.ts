import { describe, expect, it } from 'vitest';
import { ScenarioContextInputSchema, ScenarioIdSchema } from '@contextia/contracts';
import { getScenarioInput } from '@contextia/test-fixtures';
import { createScenarioApiClient } from '../src/execution/scenarioApiClient.js';
import { buildScenarioRequest, formFromScenarioInput, scenarioFormReducer } from '../src/scenario/form.js';
import { CONSOLE_PRESETS, createPresetInput } from '../src/scenario/presets.js';
import { envelope, silentResult } from './support/evaluation.js';

const now = new Date('2026-10-02T14:10:42.900+09:00');
const at = '2026-10-02T14:10:00+09:00';

describe('all five console presets', () => {
  it('covers every canonical scenario exactly once', () => {
    expect(CONSOLE_PRESETS.map(preset => preset.id).sort()).toEqual([...ScenarioIdSchema.options].sort());
  });

  it.each(CONSOLE_PRESETS)('$id loads only valid preview inputs at the current minute', ({ id }) => {
    const input = createPresetInput(id, now);
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

  it('keeps an upcoming event ahead of the scenario across midnight and the year boundary', () => {
    const input = createPresetInput('upcoming-transit', new Date('2026-12-31T23:50:59+09:00'));
    expect(input.scenarioTime).toBe('2026-12-31T23:50:00+09:00');
    expect(input.calendar[0]).toMatchObject({ startAt: '2027-01-01T00:40:00+09:00', endAt: '2027-01-01T01:40:00+09:00' });
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
    const build = buildScenarioRequest(form);
    if (!build.ok) throw new Error('Expected valid edited preset');
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
