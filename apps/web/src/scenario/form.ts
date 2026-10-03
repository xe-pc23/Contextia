import { ScenarioContextInputSchema, TimezoneSchema } from '@contextia/contracts';
import type { ScenarioContextInput, UserPreferences } from '@contextia/contracts';
import { addMinutesToWallTime, isoToZonedWallTime, zonedWallTimeToIso } from './time.js';

export const MAX_CALENDAR_EVENTS = 100;
export const DEFAULT_TIMEZONE = 'Asia/Tokyo';
export const DEFAULT_LOCALE = 'ja-JP';

export type NotificationFrequency = UserPreferences['notificationFrequency'];

export interface CalendarEventForm {
  readonly id: string;
  readonly title: string;
  /** datetime-local value in the scenario timezone. */
  readonly startAt: string;
  readonly endAt: string;
  readonly location: string;
  readonly allDay: boolean;
}

/** Raw editor values; strings keep partially typed input intact. */
export interface ScenarioForm {
  readonly latitude: string;
  readonly longitude: string;
  readonly accuracyMeters: string;
  /** datetime-local value interpreted in `timezone`. */
  readonly scenarioTime: string;
  readonly timezone: string;
  readonly stepsToday: string;
  readonly stepGoal: string;
  readonly events: readonly CalendarEventForm[];
  readonly calendarStatus?: ScenarioContextInput['calendarStatus'];
  readonly nextEventNumber: number;
  readonly interests: string;
  readonly notificationFrequency: NotificationFrequency;
  readonly notificationsEnabled: boolean;
  readonly locale: string;
}

export type TextField = 'latitude' | 'longitude' | 'accuracyMeters' | 'scenarioTime' | 'timezone' | 'stepsToday' | 'stepGoal' | 'interests' | 'locale';
export type EventPatch = Partial<Omit<CalendarEventForm, 'id'>>;

export type ScenarioFormAction =
  | { type: 'loadInput'; input: ScenarioContextInput }
  | { type: 'setText'; field: TextField; value: string }
  | { type: 'setLocation'; latitude: number; longitude: number }
  | { type: 'setNotificationFrequency'; value: NotificationFrequency }
  | { type: 'setNotificationsEnabled'; value: boolean }
  | { type: 'addEvent' }
  | { type: 'updateEvent'; id: string; patch: EventPatch }
  | { type: 'removeEvent'; id: string };

/** Field keys used to attach validation messages to editor controls. */
export type FieldKey =
  | TextField | 'notificationFrequency' | 'calendar' | 'form'
  | `event.${string}.${'title' | 'startAt' | 'endAt' | 'location'}`;
export type FieldErrors = Readonly<Partial<Record<FieldKey, readonly string[]>>>;

export type BuildResult =
  | { readonly ok: true; readonly request: ScenarioContextInput }
  | { readonly ok: false; readonly errors: FieldErrors };

function coordinateText(value: number): string {
  return String(Number(value.toFixed(6)));
}

function optionalNumberText(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : String(value);
}

/** Projects a scenario input (for example a preset) into editable values. */
export function formFromScenarioInput(input: ScenarioContextInput): ScenarioForm {
  const preferences = input.preferencesOverride ?? {};
  const timezone = preferences.timezone ?? DEFAULT_TIMEZONE;
  const wall = (iso: string) => isoToZonedWallTime(iso, timezone) ?? '';
  return {
    latitude: coordinateText(input.location.latitude),
    longitude: coordinateText(input.location.longitude),
    accuracyMeters: optionalNumberText(input.location.accuracyMeters),
    scenarioTime: wall(input.scenarioTime ?? input.capturedAt),
    timezone,
    stepsToday: optionalNumberText(input.activity?.stepsToday),
    stepGoal: optionalNumberText(input.activity?.stepGoal ?? preferences.stepGoal),
    events: input.calendar.map(event => ({
      id: event.id, title: event.title, startAt: wall(event.startAt), endAt: wall(event.endAt),
      location: event.location ?? '', allDay: event.allDay ?? false
    })),
    ...(input.calendarStatus === undefined ? {} : { calendarStatus: input.calendarStatus }),
    nextEventNumber: 1,
    interests: (preferences.interests ?? []).join(', '),
    notificationFrequency: preferences.notificationFrequency ?? 'normal',
    notificationsEnabled: preferences.notificationsEnabled ?? true,
    locale: preferences.locale ?? DEFAULT_LOCALE
  };
}

