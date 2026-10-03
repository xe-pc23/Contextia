import { z } from 'zod';
import { LocationContextSchema, type EvaluationResult, type LocationContext, type Profile } from '@contextia/contracts';
import type { BackendOutcome } from '../api/backendClient';
import type { ContextCollectionResult, RealContextInput } from '../context/types';

const CallbackFixSchema = z.object({ timestamp: z.number().finite(), coords: z.object({ latitude: z.number(), longitude: z.number(), accuracy: z.number().nullable().optional() }) });
export function latestCallbackLocation(payload: unknown, now: Date): LocationContext | null {
  const batch = z.object({ locations: z.array(z.unknown()) }).safeParse(payload);
  if (!batch.success || !Number.isFinite(now.getTime())) return null;
  let latest: LocationContext | null = null;
  for (const raw of batch.data.locations.slice(-100)) {
    const fix = CallbackFixSchema.safeParse(raw);
    if (!fix.success || fix.data.timestamp > now.getTime() || now.getTime() - fix.data.timestamp > 10 * 60_000) continue;
    const location = LocationContextSchema.safeParse({ latitude: fix.data.coords.latitude, longitude: fix.data.coords.longitude,
      ...(fix.data.coords.accuracy == null ? {} : { accuracyMeters: fix.data.coords.accuracy }),
      capturedAt: new Date(fix.data.timestamp).toISOString(), source: 'gps' });
    if (location.success && (!latest || Date.parse(location.data.capturedAt) > Date.parse(latest.capturedAt))) latest = location.data;
  }
  return latest;
}

export class BackgroundEvaluation {
  private pending: Promise<void> = Promise.resolve();
  constructor(private readonly options: {
    isCurrent: () => Promise<boolean>;
    profile: () => Promise<BackendOutcome<Profile>>;
    collect: (profile: Profile) => Promise<ContextCollectionResult>;
    evaluate: (input: RealContextInput) => Promise<BackendOutcome<EvaluationResult>>;
    deliver: (value: EvaluationResult) => Promise<void>;
  }) {}
  run(): Promise<void> {
    const next = this.pending.catch(() => undefined).then(() => this.execute()).catch(() => undefined);
    this.pending = next;
    return next;
  }
  private async execute(): Promise<void> {
    if (!await this.options.isCurrent()) return;
    const profile = await this.options.profile();
    if (!await this.options.isCurrent() || profile.kind !== 'success' || !profile.data.preferences.notificationsEnabled) return;
    const context = await this.options.collect(profile.data);
    if (!await this.options.isCurrent() || context.status !== 'ready') return;
    const result = await this.options.evaluate(context.input);
    if (!await this.options.isCurrent() || result.kind !== 'success') return;
    await this.options.deliver(result.data);
  }
}
