import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectGame,
  detectionMessage,
  GameWatcher,
  parseCsvLine,
  parseTasklistCsv,
  powershellPath,
  tasklistPath,
  PROCESS_CHECK_EVERY_MS,
  PROCESS_CHECK_TIMEOUT_MS,
  POSITIVE_CACHE_MS,
  type ExecFn,
} from '../../electron/modules/game-detect';

const CSV = [
  '"System Idle Process","0","Services","0","8 K"',
  '"explorer.exe","4242","Console","1","120,000 K"',
  '"StarCitizen.exe","9001","Console","1","14,000,000 K"',
].join('\r\n');
const IDLE_CSV = '"explorer.exe","4","Console","1","1 K"';

type Call = { file: string; args: string[]; timeout: number };
type Reply = { ms?: number; err?: Error | null; out?: string; errOut?: string };

/** Fake exec on a fake clock: each reply "takes" `ms` of simulated time; longer than the timeout = killed. */
function fake(replies: { tasklist?: Reply | (() => Reply); powershell?: Reply | (() => Reply) }) {
  const clock = { t: 1_000_000 };
  const calls: Call[] = [];
  const exec: ExecFn = (file, args, o, cb) => {
    calls.push({ file, args, timeout: o.timeout });
    const key = file.toLowerCase().endsWith('tasklist.exe') ? 'tasklist' : 'powershell';
    const r0 = replies[key];
    const r: Reply = typeof r0 === 'function' ? r0() : r0 ?? { err: new Error('not stubbed') };
    const ms = r.ms ?? 50;
    if (ms > o.timeout) {
      clock.t += o.timeout;
      cb(Object.assign(new Error('Command failed: timed out'), { killed: true }) as any, '', '');
    } else {
      clock.t += ms;
      cb((r.err ?? null) as any, r.out ?? '', r.errOut ?? '');
    }
    return undefined;
  };
  return { exec, calls, clock, now: () => clock.t };
}
const win = { platform: 'win32' as const, env: { SystemRoot: 'D:\\WIN' } as NodeJS.ProcessEnv };

