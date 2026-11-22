#!/usr/bin/env node
/**
 * Packaged-app smoke test: runs the unpacked build from electron-builder (`release/<version>/…`)
 * with `--smoke-test`. The app loads its whole main-process module graph and the native modules
 * from app.asar, checks its packaged files, opens no window and exits 0. Anything else (crash,
 * missing module, timeout, no result) fails. Release CI runs this on every OS before publishing.
 *
 *   npm run package:dir && npm run smoke:packaged        (Linux needs a display: xvfb-run -a …)
 *   node scripts/smoke-packaged.mjs [path/to/app-executable-or-unpacked-dir]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 120_000);
const LINUX_HELPERS = new Set(['chrome-sandbox', 'chrome_crashpad_handler']);

function findExecutable(target) {
  const stat = fs.existsSync(target) ? fs.statSync(target) : null;
  if (stat?.isFile()) return target;
  if (!stat?.isDirectory()) throw new Error(`${target} not found (run: npm run package:dir)`);
  // either an unpacked app dir itself, or release/<version> holding it
  const dirs = [target, ...fs.readdirSync(target).map((d) => path.join(target, d)).filter((d) => fs.statSync(d).isDirectory())];
  for (const dir of dirs) {
    const base = path.basename(dir);
    const named = dir === target; // an explicitly given app dir may have any name
    if (process.platform === 'win32' && (named || /^win-.*unpacked$/.test(base))) {
      const exe = fs.readdirSync(dir).find((f) => f.endsWith('.exe') && !/^(Uninstall|elevate)/i.test(f));
      if (exe) return path.join(dir, exe);
    }
    if (process.platform === 'linux' && (named || /^linux-.*unpacked$/.test(base))) {
      const exe = fs.readdirSync(dir).find((f) => {
        const p = path.join(dir, f);
        return !/\.(so(\.\d+)*|pak|bin|dat|json|txt|html)$/.test(f) && !LINUX_HELPERS.has(f) && fs.statSync(p).isFile() && (fs.statSync(p).mode & 0o111) !== 0;
      });
      if (exe) return path.join(dir, exe);
    }
    if (process.platform === 'darwin' && (named || /^mac/.test(base))) {
      const app = fs.readdirSync(dir).find((f) => f.endsWith('.app'));
      if (app) {
        const macos = path.join(dir, app, 'Contents', 'MacOS');
        const exe = fs.readdirSync(macos)[0];
        if (exe) return path.join(macos, exe);
      }
    }
  }
  throw new Error(`no unpacked ${process.platform} app found under release/${pkg.version} (run: npm run package:dir)`);
}

function resourcesDir(exe) {
  return process.platform === 'darwin' ? path.join(path.dirname(exe), '..', 'Resources') : path.join(path.dirname(exe), 'resources');
}

async function main() {
  const exe = findExecutable(process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'release', pkg.version));
  const resources = resourcesDir(exe);
  const problems = [];
  if (!fs.existsSync(path.join(resources, 'app.asar'))) problems.push('resources/app.asar missing (asar must stay on)');
  if (fs.existsSync(path.join(resources, 'app'))) problems.push('resources/app exists next to app.asar (Electron would load it instead)');
  if (!fs.existsSync(path.join(resources, 'app.asar.unpacked', 'node_modules', 'better-sqlite3'))) {
    problems.push('better-sqlite3 is not unpacked from app.asar (asarUnpack)');
  }

  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'voidlog-smoke-out-')), 'result.json');
  const args = ['--smoke-test', '--disable-gpu'];
  if (process.platform === 'linux') args.push('--no-sandbox');
  console.log(`smoke: ${exe} ${args.join(' ')}`);
  const child = spawn(exe, args, {
    env: { ...process.env, VOIDLOG_SMOKE_OUT: out, ELECTRON_ENABLE_LOGGING: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (d) => (output += d));
  child.stderr.on('data', (d) => (output += d));
  const code = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      problems.push(`timed out after ${TIMEOUT_MS / 1000} s`);
      child.kill();
    }, TIMEOUT_MS);
    child.on('exit', (c, sig) => {
      clearTimeout(timer);
      resolve(c ?? sig);
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      problems.push(`cannot start: ${err.message}`);
      resolve(-1);
    });
  });

  let result = null;
  if (fs.existsSync(out)) result = JSON.parse(fs.readFileSync(out, 'utf8'));
  else {
    const line = output.split('\n').find((l) => l.includes('VOIDLOG_SMOKE_RESULT '));
    if (line) result = JSON.parse(line.slice(line.indexOf('VOIDLOG_SMOKE_RESULT ') + 21));
  }
  if (code !== 0) problems.push(`exit code ${code}`);
  if (!result) problems.push('no smoke result written');
  else {
    if (!result.ok) problems.push(`smoke test failed: ${result.error}`);
    if (result.version !== pkg.version) problems.push(`packaged version ${result.version} != package.json ${pkg.version}`);
    if (!String(result.appPath).endsWith('app.asar')) problems.push(`app path is ${result.appPath}, expected …/app.asar`);
  }

  if (problems.length) {
    console.error(output.split('\n').slice(-60).join('\n'));
    console.error('\nsmoke: FAILED');
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`smoke: ok (${result.version}): ${result.checks.join('; ')}`);
}

main().catch((err) => {
  console.error(`smoke: FAILED - ${err.message}`);
  process.exit(1);
});
