/**
 * Party / org overlay data feed (main process).
 *
 * Holds the overlay subscription on the authenticated /client socket (OVERLAY-SPEC.md):
 *  - subscribes with `overlay_subscribe` whenever the link (re)authenticates and the feature is on;
 *  - keeps the latest roster / layout from the ack and from `overlay_roster` / `overlay_layout` /
 *    `overlay_party` pushes (older layout versions are ignored), and `overlay_revoked` (org access lost);
 *  - member ids are opaque, room-scoped ids from the server; `selfId` (from the ack) is ours.
 *    The party invite code is only sent to the owner, never in room broadcasts.
 *  - hands the overlay window at most one state per `minPushMs` (default 250 ms = 4 Hz), trailing.
 *
 * Electron-free (the link, settings and push are injected) so it is unit-tested in test/overlay.
 */
import type { OverlayLayout, OverlayRoster } from '../../../shared/overlay/overlay-resolve';
import type { PartyOverlaySettings } from './party-overlay-settings';
import { sanitizeOrgChoices, type OrgChoice } from '../../../shared/overlay/org-tag';

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
  party: PartyInfo | null;
  /** Our opaque member id in the subscribed room (for the YOU marker and owner checks). */
  selfId: string | null;
  compact: boolean;
};

/** A party as the server sends it. `code`, `selfId`, `isOwner` only come in replies meant for us. */
export type PartyInfo = {
  id: string;
  name: string;
  ownerId: string;
  members: { userId: string; name: string }[];
  max?: number;
  code?: string;
  selfId?: string;
  isOwner?: boolean;
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

const MESSAGES: Partial<Record<FeedStatus | 'rate-limited', string>> = {
  'signed-out': 'Sign in to VOIDLOG.GG',
  'no-access': 'Verified org members only',
  'rate-limited': 'Too many requests, try again shortly',
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
    this.state = { status: 'off', source: null, roster: null, layout: null, party: null, selfId: null, compact: deps.getSettings().partyOverlayCompact };
    const { link } = this.d;
    link.on('authenticated', () => this.resubscribe());
    link.on('unauthenticated', () => this.enabled() && this.set({ status: 'connecting', message: undefined }));
    link.onServer('overlay_roster', (r: OverlayRoster) => this.onRoster(r));
    link.onServer('overlay_layout', (l: OverlayLayout) => this.onLayout(l));
    link.onServer('overlay_party', (p: PartyInfo | null) => this.onParty(p));
    link.onServer('overlay_revoked', () => this.onRevoked());
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
    if (!s.partyOverlayEnabled) return this.set({ status: 'off', source: null, roster: null, layout: null, party: null, selfId: null, message: undefined });
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
        return this.set({ status, source, roster: null, layout: null, selfId: null, message: MESSAGES[status] ?? MESSAGES[ack.error as 'rate-limited'] ?? String(ack.error ?? 'Unavailable') });
      }
      this.d.log?.('info', `Overlay subscribed to ${ack.source?.scope} ${ack.source?.label}`);
      this.set({ status: 'live', message: undefined, source: ack.source ?? null, roster: ack.roster ?? null, layout: ack.layout ?? null, party: ack.party ?? null, selfId: ack.selfId ?? null });
    });
    if (!sent) this.set({ status: 'connecting', message: undefined });
  }

  /** Ask the server to drop the subscription (feature turned off). */
  unsubscribe(): void {
    this.seq++;
    if (this.d.link.authenticated) this.d.link.sendWithAck('overlay_unsubscribe', {});
    this.set({ status: 'off', source: null, roster: null, layout: null, party: null, selfId: null });
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

  /**
   * Room broadcast (no code / selfId / isOwner). Work out ownership from our selfId. As owner, show the
   * code we had and re-fetch it (it may have been rotated from the website or another client).
   */
  private onParty(p: PartyInfo | null): void {
    if (!this.enabled() || this.state.source?.scope !== 'party') return;
    if (!p) return this.set({ status: 'no-party', party: null, roster: null, message: MESSAGES['no-party'] });
    const selfId = this.state.selfId ?? undefined;
    const isOwner = !!selfId && p.ownerId === selfId;
    const prev = this.state.party;
    const code = isOwner && prev?.id === p.id ? prev.code : undefined;
    this.set({ party: { ...p, selfId, isOwner, code }, source: { scope: 'party', id: p.id, label: p.name } });
    if (isOwner) void this.party('get');
  }

  /** The server removed us from an org room (no longer a verified member). */
  private onRevoked(): void {
    if (!this.enabled()) return;
    this.set({ status: 'no-access', roster: null, layout: null, message: MESSAGES['no-access'] });
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

  /**
   * The user's verified orgs (`overlay_orgs`), for the Settings tag picker. Resolves null when offline,
   * on timeout, or when the server does not know the event yet (older server): Settings then shows a
   * free-text tag field.
   */
  orgs(timeoutMs = 5000): Promise<OrgChoice[] | null> {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v: OrgChoice[] | null) => {
        if (done) return;
        done = true;
        this.d.clearTimer(timer);
        resolve(v);
      };
      const timer = this.d.setTimer(() => finish(null), timeoutMs);
      const sent = this.d.link.sendWithAck('overlay_orgs', {}, (ack) => finish(ack?.ok ? sanitizeOrgChoices(ack.orgs) : null));
      if (!sent) finish(null);
    });
  }

  /** Party actions from Settings: { action: 'create' | 'join' | 'leave' | 'get' | 'kick' | 'transfer' | 'rotate', code?, name?, userId? (opaque member id) }. */
  party(action: string, args: { code?: string; name?: string; userId?: string } = {}): Promise<any> {
    return new Promise((resolve) => {
      const sent = this.d.link.sendWithAck('overlay_party', { action, ...args }, (ack) => {
        resolve(ack ?? { ok: false, error: 'No answer from VOIDLOG.GG' });
        if (!ack?.ok || this.d.getSettings().partyOverlaySource !== 'party') return;
        if (['create', 'join', 'leave'].includes(action)) this.resubscribe();
        // Replies are meant for us (owner code, selfId): apply them over the broadcast copy.
        else if (ack.party && this.state.source?.scope === 'party' && ack.party.id === this.state.source.id) this.set({ party: ack.party, selfId: ack.party.selfId ?? this.state.selfId });
      });
      if (!sent) resolve({ ok: false, error: 'Not connected to VOIDLOG.GG' });
    });
  }
}
