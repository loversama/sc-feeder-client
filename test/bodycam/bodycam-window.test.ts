import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildScript, hwndFromSourceId, makeProcessChecker, resolveWindowProcessName, PS_SCRIPT } from '../../electron/modules/bodycam-window';

test('hwnd is parsed only from well-formed window ids', () => {
  assert.equal(hwndFromSourceId('window:263974:0'), '263974');
  assert.equal(hwndFromSourceId('screen:0:0'), null);
  assert.equal(hwndFromSourceId('window:12;calc:0'), null);
  assert.equal(hwndFromSourceId('window:1'), null);
});

test('script embeds only validated digits; hostile values are refused', () => {
  assert.match(buildScript('123'), /^\$h = '123'; /);
  for (const bad of ["1'; calc; '", '1 2', '', '0x10', '-5', '9'.repeat(30)]) assert.throws(() => buildScript(bad));
  assert.equal(PS_SCRIPT.includes('${'), false);
});

test('resolveWindowProcessName passes a fixed encoded script and normalises the output', async () => {
  let seen: any;
  const name = await resolveWindowProcessName('42', (f, a, _o, cb) => ((seen = { f, a }), cb(null, 'StarCitizen.exe\r\n')));
  assert.equal(name, 'starcitizen.exe');
  assert.equal(seen.f, 'powershell.exe');
  const enc = seen.a[seen.a.indexOf('-EncodedCommand') + 1];
  assert.equal(Buffer.from(enc, 'base64').toString('utf16le'), buildScript('42'));
  assert.equal(await resolveWindowProcessName('42', (_f, _a, _o, cb) => cb(new Error('x'), '')), null);
  assert.equal(await resolveWindowProcessName('42; calc', () => assert.fail('must not run')), null);
  assert.equal(await resolveWindowProcessName('42', (_f, _a, _o, cb) => cb(null, 'weird\noutput && calc')), null);
});

test('process checker only accepts StarCitizen.exe and caches per hwnd', async () => {
  let calls = 0;
  let t = 0;
  const names: Record<string, string | null> = { '1': 'starcitizen.exe', '2': 'chrome.exe', '3': null };
  const check = makeProcessChecker(async (h) => (calls++, names[h]), { ttlMs: 1000, now: () => t });
  assert.equal(await check('1'), true);
  assert.equal(await check('1'), true);
  assert.equal(calls, 1);
  assert.equal(await check('2'), false);
  assert.equal(await check('3'), false);
  t = 5000;
  assert.equal(await check('1'), true);
  assert.equal(calls, 4);
});
