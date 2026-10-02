import { describe, expect, it } from 'vitest';
import { ScenarioContextInputSchema } from '@contextia/contracts';
import { getScenarioInput } from '@contextia/test-fixtures';
import {
  MAX_CALENDAR_EVENTS, buildScenarioRequest, formFromScenarioInput, parseInterests, scenarioFormReducer, scenarioTimeIso, stepGoalState
} from '../src/scenario/form.js';
import type { BuildResult, FieldKey, ScenarioForm, ScenarioFormAction } from '../src/scenario/form.js';

const stepGoalForm = () => formFromScenarioInput(getScenarioInput('step-goal'));
const apply = (form: ScenarioForm, ...actions: ScenarioFormAction[]) => actions.reduce(scenarioFormReducer, form);

function request(result: BuildResult) {
  if (!result.ok) throw new Error(`expected a valid request: ${JSON.stringify(result.errors)}`);
  return result.request;
}
function errorsOf(result: BuildResult, key: FieldKey) {
  if (result.ok) throw new Error('expected validation errors');
  return result.errors[key] ?? [];
}

describe('step-goal preset', () => {
  it('round-trips explicit calendar availability without changing legacy requests', () => {
    for (const calendarStatus of ['granted', 'denied', 'unavailable'] as const) {
      const preset = { ...getScenarioInput('step-goal'), calendarStatus };
      expect(request(buildScenarioRequest(formFromScenarioInput(preset)))).toEqual(preset);
    }
  });
  it('fills only inputs and rebuilds exactly the preset preview request', () => {
    const preset = getScenarioInput('step-goal');
    const form = stepGoalForm();
    expect(form).toMatchObject({
      latitude: '35.681236', longitude: '139.767125', accuracyMeters: '10', scenarioTime: '2026-10-01T14:10',
      timezone: 'Asia/Tokyo', stepsToday: '10432', stepGoal: '10000', events: [], interests: 'cafe, park'
    });
    expect(request(buildScenarioRequest(form))).toEqual(preset);
  });

  it('round-trips a preset calendar event with offset timestamps', () => {
    const preset = getScenarioInput('upcoming-transit');
    const form = formFromScenarioInput(preset);
    expect(form.events).toEqual([{
      id: 'synthetic-event-1', title: 'Synthetic meeting', startAt: '2026-10-01T16:00', endAt: '2026-10-01T17:00',
      location: 'Tokyo Station', allDay: false
    }]);
    expect(request(buildScenarioRequest(form))).toEqual(preset);
  });
});

