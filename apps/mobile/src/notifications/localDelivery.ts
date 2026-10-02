import { EvaluationResultSchema } from '@contextia/contracts';

export interface LocalClaimStore {
  /** Must atomically reserve an ID across app/headless lifecycles. */
  claim(id: string, expiresAt: number, now: number): Promise<boolean>;
}
export type LocalNotification = { identifier: string; title: string; body: string; recommendationId: string };
export class LocalDelivery {
  constructor(private readonly options: {
    store: LocalClaimStore; notify: (notification: LocalNotification) => Promise<void>;
    now: () => Date; isCurrent: () => Promise<boolean>;
  }) {}
  async deliver(value: unknown, origin: 'foreground' | 'background'): Promise<'skipped' | 'duplicate' | 'scheduled' | 'failed'> {
    const parsed = EvaluationResultSchema.safeParse(value);
    if (!parsed.success || origin !== 'background') return 'skipped';
    const result = parsed.data;
    if (result.decision !== 'notify' || result.delivery.mode !== 'proactive' || result.delivery.status !== 'ready') return 'skipped';
    const now = this.options.now().getTime();
    const expiresAt = Date.parse(result.contextExpiresAt);
    if (!Number.isFinite(now) || expiresAt <= now) return 'skipped';
    try {
      if (!await this.options.isCurrent()) return 'skipped';
      if (!await this.options.store.claim(result.recommendationId, expiresAt, now)) return 'duplicate';
      if (!await this.options.isCurrent() || this.options.now().getTime() >= expiresAt) return 'skipped';
      await this.options.notify({ identifier: `contextia-${result.recommendationId}`, title: 'Contextia', body: result.message, recommendationId: result.recommendationId });
      return 'scheduled';
    } catch { return 'failed'; }
  }
}
