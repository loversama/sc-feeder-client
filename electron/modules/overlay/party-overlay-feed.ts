/**
 * Party / org overlay data feed (main process).
 *
 * Holds the overlay subscription on the authenticated /client socket (OVERLAY-SPEC.md):
 *  - subscribes with `overlay_subscribe` whenever the link (re)authenticates and the feature is on.
 *    Org mode first asks for the user's verified orgs (`overlay_orgs`) and subscribes to all of them
 *    minus the ones unticked in Settings (`{ scope: 'org', tags }`, max 10): one section per org;
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
import { selectedOrgTags, type OverlaySectionState } from '../../../shared/overlay/overlay-sections';

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
  /** One per subscribed room, in display order (org mode: the user's org order). */
  sections: OverlaySectionState[];
  /** The user's verified orgs as last fetched (null = not known: offline / older server). */
  orgs: OrgChoice[] | null;
  /** The fields below mirror the first section (party mode has exactly one). */
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
const NO_ORGS_SELECTED = 'No orgs selected. Tick one in Settings';
const NO_VERIFIED_ORGS = 'No verified org membership. Verify your RSI profile on voidlog.gg';
const ORGS_UNKNOWN = 'Could not load your orgs';

const EMPTY = { sections: [] as OverlaySectionState[], source: null, roster: null, layout: null, selfId: null };

