/**
 * Party / org overlay data feed (main process).
 *
 * Holds the overlay subscription on the authenticated /client socket (OVERLAY-SPEC.md):
 *  - subscribes with `overlay_subscribe` whenever the link (re)authenticates and the feature is on;
 *  - keeps the latest roster / layout from the ack and from `overlay_roster` / `overlay_layout` /
 *    `overlay_party` pushes (older layout versions are ignored);
 *  - hands the overlay window at most one state per `minPushMs` (default 250 ms = 4 Hz), trailing.
 *
 * Electron-free (the link, settings and push are injected) so it is unit-tested in test/overlay.
 */
import type { OverlayLayout, OverlayRoster } from '../../../shared/overlay/overlay-resolve';
import type { PartyOverlaySettings } from './party-overlay-settings';

export type FeedLink = {
  readonly authenticated: boolean;
  sendWithAck(event: string, payload: unknown, onAck?: (ack: any | undefined) => void): boolean;
  onServer(event: string, fn: (...args: any[]) => void): void;
  on(event: 'authenticated' | 'unauthenticated', fn: () => void): unknown;
};

export type FeedStatus = 'off' | 'connecting' | 'live' | 'signed-out' | 'no-access' | 'no-party' | 'no-source' | 'error';

export type PartyOverlayState = {
  status: FeedStatus;
  message?: string;
  source: { scope: 'org' | 'party'; id: string; label: string } | null;
  roster: OverlayRoster | null;
  layout: OverlayLayout | null;
  party: { id: string; name: string; code: string; ownerId: string; members: { userId: string; name: string }[] } | null;
  compact: boolean;
};

export type FeedDeps = {
  link: FeedLink;
  getSettings: () => PartyOverlaySettings;
  isSignedIn: () => boolean;
  push: (state: PartyOverlayState) => void;
  minPushMs?: number;
  log?: (level: 'info' | 'warn' | 'debug', msg: string) => void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
  now?: () => number;
};

const MESSAGES: Partial<Record<FeedStatus, string>> = {
  'signed-out': 'Sign in to VOIDLOG.GG',
  'no-access': 'Verified org members only',
  'no-party': 'Not in a party',
  'no-source': 'Pick an org or party in Settings',
};

export class PartyOverlayFeed {
  private state: PartyOverlayState;
  private seq = 0;
  private lastPush = 0;
  private pushTimer: unknown = null;
  private readonly d: Required<Omit<FeedDeps, 'log'>> & Pick<FeedDeps, 'log'>;

  constructor(deps: FeedDeps) {
    this.d = {
      minPushMs: 250,
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (t) => clearTimeout(t as NodeJS.Timeout),
      now: Date.now,
      ...deps,
    };
    this.state = { status: 'off', source: null, roster: null, layout: null, party: null, compact: deps.getSettings().partyOverlayCompact };
    const { link } = this.d;
    link.on('authenticated', () => this.resubscribe());
    link.on('unauthenticated', () => this.enabled() && this.set({ status: 'connecting', message: undefined }));
    link.onServer('overlay_roster', (r: OverlayRoster) => this.onRoster(r));
    link.onServer('overlay_layout', (l: OverlayLayout) => this.onLayout(l));
    link.onServer('overlay_party', (p: PartyOverlayState['party']) => this.onParty(p));
  }

  get current(): PartyOverlayState {
    return this.state;
  }

  private enabled(): boolean {
    return this.d.getSettings().partyOverlayEnabled;
  }

