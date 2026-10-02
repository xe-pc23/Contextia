import { ScenarioContextInputSchema } from '@contextia/contracts';
import type { ScenarioContextInput, ScenarioId } from '@contextia/contracts';
import presetInputs from './presetInputs.json';
import { DEFAULT_TIMEZONE } from './form.js';
import { formatInstantInZone, isoToZonedWallTime, zonedWallTimeToIso } from './time.js';

export const DEFAULT_PRESET_ID: ScenarioId = 'step-goal';
export const CONSOLE_PRESETS: readonly { readonly id: ScenarioId; readonly label: string; readonly description: string }[] = [
  { id: 'upcoming-transit', label: '予定前の移動', description: '目的地のある次の予定と、現在地からの移動を考えます。' },
  { id: 'step-goal', label: '歩数目標達成', description: '目標を達成した歩数で、近くの休憩候補を考えます。' },
  { id: 'free-time', label: '予定までの空き時間', description: '次の予定までの時間と好みに合う過ごし方を考えます。' },
  { id: 'weather-adaptation', label: '天候に合わせた候補', description: '選んだ位置の実際の天気を使います。雨や推薦の発生は保証されません。' },
  { id: 'early-arrival', label: '目的地へ早く到着', description: '目的地の近くで、予定開始までに収まる立ち寄りを考えます。' }
];

/** Loads input-only presets on today's local date at their fixed scenario time. */
export function createPresetInput(id: ScenarioId, now: Date): ScenarioContextInput {
  const template = ScenarioContextInputSchema.parse(presetInputs[id]);
  const timezone = template.preferencesOverride?.timezone ?? DEFAULT_TIMEZONE;
  const templateAt = template.scenarioTime ?? template.capturedAt;
  const today = formatInstantInZone(now.getTime(), timezone);
  const wallTime = isoToZonedWallTime(templateAt, timezone);
  if (today === null || wallTime === null) throw new RangeError('Invalid preset clock or timestamp');
  const at = zonedWallTimeToIso(`${today.slice(0, 10)}T${wallTime.slice(11)}`, timezone);
  if (at === null) throw new RangeError('Invalid preset clock or timestamp');
  const shiftMs = Date.parse(at) - Date.parse(templateAt);
  const shift = (timestamp: string): string => {
    const shifted = formatInstantInZone(Date.parse(timestamp) + shiftMs, timezone);
    if (shifted === null) throw new RangeError('Invalid preset clock or timestamp');
    return shifted;
  };
  return ScenarioContextInputSchema.parse({
    ...template,
    capturedAt: at,
    scenarioTime: at,
    location: { ...template.location, capturedAt: at },
    calendar: template.calendar.map(event => ({ ...event, startAt: shift(event.startAt), endAt: shift(event.endAt) }))
  });
}
