/**
 * Game.log line signatures.
 *
 * A signature is a line with everything that varies between occurrences stripped out
 * (timestamps, ids, numbers, quoted names, coordinates…), so the same *kind* of line
 * maps to the same key across sessions and patches. Comparing the signature sets of two
 * Game.log files shows which kinds of lines a patch added and which ones we no longer see.
 *
 * Pure module: no Electron / fs imports, so it can be unit-tested with plain Node.
 */

export type SignatureInfo = {
  /** Normalised template, e.g. `[Notice] <Actor Death> CActor::Kill: * [#] in zone * killed by * …` */
  signature: string;
  /** `<Tag>` of the line when present (e.g. `Actor Death`), else '' */
  tag: string;
  /** `[Level]` of the line when present (e.g. `Notice`), else '' */
  level: string;
};

export type SignatureStats = {
  count: number;
  /** First raw line seen for this signature (trimmed to SAMPLE_MAX chars). */
  sample: string;
  tag: string;
  level: string;
};

export type SignatureSet = Record<string, SignatureStats>;

const SAMPLE_MAX = 400;
/** Only the first N normalised tokens of a message are kept, so long variable tails don't explode the set. */
const MAX_TOKENS = 16;

const TIMESTAMP_RE = /^<\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z>\s?/;
const LEVEL_RE = /^\[(Notice|Trace|Error|Warning|Warn|Info|Debug|Fatal|Error State|Assert)\]\s*/i;
const TAG_RE = /^<([^<>]{1,80})>\s*/;

/** Placeholder for any variable token. */
const V = '#';

export type SignatureOptions = {
  /** Names to replace with `<player>` (e.g. the logged-in handle), so they don't split signatures. */
  redact?: string[];
};

function escapeRe(x: string): string {
  return x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normaliseMessage(msg: string, opts: SignatureOptions): string {
  let s = msg;
  for (const name of opts.redact ?? []) {
    if (name && name.length >= 3) s = s.replace(new RegExp(escapeRe(name), 'g'), '<player>');
  }
  // Trailing team/category tags ([Team_ActorTech][Actor]) get renamed between patches → drop them.
  s = s.replace(/(?:\s*\[[^\[\]]*\])+\s*$/, (m) => (/\[Team_|\]\[/.test(m) ? '' : m));
  // Quoted strings ('Ship_Name_123', "Contract Accepted: foo") → *
  s = s.replace(/'[^']*'/g, "'*'").replace(/"[^"]*"/g, '"*"');
  // GUIDs and long hex ids
  s = s.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, V);
  s = s.replace(/\b0x[0-9a-f]+\b/gi, V);
  // Windows / unix paths
  s = s.replace(/[A-Za-z]:\\[^\s'"]*/g, V).replace(/(?:\/[\w.\-]+){2,}/g, V);
  // URLs
  s = s.replace(/\bhttps?:\/\/\S+/g, V);
  // Key[value] pairs (Player[Name] Port[magazine_attach] Elapsed[0.1]) → Key[*]
  s = s.replace(/\b([A-Za-z_]\w*)\[[^\[\]]*\]/g, '$1[*]');
  // Bracket groups whose content has a digit: [12345] [pos x: 1.2] → [#]
  s = s.replace(/\[[^\[\]]*\d[^\[\]]*\]/g, `[${V}]`);
  // Parenthesised groups with a digit
  s = s.replace(/\([^()]*\d[^()]*\)/g, `(${V})`);

  // Token pass: any token containing a digit becomes #; collapse consecutive #.
  const out: string[] = [];
  for (const raw of s.split(/\s+/)) {
    if (!raw) continue;
    let tok = raw;
    if (/\d/.test(tok) && tok !== `[${V}]` && tok !== `(${V})`) {
      // keep leading/trailing punctuation so "x:" style labels survive
      const lead = tok.match(/^[\[(<'"]*/)?.[0] ?? '';
      const trail = tok.match(/[\])>'",;:]*$/)?.[0] ?? '';
      tok = `${lead}${V}${trail}`;
    }
    if (out.length && out[out.length - 1] === tok && tok.includes(V)) continue;
    out.push(tok);
    if (out.length >= MAX_TOKENS) {
      out.push('…');
      break;
    }
  }
  return out.join(' ');
}

/** Signature of one Game.log line, or null for blank lines. */
export function lineSignature(line: string, opts: SignatureOptions = {}): SignatureInfo | null {
  let rest = line.replace(/\r$/, '').trim();
  if (!rest) return null;
  rest = rest.replace(TIMESTAMP_RE, '');
  let level = '';
  const lv = rest.match(LEVEL_RE);
  if (lv) {
    level = lv[1];
    rest = rest.slice(lv[0].length);
  }
  let tag = '';
  const tg = rest.match(TAG_RE);
  if (tg) {
    tag = tg[1].trim();
    rest = rest.slice(tg[0].length);
  }
  // Tags themselves sometimes carry ids (<Vehicle Destruction 123>) – normalise them too.
  const normTag = tag ? tag.replace(/\d+/g, V) : '';
  const body = normaliseMessage(rest, opts);
  const parts = [level ? `[${level}]` : '', normTag ? `<${normTag}>` : '', body].filter(Boolean);
  const signature = parts.join(' ');
  if (!signature) return null;
  return { signature, tag: normTag, level };
}

/** Adds every line of `content` to `set` (mutates and returns it). */
export function addLinesToSet(set: SignatureSet, content: string, opts: SignatureOptions = {}): SignatureSet {
  for (const line of content.split('\n')) {
    const info = lineSignature(line, opts);
    if (!info) continue;
    const existing = set[info.signature];
    if (existing) {
      existing.count++;
    } else {
      set[info.signature] = {
        count: 1,
        sample: line.trim().slice(0, SAMPLE_MAX),
        tag: info.tag,
        level: info.level,
      };
    }
  }
  return set;
}

export function buildSignatureSet(content: string, opts: SignatureOptions = {}): SignatureSet {
  return addLinesToSet({}, content, opts);
}

/** Game build info found in a Game.log header. */
export type LogBuildInfo = { fileVersion?: string; build?: string; branch?: string };

export function extractBuildInfo(content: string): LogBuildInfo {
  const head = content.slice(0, 200_000);
  return {
    fileVersion: head.match(/FileVersion:\s*([\d.]+)/)?.[1],
    build: head.match(/Build\((\d+)\)/)?.[1],
    branch: head.match(/Branch:\s*(\S+)/)?.[1],
  };
}

export type DiffEntry = { signature: string } & SignatureStats;

export type SignatureDiff = {
  /** Kinds of lines present in `current` but never in `baseline`. */
  added: DiffEntry[];
  /** Kinds of lines in `baseline` not (yet) seen in `current`. Not proof of removal: the session may not have triggered them. */
  notSeen: DiffEntry[];
  /** Signatures present in both. */
  common: number;
};

/** Compare two signature sets. Results sorted by count (most frequent first). */
export function diffSignatureSets(baseline: SignatureSet, current: SignatureSet): SignatureDiff {
  const added: DiffEntry[] = [];
  const notSeen: DiffEntry[] = [];
  let common = 0;
  for (const [signature, stats] of Object.entries(current)) {
    if (baseline[signature]) common++;
    else added.push({ signature, ...stats });
  }
  for (const [signature, stats] of Object.entries(baseline)) {
    if (!current[signature]) notSeen.push({ signature, ...stats });
  }
  const byCount = (a: DiffEntry, b: DiffEntry) => b.count - a.count;
  added.sort(byCount);
  notSeen.sort(byCount);
  return { added, notSeen, common };
}
