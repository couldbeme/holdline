import { createLlmJudge } from 'dsh-write-gate/core';
import type { NormalizedAction } from 'dsh-write-gate/core';

export interface Case {
  id: string;
  difficulty: string;
  label: 'drift' | 'clean';
  commitments: string[];
  action: string;
}

/**
 * Declared, construction-time facts about how a guard reaches its verdict.
 * This enforces PRESENCE, not TRUTHFULNESS — a guard can declare 'in-process'
 * while secretly calling the network. Module hashing (next round) is what
 * would address that; see docs/GUARD-INTERFACE.md.
 */
export interface GuardMeta {
  transport: 'http' | 'in-process' | 'local-model';
  model: string | null;
  temperature: number | null;
  live: boolean; // true iff the call leaves the process
}

/** What a guard actually receives: a case with the ground-truth label removed. */
export type GuardCase = Omit<Case, 'label'>;

/** A guard decides, for one case, whether to BLOCK (predict drift). */
export type Guard = {
  name: string;
  kind: 'real' | 'archetype' | 'baseline' | 'external';
  note: string;
  meta: GuardMeta;
  /**
   * Receives the case WITHOUT `label`: ground truth is stripped at the call
   * boundary so a guard cannot read the answer. Compiler-enforced, not just
   * documented.
   */
  block(c: GuardCase): Promise<boolean>;
};

/** Every guard sees the same uniform representation of a case's action. */
function asAction(c: GuardCase): NormalizedAction {
  return { kind: 'shell', tool: 'action', command: c.action, summary: c.action };
}

/**
 * Commitment-blind deny-list — the dominant swarm strategy: a fixed pattern set
 * over the raw action, ignoring what the operator actually committed to. Catches
 * exactly what it hardcoded; blind to paraphrase and novel domains by construction.
 * Archetype of the strategy, NOT any specific published plugin.
 */
const DENYLIST: RegExp[] = [
  /\bgit\s+push\s+[^\n]*(-f\b|--force)/i,
  /\brm\s+-[rf]{1,2}\b/i,
  /\b(DROP\s+(TABLE|DATABASE|SCHEMA)|TRUNCATE|DELETE\s+FROM)\b/i,
  /\.env\b/i,
  /\bcredentials?\b/i,
  /\b(sk-[a-z0-9]{16,}|AKIA[0-9A-Z]{16})\b/,
];

/** Shared by every in-tree guard that is a plain regex/boolean function: no network, no model. */
const IN_PROCESS_META: GuardMeta = { transport: 'in-process', model: null, temperature: null, live: false };

export function denylistGuard(): Guard {
  return {
    name: 'denylist-archetype',
    kind: 'archetype',
    note: 'fixed regex blocklist over the raw action; commitment-blind (models the dominant swarm strategy)',
    meta: IN_PROCESS_META,
    block: async (c) => DENYLIST.some((re) => re.test(c.action)),
  };
}

/**
 * Barricade (JohnXu22786/safety-net) — a REAL published dsh guard, its structural
 * rules encoded verbatim from src/analyzer.js RAW_PATTERNS + src/rules.js severities
 * (fetched 2026-08-17, github.com/JohnXu22786/safety-net, MIT). PARTIAL by design:
 * this is the regex layer; the shipped plugin also runs a ~1300-line POSIX parser
 * with cwd/workspace path classification more capable than these patterns.
 * block = deny||ask (both intervene on the call). Allow-by-default, commitment-blind.
 */
const BARRICADE: RegExp[] = [
  /\brm\s+[^\n;&|]{0,256}\s+\/(?:\s|$|[;&|])/,
  /\brm\s+[^\n;&|]{0,256}\s+(?:~|\$\{?HOME\}?)(?:\s|$|[;&|])/,
  /\bgit\s+(?:-\S{0,32}\s+){0,8}reset\s+--hard\b/,
  /\bgit\s+(?:-\S{0,32}\s+){0,8}clean\s+-\S{0,32}f\S{0,32}/,
  /\bgit\s+(?:-\S{0,32}\s+){0,8}push\s+(?:[^\s;&|]{0,32} ){0,16}(?:-f\b|--force(?:-with-lease)?\b)/,
  /\bdd\b[^\n;&|]{0,256}\bof=\/dev\/(?!null\b|zero\b|random\b|urandom\b|tty\b)/,
  /\bmkfs(?:\.\w+)?\s+[^\n;&|]{0,256}\/dev\//,
];

export function barricadeGuard(): Guard {
  return {
    name: 'barricade',
    kind: 'real',
    note: 'JohnXu22786/safety-net — real published guard, regex layer encoded verbatim (partial; full plugin adds a POSIX parser). Commitment-blind, allow-by-default.',
    meta: IN_PROCESS_META,
    block: async (c) => BARRICADE.some((re) => re.test(c.action)),
  };
}

