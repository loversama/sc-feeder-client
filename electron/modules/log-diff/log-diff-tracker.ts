/**
 * Game.log diff tracker.
 *
 * Builds a signature set (see log-signature.ts) of the Game.log being watched and compares it
 * with the previous Game.log we parsed ("baseline"), so after a patch we can see:
 *   - added:    kinds of lines the game now writes that the previous log never had
 *   - notSeen:  kinds of lines the previous log had but this one hasn't (yet) — a session may simply
 *               not have triggered them, so this is "not seen", not proof of removal
 *   - patterns: which of the log-parser's regexes matched in each log — a parser pattern that
 *               matched before and matches nothing now is the most likely post-patch breakage
 *
 * Baseline source, in order: the last session we saved (userData/log-diff/baseline.json), or, the
 * first time, the newest file in the game's logbackups/ folder.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {
  addLinesToSet,
  diffSignatureSets,
  extractBuildInfo,
  type DiffEntry,
  type LogBuildInfo,
  type SignatureSet,
} from './log-signature';

export type LogSnapshot = {
  /** Identifies one game session's Game.log: build + "Log started on" line. */
  logId: string;
  logPath: string;
  build: LogBuildInfo;
  startedLine: string | null;
  lines: number;
  savedAt: string;
  source: 'session' | 'logbackups' | 'file';
  set: SignatureSet;
  patternHits: Record<string, number>;
};

export type PatternStatus = {
  name: string;
  current: number;
  baseline: number;
  /** ok = matched now; lost = matched in baseline but not now; never = matched in neither */
  status: 'ok' | 'lost' | 'never' | 'new';
};

export type LogDiffReport = {
  generatedAt: string;
  current: Omit<LogSnapshot, 'set' | 'patternHits'> & { signatures: number };
  baseline: (Omit<LogSnapshot, 'set' | 'patternHits'> & { signatures: number }) | null;
  counts: { added: number; notSeen: number; common: number };
  added: DiffEntry[];
  notSeen: DiffEntry[];
  patterns: PatternStatus[];
};

export type LogDiffTrackerOptions = {
  storeDir: string;
  patterns: Readonly<Record<string, RegExp>>;
  getRedactNames?: () => string[];
  log?: (level: 'info' | 'warn' | 'debug', msg: string) => void;
  /** Minimum lines before a session is worth saving as the next baseline. */
  minLinesToSave?: number;
};

const BASELINE_FILE = 'baseline.json';
const PREVIOUS_FILE = 'baseline-previous.json';

function emptySnapshot(logPath: string): LogSnapshot {
  return { logId: '', logPath, build: {}, startedLine: null, lines: 0, savedAt: '', source: 'session', set: {}, patternHits: {} };
}

function strip(s: LogSnapshot): Omit<LogSnapshot, 'set' | 'patternHits'> & { signatures: number } {
  const { set, patternHits: _p, ...rest } = s;
  return { ...rest, signatures: Object.keys(set).length };
}

export class LogDiffTracker {
  #opts: Required<Omit<LogDiffTrackerOptions, 'getRedactNames'>> & Pick<LogDiffTrackerOptions, 'getRedactNames'>;
  #current: LogSnapshot;
  #baseline: LogSnapshot | null = null;
  #previous: LogSnapshot | null = null;
  #headerBuf = '';
  #loaded = false;
  #version = 0;
  #cachedReport: { version: number; report: LogDiffReport } | null = null;

