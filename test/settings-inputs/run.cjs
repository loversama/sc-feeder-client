/**
 * Component test for the Settings inputs, in a real (hidden) Electron window: types into the rendered
 * TelemetrySettings (preview build with a fake IPC bridge that records every save) and checks what the
 * field shows and what was saved. Guards against controlled inputs that discard keystrokes.
 *
 *   npm run test:settings-inputs        (Linux needs a display: xvfb-run -a …)
 */
const { app, BrowserWindow } = require('electron');
const path = require('node:path');

const OUT = path.join(__dirname, '.out', 'settings.html');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (cond, msg, extra) => {
  console.log(`${cond ? 'ok' : 'not ok'} - ${msg}${!cond && extra !== undefined ? ` (${JSON.stringify(extra)})` : ''}`);
  if (!cond) failures++;
};

async function open(query) {
  const win = new BrowserWindow({ show: false, width: 1280, height: 1600, webPreferences: { backgroundThrottling: false } });
  // A fresh window right after another was destroyed can abort its first navigation (ERR_FAILED): retry.
  for (let attempt = 0; ; attempt++) {
    try {
      await win.loadFile(OUT, { query });
      break;
    } catch (err) {
      if (attempt >= 3) throw err;
      await sleep(300);
    }
  }
  const js = (code) => win.webContents.executeJavaScript(code);
  for (let i = 0; i < 100 && !(await js(`!!document.querySelector('h3')`)); i++) await sleep(50);
  await sleep(300);
  const field = (sel) => `(() => { const el = document.querySelector('${sel}'); return el && (el.matches('input') ? el : el.querySelector('input')); })()`;
  return {
    win,
    js,
    value: (sel) => js(`${field(sel)}?.value ?? null`),
    exists: (sel) => js(`!!${field(sel)}`),
    calls: () => js(`JSON.parse(JSON.stringify(window.__calls))`),
    saves: async () => (await js(`JSON.parse(JSON.stringify(window.__calls))`)).filter((c) => c.channel.endsWith(':set-settings')).map((c) => c.arg),
    async type(sel, text, { clear = false } = {}) {
      await js(`(() => { const i = ${field(sel)}; i.focus(); ${clear ? 'i.select();' : ''} })()`);
      for (const ch of text) {
        win.webContents.sendInputEvent({ type: 'char', keyCode: ch });
        await sleep(15);
      }
      await sleep(150);
    },
    async enter() {
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
      await sleep(300);
    },
  };
}

async function main() {
  // 0. Fresh install (real defaults): overlay switched on, showing Org, every verified org ticked.
  let p = await open({ fresh: '1' });
  check(await p.js(`document.querySelector('[data-test=party-overlay-switch]')?.classList.contains('is-checked') === true`), 'fresh install: party/org overlay is ON');
  check(await p.js(`document.querySelector('.el-radio-button.is-active')?.innerText.trim() === 'Org'`), 'fresh install: shows Org');
  check(await p.js(`[...document.querySelectorAll('.el-checkbox[data-test^=org-]')].every((e) => e.classList.contains('is-checked'))`), 'fresh install: every verified org ticked');
  p.win.destroy();

  // 1. Org checklist: every verified org, all ticked by default; the free-text tag box is gone.
  p = await open({ source: 'org' });
  check(!(await p.exists('[data-test=org-tag]')) && !(await p.exists('[data-test=org-tag-select]')), 'no free-text org tag box any more');
  const ticked = () => p.js(`[...document.querySelectorAll('.el-checkbox[data-test^=org-]')].map((e) => (e.classList.contains('is-checked') ? '+' : '-') + e.getAttribute('data-test').slice(4)).join(',')`);
  check((await ticked()) === '+VOID,+WING,+TRDR', 'every verified org is listed in org order and ticked by default', await ticked());
  await p.js(`document.querySelector('[data-test=org-WING]').click()`);
  await sleep(300);
  check(JSON.stringify((await p.saves()).at(-1)) === JSON.stringify({ partyOverlayOrgsUnticked: ['WING'] }), 'unticking an org saves the UNTICKED set', (await p.saves()).at(-1));
  check((await ticked()) === '+VOID,-WING,+TRDR', 'the unticked org shows unticked', await ticked());
  await p.js(`document.querySelector('[data-test=orgs-none]').click()`);
  await sleep(300);
  check(JSON.stringify((await p.saves()).at(-1)?.partyOverlayOrgsUnticked) === JSON.stringify(['VOID', 'WING', 'TRDR']), 'None unticks every org', (await p.saves()).at(-1));
  await p.js(`document.querySelector('[data-test=orgs-all]').click()`);
  await sleep(300);
  check(JSON.stringify((await p.saves()).at(-1)) === JSON.stringify({ partyOverlayOrgsUnticked: [] }), 'All ticks every org again (empty unticked set)', (await p.saves()).at(-1));
  check((await ticked()) === '+VOID,+WING,+TRDR', 'all ticked after All', await ticked());
  const status = await p.js(`document.body.innerText`);
  check(/\[VOID\] Voidrunners 3 online · \[TRDR\] Night Traders 1 online/.test(status), 'status line lists every live org section');
  p.win.destroy();

  // 2. A stored unticked set; and the no-orgs / load-failure messages.
  p = await open({ source: 'org', unticked: 'TRDR,GONE' });
  check((await ticked()) === '+VOID,+WING,-TRDR', 'a stored unticked set is shown; orgs not in it stay ticked', await ticked());
  p.win.destroy();
  p = await open({ source: 'org', orgs: 'none' });
  check(await p.js(`!!document.querySelector('[data-test=orgs-empty]')`), 'no verified orgs: explains how to get them');
  p.win.destroy();
  p = await open({ source: 'org', orgs: 'fail' });
  check(/Could not load your orgs/.test(await p.js(`document.body.innerText`)), 'org list failure: says so with a Retry');
  p.win.destroy();

  p = await open({ source: 'org' });
  // 3. Hotkey fields accept typing and save on Enter.
  for (const [sel, key, text] of [
    ['[data-test=party-hotkey]', 'partyOverlayHotkey', 'Ctrl+Alt+K'],
    ['[data-test=switch-hotkey]', 'partyOverlaySwitchHotkey', 'Ctrl+Alt+L'],
    ['[data-test=overlay-hotkey]', 'overlayHotkey', 'Ctrl+Alt+J'],
  ]) {
    await p.type(sel, text, { clear: true });
    check((await p.value(sel)) === text, `${key}: typing stays in the field`, await p.value(sel));
    await p.enter();
    check((await p.saves()).some((s) => s[key] === text), `${key}: Enter saves`, (await p.saves()).slice(-2));
  }
  p.win.destroy();

  // 4. Party join code: typing shows, upper-cased.
  p = await open({ noparty: '1' });
  await p.type('[data-test=join-code]', 'k7qx4m');
  check((await p.value('[data-test=join-code]')) === 'K7QX4M', 'join code typing stays in the field, upper-cased', await p.value('[data-test=join-code]'));
  p.win.destroy();

  console.log(failures ? `# fail ${failures}` : '# pass');
  app.exit(failures ? 1 : 0);
}

app.commandLine.appendSwitch('disable-gpu');
// Windows are opened and destroyed one after another: do not quit when the last one closes.
app.on('window-all-closed', () => undefined);
app.whenReady().then(() => main().catch((err) => {
  console.error(err);
  app.exit(2);
}));