  /** Settings changed (or startup): subscribe to the configured source. */
  resubscribe(): void {
    const s = this.d.getSettings();
    const seq = ++this.seq;
    this.state.compact = s.partyOverlayCompact;
    if (!s.partyOverlayEnabled) return this.set({ status: 'off', source: null, roster: null, layout: null, party: null, message: undefined });
    if (!this.d.isSignedIn()) return this.set({ status: 'signed-out', roster: null, message: MESSAGES['signed-out'] });
    if (s.partyOverlaySource === 'org' && !s.partyOverlayOrgTag) return this.set({ status: 'no-source', roster: null, message: MESSAGES['no-source'] });
    if (!this.d.link.authenticated) return this.set({ status: 'connecting', message: undefined });
    const payload = s.partyOverlaySource === 'org' ? { scope: 'org', tag: s.partyOverlayOrgTag } : { scope: 'party' };
    const sent = this.d.link.sendWithAck('overlay_subscribe', payload, (ack) => {
      if (seq !== this.seq) return; // superseded by a newer subscribe
      if (!ack) return this.set({ status: 'error', message: 'No answer from VOIDLOG.GG' });
      if (!ack.ok) {
        const status: FeedStatus = ack.error === 'no-access' || ack.error === 'no-party' || ack.error === 'signed-out' ? ack.error : 'error';
        // Keep a header label for the overlay even though the server sent no source.
        const source = s.partyOverlaySource === 'org' ? { scope: 'org' as const, id: s.partyOverlayOrgTag, label: `[${s.partyOverlayOrgTag}]` } : null;
        return this.set({ status, source, roster: null, layout: null, message: MESSAGES[status] ?? String(ack.error ?? 'Unavailable') });
      }
      this.d.log?.('info', `Overlay subscribed to ${ack.source?.scope} ${ack.source?.label}`);
      this.set({ status: 'live', message: undefined, source: ack.source ?? null, roster: ack.roster ?? null, layout: ack.layout ?? null, party: ack.party ?? null });
    });
    if (!sent) this.set({ status: 'connecting', message: undefined });
  }

  /** Ask the server to drop the subscription (feature turned off). */
  unsubscribe(): void {
    this.seq++;
    if (this.d.link.authenticated) this.d.link.sendWithAck('overlay_unsubscribe', {});
    this.set({ status: 'off', source: null, roster: null, layout: null, party: null });
  }

  private onRoster(r: OverlayRoster): void {
    if (!this.enabled() || !r || !this.state.source) return;
    if (r.scope !== this.state.source.scope || r.id !== this.state.source.id) return;
    this.set({ roster: r });
  }

  private onLayout(l: OverlayLayout): void {
    if (!this.enabled() || !l || !this.state.source) return;
    if (l.scope !== this.state.source.scope || l.id !== this.state.source.id) return;
    if (this.state.layout && l.version < this.state.layout.version) return;
    this.set({ layout: l });
  }

  private onParty(p: PartyOverlayState['party']): void {
    if (!this.enabled() || this.state.source?.scope !== 'party') return;
    if (!p) return this.set({ status: 'no-party', party: null, roster: null, message: MESSAGES['no-party'] });
    this.set({ party: p, source: { scope: 'party', id: p.id, label: p.name } });
  }

  private set(patch: Partial<PartyOverlayState>): void {
    this.state = { ...this.state, ...patch };
    this.schedulePush();
  }

  /** Throttle to one push per minPushMs; the last state always goes out (trailing edge). */
  private schedulePush(): void {
    if (this.pushTimer) return;
    const wait = Math.max(0, this.lastPush + this.d.minPushMs - this.d.now());
    if (wait === 0) return this.flushPush();
    this.pushTimer = this.d.setTimer(() => {
      this.pushTimer = null;
      this.flushPush();
    }, wait);
  }

  private flushPush(): void {
    this.lastPush = this.d.now();
    this.d.push(this.state);
  }

  /** Party actions from Settings: { action: 'create' | 'join' | 'leave' | 'get' | 'kick' | 'transfer', code?, name?, userId? }. */
  party(action: string, args: { code?: string; name?: string; userId?: string } = {}): Promise<any> {
    return new Promise((resolve) => {
      const sent = this.d.link.sendWithAck('overlay_party', { action, ...args }, (ack) => {
        resolve(ack ?? { ok: false, error: 'No answer from VOIDLOG.GG' });
        if (ack?.ok && ['create', 'join', 'leave'].includes(action) && this.d.getSettings().partyOverlaySource === 'party') this.resubscribe();
      });
      if (!sent) resolve({ ok: false, error: 'Not connected to VOIDLOG.GG' });
    });
  }
}