describe('preview request generation', () => {
  it('always produces a contract-valid simulation/preview request', () => {
    const built = request(buildScenarioRequest(stepGoalForm()));
    expect(built.mode).toBe('simulation');
    expect(built.deliveryMode).toBe('preview');
    expect(built.location.source).toBe('scenario');
    expect(ScenarioContextInputSchema.safeParse(built).success).toBe(true);
  });

  it('applies scenario time and timezone to capture times and preferences', () => {
    const form = apply(stepGoalForm(),
      { type: 'setText', field: 'timezone', value: 'America/New_York' },
      { type: 'setText', field: 'scenarioTime', value: '2026-07-15T09:30' });
    const built = request(buildScenarioRequest(form));
    expect(built.scenarioTime).toBe('2026-07-15T09:30:00-04:00');
    expect(built.capturedAt).toBe(built.scenarioTime);
    expect(built.location.capturedAt).toBe(built.scenarioTime);
    expect(built.preferencesOverride?.timezone).toBe('America/New_York');
  });

  it('updates coordinates from a map position and rounds to six decimals', () => {
    const form = apply(stepGoalForm(), { type: 'setLocation', latitude: 34.70248512345, longitude: 135.4959511 });
    expect(form.latitude).toBe('34.702485');
    expect(form.longitude).toBe('135.495951');
    expect(request(buildScenarioRequest(form)).location).toMatchObject({ latitude: 34.702485, longitude: 135.495951 });
  });

  it('reports out-of-range coordinates against the edited fields', () => {
    const result = buildScenarioRequest(apply(stepGoalForm(),
      { type: 'setText', field: 'latitude', value: '91' },
      { type: 'setText', field: 'longitude', value: '-181' }));
    expect(errorsOf(result, 'latitude')).toEqual(['90以下で入力してください']);
    expect(errorsOf(result, 'longitude')).toEqual(['-180以上で入力してください']);
  });

  it('requires numeric coordinates and a step goal', () => {
    const result = buildScenarioRequest(apply(stepGoalForm(),
      { type: 'setText', field: 'latitude', value: '' },
      { type: 'setText', field: 'longitude', value: 'east' },
      { type: 'setText', field: 'stepGoal', value: ' ' }));
    expect(errorsOf(result, 'latitude')).toEqual(['入力してください']);
    expect(errorsOf(result, 'longitude')).toEqual(['数値で入力してください']);
    expect(errorsOf(result, 'stepGoal')).toEqual(['入力してください']);
  });

  it('omits optional accuracy when blank', () => {
    const built = request(buildScenarioRequest(apply(stepGoalForm(), { type: 'setText', field: 'accuracyMeters', value: '' })));
    expect(built.location).not.toHaveProperty('accuracyMeters');
  });

  it('derives goal state from numeric steps and mirrors the goal into preferences', () => {
    const below = request(buildScenarioRequest(apply(stepGoalForm(),
      { type: 'setText', field: 'stepsToday', value: '9999' },
      { type: 'setText', field: 'stepGoal', value: '12000' })));
    expect(below.activity).toEqual({ stepsToday: 9999, stepGoal: 12_000, stepGoalReached: false, stepSource: 'scenario', confidence: 'high' });
    expect(below.preferencesOverride?.stepGoal).toBe(12_000);

    const exact = request(buildScenarioRequest(apply(stepGoalForm(), { type: 'setText', field: 'stepsToday', value: '10000' })));
    expect(exact.activity?.stepGoalReached).toBe(true);
  });

  it('sends unknown steps as null without claiming the goal state', () => {
    const built = request(buildScenarioRequest(apply(stepGoalForm(), { type: 'setText', field: 'stepsToday', value: '' })));
    expect(built.activity).toEqual({ stepsToday: null, stepGoal: 10_000, stepSource: 'scenario' });
  });

  it('rejects fractional or out-of-range steps', () => {
    expect(errorsOf(buildScenarioRequest(apply(stepGoalForm(), { type: 'setText', field: 'stepsToday', value: '1.5' })), 'stepsToday'))
      .toEqual(['整数で入力してください']);
    expect(errorsOf(buildScenarioRequest(apply(stepGoalForm(), { type: 'setText', field: 'stepsToday', value: '200001' })), 'stepsToday'))
      .toEqual(['200,000以下で入力してください']);
    expect(errorsOf(buildScenarioRequest(apply(stepGoalForm(), { type: 'setText', field: 'stepGoal', value: '0' })), 'stepGoal'))
      .toEqual(['1以上で入力してください']);
  });

  it('rejects an invalid timezone before converting times', () => {
    const result = buildScenarioRequest(apply(stepGoalForm(), { type: 'setText', field: 'timezone', value: '+09:00' }));
    expect(errorsOf(result, 'timezone')).toEqual(['IANAタイムゾーン名で入力してください（例: Asia/Tokyo）']);
    expect(errorsOf(result, 'scenarioTime')).toEqual([]);
  });

  it('requires a scenario time', () => {
    const result = buildScenarioRequest(apply(stepGoalForm(), { type: 'setText', field: 'scenarioTime', value: '' }));
    expect(errorsOf(result, 'scenarioTime')).toEqual(['日時を入力してください']);
  });

  it('sends interests from comma-separated input and bounds them by the contract', () => {
    const built = request(buildScenarioRequest(apply(stepGoalForm(), { type: 'setText', field: 'interests', value: 'cafe、museum, cafe,\npark' })));
    expect(built.preferencesOverride?.interests).toEqual(['cafe', 'museum', 'park']);

    const many = Array.from({ length: 21 }, (_, index) => `interest-${index}`).join(',');
    expect(errorsOf(buildScenarioRequest(apply(stepGoalForm(), { type: 'setText', field: 'interests', value: many })), 'interests'))
      .toEqual(['20件以内にしてください']);
    expect(errorsOf(buildScenarioRequest(apply(stepGoalForm(), { type: 'setText', field: 'interests', value: 'x'.repeat(65) })), 'interests'))
      .toEqual(['64文字以内で入力してください']);
  });

  it('sends notification preference overrides', () => {
    const built = request(buildScenarioRequest(apply(stepGoalForm(),
      { type: 'setNotificationFrequency', value: 'low' },
      { type: 'setNotificationsEnabled', value: false },
      { type: 'setText', field: 'locale', value: 'en-US' })));
    expect(built.preferencesOverride).toMatchObject({ notificationFrequency: 'low', notificationsEnabled: false, locale: 'en-US' });
  });
});