test('system tools are resolved absolutely from %SystemRoot%', () => {
  assert.equal(tasklistPath({ SystemRoot: 'D:\\WIN' }), 'D:\\WIN\\System32\\tasklist.exe');
  assert.equal(powershellPath({ SystemRoot: 'D:\\WIN' }), 'D:\\WIN\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.equal(tasklistPath({}), 'C:\\Windows\\System32\\tasklist.exe');
});

test('parses tasklist CSV properly (quotes, commas inside fields, INFO lines)', () => {
  assert.deepEqual(parseCsvLine('"a,b","c ""q"" d","3"'), ['a,b', 'c "q" d', '3']);
  const rows = parseTasklistCsv('INFO: No tasks are running which match the specified criteria.\r\n' + CSV);
  assert.deepEqual(rows.map((r) => r.image), ['System Idle Process', 'explorer.exe', 'StarCitizen.exe']);
  assert.equal(rows[2].pid, '9001');
  assert.deepEqual(parseTasklistCsv('INFO: No tasks are running'), []);
});

test('the process-check timeout is far above the measured 5.85 s (was 4 s)', () => {
  assert.ok(PROCESS_CHECK_TIMEOUT_MS >= 20_000);
});

// ---- Diagnose (detectGame): everything once, timed -------------------------------------------------

test('Diagnose runs signals, tasklist (no /FI, absolute path) and PowerShell and reports each duration', async () => {
  const f = fake({ tasklist: { ms: 5850, out: CSV.replace('StarCitizen.exe', 'STARCITIZEN.EXE') }, powershell: { ms: 900, out: 'yes 9001\r\n' } });
  const d = await detectGame({ ...win, exec: f.exec, now: f.now, telemetryStatus: () => 'disabled' });
  assert.equal(d.running, true);
  assert.equal(d.error, null);
  assert.deepEqual(d.steps.map((s) => s.step), ['telemetry', 'tasklist', 'powershell']);
  assert.equal(d.durations.tasklist, 5850);
  assert.equal(d.durations.powershell, 900);
  assert.equal(f.calls[0].file, 'D:\\WIN\\System32\\tasklist.exe');
  assert.deepEqual(f.calls[0].args, ['/FO', 'CSV', '/NH']); // no /FI
  assert.equal(f.calls[0].timeout, PROCESS_CHECK_TIMEOUT_MS);
  assert.ok(f.calls[1].args.includes('-EncodedCommand'));
  const script = Buffer.from(f.calls[1].args[f.calls[1].args.length - 1], 'base64').toString('utf16le');
  assert.match(script, /Get-Process -Name StarCitizen/);
});

test('a 5.85 s tasklist is NOT killed (the original bug) and finds the game', async () => {
  const f = fake({ tasklist: { ms: 5850, out: CSV }, powershell: { ms: 800, out: 'no' } });
  const d = await detectGame({ ...win, exec: f.exec, now: f.now });
  assert.equal(d.steps.find((s) => s.step === 'tasklist')?.ok, true);
  assert.equal(d.running, true);
  assert.equal(d.via, 'tasklist');
});

test('Diagnose reports every failure with its reason and a combined error', async () => {
  const e1 = Object.assign(new Error('spawn tasklist ENOENT'), { code: 'ENOENT' });
  const f = fake({ tasklist: { err: e1 }, powershell: { err: new Error('Command failed: powershell'), errOut: 'Access is denied' } });
  const d = await detectGame({ ...win, exec: f.exec, now: f.now });
  assert.equal(d.running, false);
  assert.match(d.error ?? '', /tasklist: could not run D:\\WIN\\System32\\tasklist\.exe: spawn tasklist ENOENT \(ENOENT\)/);
  assert.match(d.error ?? '', /powershell: .*Access is denied/);
  assert.match(detectionMessage(d) ?? '', /^Could not check for the game: tasklist:/);
});

test('timeouts are reported as such (never silent)', async () => {
  const f = fake({ tasklist: { ms: 60_000 }, powershell: { ms: 60_000 } });
  const d = await detectGame({ ...win, exec: f.exec, now: f.now });
  assert.match(d.error ?? '', /timed out after 20 s/);
});

test('a launcher alone is not the game, and look-alike names do not count', async () => {
  const f = fake({ tasklist: { out: '"StarCitizen_Launcher.exe","10","Console","1","1 K"\r\n' + IDLE_CSV }, powershell: { out: 'no' } });
  const d = await detectGame({ ...win, exec: f.exec, now: f.now });
  assert.equal(d.running, false);
  assert.equal(d.launcherOnly, true);
  assert.match(detectionMessage(d) ?? '', /launcher is running/);
  const g = fake({ tasklist: { out: '"StarCitizen.exe.bak","1","Console","1","1 K"\r\n"MyStarCitizen.exe","2","Console","1","1 K"' }, powershell: { out: 'no' } });
  assert.equal((await detectGame({ ...win, exec: g.exec, now: g.now })).running, false);
});

test('non-Windows reports why instead of failing silently', async () => {
  const d = await detectGame({ platform: 'linux' });
  assert.equal(d.running, false);
  assert.equal(d.error, null);
  assert.match(d.steps[0].detail, /only available on Windows/);
});

// ---- GameWatcher -----------------------------------------------------------------------------------

function watcher(f: ReturnType<typeof fake>, extra: Record<string, unknown> = {}) {
  const logs: string[] = [];
  const changes: boolean[] = [];
  const w = new GameWatcher({ ...win, exec: f.exec, now: f.now, log: (_l, m) => logs.push(m), onChange: (r) => changes.push(r), ...extra } as any);
  return { w, logs, changes };
}

test('watcher: the telemetry connection is the primary signal - no process check at all', async () => {
  const f = fake({});
  const { w, changes } = watcher(f, { telemetryStatus: () => 'streaming' });
  const d = await w.tick();
  assert.equal(d.running, true);
  assert.equal(d.via, 'telemetry');
  assert.equal(f.calls.length, 0);
  assert.deepEqual(changes, [true]);
});

test('watcher: Game.log written in the last 2 minutes counts; a stale log does not', async () => {
  const f = fake({ tasklist: { out: IDLE_CSV }, powershell: { out: 'no' } });
  const fresh = watcher(f, { gameLogMtimeMs: async () => f.clock.t - 100_000 });
  assert.equal((await fresh.w.tick()).via, 'game-log');
  assert.equal(f.calls.length, 0);
  const stale = watcher(fake({ tasklist: { out: IDLE_CSV }, powershell: { out: 'no' } }), { gameLogMtimeMs: async () => 0 });
  assert.equal((await stale.w.tick()).running, false);
});

test('watcher: the first process check times both methods, then only the faster one runs (measured)', async () => {
  const f = fake({ tasklist: { ms: 5850, out: CSV }, powershell: { ms: 900, out: 'yes 9001' } });
  const { w } = watcher(f);
  let d = await w.tick();
  assert.equal(d.running, true);
  assert.deepEqual(d.durations, { tasklist: 5850, powershell: 900 });
  assert.equal(f.calls.length, 2);
  // next due check: PowerShell is the faster, so it goes first (and alone)
  f.clock.t += PROCESS_CHECK_EVERY_MS;
  d = await w.tick();
  assert.equal(f.calls.length, 3);
  assert.ok(f.calls[2].file.toLowerCase().endsWith('powershell.exe'));
  assert.equal(d.via, 'powershell');
});

test('watcher: process checks are rate-limited to one every 15 s and never overlap', async () => {
  const pending: Array<() => void> = [];
  const f = fake({ tasklist: { out: IDLE_CSV }, powershell: { out: 'no' } });
  const slowExec: ExecFn = (file, args, o, cb) => {
    f.calls.push({ file, args, timeout: o.timeout });
    pending.push(() => cb(null, file.toLowerCase().endsWith('powershell.exe') ? 'no' : IDLE_CSV, ''));
    return undefined;
  };
  const w = new GameWatcher({ ...win, exec: slowExec, now: f.now } as any);
  const first = w.tick();
  const overlapped = await w.tick(); // returns immediately while the first is in flight
  assert.equal(f.calls.length, 2); // tasklist + PowerShell of the first check only
  assert.equal(overlapped.running, false);
  pending.forEach((r) => r());
  await first;
  const before = f.calls.length;
  f.clock.t += 5000;
  await w.tick();
  assert.equal(f.calls.length, before, 'no second check within 15 s');
});

test('watcher: a positive result survives a failed or negative check for 60 s, then drops', async () => {
  let reply: Reply = { out: CSV };
  const f = fake({ tasklist: () => reply, powershell: { err: new Error('ps blocked') } });
  const { w, changes } = watcher(f);
  assert.equal((await w.tick()).running, true);
  reply = { err: new Error('tasklist blocked') };
  f.clock.t += PROCESS_CHECK_EVERY_MS;
  let d = await w.tick();
  assert.equal(d.running, true);
  assert.equal(d.via, 'cached');
  f.clock.t += POSITIVE_CACHE_MS;
  d = await w.tick();
  assert.equal(d.running, false);
  assert.match(d.error ?? '', /tasklist blocked/);
  assert.deepEqual(changes, [true, false]);
});

test('watcher: errors are kept and logged once, and recovery is logged', async () => {
  let reply: Reply = { err: new Error('boom') };
  const f = fake({ tasklist: () => reply, powershell: { err: new Error('also boom') } });
  const { w, logs } = watcher(f);
  await w.tick();
  f.clock.t += PROCESS_CHECK_EVERY_MS;
  await w.tick();
  assert.equal(logs.filter((l) => l.startsWith('Game detection failed')).length, 1);
  reply = { out: IDLE_CSV };
  f.clock.t += PROCESS_CHECK_EVERY_MS;
  const d = await w.tick();
  assert.equal(d.error, null);
  assert.ok(logs.includes('Game detection works again'));
});

test('watcher: the game closing is noticed once the cache runs out', async () => {
  let reply: Reply = { out: CSV };
  const f = fake({ tasklist: () => reply, powershell: { out: 'no' } });
  const { w } = watcher(f);
  await w.tick();
  reply = { out: IDLE_CSV };
  f.clock.t += POSITIVE_CACHE_MS + PROCESS_CHECK_EVERY_MS;
  assert.equal((await w.tick()).running, false);
});

test('watcher: non-Windows never runs anything and never errors', async () => {
  const f = fake({});
  const w = new GameWatcher({ platform: 'linux', exec: f.exec, now: f.now });
  const d = await w.tick();
  assert.equal(d.running, false);
  assert.equal(d.error, null);
  assert.equal(f.calls.length, 0);
});

test('watcher: a 6 s tasklist (and no PowerShell) still detects the game via the watcher path', async () => {
  const f = fake({ tasklist: { ms: 6000, out: CSV }, powershell: { err: new Error('powershell blocked') } });
  const { w } = watcher(f);
  const d = await w.tick();
  assert.equal(d.running, true);
  assert.equal(d.via, 'tasklist');
  assert.equal(d.durations.tasklist, 6000);
  assert.ok(f.calls.every((c) => c.timeout >= 20_000), 'every spawned check allows at least 20 s');
});
