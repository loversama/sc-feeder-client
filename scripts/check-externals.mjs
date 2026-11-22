#!/usr/bin/env node
/**
 * Fails the build if the main-process bundle (dist-electron) imports a package that is not on the
 * native allowlist. Every other dependency must be bundled: a bare import that has to be resolved
 * from node_modules at startup is what crashed the app when it was launched mid-update
 * ("ERR_MODULE_NOT_FOUND: Cannot find package 'undici'"). See CLAUDE.md "Packaging rules".
 *
 * Checks ESM `import ... from 'x'`, `export ... from 'x'`, `import('x')` and literal `require('x')`
 * calls at the start of a statement or expression (not inside strings of generated code).
 */
import fs from 'node:fs';
import path from 'node:path';
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'dist-electron');

/** Native modules: kept external and unpacked from app.asar (electron-builder asarUnpack). */
export const NATIVE_EXTERNALS = ['better-sqlite3', 'bindings', 'node-gyp-build'];
const ALLOWED = new Set(['electron', ...NATIVE_EXTERNALS]);
/** Optional peers required inside try/catch by bundled code (absence is handled): node-fetch -> encoding, ws -> bufferutil / utf-8-validate. */
const OPTIONAL_GUARDED = new Set(['encoding', 'bufferutil', 'utf-8-validate']);
const BUILTINS = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]));

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const deps = new Set(Object.keys(pkg.dependencies ?? {}));

const packageName = (spec) => (spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]);
const isBare = (spec) => !spec.startsWith('.') && !spec.startsWith('/') && !/^[a-z]+:\/\//i.test(spec) && !spec.startsWith('data:');

const PATTERNS = [
  /^\s*import\s+(?:[\w*{}\s,$]+?\s+from\s+)?["']([^"']+)["']/gm,
  /^\s*export\s+[\w*{}\s,$]+?\s+from\s+["']([^"']+)["']/gm,
  /(?<![\w$.])import\(\s*["']([^"']+)["']\s*\)/g,
  /(?:^|[=(,;:!&|?{}\s])require\(\s*["']([^"']+)["']\s*\)/gm,
];

if (!fs.existsSync(dir)) {
  console.error(`check-externals: ${path.relative(root, dir)} not found (run vite build first)`);
  process.exit(1);
}

const problems = [];
const seen = new Map();
for (const file of fs.readdirSync(dir).filter((f) => /\.(m?js|cjs)$/.test(f))) {
  const code = fs.readFileSync(path.join(dir, file), 'utf8');
  for (const re of PATTERNS) {
    for (const m of code.matchAll(re)) {
      const spec = m[1];
      if (!isBare(spec) || spec.startsWith('node:') || BUILTINS.has(spec) || BUILTINS.has(spec.split('/')[0])) continue;
      const name = packageName(spec);
      if (OPTIONAL_GUARDED.has(name)) continue;
      seen.set(name, [...new Set([...(seen.get(name) ?? []), file])]);
      if (!ALLOWED.has(name)) problems.push(`${file}: imports '${spec}' (not bundled; only native modules may stay external)`);
      else if (name !== 'electron' && !deps.has(name) && name !== 'bindings' && name !== 'node-gyp-build') {
        problems.push(`${file}: external '${name}' is not in package.json dependencies`);
      }
    }
  }
}
for (const name of NATIVE_EXTERNALS.filter((n) => n === 'better-sqlite3')) {
  if (!deps.has(name)) problems.push(`native external '${name}' must be in package.json dependencies`);
}

if (problems.length) {
  console.error('check-externals: FAILED');
  for (const p of [...new Set(problems)]) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`check-externals: ok (external packages: ${[...seen.keys()].sort().join(', ') || 'none'})`);
