import { createDefaultUserPreferences, UserPreferencesSchema } from '@contextia/contracts';
import type { EvaluationResult, ListRecommendationsResponse, Profile, RecommendationHistoryItem } from '@contextia/contracts';
import type { BackendClient, BackendFailure, BackendOutcome } from '../api/backendClient';
import { OperationTimeout, withTimeout } from '../async/withTimeout';
import type { ContextCollectionResult } from '../context/types';

export type MobileFailure = BackendFailure | { kind: 'location-required' | 'invalid-context' | 'profile-required' };
export type Resource<T> =
  | { status: 'idle' | 'loading'; data: T | null }
  | { status: 'ready'; data: T }
  | { status: 'error'; data: T | null; error: MobileFailure };

type History = ListRecommendationsResponse['data'];
export type MobileState = {
  profile: Resource<Profile>;
  history: Resource<History>;
  detail: Resource<RecommendationHistoryItem>;
  evaluation: Resource<{ result: EvaluationResult; requestId: string }>;
  collection: ContextCollectionResult | null;
  collecting: boolean;
  collectionError: MobileFailure | null;
  saving: boolean;
  saveResult: 'idle' | 'saved' | MobileFailure;
};

function initialState(): MobileState {
  return {
    profile: { status: 'idle', data: null }, history: { status: 'idle', data: null },
    detail: { status: 'idle', data: null }, evaluation: { status: 'idle', data: null },
    collection: null, collecting: false, collectionError: null, saving: false, saveResult: 'idle'
  };
}

function resource<T>(outcome: BackendOutcome<T>, previous: T | null = null): Resource<T> {
  return outcome.kind === 'success'
    ? { status: 'ready', data: outcome.data }
    : { status: 'error', data: previous, error: outcome };
}

/** One foreground workflow; disposing it clears private state and aborts API calls. */
export class MobileController {
  private state = initialState();
  private active = true;
  private lifetime = 0;
  private detailVersion = 0;
  private readonly listeners = new Set<() => void>();
  private readonly requests = new Set<AbortController>();
  private detailRequest: AbortController | null = null;
  private historyRefreshPending = false;

  constructor(private readonly options: {
    client: BackendClient;
    collector: { collect(stepGoal?: number): Promise<ContextCollectionResult> };
    collectionTimeoutMs?: number;
  }) {}

  getSnapshot = (): MobileState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  activate(): void { this.active = true; }
  dispose(): void {
    this.active = false;
    this.lifetime++;
    this.detailVersion++;
    this.historyRefreshPending = false;
    for (const request of this.requests) request.abort();
    this.requests.clear();
    this.state = initialState();
  }

  private patch(change: Partial<MobileState>): void {
    if (!this.active) return;
    this.state = { ...this.state, ...change };
    for (const listener of this.listeners) listener();
  }
  private current(lifetime: number): boolean { return this.active && lifetime === this.lifetime; }
  private busy(): boolean { return this.state.collecting || this.state.evaluation.status === 'loading' || this.state.saving; }
  private async call<T>(operation: (signal: AbortSignal) => Promise<BackendOutcome<T>>): Promise<BackendOutcome<T>> {
    const request = new AbortController();
    this.requests.add(request);
    try { return await operation(request.signal); }
    catch { return { kind: 'network-error' }; }
    finally { this.requests.delete(request); }
  }

  async loadProfile(): Promise<void> {
    if (!this.active || this.state.profile.status === 'loading' || this.state.saving) return;
    const lifetime = this.lifetime;
    this.patch({ profile: { status: 'loading', data: this.state.profile.data } });
    const result = await this.call(async signal => {
      const existing = await this.options.client.getProfile(signal);
      if (signal.aborted || !this.current(lifetime)) return { kind: 'cancelled' };
      if (existing.kind !== 'http-error' || existing.status !== 404 || existing.code !== 'PROFILE_NOT_FOUND') return existing;
      const initialized = await this.options.client.updatePreferences(createDefaultUserPreferences(), signal, true);
      if (signal.aborted || !this.current(lifetime)) return { kind: 'cancelled' };
      if (initialized.kind !== 'success' && !(initialized.kind === 'http-error' && initialized.status === 412 && initialized.code === 'PROFILE_EXISTS')) return initialized;
      return this.options.client.getProfile(signal);
    });
    if (this.current(lifetime)) this.patch({ profile: resource(result) });
  }