describe('calendar editing', () => {
  it('adds an event after the scenario time and sends only allowed fields', () => {
    const form = apply(stepGoalForm(), { type: 'addEvent' });
    expect(form.events).toEqual([{
      id: 'scenario-event-1', title: '新しい予定', startAt: '2026-10-01T15:10', endAt: '2026-10-01T16:10', location: '', allDay: false
    }]);
    const [event] = request(buildScenarioRequest(form)).calendar;
    expect(event).toEqual({
      id: 'scenario-event-1', title: '新しい予定', startAt: '2026-10-01T15:10:00+09:00', endAt: '2026-10-01T16:10:00+09:00',
      location: null, allDay: false
    });
    expect(Object.keys(event ?? {}).sort()).toEqual(['allDay', 'endAt', 'id', 'location', 'startAt', 'title']);
  });

  it('keeps generated event IDs unique and supports update/remove', () => {
    let form = apply(stepGoalForm(), { type: 'addEvent' }, { type: 'addEvent' });
    expect(form.events.map(event => event.id)).toEqual(['scenario-event-1', 'scenario-event-2']);
    form = apply(form,
      { type: 'updateEvent', id: 'scenario-event-2', patch: { title: '打ち合わせ', location: ' 東京駅 ' } },
      { type: 'removeEvent', id: 'scenario-event-1' },
      { type: 'addEvent' });
    expect(form.events.map(event => event.id)).toEqual(['scenario-event-2', 'scenario-event-3']);
    const [first] = request(buildScenarioRequest(form)).calendar;
    expect(first).toMatchObject({ id: 'scenario-event-2', title: '打ち合わせ', location: '東京駅' });
  });

  it('does not reuse an ID that a loaded preset already contains', () => {
    const preset = getScenarioInput('upcoming-transit');
    const withGeneratedId = { ...preset, calendar: [{ ...preset.calendar[0], id: 'scenario-event-1' }] };
    const form = apply(formFromScenarioInput(ScenarioContextInputSchema.parse(withGeneratedId)), { type: 'addEvent' });
    expect(form.events.map(event => event.id)).toEqual(['scenario-event-1', 'scenario-event-2']);
  });

  it('reports event field errors against that event', () => {
    const form = apply(stepGoalForm(), { type: 'addEvent' },
      { type: 'updateEvent', id: 'scenario-event-1', patch: { title: '  ', endAt: '2026-10-01T15:00' } });
    const result = buildScenarioRequest(form);
    expect(errorsOf(result, 'event.scenario-event-1.title')).toEqual(['入力してください']);
    expect(errorsOf(result, 'event.scenario-event-1.endAt')).toEqual(['終了は開始と同じかそれ以降にしてください']);
  });

  it('limits non-all-day events to 31 days', () => {
    const form = apply(stepGoalForm(), { type: 'addEvent' },
      { type: 'updateEvent', id: 'scenario-event-1', patch: { endAt: '2026-11-15T15:10' } });
    expect(errorsOf(buildScenarioRequest(form), 'event.scenario-event-1.endAt')).toEqual(['終日でない予定は31日以内にしてください']);
    const allDay = apply(form, { type: 'updateEvent', id: 'scenario-event-1', patch: { allDay: true } });
    expect(request(buildScenarioRequest(allDay)).calendar[0]?.allDay).toBe(true);
  });

  it('requires event times', () => {
    const form = apply(stepGoalForm(), { type: 'addEvent' }, { type: 'updateEvent', id: 'scenario-event-1', patch: { startAt: '' } });
    expect(errorsOf(buildScenarioRequest(form), 'event.scenario-event-1.startAt')).toEqual(['日時を入力してください']);
  });

  it(`stops adding events at ${MAX_CALENDAR_EVENTS}`, () => {
    const actions = Array.from({ length: MAX_CALENDAR_EVENTS + 1 }, (): ScenarioFormAction => ({ type: 'addEvent' }));
    const form = apply(stepGoalForm(), ...actions);
    expect(form.events).toHaveLength(MAX_CALENDAR_EVENTS);
    expect(request(buildScenarioRequest(form)).calendar).toHaveLength(MAX_CALENDAR_EVENTS);
  });
});

describe('editor hints', () => {
  it('follows the step inputs even when another field is invalid', () => {
    const steps = (stepsToday: string, stepGoal = '10000') => apply(stepGoalForm(),
      { type: 'setText', field: 'latitude', value: '999' },
      { type: 'setText', field: 'stepsToday', value: stepsToday },
      { type: 'setText', field: 'stepGoal', value: stepGoal });
    expect(stepGoalState(steps('10000'))).toBe('reached');
    expect(stepGoalState(steps('9999'))).toBe('below');
    expect(stepGoalState(steps(' '))).toBe('unknown');
    expect(stepGoalState(steps('many'))).toBe('invalid');
    expect(stepGoalState(steps('10000', ''))).toBe('invalid');
  });

  it('shows the sent scenario time only for a valid IANA timezone', () => {
    const withInvalidLatitude = apply(stepGoalForm(), { type: 'setText', field: 'latitude', value: '999' });
    expect(scenarioTimeIso(withInvalidLatitude)).toBe('2026-10-01T14:10:00+09:00');
    expect(scenarioTimeIso(apply(stepGoalForm(), { type: 'setText', field: 'timezone', value: '+09:00' }))).toBeNull();
    expect(scenarioTimeIso(apply(stepGoalForm(), { type: 'setText', field: 'scenarioTime', value: '' }))).toBeNull();
  });
});

describe('interest parsing', () => {
  it('trims, drops blanks and removes duplicates', () => {
    expect(parseInterests(' cafe ,, park、cafe\n ')).toEqual(['cafe', 'park']);
    expect(parseInterests('')).toEqual([]);
  });
});