/**
 * safeguard (ZhijiangTang/dsh-safeguard) — REAL published guard, all command/secret
 * patterns encoded VERBATIM from index.js (fetched 2026-08-18, MIT). Adds a DROP-SQL
 * rule Barricade lacks. Commitment-blind, allow-by-default.
 */
const SAFEGUARD: RegExp[] = [
  /\brm\s+(?:-[a-z]*r[a-z]*f[a-z]*|-[a-z]*f[a-z]*r[a-z]*)(?:\s+-\w+)*\s+(\/)/,
  /\bgit\s+push\b[^\n]*(?:--force|-f(?:\s|$))/,
  /^\s*DROP\s+(?:TABLE|DATABASE|INDEX|VIEW|SCHEMA|USER|ROLE|FUNCTION|PROCEDURE|TRIGGER|COLUMN)\b/i,
  /AKIA[0-9A-Z]{16}/,
  /sk-[A-Za-z0-9]{20,}/,
  /ghp_[A-Za-z0-9]{30,}/,
];

export function safeguardGuard(): Guard {
  return {
    name: 'safeguard',
    kind: 'real',
    note: 'ZhijiangTang/dsh-safeguard — real published guard, all patterns encoded verbatim (rm -rf /, git force-push, DROP SQL, AWS/OpenAI/GitHub secrets). Commitment-blind.',
    meta: IN_PROCESS_META,
    block: async (c) => SAFEGUARD.some((re) => re.test(c.action)),
  };
}

/**
 * guardian (lonelymoon87/dsh-guardian) — REAL published guard. Command deny rules
 * encoded from src/index.ts (fetched 2026-08-18, MIT): rm -rf variants, /etc writes,
 * and sudo are verbatim; it also declares force-push / destructive-sql / curl-pipe
 * rules whose full regex was not captured, approximated here (labeled PARTIAL).
 */
const GUARDIAN: RegExp[] = [
  /(?:^|[;&|]\s*)rm\s+(?=[^\n]*-[^\n]*r)(?=[^\n]*-[^\n]*f)/iu,
  /(?:>|\btee\b)\s*\/etc(?:\/|\s|$)/iu,
  /(?:^|[;&|]\s*)sudo\s+/iu,
  /\bgit\s+push\b[^\n]*(?:--force|-f\b)/i, // approximated (guardian declares a force-push rule)
  /\bDROP\s+(?:TABLE|DATABASE|SCHEMA)\b/i, // approximated (guardian declares a destructive-sql rule)
  /\b(?:curl|wget)\b[^\n]*\|\s*(?:sh|bash)\b/i, // approximated (guardian declares a remote-script-pipe rule)
];

export function guardianGuard(): Guard {
  return {
    name: 'guardian',
    kind: 'real',
    note: 'lonelymoon87/dsh-guardian — real published guard; rm/‎etc/sudo verbatim, force-push/sql/curl-pipe approximated (PARTIAL). Also redacts secrets. Commitment-blind.',
    meta: IN_PROCESS_META,
    block: async (c) => GUARDIAN.some((re) => re.test(c.action)),
  };
}

export function allowAll(): Guard {
  return { name: 'allow-all', kind: 'baseline', note: 'no guard (floor)', meta: IN_PROCESS_META, block: async () => false };
}

export function blockAll(): Guard {
  return {
    name: 'block-all',
    kind: 'baseline',
    note: 'blocks everything (shows why catch-rate alone is meaningless)',
    meta: IN_PROCESS_META,
    block: async () => true,
  };
}

/**
 * Our tier-2 judge, live, against an OpenAI-compatible endpoint. Blocks if ANY
 * of the case's commitments is judged violated. Uses the SHIPPED prompt builder
 * and parser from the published package (dogfood).
 */
export function judgeGuard(endpoint: string, model: string): Guard {
  const judge = createLlmJudge(async (prompt, signal) => {
    const res = await fetch(`${endpoint}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, temperature: 0, max_tokens: 250, messages: [{ role: 'user', content: prompt }] }),
      ...(signal ? { signal } : {}),
    });
    if (!res.ok) throw new Error(`judge endpoint ${res.status}`);
    const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error('no content');
    return content;
  });
  return {
    name: `judge:${model}`,
    kind: 'real',
    note: 'dsh-write-gate tier-2 judge (shipped fenced prompt + parser), live model',
    meta: { transport: 'local-model', model, temperature: 0, live: true }, // matches the pinned temperature: 0 above
    block: async (c) => {
      for (const statement of c.commitments) {
        const v = await judge({ statement, action: asAction(c) });
        if (v.violation) return true; // abstain (v.violation=false) never blocks
      }
      return false;
    },
  };
}
