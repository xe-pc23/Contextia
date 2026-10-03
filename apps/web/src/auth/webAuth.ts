import { z } from 'zod';
import { browserRedirectUri } from '../runtimeConfig.js';
import type { WebConfig } from '../runtimeConfig.js';

export type AuthSnapshot = { readonly status: 'loading' } | { readonly status: 'signed-out'; readonly message: string | null } | { readonly status: 'signed-in' };
type Ports = {
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>; crypto: Crypto; fetch: typeof fetch;
  now: () => number; navigate: (url: string) => void; clearCallback: () => void; origin: string;
};
const TransactionSchema = z.strictObject({ state: z.string().min(32), verifier: z.string().min(43), createdAt: z.number(), redirectUri: z.string(), clientId: z.string() });
const TokenSchema = z.object({ access_token: z.string().min(1), refresh_token: z.string().min(1).optional(), expires_in: z.number().int().positive().max(86_400), token_type: z.literal('Bearer') });
type Session = { accessToken: string; refreshToken: string | null; expiresAt: number };
function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
export async function pkceChallenge(verifier: string, crypto: Crypto): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}

/** Tokens stay in memory; sessionStorage contains only the expiring PKCE transaction. */
export class WebAuthSession {
  private snapshot: AuthSnapshot = { status: 'loading' };
  private session: Session | null = null;
  private initialization: Promise<void> | null = null;
  private refreshing: Promise<string | null> | null = null;
  private generation = 0;
  private readonly listeners = new Set<() => void>();
  private readonly storageKey: string;
  private readonly redirectUri: string;
  constructor(private readonly config: WebConfig, private readonly ports: Ports) {
    this.storageKey = `contextia:${config.stage}:${config.auth.clientId}:pkce`;
    this.redirectUri = browserRedirectUri(config, ports.origin);
  }
  getSnapshot = (): AuthSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(snapshot: AuthSnapshot): void { this.snapshot = snapshot; this.listeners.forEach(listener => listener()); }
  private clearTransaction(): void {
    try { this.ports.storage.removeItem(this.storageKey); } catch { /* Storage denial cannot retain the in-memory session. */ }
  }
  invalidate = (): void => {
    this.generation++; this.session = null; this.clearTransaction();
    this.publish({ status: 'signed-out', message: 'ログインし直してください。' });
  };
  async signIn(): Promise<void> {
    const verifier = base64url(this.ports.crypto.getRandomValues(new Uint8Array(32)));
    const state = base64url(this.ports.crypto.getRandomValues(new Uint8Array(32)));
    const challenge = await pkceChallenge(verifier, this.ports.crypto);
    this.ports.storage.setItem(this.storageKey, JSON.stringify({ verifier, state, createdAt: this.ports.now(), redirectUri: this.redirectUri, clientId: this.config.auth.clientId }));
    const url = new URL('/oauth2/authorize', this.config.auth.cognitoDomain);
    url.search = new URLSearchParams({ response_type: 'code', client_id: this.config.auth.clientId, redirect_uri: this.redirectUri, scope: this.config.auth.scopes.join(' '), state, code_challenge: challenge, code_challenge_method: 'S256' }).toString();
    this.ports.navigate(url.toString());
  }
  signOut(): void {
    this.invalidate();
    const url = new URL('/logout', this.config.auth.cognitoDomain);
    url.search = new URLSearchParams({ client_id: this.config.auth.clientId, logout_uri: this.redirectUri }).toString();
    this.ports.navigate(url.toString());
  }
  initialize(callback: string): Promise<void> {
    this.initialization ??= this.completeLogin(callback);
    return this.initialization;
  }
  private async completeLogin(callback: string): Promise<void> {
    const url = new URL(callback);
    if (!url.searchParams.has('code') && !url.searchParams.has('error')) { this.publish({ status: 'signed-out', message: null }); return; }
    const generation = this.generation;
    try {
      let stored: string | null;
      try { stored = this.ports.storage.getItem(this.storageKey); }
      finally { this.clearTransaction(); this.ports.clearCallback(); }
      const transaction = TransactionSchema.parse(stored === null ? null : JSON.parse(stored) as unknown);
      const age = this.ports.now() - transaction.createdAt;
      const code = url.searchParams.get('code');
      if (!code || url.origin !== new URL(this.redirectUri).origin || url.pathname !== '/' || url.searchParams.get('state') !== transaction.state || age < 0 || age > 600_000 || transaction.redirectUri !== this.redirectUri || transaction.clientId !== this.config.auth.clientId) throw new Error('Invalid callback');
      const token = await this.exchange({ grant_type: 'authorization_code', code, redirect_uri: this.redirectUri, code_verifier: transaction.verifier });
      if (generation !== this.generation) return;
      this.session = { accessToken: token.access_token, refreshToken: token.refresh_token ?? null, expiresAt: this.ports.now() + token.expires_in * 1000 };
      this.publish({ status: 'signed-in' });
    } catch { if (generation === this.generation) this.invalidate(); }
  }
  private async exchange(parameters: Record<string, string>): Promise<z.infer<typeof TokenSchema>> {
    const response = await this.ports.fetch(new URL('/oauth2/token', this.config.auth.cognitoDomain).toString(), {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...parameters, client_id: this.config.auth.clientId }).toString(),
      credentials: 'omit', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) throw new Error('Token exchange failed');
    const value: unknown = await response.json();
    return TokenSchema.parse(value);
  }
  getAccessToken = async (): Promise<string | null> => {
    if (!this.session) return null;
    if (this.session.expiresAt - this.ports.now() > 30_000) return this.session.accessToken;
    if (!this.refreshing) {
      this.refreshing = this.refresh().finally(() => { this.refreshing = null; });
    }
    return this.refreshing;
  };
  private async refresh(): Promise<string | null> {
    const session = this.session; const generation = this.generation;
    if (!session?.refreshToken) { this.invalidate(); return null; }
    try {
      const token = await this.exchange({ grant_type: 'refresh_token', refresh_token: session.refreshToken });
      if (generation !== this.generation) return null;
      this.session = { accessToken: token.access_token, refreshToken: token.refresh_token ?? session.refreshToken, expiresAt: this.ports.now() + token.expires_in * 1000 };
      return this.session.accessToken;
    } catch { if (generation === this.generation) this.invalidate(); return null; }
  }
}
