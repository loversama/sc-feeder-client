// test/bodycam/bodycam-window.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// electron/modules/bodycam-window.ts
import { execFile } from "node:child_process";
import path from "node:path";
var GAME_PROCESS_NAME = "StarCitizen";
function hwndFromSourceId(id) {
  const m = /^window:(\d{1,20}):\d+$/.exec(id);
  return m ? m[1] : null;
}
var PS_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  `$m = @(Get-Process -Name ${GAME_PROCESS_NAME} -ErrorAction SilentlyContinue | ForEach-Object { $_.MainWindowHandle.ToInt64() })`,
  "if ($m -contains [int64]$h) { 'yes' } else { 'no' }"
].join("; ");
function buildScript(hwnd) {
  if (!/^\d{1,20}$/.test(hwnd)) throw new Error("bad hwnd");
  return `$h = '${hwnd}'; ${PS_SCRIPT}`;
}
function powershellPath(env = process.env) {
  const root = env.SystemRoot || env.SYSTEMROOT || "C:\\Windows";
  return path.win32.join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}
function checkGameWindow(hwnd, exec = execFile, env = process.env) {
  if (!/^\d{1,20}$/.test(hwnd)) return Promise.resolve("unknown");
  return new Promise((resolve) => {
    exec(
      powershellPath(env),
      // -EncodedCommand (UTF-16LE base64) avoids every quoting problem; the script is fixed apart from the digits-only HWND.
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", Buffer.from(buildScript(hwnd), "utf16le").toString("base64")],
      { windowsHide: true, timeout: 8e3 },
      (err, stdout) => {
        if (err) return resolve("unknown");
        const out = String(stdout).trim();
        resolve(out === "yes" ? "yes" : out === "no" ? "no" : "unknown");
      }
    );
  });
}
function makeProcessChecker(check, opts = {}) {
  const ttl = opts.ttlMs ?? 3e3;
  const now = opts.now ?? Date.now;
  const cache = /* @__PURE__ */ new Map();
  return async (hwnd, o = {}) => {
    const hit = cache.get(hwnd);
    if (!o.fresh && hit && now() - hit.at < ttl) return hit.v;
    const v = await check(hwnd);
    if (v === "unknown") cache.delete(hwnd);
    else cache.set(hwnd, { at: now(), v });
    if (cache.size > 50) cache.delete(cache.keys().next().value);
    return v;
  };
}

// test/bodycam/bodycam-window.test.ts
test("hwnd is parsed only from well-formed window ids", () => {
  assert.equal(hwndFromSourceId("window:263974:0"), "263974");
  assert.equal(hwndFromSourceId("screen:0:0"), null);
  assert.equal(hwndFromSourceId("window:12;calc:0"), null);
  assert.equal(hwndFromSourceId("window:1"), null);
});
test("script embeds only validated digits; hostile values are refused; no compiled code", () => {
  assert.match(buildScript("123"), /^\$h = '123'; /);
  for (const bad of ["1'; calc; '", "1 2", "", "0x10", "-5", "9".repeat(30)]) assert.throws(() => buildScript(bad));
  assert.equal(PS_SCRIPT.includes("${"), false);
  assert.equal(/Add-Type|DllImport/i.test(PS_SCRIPT), false);
  assert.match(PS_SCRIPT, /Get-Process -Name StarCitizen/);
  assert.match(PS_SCRIPT, /MainWindowHandle/);
});
test("PowerShell is started from its absolute %SystemRoot% path", () => {
  assert.equal(powershellPath({ SystemRoot: "C:\\Windows" }), "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
  assert.equal(powershellPath({}), "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
});
test("checkGameWindow runs a fixed encoded script and maps output to yes/no/unknown", async () => {
  let seen;
  const run = (out) => (f, a, _o, cb) => {
    seen = { f, a };
    out instanceof Error ? cb(out, "") : cb(null, out);
  };
  assert.equal(await checkGameWindow("42", run("yes\r\n"), { SystemRoot: "D:\\WIN" }), "yes");
  assert.equal(seen.f, "D:\\WIN\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
  const enc = seen.a[seen.a.indexOf("-EncodedCommand") + 1];
  assert.equal(Buffer.from(enc, "base64").toString("utf16le"), buildScript("42"));
  assert.equal(await checkGameWindow("42", run("no\n")), "no");
  assert.equal(await checkGameWindow("42", run(new Error("powershell missing"))), "unknown");
  assert.equal(await checkGameWindow("42", run("weird output && calc")), "unknown");
  assert.equal(await checkGameWindow("42; calc", () => assert.fail("must not run")), "unknown");
});
test("process checker caches for 3 s, never caches unknown, and fresh bypasses the cache", async () => {
  let calls = 0;
  let t = 0;
  const answers = { "1": "yes", "2": "no", "3": "unknown" };
  const check = makeProcessChecker(async (h) => (calls++, answers[h]), { now: () => t });
  assert.equal(await check("1"), "yes");
  assert.equal(await check("1"), "yes");
  assert.equal(calls, 1);
  t = 2999;
  await check("1");
  assert.equal(calls, 1);
  t = 3001;
  await check("1");
  assert.equal(calls, 2);
  await check("1", { fresh: true });
  assert.equal(calls, 3);
  assert.equal(await check("2"), "no");
  assert.equal(await check("3"), "unknown");
  await check("3");
  assert.equal(calls, 6);
  answers["1"] = "no";
  assert.equal(await check("1", { fresh: true }), "no");
});
