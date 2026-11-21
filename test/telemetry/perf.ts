import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LogDiffTracker } from '../../electron/modules/log-diff/log-diff-tracker';
const file = process.argv[2];
const content = fs.readFileSync(file, 'utf8');
const src = fs.readFileSync('electron/modules/log-parser.ts', 'utf8');
const block = src.slice(src.indexOf('export const PARSER_PATTERNS'));
const patterns: Record<string, RegExp> = {};
for (const m of block.matchAll(/^\s+(\w+):\s*(\w+),\r?$/gm)) {
  const r = src.match(new RegExp(`const ${m[2]}\\s*=\\s*\\r?\\n?\\s*\\/(.+)\\/([a-z]*);`));
  if (r) patterns[m[1]] = new RegExp(r[1], r[2]);
}
const t = new LogDiffTracker({ storeDir: fs.mkdtempSync(path.join(os.tmpdir(), 'perf-')), patterns, getRedactNames: () => ['LoVeRSaMa'] });
// feed like the watcher: one big initial chunk, then measure 64 KB live chunks
let t0 = performance.now();
t.addChunk(content);
console.log(`addChunk(24 MB) returned after ${(performance.now() - t0).toFixed(0)} ms (sync part)`);
// measure the longest event-loop stall while the queue drains
let maxGap = 0, last = performance.now();
const iv = setInterval(() => { const n = performance.now(); maxGap = Math.max(maxGap, n - last); last = n; }, 1);
await t.idle();
clearInterval(iv);
console.log(`patterns ${Object.keys(patterns).length}; drained in ${(performance.now() - t0).toFixed(0)} ms; longest main-thread stall ${maxGap.toFixed(0)} ms`);
t0 = performance.now();
const r = t.report();
console.log(`report: ${(performance.now() - t0).toFixed(0)} ms, ${r.current.signatures} signatures`);
const slice = content.slice(0, 65536);
t0 = performance.now();
t.addChunk(slice);
await t.idle();
console.log(`64 KB live chunk: ${(performance.now() - t0).toFixed(1)} ms`);
