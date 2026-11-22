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
const self = q.get('member') === '1' ? 'u-ava' : 'u-bo';
const party = q.get('noparty') === '1'
  ? null
  : {
      id: 'p1',
      name: "Bo_Kestrel's party",
      code: 'K7QX4M',
      ownerId: 'u-bo',
      members: [
        { userId: 'u-bo', name: 'Bo_Kestrel' },
        { userId: 'u-ava', name: 'AvaNightjar' },
        { userId: 'u-cy', name: 'cy-runner' },
        { userId: 'u-hal', name: 'HalBrenner' },
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

(window as any).logMonitorApi = {
  invoke: async (channel: string) => fixtures[channel] ?? null,
};

createApp(TelemetrySettings).use(ElementPlus).mount('#app');
