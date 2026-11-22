import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildScript, checkGameWindow, hwndFromSourceId, makeProcessChecker, powershellPath, PS_SCRIPT, type WindowCheck } from '../../electron/modules/bodycam-window';

test('hwnd is parsed only from well-formed window ids', () => {
  assert.equal(hwndFromSourceId('window:263974:0'), '263974');
  assert.equal(hwndFromSourceId('screen:0:0'), null);
  assert.equal(hwndFromSourceId('window:12;calc:0'), null);
  assert.equal(hwndFromSourceId('window:1'), null);
});

test('script embeds only validated digits; hostile values are refused; no compiled code', () => {
  assert.match(buildScript('123'), /^\$h = '123'; /);
  for (const bad of ["1'; calc; '", '1 2', '', '0x10', '-5', '9'.repeat(30)]) assert.throws(() => buildScript(bad));
  assert.equal(PS_SCRIPT.includes('${'), false);
  assert.equal(/Add-Type|DllImport/i.test(PS_SCRIPT), false);
  assert.match(PS_SCRIPT, /Get-Process -Name StarCitizen/);
  assert.match(PS_SCRIPT, /MainWindowHandle/);
});

test('PowerShell is started from its absolute %SystemRoot% path', () => {
  assert.equal(powershellPath({ SystemRoot: 'C:\\Windows' }), 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.equal(powershellPath({}), 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
});

test('checkGameWindow runs a fixed encoded script and maps output to yes/no/unknown', async () => {
  let seen: any;
  const run = (out: string | Error) => (f: string, a: string[], _o: unknown, cb: (e: Error | null, s: string) => void) => {
    seen = { f, a };
    out instanceof Error ? cb(out, '') : cb(null, out);
  };
  assert.equal(await checkGameWindow('42', run('yes\r\n'), { SystemRoot: 'D:\\WIN' }), 'yes');
  assert.equal(seen.f, 'D:\\WIN\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  const enc = seen.a[seen.a.indexOf('-EncodedCommand') + 1];
  assert.equal(Buffer.from(enc, 'base64').toString('utf16le'), buildScript('42'));
  assert.equal(await checkGameWindow('42', run('no\n')), 'no');
  assert.equal(await checkGameWindow('42', run(new Error('powershell missing'))), 'unknown');
  assert.equal(await checkGameWindow('42', run('weird output && calc')), 'unknown');
  assert.equal(await checkGameWindow('42; calc', () => assert.fail('must not run')), 'unknown');
});

test('process checker caches for 3 s, never caches unknown, and fresh bypasses the cache', async () => {
  let calls = 0;
  let t = 0;
  const answers: Record<string, WindowCheck> = { '1': 'yes', '2': 'no', '3': 'unknown' };
  const check = makeProcessChecker(async (h) => (calls++, answers[h]), { now: () => t });
  assert.equal(await check('1'), 'yes');
  assert.equal(await check('1'), 'yes');
  assert.equal(calls, 1);
  t = 2999;
  await check('1');
  assert.equal(calls, 1);
  t = 3001;
  await check('1');
  assert.equal(calls, 2);
  await check('1', { fresh: true });
  assert.equal(calls, 3);
  assert.equal(await check('2'), 'no');
  assert.equal(await check('3'), 'unknown');
  await check('3');
  assert.equal(calls, 6); // unknown is re-checked every time
  answers['1'] = 'no';
  assert.equal(await check('1', { fresh: true }), 'no');
});