function newEvent(form: ScenarioForm): { event: CalendarEventForm; nextEventNumber: number } {
  const used = new Set(form.events.map(event => event.id));
  let number = form.nextEventNumber;
  while (used.has(`scenario-event-${number}`)) number += 1;
  const startAt = addMinutesToWallTime(form.scenarioTime, 60) ?? '';
  const endAt = addMinutesToWallTime(form.scenarioTime, 120) ?? '';
  return {
    event: { id: `scenario-event-${number}`, title: '新しい予定', startAt, endAt, location: '', allDay: false },
    nextEventNumber: number + 1
  };
}

export function scenarioFormReducer(form: ScenarioForm, action: ScenarioFormAction): ScenarioForm {
  switch (action.type) {
    case 'loadInput':
      return formFromScenarioInput(action.input);
    case 'setText':
      return { ...form, [action.field]: action.value };
    case 'setLocation':
      return { ...form, latitude: coordinateText(action.latitude), longitude: coordinateText(action.longitude) };
    case 'setNotificationFrequency':
      return { ...form, notificationFrequency: action.value };
    case 'setNotificationsEnabled':
      return { ...form, notificationsEnabled: action.value };
    case 'addEvent': {
      if (form.events.length >= MAX_CALENDAR_EVENTS) return form;
      const { event, nextEventNumber } = newEvent(form);
      return { ...form, events: [...form.events, event], nextEventNumber };
    }
    case 'updateEvent':
      return { ...form, events: form.events.map(event => (event.id === action.id ? { ...event, ...action.patch } : event)) };
    case 'removeEvent':
      return { ...form, events: form.events.filter(event => event.id !== action.id) };
  }
}

/** Offset timestamp sent for the scenario time, independent of errors in other fields. */
export function scenarioTimeIso(form: ScenarioForm): string | null {
  const timezone = form.timezone.trim();
  return TimezoneSchema.safeParse(timezone).success ? zonedWallTimeToIso(form.scenarioTime, timezone) : null;
}

/** Goal state beside the step inputs, independent of errors in other fields. */
export function stepGoalState(form: ScenarioForm): 'reached' | 'below' | 'unknown' | 'invalid' {
  const steps = form.stepsToday.trim();
  const goal = form.stepGoal.trim();
  if (steps === '') return 'unknown';
  const stepsValue = Number(steps);
  const goalValue = Number(goal);
  if (goal === '' || !Number.isInteger(stepsValue) || !Number.isInteger(goalValue)) return 'invalid';
  return stepsValue >= goalValue ? 'reached' : 'below';
}

/** Splits interests on ASCII/Japanese commas and newlines, keeping first occurrences. */
export function parseInterests(text: string): string[] {
  return [...new Set(text.split(/[,、\n]/).map(value => value.trim()).filter(value => value.length > 0))];
}

type ErrorBag = Partial<Record<FieldKey, string[]>>;

function addError(errors: ErrorBag, key: FieldKey, message: string): void {
  const messages = errors[key] ?? [];
  if (!messages.includes(message)) messages.push(message);
  errors[key] = messages;
}

function readNumber(errors: ErrorBag, key: FieldKey, text: string, required: boolean): number | null {
  const trimmed = text.trim();
  if (trimmed === '') {
    if (required) addError(errors, key, '入力してください');
    return null;
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value)) {
    addError(errors, key, '数値で入力してください');
    return null;
  }
  return value;
}

function readTime(errors: ErrorBag, key: FieldKey, wall: string, timezone: string): string {
  if (wall.trim() === '') {
    addError(errors, key, '日時を入力してください');
    return '';
  }
  const iso = zonedWallTimeToIso(wall, timezone);
  if (iso === null) addError(errors, key, '日時の形式が正しくありません');
  return iso ?? '';
}

type ContractIssue = NonNullable<ReturnType<typeof ScenarioContextInputSchema.safeParse>['error']>['issues'][number];

function issueFieldKey(path: readonly PropertyKey[], form: ScenarioForm): FieldKey {
  const [head, second, third] = path;
  if (head === 'capturedAt' || head === 'scenarioTime' || (head === 'location' && second === 'capturedAt')) return 'scenarioTime';
  if (head === 'location' && (second === 'latitude' || second === 'longitude' || second === 'accuracyMeters')) return second;
  if (head === 'activity' && second === 'stepsToday') return 'stepsToday';
  if ((head === 'activity' || head === 'preferencesOverride') && second === 'stepGoal') return 'stepGoal';
  if (head === 'calendar') {
    const event = typeof second === 'number' ? form.events[second] : undefined;
    if (event && (third === 'title' || third === 'startAt' || third === 'endAt' || third === 'location')) return `event.${event.id}.${third}`;
    return 'calendar';
  }
  if (head === 'preferencesOverride') {
    if (second === 'interests') return 'interests';
    if (second === 'locale' || second === 'timezone' || second === 'notificationFrequency') return second;
  }
  return 'form';
}

