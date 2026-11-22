/**
 * Browser preview of Settings → Telemetry & Overlay with a fake IPC bridge (fixture party where
 * "you" are the owner), so the party panel can be screenshotted without Electron. Not shipped.
 *   ?member=1  view as a non-owner member     ?noparty=1  not in a party yet
 */
import { createApp } from 'vue';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import './preview.css';
import TelemetrySettings from '../../src/components/TelemetrySettings.vue';

const q = new URLSearchParams(location.search);
// Member ids are opaque room-scoped ids from the server; the code only reaches the owner.
const member = q.get('member') === '1';
const self = member ? '5be1c09a2f7d4e61a830' : '9f3c2a1e7b4d6c8e0a12';
const party = q.get('noparty') === '1'
  ? null
  : {
      id: 'p1',
      name: "Bo_Kestrel's party",
      ...(member ? { isOwner: false } : { code: 'K7QX4M', isOwner: true }),
      selfId: self,
      ownerId: '9f3c2a1e7b4d6c8e0a12',
      members: [
        { userId: '9f3c2a1e7b4d6c8e0a12', name: 'Bo_Kestrel' },
        { userId: '5be1c09a2f7d4e61a830', name: 'AvaNightjar' },
        { userId: 'c41d7e09b3a25f8e6d10', name: 'cy-runner' },
        { userId: '0a7e3b5c9d1f2e4a6b80', name: 'HalBrenner' },
      ],
    };

const fixtures: Record<string, unknown> = {
  'telemetry:get-settings': { telemetryEnabled: true, telemetryShare: true, telemetryShareBalance: false, overlayEnabled: false, overlayAlwaysShow: false, overlayHotkey: 'CommandOrControl+Alt+O', logDiffEnabled: true, telemetryRecord: true },
  'telemetry:user-cfg-status': { path: 'C:/Games/StarCitizen/LIVE/user.cfg', exists: true, enabled: true, channels: [] },
  'telemetry:get-state': null,
  'party-overlay:get-settings': {
    partyOverlayEnabled: true,
    partyOverlaySource: 'party',
    partyOverlayOrgTag: 'VOID',
    partyOverlayHotkey: 'CommandOrControl+Alt+P',
    partyOverlayCompact: false,
    partyOverlayScale: 1,
    partyOverlayOffsetY: 18,
    partyOverlayDisplayId: 0,
    partyOverlaySwitchHotkey: 'CommandOrControl+Alt+Shift+P',
  },
  'party-overlay:displays': [
    { id: 2528732444, label: 'DELL U2723QE', width: 2560, height: 1440, primary: true },
    { id: 2779098405, label: 'XENEON EDGE', width: 2560, height: 720, primary: false },
  ],
  'party-overlay:status': { status: party ? 'live' : 'no-party', message: party ? null : 'Not in a party', source: party ? { scope: 'party', id: 'p1', label: party.name } : null, party, selfId: self, online: 3 },
};

// ?orgs=none: no verified orgs. ?orgs=fail: the list could not be loaded. ?unticked=WING,X: stored unticked set.
fixtures['party-overlay:orgs'] = q.get('orgs') === 'none' ? [] : q.get('orgs') === 'fail' ? null : [
  { tag: 'VOID', name: 'Voidrunners', primary: true },
  { tag: 'WING', name: 'Wingmen', primary: false },
  { tag: 'TRDR', name: 'Night Traders', primary: false },
];
if (q.get('source') === 'org') {
  (fixtures['party-overlay:get-settings'] as any).partyOverlaySource = 'org';
  (fixtures['party-overlay:status'] as any) = {
    status: 'live', message: null, source: { scope: 'org', id: 'VOID', label: '[VOID] Voidrunners' }, party: null, selfId: null, online: 3,
    sections: [{ source: { scope: 'org', id: 'VOID', label: '[VOID] Voidrunners' }, online: 3 }, { source: { scope: 'org', id: 'TRDR', label: '[TRDR] Night Traders' }, online: 1 }],
  };
}
(fixtures['party-overlay:get-settings'] as any).partyOverlayOrgTag = '';
(fixtures['party-overlay:get-settings'] as any).partyOverlayOrgsUnticked = (q.get('unticked') ?? '').split(',').filter(Boolean);

/** Every invoke is recorded so tests can check what was saved (window.__calls). Saves merge like the real IPC. */
const calls: Array<{ channel: string; arg: unknown }> = [];
(window as any).__calls = calls;
(window as any).logMonitorApi = {
  invoke: async (channel: string, arg?: unknown) => {
    calls.push({ channel, arg });
    if (channel === 'party-overlay:set-settings' || channel === 'telemetry:set-settings') {
      const key = channel === 'telemetry:set-settings' ? 'telemetry:get-settings' : 'party-overlay:get-settings';
      fixtures[key] = { ...(fixtures[key] as object), ...(arg as object) };
      return fixtures[key];
    }
    return fixtures[channel] ?? null;
  },
};

createApp(TelemetrySettings).use(ElementPlus).mount('#app');
