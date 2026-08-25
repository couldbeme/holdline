// Score YOUR guard against holdline without forking src/guards.ts or opening a PR.
// Copy this file, replace `myGuard` with an import of your real guard, run:
//   node examples/score-your-guard.mjs
// With KAPPA_FLOOR set (see examples/ci-gate.yml) it exits 1 below the floor.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatGuardRow, runGuard } from '../run.mjs';
import { score } from '../src/score.ts';

// Toy commitment-conditioned rules: a pattern only fires when the commitments are
// about its topic. This is the cheapest possible "reads the commitments" guard,
// here to keep the example self-contained; replace it with your real logic.
const RULES = [
  { topic: /force.?push/i, hit: /\bpush\b[^\n]*(\s-f\b|--force)/i },
  { topic: /secret|credential|\.env|token/i, hit: /\.env\b|credential|secret|\btoken\b/i },
  { topic: /delete|drop|database/i, hit: /\bDROP\s+(TABLE|DATABASE|SCHEMA)\b|\bdelete\b[^\n]*\b(user|record|database)s?\b/i },
  { topic: /prod|deploy|release|freeze/i, hit: /\b(deploy|ship|release)\b[^\n]*\bprod(uction)?\b|\bwrite\b[^\n]*\b(flag|row|database)\b/i },
  { topic: /staging|untouched/i, hit: /\b(UPDATE|INSERT|DELETE|write)\b[^\n]*\bstaging\b/i },
];

// Every field below is required by the `Guard` shape in src/guards.ts.
const myGuard = {
  name: 'example-topic-rules', // the row label in any results table
  kind: 'external', // 'external' = lives outside this repo (vs 'real'/'archetype'/'baseline')
  note: 'toy commitment-conditioned rules; a template, not a recommendation',
  // meta is REQUIRED so no metric ever appears detached from the methodology that
  // produced it: transport, model, temperature, live (does the call leave the
  // process?) print in the row next to the numbers. It declares presence, not
  // verified truthfulness; see docs/GUARD-INTERFACE.md.
  meta: { transport: 'in-process', model: null, temperature: null, live: false },
  // block() receives ONLY {commitments, action}. It never sees `label` (the answer)
  // and never sees `id` or `difficulty`: on a public corpus that metadata alone is
  // an answer oracle (~0.85 balanced kappa with zero judging). runGuard strips
  // everything else before your code runs; throwing counts as a block (fail-closed).
  async block({ commitments, action }) {
    const text = commitments.join('\n');
    return RULES.some((r) => r.topic.test(text) && r.hit.test(action));
  },
};

const here = dirname(fileURLToPath(import.meta.url));
const base = JSON.parse(readFileSync(join(here, '../corpus/base-cases.json'), 'utf8'));
const inj = JSON.parse(readFileSync(join(here, '../corpus/injection-cases.json'), 'utf8'));
const cases = [...base.dev, ...base.heldout, ...inj.injection]; // 42 cases: 22 drift / 20 clean

const metrics = score(await runGuard(myGuard, cases));
console.log('guard'.padEnd(22), 'catch', 'falseBlock', 'bal.kappa', 'inj-acc', ' kind'.padEnd(11), 'transport'.padEnd(13), 'temp    ', 'live');
console.log(formatGuardRow({ guard: myGuard.name, kind: myGuard.kind, meta: myGuard.meta, metrics }));
// Catch-rate alone is meaningless (block-all scores 100% catch): read it against
// false-block; balanced kappa prices both. 42 cases is dev scale: use this as a
// regression gate, not a headline claim.
console.log(`balancedKappa=${metrics.balancedKappa.toFixed(2)} catch=${metrics.catchRate.toFixed(2)} falseBlock=${metrics.falseBlockRate.toFixed(2)}`);

const floor = process.env.KAPPA_FLOOR ? Number(process.env.KAPPA_FLOOR) : null;
if (floor !== null && !(metrics.balancedKappa >= floor)) {
  console.error(`FAIL: balanced kappa ${metrics.balancedKappa.toFixed(2)} < floor ${floor}`);
  process.exit(1);
}
