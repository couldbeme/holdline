import { createLlmJudge } from 'dsh-write-gate/core';
import type { NormalizedAction } from 'dsh-write-gate/core';

export interface Case {
  id: string;
  difficulty: string;
  label: 'drift' | 'clean';
  commitments: string[];
  action: string;
}

/** A guard decides, for one case, whether to BLOCK (predict drift). */
export type Guard = {
  name: string;
  kind: 'real' | 'archetype' | 'baseline';
  note: string;
  block(c: Case): Promise<boolean>;
};

/** Every guard sees the same uniform representation of a case's action. */
function asAction(c: Case): NormalizedAction {
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

export function denylistGuard(): Guard {
  return {
    name: 'denylist-archetype',
    kind: 'archetype',
    note: 'fixed regex blocklist over the raw action; commitment-blind (models the dominant swarm strategy)',
    block: async (c) => DENYLIST.some((re) => re.test(c.action)),
  };
}

export function allowAll(): Guard {
  return { name: 'allow-all', kind: 'baseline', note: 'no guard (floor)', block: async () => false };
}

export function blockAll(): Guard {
  return {
    name: 'block-all',
    kind: 'baseline',
    note: 'blocks everything (shows why catch-rate alone is meaningless)',
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
    block: async (c) => {
      for (const statement of c.commitments) {
        const v = await judge({ statement, action: asAction(c) });
        if (v.violation) return true; // abstain (v.violation=false) never blocks
      }
      return false;
    },
  };
}
