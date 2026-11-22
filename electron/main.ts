/**
 * Main-process entry (bootstrap). Keeps the startup path tiny and only imports Electron and Node
 * built-ins, so it can always run:
 *
 * - loads the application (app-main.ts) with a dynamic import. A missing module, e.g. when the app
 *   is launched while an update is still being written, becomes a friendly "finishing an update"
 *   dialog with Retry instead of a raw "Uncaught Exception: ERR_MODULE_NOT_FOUND" crash;
 * - `--smoke-test`: loads the whole main-process module graph and the native modules, checks the
 *   packaged files, opens no window and exits 0 (or 1). Used by CI on every OS before a release
 *   (scripts/smoke-packaged.mjs). See CLAUDE.md "Packaging rules".
 */
import { app, dialog } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isMissingModuleError } from './startup-guard';

const SMOKE_TEST = process.argv.includes('--smoke-test');

/** Files the packaged app reads from its own directory (app.asar). */
const REQUIRED_APP_FILES = [
  'package.json',
  'dist/index.html',
  'dist/settings.html',
  'dist/login.html',
  'dist/event-details.html',
  'dist/web-content.html',
  'dist/overlay.html',
  'dist/voidlog-icon.png',
  'dist-electron/preload.mjs',
  'dist-electron/overlay-preload.mjs',
  'dist-electron/webview-preload.mjs',
  'dist-electron/webcontents-header-preload.mjs',
  'dist-electron/webcontents-view-preload.mjs',
];


async function showUpdateInProgressDialog(err: unknown): Promise<void> {
  const detail = String((err as Error)?.message ?? err).split('\n')[0].slice(0, 300);
  try {
    await app.whenReady();
    const { response } = await dialog.showMessageBox({
      type: 'warning',
      title: 'VOIDLOG.GG',
      message: 'VOIDLOG is finishing an update',
      detail:
        'Please wait a moment and reopen VOIDLOG. If this keeps happening, reinstall it from voidlog.gg.\n\n' +
        `Details: ${detail}`,
      buttons: ['Retry', 'Quit'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (response === 0) app.relaunch();
  } catch {
    // no dialog possible: fall through and exit
  }
  app.exit(0);
}

async function runSmokeTest(): Promise<void> {
  const result: { ok: boolean; version: string; packaged: boolean; appPath: string; checks: string[]; error?: string } = {
    ok: false,
    version: app.getVersion(),
    packaged: app.isPackaged,
    appPath: app.getAppPath(),
    checks: [],
  };
  try {
    // Modules may read userData at import time: keep the smoke run away from real user data.
    app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'voidlog-smoke-')));
    process.env.VOIDLOG_SMOKE_TEST = '1';

    const appMain = await import('./app-main');
    if (typeof appMain.startApp !== 'function') throw new Error('app-main has no startApp()');
    result.checks.push('main-process module graph loaded');
    result.checks.push(...appMain.smokeChecks());

    const { default: Database } = await import('better-sqlite3');
    const db = new Database(':memory:');
    const row = db.prepare('SELECT 41 + 1 AS answer').get() as { answer: number };
    db.close();
    if (row.answer !== 42) throw new Error('better-sqlite3 returned a wrong result');
    result.checks.push('better-sqlite3 native module works');

    const missing = REQUIRED_APP_FILES.filter((f) => !fs.existsSync(path.join(app.getAppPath(), f)));
    if (missing.length) throw new Error(`missing app files: ${missing.join(', ')}`);
    result.checks.push(`${REQUIRED_APP_FILES.length} app files present`);

    await app.whenReady();
    result.checks.push('app ready (no window opened)');
    result.ok = true;
  } catch (err) {
    result.error = String((err as Error)?.stack ?? err);
  }
  const line = `VOIDLOG_SMOKE_RESULT ${JSON.stringify(result)}`;
  console.log(line);
  const out = process.env.VOIDLOG_SMOKE_OUT;
  if (out) {
    try {
      fs.writeFileSync(out, JSON.stringify(result, null, 2));
    } catch (err) {
      console.error(`cannot write ${out}: ${err}`);
    }
  }
  app.exit(result.ok ? 0 : 1);
}

async function boot(): Promise<void> {
  if (SMOKE_TEST) return runSmokeTest();
  try {
    const { startApp } = await import('./app-main');
    startApp();
  } catch (err) {
    console.error('VOIDLOG failed to start:', err);
    if (isMissingModuleError(err)) return showUpdateInProgressDialog(err);
    try {
      await app.whenReady();
      dialog.showErrorBox('VOIDLOG.GG could not start', String((err as Error)?.stack ?? err).slice(0, 2000));
    } catch {
      // ignore
    }
    app.exit(1);
  }
}

void boot();
