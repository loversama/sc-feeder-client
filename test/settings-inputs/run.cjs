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
  // 1. No org list from the server: free-text tag. Typing shows (upper-cased) and Enter saves.
  let p = await open({ source: 'org', orgs: 'none', tag: '' });
  check(await p.exists('[data-test=org-tag]'), 'free-text org tag field is shown when no org list is available');
  await p.type('[data-test=org-tag]', 'void');
  check((await p.value('[data-test=org-tag]')) === 'VOID', 'typed org tag stays in the field, upper-cased', await p.value('[data-test=org-tag]'));
  await p.enter();
  check((await p.saves()).some((s) => s.partyOverlayOrgTag === 'VOID'), 'Enter saves partyOverlayOrgTag = VOID', await p.saves());
  await p.type('[data-test=org-tag]', 'bad tag!', { clear: true });
  await p.enter();
  check(!(await p.saves()).some((s) => /\s|!/.test(s.partyOverlayOrgTag ?? '')), 'an invalid tag is not saved');
  check((await p.value('[data-test=org-tag]')) === 'VOID', 'an invalid tag reverts to the saved one', await p.value('[data-test=org-tag]'));
  p.win.destroy();

  // 2. Org list available and no tag stored: defaults to the verified main org; picker shown.
  p = await open({ source: 'org', tag: '' });
  await sleep(300);
  check(await p.exists('[data-test=org-tag-select]'), 'verified orgs are offered as a picker');
  check((await p.saves()).some((s) => s.partyOverlayOrgTag === 'VOID'), 'empty tag defaults to the verified main org', await p.saves());
  const shown = await p.js(`document.querySelector('[data-test=org-tag-select]')?.closest('.el-select')?.innerText ?? document.querySelector('.el-select')?.innerText ?? ''`);
  check(/VOID/.test(shown), 'the picker shows the main org', shown);
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
