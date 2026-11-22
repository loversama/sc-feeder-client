/**
 * App-wide "is Star Citizen running?" state (wiring of the shared detector in game-detect.ts).
 *
 * API for features that need it (body-cam, debug overlay, party overlay, ...):
 *   watchGame('my-feature')   start polling (reference counted; call unwatchGame with the same id to release)
 *   isGameRunning()           current verdict
 *   getGameDetection()        full detection: via, error, step results, measured durations
 *   gameStatusMessage()       "Could not check for the game: ..." / launcher hint / undefined
 *   onGamePoll(fn)            fn(running) after every evaluation (every 5 s while watched)
 *   diagnoseGame()            run every check once, timed (Diagnose buttons)
 */
import fs from 'node:fs/promises';
import * as logger from './logger';
import { getCurrentLogPath } from './config-manager';
import { getTelemetryService } from './telemetry/telemetry-manager';
import { pushDebugEvent } from './telemetry/debug-bus';
import { GameWatcher, detectGame, detectionMessage, emptyDetection, type DetectDeps, type GameDetection } from './game-detect';

const MODULE_NAME = 'GameDetect';

const consumers = new Set<string>();
const pollListeners: Array<(running: boolean) => void> = [];

function realDeps(): DetectDeps {
  return {
    telemetryStatus: () => (getTelemetryService() as { status?: string } | null)?.status ?? null,
    gameLogMtimeMs: async () => {
      try {
        return (await fs.stat(getCurrentLogPath())).mtimeMs;
      } catch {
        return null;
      }
    },
  };
}

const watcher = new GameWatcher({
  ...realDeps(),
  log: (lvl, msg) => logger[lvl === 'debug' ? 'debug' : lvl](MODULE_NAME, msg),
  onChange: (running) => pushDebugEvent({ source: 'system', type: running ? 'game_started' : 'game_exited', summary: `StarCitizen.exe ${running ? 'running' : 'exited'}` }),
  onTick: () => {
    for (const fn of pollListeners) {
      try {
        fn(watcher.running);
      } catch (err) {
        logger.debug(MODULE_NAME, `game poll listener failed: ${err}`);
      }
    }
  },
});

export function watchGame(id: string): void {
  consumers.add(id);
  watcher.start();
}

export function unwatchGame(id: string): void {
  consumers.delete(id);
  if (!consumers.size) watcher.stop();
}

export function isGameRunning(): boolean {
  return watcher.running;
}

export function getGameDetection(): GameDetection {
  return watcher.detection ?? emptyDetection(Date.now());
}

export function gameStatusMessage(): string | undefined {
  return detectionMessage(watcher.detection);
}

export function onGamePoll(fn: (running: boolean) => void): void {
  pollListeners.push(fn);
}

/** Every check once (signals, tasklist, PowerShell), each timed. */
export function diagnoseGame(): Promise<GameDetection> {
  return detectGame(realDeps());
}

/** Public, renderer-safe summary. */
export function gameDetectionSummary() {
  const d = getGameDetection();
  return { running: d.running, via: d.via, error: d.error, launcherOnly: d.launcherOnly, checkedAt: d.checkedAt, durations: d.durations, message: detectionMessage(d) ?? null };
}
