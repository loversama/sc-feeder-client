// Bundles test/parser/parser.test.ts with esbuild (Electron-bound modules replaced by stubs) and runs it with node --test.
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const modules = path.resolve(here, '../../electron/modules');
const stub = (n) => path.join(here, 'stubs', n);
const STUBS = {
  'config-manager': 'config-manager.ts',
  'notification-manager': 'notification-manager.ts',
  'window-manager': 'window-manager.ts',
  'session-manager': 'session-manager.ts',
  'rsi-scraper': 'rsi-scraper.ts',
  'definitionsService': 'definitions.ts',
  'event-processor': 'event-processor.ts',
  'logger': 'logger.ts',
  'zone-history-manager': 'zone.ts',
  'zone-resolver': 'zone.ts',
  'zone-classifier': 'zone.ts',
};
const stubPlugin = {
  name: 'parser-test-stubs',
  setup(b) {
    b.onResolve({ filter: /(^|\/)[\w.-]+?(\.ts)?$/ }, (args) => {
      if (!args.path.startsWith('.')) return;
      const base = path.basename(args.path).replace(/\.ts$/, '');
      const resolved = path.resolve(args.resolveDir, args.path);
      if (STUBS[base] && path.dirname(resolved) === modules) return { path: stub(STUBS[base]) };
    });
  },
};
const out = path.join(here, '..', 'telemetry', '.out', 'parser.test.mjs'); // .out is already gitignored
await build({
  entryPoints: [path.join(here, 'parser.test.ts')],
  bundle: true, platform: 'node', format: 'esm', packages: 'external',
  outfile: out, plugins: [stubPlugin], logLevel: 'warning',
});
const r = spawnSync(process.execPath, ['--test', out], { stdio: 'inherit', env: { ...process.env, PARSER_FIXTURES: path.join(here, 'fixtures') } });
process.exit(r.status ?? 1);
