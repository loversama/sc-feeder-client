/**
 * Offline Game.log diff:  npm run log-diff -- <baseline Game.log> <current Game.log> [--redact Handle] [--out report.md]
 *
 * Same engine as the in-app tracker. Parser patterns are read from electron/modules/log-parser.ts
 * source (that module imports Electron, so it can't be loaded in plain Node).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LogDiffTracker, renderMarkdown } from '../electron/modules/log-diff/log-diff-tracker';

function patternsFromParserSource(): Record<string, RegExp> {
  const src = fs.readFileSync(path.join(process.cwd(), 'electron/modules/log-parser.ts'), 'utf8');
  const block = src.slice(src.indexOf('export const PARSER_PATTERNS'));
  const names = [...block.matchAll(/^\s+(\w+):\s*(\w+),$/gm)].map((m) => [m[1], m[2]] as const);
  const out: Record<string, RegExp> = {};
  for (const [name, constName] of names) {
    const m = src.match(new RegExp(`const ${constName}\\s*=\\s*\\n?\\s*\\/(.+)\\/([a-z]*);`));
    if (m) out[name] = new RegExp(m[1], m[2]);
  }
  return out;
}

const args = process.argv.slice(2);
const opt = (k: string) => {
  const i = args.indexOf(k);
  if (i < 0) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const redact = opt('--redact');
const out = opt('--out');
const [baseFile, curFile] = args;
if (!baseFile || !curFile) {
  console.error('usage: npm run log-diff -- <baseline Game.log> <current Game.log> [--redact Handle] [--out report.md]');
  process.exit(2);
}
const patterns = patternsFromParserSource();
const tracker = new LogDiffTracker({ storeDir: fs.mkdtempSync(path.join(os.tmpdir(), 'logdiff-')), patterns, getRedactNames: () => (redact ? [redact] : []) });
const report = await tracker.compareFiles(baseFile, curFile);
const md = renderMarkdown(report);
if (out) fs.writeFileSync(out, md);
const lost = report.patterns.filter((p) => p.status === 'lost');
console.log(`patterns loaded: ${Object.keys(patterns).length}`);
console.log(`baseline: ${report.baseline?.build.fileVersion} (${report.baseline?.build.build}) ${report.baseline?.lines} lines`);
console.log(`current:  ${report.current.build.fileVersion} (${report.current.build.build}) ${report.current.lines} lines`);
console.log(`added ${report.counts.added} · not seen ${report.counts.notSeen} · common ${report.counts.common}`);
console.log(`parser patterns lost: ${lost.map((p) => `${p.name}(${p.baseline}→0)`).join(', ') || 'none'}`);
console.log(`parser patterns new:  ${report.patterns.filter((p) => p.status === 'new').map((p) => p.name).join(', ') || 'none'}`);
if (out) console.log(`report: ${out}`);