/** Top-level mirror fields from the first section. */
function mirror(sections: OverlaySectionState[]) {
  const f = sections[0];
  return { sections, source: f?.source ?? null, roster: f?.roster ?? null, layout: f?.layout ?? null, selfId: f?.selfId ?? null };
}

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
    this.state = { status: 'off', ...EMPTY, orgs: null, party: null, compact: deps.getSettings().partyOverlayCompact };
    const { link } = this.d;
    link.on('authenticated', () => this.resubscribe({ refetchOrgs: true }));
    link.on('unauthenticated', () => this.enabled() && this.set({ status: 'connecting', message: undefined }));
    link.onServer('overlay_roster', (r: OverlayRoster) => this.onRoster(r));
    link.onServer('overlay_layout', (l: OverlayLayout) => this.onLayout(l));
    link.onServer('overlay_party', (p: PartyInfo | null) => this.onParty(p));
    link.onServer('overlay_vids', (v: { scope?: string; id?: string; vids?: Record<string, string> } | undefined) => this.onVids(v));
    link.onServer('overlay_revoked', (r: { scope?: string; id?: string } | undefined) => this.onRevoked(r));
  }

  get current(): PartyOverlayState {
    return this.state;
  }

  private enabled(): boolean {
    return this.d.getSettings().partyOverlayEnabled;
  }

  /**
   * Settings changed (or startup): subscribe to the configured source. The org list is fetched on
   * (re)connect (`refetchOrgs`) or when none is cached; settings saves reuse the cached list, so sliders and
   * checkboxes do not spend the server's `overlay_orgs` rate limit. A failed fetch keeps the cached list.
   */
  resubscribe(opts: { refetchOrgs?: boolean } = {}): void {
    const s = this.d.getSettings();
    const seq = ++this.seq;
    this.state.compact = s.partyOverlayCompact;
    if (!s.partyOverlayEnabled) return this.set({ status: 'off', ...EMPTY, party: null, message: undefined });
    if (!this.d.isSignedIn()) return this.set({ status: 'signed-out', ...EMPTY, message: MESSAGES['signed-out'] });
    if (!this.d.link.authenticated) return this.set({ status: 'connecting', message: undefined });
    if (s.partyOverlaySource === 'party') return this.subscribe(seq, { scope: 'party' });
    // Org mode: which orgs? (all verified ones minus the unticked set)
    const cached = this.state.orgs;
    const list = cached && !opts.refetchOrgs ? Promise.resolve(cached) : this.orgs().then((o) => o ?? cached);
    void list.then((orgs) => {
      if (seq !== this.seq) return;
      if (orgs) this.state.orgs = orgs;
      const cur = this.d.getSettings();
      let tags: string[];
      if (orgs) tags = selectedOrgTags(orgs, cur.partyOverlayOrgsUnticked);
      else if (cur.partyOverlayOrgTag) tags = [cur.partyOverlayOrgTag]; // older server: the 0.3.5 single tag
      else return this.set({ status: this.d.link.authenticated ? 'error' : 'connecting', ...EMPTY, message: this.d.link.authenticated ? ORGS_UNKNOWN : undefined });
      if (!tags.length) return this.set({ status: 'no-source', ...EMPTY, message: orgs?.length ? NO_ORGS_SELECTED : NO_VERIFIED_ORGS });
      this.subscribe(seq, orgs ? { scope: 'org', tags } : { scope: 'org', tag: tags[0] }, tags);
    });
  }

  private subscribe(seq: number, payload: { scope: 'org' | 'party'; tag?: string; tags?: string[] }, tags: string[] = []): void {
    const sent = this.d.link.sendWithAck('overlay_subscribe', payload, (ack) => {
      if (seq !== this.seq) return; // superseded by a newer subscribe
      if (!ack) return this.set({ status: 'error', message: 'No answer from VOIDLOG.GG' });
      // A server from before multi-org (0.3.5) only reads `tag`: show the first selected org instead.
      if (!ack.ok && ack.error === 'bad tag' && payload.tags?.length) return this.subscribe(seq, { scope: 'org', tag: payload.tags[0] }, payload.tags.slice(0, 1));
      if (!ack.ok) {
        const status: FeedStatus = ack.error === 'no-access' || ack.error === 'no-party' || ack.error === 'signed-out' ? ack.error : 'error';
        // Keep header labels for the overlay even though the server sent no source.
        const sections: OverlaySectionState[] = tags.map((t) => ({ source: { scope: 'org', id: t, label: `[${t}]` }, roster: null, layout: null, selfId: null }));
        return this.set({ status, ...mirror(sections), roster: null, message: MESSAGES[status] ?? MESSAGES[ack.error as 'rate-limited'] ?? String(ack.error ?? 'Unavailable') });
      }
      const sections: OverlaySectionState[] = ack.multi
        ? (Array.isArray(ack.sections) ? ack.sections : []).map((x: any) => ({ source: x.source, roster: x.roster ?? null, layout: x.layout ?? null, selfId: x.selfId ?? null, vids: x.vids ?? null }))
        : [{ source: ack.source, roster: ack.roster ?? null, layout: ack.layout ?? null, selfId: ack.selfId ?? null }];
      this.d.log?.('info', `Overlay subscribed to ${sections.map((x) => `${x.source?.scope} ${x.source?.label}`).join(', ')}`);
      if (ack.refused?.length) this.d.log?.('warn', `Overlay refused: ${ack.refused.map((r: any) => `${r.tag} (${r.error})`).join(', ')}`);
      this.set({ status: 'live', message: undefined, ...mirror(sections.filter((x) => x.source)), party: ack.party ?? null });
    });
    if (!sent) this.set({ status: 'connecting', message: undefined });
  }

  /** Ask the server to drop the subscription (feature turned off). */
  unsubscribe(): void {
    this.seq++;
    if (this.d.link.authenticated) this.d.link.sendWithAck('overlay_unsubscribe', {});
    this.set({ status: 'off', ...EMPTY, party: null });
  }

  private sectionIndex(scope: string, id: string): number {
    return this.state.sections.findIndex((x) => x.source.scope === scope && x.source.id === id);
  }

  private patchSection(i: number, patch: Partial<OverlaySectionState>): void {
    const sections = this.state.sections.map((x, j) => (j === i ? { ...x, ...patch } : x));
    this.set(mirror(sections));
  }

  private onRoster(r: OverlayRoster): void {
    if (!this.enabled() || !r) return;
    const i = this.sectionIndex(r.scope, r.id);
    if (i >= 0) this.patchSection(i, { roster: r });
  }

  /** Fresh viewer-scoped ids for one room (its member set changed). */
  private onVids(v?: { scope?: string; id?: string; vids?: Record<string, string> }): void {
    if (!this.enabled() || !v?.scope || !v.id || !v.vids || typeof v.vids !== 'object') return;
    const i = this.sectionIndex(v.scope, v.id);
    if (i >= 0) this.patchSection(i, { vids: v.vids });
  }

  private onLayout(l: OverlayLayout): void {
    if (!this.enabled() || !l) return;
    const i = this.sectionIndex(l.scope, l.id);
    if (i < 0) return;
    const cur = this.state.sections[i].layout;
    if (cur && l.version < cur.version) return;
    this.patchSection(i, { layout: l });
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
    const first = this.state.sections[0];
    const source = { scope: 'party' as const, id: p.id, label: p.name };
    this.set({ party: { ...p, selfId, isOwner, code }, ...mirror([{ source, roster: first?.roster ?? null, layout: first?.layout ?? null, selfId: first?.selfId ?? null }]) });
    if (isOwner) void this.party('get');
  }

  /** The server removed us from an org room (no longer a verified member): drop that section. */
  private onRevoked(r?: { scope?: string; id?: string }): void {
    if (!this.enabled()) return;
    const i = r?.scope && r.id ? this.sectionIndex(r.scope, r.id) : -1;
    const rest = i >= 0 ? this.state.sections.filter((_, j) => j !== i) : [];
    if (rest.length) return this.set(mirror(rest));
    this.set({ status: 'no-access', ...EMPTY, message: MESSAGES['no-access'] });
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
   * Fresh org list for Settings. When it differs from the list the overlay subscribed with (joined or
   * left an org), re-subscribe so a new org shows up without a restart.
   */
  async refreshOrgs(): Promise<OrgChoice[] | null> {
    const before = this.state.orgs?.map((o) => o.tag).join() ?? null;
    const orgs = await this.orgs();
    if (orgs) {
      const s = this.d.getSettings();
      const changed = orgs.map((o) => o.tag).join() !== before;
      this.state.orgs = orgs;
      if (changed && s.partyOverlayEnabled && s.partyOverlaySource === 'org' && this.state.status !== 'off') this.resubscribe();
    }
    return orgs;
  }

  /**
   * The user's verified orgs (`overlay_orgs`), for the Settings org checklist. Resolves null when offline,
   * on timeout, or when the server does not know the event yet (older server).
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