  async loadHistory(append = false): Promise<void> {
    if (!this.active) return;
    if (this.state.history.status === 'loading') {
      if (!append) this.historyRefreshPending = true;
      return;
    }
    const lifetime = this.lifetime;
    const previous = this.state.history.data;
    const cursor = append ? previous?.nextCursor : undefined;
    if (append && !cursor) return;
    if (!append) this.historyRefreshPending = false;
    this.patch({ history: { status: 'loading', data: previous } });
    const result = await this.call(signal => this.options.client.listRecommendations(cursor ? { cursor } : {}, signal));
    if (!this.current(lifetime)) return;
    if (result.kind === 'success' && append && previous) {
      const seen = new Set<string>();
      const items = [...previous.items, ...result.data.items].filter(item => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      });
      this.patch({ history: { status: 'ready', data: { items, nextCursor: result.data.nextCursor === cursor ? null : result.data.nextCursor } } });
    } else this.patch({ history: resource(result, previous) });
    if (this.current(lifetime) && this.historyRefreshPending) {
      this.historyRefreshPending = false;
      await this.loadHistory();
    }
  }

  async openDetail(id: string): Promise<void> {
    if (!this.active) return;
    this.detailRequest?.abort();
    const request = new AbortController();
    this.detailRequest = request;
    this.requests.add(request);
    const version = ++this.detailVersion;
    const lifetime = this.lifetime;
    this.patch({ detail: { status: 'loading', data: null } });
    let result: BackendOutcome<RecommendationHistoryItem>;
    try { result = await this.options.client.getRecommendation(id, request.signal); }
    catch { result = { kind: 'network-error' }; }
    finally { this.requests.delete(request); }
    if (this.current(lifetime) && version === this.detailVersion) this.patch({ detail: resource(result) });
  }

  closeDetail(): void {
    this.detailVersion++;
    this.detailRequest?.abort();
    this.detailRequest = null;
    this.patch({ detail: { status: 'idle', data: null } });
  }

  private async collect(lifetime: number): Promise<ContextCollectionResult | null> {
    this.patch({ collecting: true, collection: null, collectionError: null });
    try {
      const goal = this.state.profile.data?.preferences.stepGoal;
      const result = await withTimeout(this.options.collector.collect(goal), this.options.collectionTimeoutMs ?? 45_000);
      if (!this.current(lifetime)) return null;
      this.patch({ collection: result });
      return result;
    } catch (error) {
      if (this.current(lifetime)) this.patch({ collectionError: error instanceof OperationTimeout ? { kind: 'timeout' } : { kind: 'invalid-context' } });
      return null;
    } finally {
      if (this.current(lifetime)) this.patch({ collecting: false });
    }
  }

  async readContext(): Promise<void> {
    if (!this.active || this.busy()) return;
    await this.collect(this.lifetime);
  }

  async evaluate(): Promise<void> {
    if (!this.active || this.busy() || this.state.profile.status === 'loading') return;
    const lifetime = this.lifetime;
    this.patch({ evaluation: { status: 'loading', data: null }, saveResult: 'idle' });
    const collection = await this.collect(lifetime);
    if (!this.current(lifetime)) return;
    if (collection?.status !== 'ready') {
      const error: MobileFailure = this.state.collectionError ?? (collection?.status === 'location-unavailable' ? { kind: 'location-required' } : { kind: 'invalid-context' });
      this.patch({ evaluation: { status: 'error', data: null, error } });
      return;
    }
    const result = await this.call(signal => this.options.client.evaluate(collection.input, signal));
    if (!this.current(lifetime)) return;
    this.patch({ evaluation: result.kind === 'success'
      ? { status: 'ready', data: { result: result.data, requestId: result.requestId } }
      : { status: 'error', data: null, error: result }
    });
    if (result.kind === 'success') void this.loadHistory();
  }

  async savePreferences(input: unknown): Promise<void> {
    if (!this.active || this.busy() || this.state.profile.status === 'loading') return;
    const profile = this.state.profile.data;
    if (!profile) { this.patch({ saveResult: { kind: 'profile-required' } }); return; }
    const parsed = UserPreferencesSchema.safeParse(input);
    if (!parsed.success) {
      this.patch({ saveResult: { kind: 'invalid-request', fields: parsed.error.issues.map(issue => issue.path.map(String).join('.')) } });
      return;
    }
    const lifetime = this.lifetime;
    this.patch({ saving: true, saveResult: 'idle' });
    const result = await this.call(signal => this.options.client.updatePreferences(parsed.data, signal));
    if (!this.current(lifetime)) return;
    this.patch(result.kind === 'success'
      ? { saving: false, saveResult: 'saved', profile: { status: 'ready', data: { ...profile, preferences: parsed.data } } }
      : { saving: false, saveResult: result }
    );
  }
}
