import type { NativeReadStatus, StepReadResult, StepSource } from './types';
import { UnavailableStepSource } from './unavailableStepSource';

export interface PedometerPort {
  available(): Promise<boolean>;
  permission(): Promise<NativeReadStatus>;
  read(start: Date, end: Date): Promise<number>;
}
export interface HealthConnectPort {
  initialize(): Promise<boolean>;
  permissions(): Promise<{ steps: boolean; background: boolean }>;
  read(start: string, end: string): Promise<number>;
}
function validCount(count: number): boolean { return Number.isInteger(count) && count >= 0 && count <= 200_000; }
function midnight(now: Date): Date { const start = new Date(now); start.setHours(0, 0, 0, 0); return start; }
/** Find the first instant of the profile's current day using the OS IANA database. */
function stepDayStart(now: Date, timezone?: string): Date {
  if (!timezone) return midnight(now);
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, calendar: 'gregory', numberingSystem: 'latn', year: 'numeric', month: '2-digit', day: '2-digit' });
  const key = (instant: number) => {
    const parts = formatter.formatToParts(new Date(instant));
    return ['year', 'month', 'day'].map(type => {
      const value = parts.find(part => part.type === type)?.value;
      if (!value) throw new Error('Unavailable timezone day');
      return value;
    }).join('-');
  };
  const day = key(now.getTime());
  let low = now.getTime() - 36 * 60 * 60_000;
  let high = now.getTime();
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (key(middle) < day) low = middle; else high = middle;
  }
  return new Date(high);
}
export class IosPedometerStepSource implements StepSource {
  constructor(private readonly port: PedometerPort) {}
  async getTodaySteps(now: Date, timezone?: string): Promise<StepReadResult> {
    try {
      if (!Number.isFinite(now.getTime()) || !await this.port.available()) return { status: 'unavailable' };
      const permission = await this.port.permission();
      if (permission !== 'granted') return { status: permission };
      const steps = await this.port.read(stepDayStart(now, timezone), now);
      return validCount(steps) ? { status: 'granted', steps, source: 'ios-pedometer', confidence: 'high' } : { status: 'unavailable' };
    } catch { return { status: 'unavailable' }; }
  }
}
export class AndroidHealthConnectStepSource implements StepSource {
  constructor(private readonly port: HealthConnectPort, private readonly background = false) {}
  async getTodaySteps(now: Date, timezone?: string): Promise<StepReadResult> {
    try {
      if (!Number.isFinite(now.getTime()) || !await this.port.initialize()) return { status: 'unavailable' };
      const permission = await this.port.permissions();
      if (!permission.steps) return { status: 'denied' };
      if (this.background && !permission.background) return { status: 'unavailable' };
      const steps = await this.port.read(stepDayStart(now, timezone).toISOString(), now.toISOString());
      return validCount(steps) ? { status: 'granted', steps, source: 'android-health-connect', confidence: 'high' } : { status: 'unavailable' };
    } catch { return { status: 'unavailable' }; }
  }
}
/** A conservative count observed in this foreground session, never full-day history. */
export class ForegroundPedometerFallbackSource implements StepSource {
  private sample: { day: number; count: number; baseline: number } | null = null;
  observe(count: number, now: Date): void {
    if (!validCount(count) || !Number.isFinite(now.getTime())) return;
    const day = midnight(now).getTime();
    if (this.sample && day < this.sample.day) return;
    if (!this.sample) this.sample = { day, count, baseline: 0 };
    else if (day !== this.sample.day) this.sample = { day, count, baseline: count };
    else if (count >= this.sample.count) this.sample.count = count;
  }
  reset(): void { this.sample = null; }
  async getTodaySteps(now: Date, timezone?: string): Promise<StepReadResult> {
    if (!this.sample || !Number.isFinite(now.getTime()) || this.sample.day !== midnight(now).getTime()) return { status: 'unavailable' };
    try { if (stepDayStart(now, timezone).getTime() !== this.sample.day) return { status: 'unavailable' }; }
    catch { return { status: 'unavailable' }; }
    return { status: 'granted', steps: this.sample.count - this.sample.baseline, source: 'foreground-sensor', confidence: 'low' };
  }
}
export function selectStepSource(platform: string, ios: StepSource, android: StepSource): StepSource {
  if (platform === 'ios') return ios;
  if (platform === 'android') return android;
  return new UnavailableStepSource();
}