function bound(value: number | bigint): string {
  return value.toLocaleString('ja-JP');
}

/** Japanese message for a contract validation issue. */
export function describeIssue(issue: ContractIssue): string {
  switch (issue.code) {
    case 'too_small':
      if (issue.origin === 'string') return Number(issue.minimum) <= 1 ? '入力してください' : `${bound(issue.minimum)}文字以上で入力してください`;
      if (issue.origin === 'number') return `${bound(issue.minimum)}以上で入力してください`;
      if (issue.origin === 'array') return `${bound(issue.minimum)}件以上必要です`;
      return issue.message;
    case 'too_big':
      if (issue.origin === 'string') return `${bound(issue.maximum)}文字以内で入力してください`;
      if (issue.origin === 'number') return `${bound(issue.maximum)}以下で入力してください`;
      if (issue.origin === 'array') return `${bound(issue.maximum)}件以内にしてください`;
      return issue.message;
    case 'invalid_type':
      if (issue.expected === 'int') return '整数で入力してください';
      if (issue.expected === 'number') return '数値で入力してください';
      return '値の形式が正しくありません';
    case 'invalid_format':
      return issue.format === 'datetime' ? '日時の形式が正しくありません' : '形式が正しくありません';
    case 'invalid_value':
      return '選択肢から選んでください';
    case 'unrecognized_keys':
      return '送信できない項目が含まれています';
    case 'custom': {
      const field = issue.path[issue.path.length - 1];
      if (field === 'timezone') return 'IANAタイムゾーン名で入力してください（例: Asia/Tokyo）';
      if (field === 'endAt' && issue.message.includes('31')) return '終日でない予定は31日以内にしてください';
      if (field === 'endAt' && issue.message.includes('after')) return '終了は開始と同じかそれ以降にしてください';
      if (issue.message === 'Invalid timestamp') return '日時が正しくありません';
      return issue.message;
    }
    default:
      return issue.message;
  }
}

/**
 * Builds the preview evaluation request. Mode and delivery are fixed to
 * simulation/preview; the result is validated with the shared contract.
 */
export function buildScenarioRequest(form: ScenarioForm): BuildResult {
  const errors: ErrorBag = {};
  const timezone = form.timezone.trim();
  const timezoneValid = TimezoneSchema.safeParse(timezone).success;
  if (!timezoneValid) addError(errors, 'timezone', 'IANAタイムゾーン名で入力してください（例: Asia/Tokyo）');

  const latitude = readNumber(errors, 'latitude', form.latitude, true);
  const longitude = readNumber(errors, 'longitude', form.longitude, true);
  const accuracyMeters = readNumber(errors, 'accuracyMeters', form.accuracyMeters, false);
  const stepsToday = readNumber(errors, 'stepsToday', form.stepsToday, false);
  const stepGoal = readNumber(errors, 'stepGoal', form.stepGoal, true);
  const at = timezoneValid ? readTime(errors, 'scenarioTime', form.scenarioTime, timezone) : '';
  const calendar = form.events.map(event => ({
    id: event.id,
    title: event.title.trim(),
    startAt: timezoneValid ? readTime(errors, `event.${event.id}.startAt`, event.startAt, timezone) : '',
    endAt: timezoneValid ? readTime(errors, `event.${event.id}.endAt`, event.endAt, timezone) : '',
    location: event.location.trim() === '' ? null : event.location.trim(),
    allDay: event.allDay
  }));
  if (Object.keys(errors).length > 0 || latitude === null || longitude === null || stepGoal === null) return { ok: false, errors };

  const draft = {
    mode: 'simulation',
    deliveryMode: 'preview',
    capturedAt: at,
    scenarioTime: at,
    location: { latitude, longitude, ...(accuracyMeters === null ? {} : { accuracyMeters }), capturedAt: at, source: 'scenario' },
    activity: stepsToday === null
      ? { stepsToday: null, stepGoal, stepSource: 'scenario' }
      : { stepsToday, stepGoal, stepGoalReached: stepsToday >= stepGoal, stepSource: 'scenario', confidence: 'high' },
    calendar,
    ...(form.calendarStatus === undefined ? {} : { calendarStatus: form.calendarStatus }),
    preferencesOverride: {
      interests: parseInterests(form.interests), stepGoal, notificationFrequency: form.notificationFrequency,
      notificationsEnabled: form.notificationsEnabled, locale: form.locale.trim(), timezone
    }
  };
  const parsed = ScenarioContextInputSchema.safeParse(draft);
  if (parsed.success) return { ok: true, request: parsed.data };
  for (const issue of parsed.error.issues) addError(errors, issueFieldKey(issue.path, form), describeIssue(issue));
  return { ok: false, errors };
}
