import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectGame, detectionMessage, parseCsvLine, parseTasklistCsv, powershellPath, tasklistPath, type ExecFn } from '../../electron/modules/game-detect';

const CSV = [
  '"System Idle Process","0","Services","0","8 K"',
  '"explorer.exe","4242","Console","1","120,000 K"',
  '"StarCitizen.exe","9001","Console","1","14,000,000 K"',
].join('\r\n');

type Call = { file: string; args: string[] };
function fakeExec(handlers: { tasklist?: () => [Error | null, string, string?]; powershell?: () => [Error | null, string, string?] }) {
  const calls: Call[] = [];
  const exec: ExecFn = (file, args, _o, cb) => {
    calls.push({ file, args });
    const h = file.toLowerCase().endsWith('tasklist.exe') ? handlers.tasklist : handlers.powershell;
    const [err, out, errOut] = h ? h() : [new Error('not stubbed'), ''];
    cb(err as any, out, errOut ?? '');
    return undefined;
  };
  return { exec, calls };
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

test('detects the game via tasklist, case-insensitively, with the absolute tasklist path', async () => {
  const { exec, calls } = fakeExec({ tasklist: () => [null, CSV.replace('StarCitizen.exe', 'STARCITIZEN.EXE')] });
  const d = await detectGame({ ...win, exec });
  assert.equal(d.running, true);
  assert.equal(d.via, 'tasklist');
  assert.equal(d.error, null);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, 'D:\\WIN\\System32\\tasklist.exe');
});

test('a launcher alone is not the game, and says so', async () => {
  const { exec } = fakeExec({ tasklist: () => [null, '"StarCitizen_Launcher.exe","10","Console","1","1 K"\r\n"explorer.exe","4","Console","1","1 K"'] });
  const d = await detectGame({ ...win, exec });
  assert.equal(d.running, false);
  assert.equal(d.launcherOnly, true);
  assert.equal(d.error, null);
  assert.match(detectionMessage(d) ?? '', /launcher is running/);
  // look-alike names do not count
  const x = fakeExec({ tasklist: () => [null, '"StarCitizen.exe.bak","1","Console","1","1 K"\r\n"MyStarCitizen.exe","2","Console","1","1 K"'] });
  assert.equal((await detectGame({ ...win, exec: x.exec })).running, false);
});

test('tasklist not running the game and working = no error, no PowerShell (cheap poll)', async () => {
  const { exec, calls } = fakeExec({ tasklist: () => [null, '"explorer.exe","4","Console","1","1 K"'] });
  const d = await detectGame({ ...win, exec });
  assert.equal(d.running, false);
  assert.equal(d.error, null);
  assert.equal(detectionMessage(d), undefined);
  assert.equal(calls.length, 1);
});

test('tasklist failure falls back to PowerShell Get-Process', async () => {
  const enoent = Object.assign(new Error('spawn tasklist.exe ENOENT'), { code: 'ENOENT' });
  const { exec, calls } = fakeExec({ tasklist: () => [enoent, ''], powershell: () => [null, 'yes 9001\r\n'] });
  const d = await detectGame({ ...win, exec });
  assert.equal(d.running, true);
  assert.equal(d.via, 'powershell');
  assert.equal(d.error, null);
  assert.equal(calls[1].file, 'D:\\WIN\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.ok(calls[1].args.includes('-EncodedCommand'));
  const script = Buffer.from(calls[1].args[calls[1].args.length - 1], 'base64').toString('utf16le');
  assert.match(script, /Get-Process -Name StarCitizen/);
});

test('when no process check can run the error is reported with each reason (never swallowed)', async () => {
  const e1 = Object.assign(new Error('spawn tasklist ENOENT'), { code: 'ENOENT' });
  const e2 = new Error('Command failed: powershell');
  const { exec } = fakeExec({ tasklist: () => [e1, ''], powershell: () => [e2, '', 'Access is denied'] });
  const d = await detectGame({ ...win, exec });
  assert.equal(d.running, false);
  assert.match(d.error ?? '', /tasklist: could not run D:\\WIN\\System32\\tasklist\.exe: spawn tasklist ENOENT \(ENOENT\)/);
  assert.match(d.error ?? '', /powershell: .*Access is denied/);
  assert.match(detectionMessage(d) ?? '', /^Could not check for the game: tasklist:/);
});

test('telemetry connection or fresh Game.log count as the game running when processes say no', async () => {
  const idle = fakeExec({ tasklist: () => [null, '"explorer.exe","4","Console","1","1 K"'] });
  const viaTelemetry = await detectGame({ ...win, exec: idle.exec, telemetryStatus: () => 'streaming' });
  assert.equal(viaTelemetry.running, true);
  assert.equal(viaTelemetry.via, 'telemetry');

  const now = 10_000_000;
  const viaLog = await detectGame({ ...win, exec: idle.exec, now: () => now, telemetryStatus: () => 'disabled', gameLogMtimeMs: async () => now - 20_000 });
  assert.equal(viaLog.via, 'game-log');
  const stale = await detectGame({ ...win, exec: idle.exec, now: () => now, gameLogMtimeMs: async () => now - 10 * 60_000 });
  assert.equal(stale.running, false);
  const missing = await detectGame({ ...win, exec: idle.exec, gameLogMtimeMs: async () => null });
  assert.equal(missing.running, false);
  assert.ok(missing.steps.some((s) => s.step === 'game-log' && !s.ok));
});

test('an inconclusive process check is rescued by the log signal and then reports no error', async () => {
  const e1 = new Error('tasklist blocked');
  const { exec } = fakeExec({ tasklist: () => [e1, ''], powershell: () => [new Error('ps blocked'), ''] });
  const now = 5_000_000;
  const d = await detectGame({ ...win, exec, now: () => now, gameLogMtimeMs: async () => now - 5000 });
  assert.equal(d.running, true);
  assert.equal(d.via, 'game-log');
  assert.equal(d.error, null);
});

test('Diagnose (full) runs the PowerShell step even when tasklist worked, and lists every step', async () => {
  const { exec, calls } = fakeExec({ tasklist: () => [null, '"explorer.exe","4","Console","1","1 K"'], powershell: () => [null, 'no'] });
  const d = await detectGame({ ...win, exec, full: true, telemetryStatus: () => 'disabled' });
  assert.equal(calls.length, 2);
  assert.deepEqual(d.steps.map((s) => s.step), ['tasklist', 'powershell', 'telemetry']);
  assert.equal(d.running, false);
});

test('non-Windows reports why instead of failing silently', async () => {
  const d = await detectGame({ platform: 'linux' });
  assert.equal(d.running, false);
  assert.equal(d.error, null);
  assert.match(d.steps[0].detail, /only available on Windows/);
});