  constructor(opts: LogDiffTrackerOptions) {
    this.#opts = {
      log: () => {},
      minLinesToSave: 500,
      ...opts,
    } as any;
    this.#current = emptySnapshot('');
  }

  /** Load saved baselines (call once at startup; safe to call again). */
  async load(): Promise<void> {
    if (this.#loaded) return;
    this.#loaded = true;
    await fsp.mkdir(this.#opts.storeDir, { recursive: true }).catch(() => {});
    this.#baseline = await this.#readSnapshot(BASELINE_FILE);
    this.#previous = await this.#readSnapshot(PREVIOUS_FILE);
  }

  /** Start tracking a (new) Game.log from its beginning. Finalises the session being tracked. */
  async beginLog(logPath: string): Promise<void> {
    await this.load();
    await this.finalize();
    this.#current = emptySnapshot(logPath);
    this.#headerBuf = '';
    this.#version++;
    if (!this.#baseline) await this.#loadBaselineFromLogBackups(logPath);
  }

  /** Feed newly read Game.log content (same chunks the log watcher parses). */
  addChunk(chunk: string): void {
    if (!chunk) return;
    const cur = this.#current;
    if (!cur.logId) {
      this.#headerBuf += chunk.slice(0, 200_000);
      const started = this.#headerBuf.match(/Log started on ([^\r\n]+)/)?.[1] ?? null;
      const build = extractBuildInfo(this.#headerBuf);
      if (started || this.#headerBuf.length > 100_000) {
        cur.startedLine = started;
        cur.build = build;
        cur.logId = `${build.build ?? '?'}|${started ?? 'unknown'}`;
        this.#headerBuf = '';
      }
    }
    const redact = this.#opts.getRedactNames?.() ?? [];
    addLinesToSet(cur.set, chunk, { redact });
    let lines = 0;
    for (const line of chunk.split('\n')) {
      if (!line.trim()) continue;
      lines++;
      for (const [name, re] of Object.entries(this.#opts.patterns)) {
        if (re.test(line)) cur.patternHits[name] = (cur.patternHits[name] ?? 0) + 1;
      }
    }
    cur.lines += lines;
    this.#version++;
  }

  /**
   * Save the tracked session as the new baseline (if it has enough lines and is a different log
   * from the saved one). Called on log reset/replacement and on app quit.
   */
  async finalize(): Promise<void> {
    const cur = this.#current;
    if (!cur.logId || cur.lines < this.#opts.minLinesToSave) return;
    cur.savedAt = new Date().toISOString();
    cur.source = 'session';
    if (this.#baseline && this.#baseline.logId !== cur.logId) {
      this.#previous = this.#baseline;
      await this.#writeSnapshot(PREVIOUS_FILE, this.#previous);
    }
    this.#baseline = { ...cur, set: { ...cur.set }, patternHits: { ...cur.patternHits } };
    await this.#writeSnapshot(BASELINE_FILE, this.#baseline);
    this.#opts.log('info', `Saved Game.log baseline (${cur.lines} lines, ${Object.keys(cur.set).length} signatures, build ${cur.build.build ?? '?'})`);
  }

  /** The baseline to compare against: never the same log as the one being tracked. */
  #comparisonBaseline(): LogSnapshot | null {
    const id = this.#current.logId;
    if (this.#baseline && (!id || this.#baseline.logId !== id)) return this.#baseline;
    if (this.#previous && this.#previous.logId !== id) return this.#previous;
    return null;
  }

  report(limit = 200): LogDiffReport {
    if (this.#cachedReport && this.#cachedReport.version === this.#version && limit === 200) return this.#cachedReport.report;
    const report = buildReport(this.#comparisonBaseline(), this.#current, Object.keys(this.#opts.patterns), limit);
    if (limit === 200) this.#cachedReport = { version: this.#version, report };
    return report;
  }

  /** Compare two Game.log files on disk (does not touch the saved baselines). */
  async compareFiles(baselineFile: string, currentFile: string, limit = 100_000): Promise<LogDiffReport> {
    const base = await this.snapshotFromFile(baselineFile);
    const cur = await this.snapshotFromFile(currentFile);
    if (!base) throw new Error(`Not found: ${baselineFile}`);
    if (!cur) throw new Error(`Not found: ${currentFile}`);
    return buildReport(base, cur, Object.keys(this.#opts.patterns), limit);
  }

  /** Write the full report (JSON + readable Markdown) and return the Markdown path. */
  async exportReport(): Promise<string> {
    const r = this.report(100_000);
    const stamp = r.generatedAt.replace(/[:.]/g, '-');
    const jsonPath = path.join(this.#opts.storeDir, `report-${stamp}.json`);
    const mdPath = path.join(this.#opts.storeDir, `report-${stamp}.md`);
    await fsp.writeFile(jsonPath, JSON.stringify(r, null, 2));
    await fsp.writeFile(mdPath, renderMarkdown(r));
    return mdPath;
  }

  // --- persistence -----------------------------------------------------------

  async #readSnapshot(file: string): Promise<LogSnapshot | null> {
    try {
      const raw = await fsp.readFile(path.join(this.#opts.storeDir, file), 'utf8');
      const s = JSON.parse(raw) as LogSnapshot;
      return s && s.set ? s : null;
    } catch {
      return null;
    }
  }

  async #writeSnapshot(file: string, s: LogSnapshot): Promise<void> {
    try {
      await fsp.mkdir(this.#opts.storeDir, { recursive: true });
      const tmp = path.join(this.#opts.storeDir, `${file}.tmp`);
      await fsp.writeFile(tmp, JSON.stringify(s));
      await fsp.rename(tmp, path.join(this.#opts.storeDir, file));
    } catch (err) {
      this.#opts.log('warn', `Could not save ${file}: ${(err as Error).message}`);
    }
  }

  /** First run: use the newest logbackups/*.log next to Game.log as the baseline. */
  async #loadBaselineFromLogBackups(logPath: string): Promise<void> {
    if (!logPath) return;
    const dir = path.join(path.dirname(logPath), 'logbackups');
    try {
      const files = (await fsp.readdir(dir)).filter((f) => f.toLowerCase().endsWith('.log'));
      if (!files.length) return;
      const stats = await Promise.all(files.map(async (f) => ({ f, m: (await fsp.stat(path.join(dir, f))).mtimeMs })));
      stats.sort((a, b) => b.m - a.m);
      const file = path.join(dir, stats[0].f);
      const snap = await this.snapshotFromFile(file, 'logbackups');
      if (snap) {
        this.#baseline = snap;
        this.#version++;
        this.#opts.log('info', `Using ${file} as initial Game.log baseline (${snap.lines} lines)`);
      }
    } catch {
      /* no logbackups folder */
    }
  }

  /** Build a snapshot of any Game.log file on disk (also used to compare two arbitrary logs). */
  async snapshotFromFile(file: string, source: LogSnapshot['source'] = 'file'): Promise<LogSnapshot | null> {
    if (!fs.existsSync(file)) return null;
    const content = await fsp.readFile(file, 'utf8');
    const t = new LogDiffTracker({ ...this.#opts, storeDir: this.#opts.storeDir });
    t.#current = emptySnapshot(file);
    t.addChunk(content);
    const s = t.#current;
    s.source = source;
    s.savedAt = new Date().toISOString();
    if (!s.logId) s.logId = `file|${file}`;
    return s;
  }
}

export function buildReport(base: LogSnapshot | null, current: LogSnapshot, patternNames: string[], limit = 200): LogDiffReport {
  const diff = diffSignatureSets(base?.set ?? {}, current.set);
  const patterns: PatternStatus[] = patternNames.map((name) => {
    const cur = current.patternHits[name] ?? 0;
    const was = base?.patternHits[name] ?? 0;
    const status: PatternStatus['status'] = cur > 0 ? (was > 0 || !base ? 'ok' : 'new') : was > 0 ? 'lost' : 'never';
    return { name, current: cur, baseline: was, status };
  });
  const order = { lost: 0, new: 1, ok: 2, never: 3 } as const;
  patterns.sort((a, b) => order[a.status] - order[b.status] || b.baseline - a.baseline);
  return {
    generatedAt: new Date().toISOString(),
    current: strip(current),
    baseline: base ? strip(base) : null,
    counts: { added: base ? diff.added.length : 0, notSeen: diff.notSeen.length, common: diff.common },
    added: base ? diff.added.slice(0, limit) : [],
    notSeen: diff.notSeen.slice(0, limit),
    patterns,
  };
}

export function renderMarkdown(r: LogDiffReport): string {
  const b = (x: LogDiffReport['current'] | null) =>
    x ? `${x.build.fileVersion ?? '?'} build ${x.build.build ?? '?'} (${x.build.branch ?? '?'}) — ${x.lines} lines, ${x.signatures} signatures — ${x.logPath}` : '(none)';
  const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const rows = (list: DiffEntry[]) => list.map((e) => `| ${e.count} | \`${esc(e.signature).slice(0, 220)}\` | \`${esc(e.sample).slice(0, 220)}\` |`).join('\n');
  return [
    `# Game.log diff — ${r.generatedAt}`,
    '',
    `- **Current:** ${b(r.current)}`,
    `- **Baseline:** ${b(r.baseline)}`,
    `- **Added:** ${r.counts.added} · **Not seen:** ${r.counts.notSeen} · **Common:** ${r.counts.common}`,
    '',
    '## Parser patterns',
    '',
    '| Pattern | Status | Current | Baseline |',
    '|---|---|---|---|',
    ...r.patterns.map((p) => `| ${p.name} | ${p.status} | ${p.current} | ${p.baseline} |`),
    '',
    '## New kinds of lines',
    '',
    '| Count | Signature | Sample |',
    '|---|---|---|',
    rows(r.added),
    '',
    '## Not seen this session (present in baseline)',
    '',
    '| Count (baseline) | Signature | Sample |',
    '|---|---|---|',
    rows(r.notSeen),
    '',
  ].join('\n');
}
