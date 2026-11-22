/** Fixture data for the party overlay preview (scripts/overlay-preview). Not shipped. */
import type { OverlayLayout, OverlayRoster } from '../../shared/overlay/overlay-resolve';

export const previewRoster: OverlayRoster = {
  scope: 'org',
  id: 'VOID',
  generatedAt: '2026-11-22T12:00:00.000Z',
  ships: [
    { key: '877604806898', className: 'RSI_Galaxy', name: 'RSI_Galaxy_877604806898', hull: 92, shields: 61, faces: [100, 64, 0, 80] },
    { key: '555000111222', className: 'DRAK_Cutlass_Black', name: 'DRAK_Cutlass_Black_555000111222', hull: 18, shields: 12, faces: [12] },
    { key: '555000111999', className: 'ANVL_Arrow', name: 'ANVL_Arrow_555000111999', hull: 100, shields: 100, faces: [100, 100] },
  ],
  members: [
    { userId: 'u-ava', name: 'AvaNightjar', status: 'ship', health: 100, o2: 100, shipKey: '877604806898', crewRole: 'TURRET' },
    { userId: 'u-bo', name: 'Bo_Kestrel', status: 'ship', health: 88, o2: 100, shipKey: '877604806898', crewRole: 'PILOT' },
    { userId: 'u-kit', name: 'KitVance', status: 'ship', health: 64, o2: 100, shipKey: '877604806898', crewRole: 'COPILOT' },
    { userId: 'u-cy', name: 'cy-runner', status: 'foot', health: 55, o2: 22, shipKey: null },
    { userId: 'u-dee', name: 'DeeMarlow', status: 'downed', health: null, o2: 100, shipKey: null },
    { userId: 'u-eli', name: 'Eli_Stormcrow', status: 'ship', health: 100, o2: 100, shipKey: '555000111222', crewRole: 'PILOT' },
    { userId: 'u-jo', name: 'JoHalloran', status: 'ship', health: 21, o2: 9, shipKey: '555000111222', crewRole: 'TURRET' },
    { userId: 'u-fen', name: 'Fen', status: 'ship', health: 100, o2: 100, shipKey: '555000111999', crewRole: 'PILOT' },
    { userId: 'u-gus', name: 'GusOrtega', status: 'dead', health: null, o2: null, shipKey: null },
    { userId: 'u-ivy', name: 'IvyQuill', status: 'foot', health: 100, o2: 100, shipKey: null },
  ],
};

/** A 5-person party: two in a Cutlass, one on foot, two offline (party lists show offline members last). */
export const previewParty: OverlayRoster = {
  scope: 'party',
  id: 'p1',
  generatedAt: '2026-11-22T12:00:00.000Z',
  ships: [{ key: '555000111222', className: 'DRAK_Cutlass_Black', name: 'DRAK_Cutlass_Black_555000111222', hull: 76, shields: 48, faces: [48] }],
  members: [
    { userId: 'u-bo', name: 'Bo_Kestrel', status: 'ship', health: 100, o2: 100, shipKey: '555000111222', crewRole: 'PILOT' },
    { userId: 'u-ava', name: 'AvaNightjar', status: 'ship', health: 72, o2: 100, shipKey: '555000111222', crewRole: 'TURRET' },
    { userId: 'u-cy', name: 'cy-runner', status: 'foot', health: 34, o2: 31, shipKey: null },
    { userId: 'u-hal', name: 'HalBrenner', status: 'offline', health: null, o2: null, shipKey: null },
    { userId: 'u-ivy', name: 'IvyQuill', status: 'offline', health: null, o2: null, shipKey: null },
  ],
};

export const previewLayout: OverlayLayout = {
  scope: 'org',
  id: 'VOID',
  version: 3,
  updatedAt: null,
  updatedBy: null,
  shipsExpandedByDefault: true,
  entries: [
    { kind: 'ship', shipClass: 'RSI_Galaxy', expanded: true },
    { kind: 'member', userId: 'u-dee' },
    { kind: 'ship', shipClass: 'DRAK_Cutlass_Black', expanded: true },
    { kind: 'ship', shipClass: 'ANVL_Arrow', expanded: false },
    { kind: 'member', userId: 'u-cy' },
  ],
};
