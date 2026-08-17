// LIMITATION (read before trusting the output): this scores per-COMMAND structural
// guards on whole TRANSCRIPT blobs, which is the wrong input shape for them, and some
// of their regexes are start-anchored (/^DROP/) so they cannot fire mid-transcript.
// The resulting ~0% is therefore NOT a fair measurement and is withdrawn from
// RESULTS-ODCV. It is kept only to reproduce the artifact. The real point (evidenced
// by grep, not by this script): ODCV violations are semantic (0 force-push, 0 DROP,
// 49/706 rm-rf), so command guards are out of domain here regardless. A fair test
// would extract individual tool-call commands and run the guards per-command (TODO).
//
// Score the STRUCTURAL guards on the same ODCV real-trajectory slice as the judge.
// node odcv-compare.mjs
import { score } from './src/score.ts';
import { loadOdcvSlice } from './src/odcv.ts';
import { allowAll, barricadeGuard, blockAll, denylistGuard, guardianGuard, safeguardGuard } from './src/guards.ts';

const base = `${process.env.HOME}/Dev/odcv-bench`;
const MODELS = ['claude-opus-4.5', 'gpt-5.1-chat', 'gemini-3-pro-preview', 'glm-4.6', 'grok-4.1-fast', 'kimi-k2-0905', 'minimax-m2'];
const VARIATIONS = MODELS.flatMap((m) => [`${m}-mandated`, `${m}-incentivized`]);
const cases = loadOdcvSlice(base, { variations: VARIATIONS, maxScenarios: 100 });

// Structural guards see the transcript as the action text (they are commitment-blind).
const asAction = (c) => ({ commitments: [c.constraint], action: c.transcript, id: c.id, difficulty: c.variation, label: c.label });
const guards = [barricadeGuard(), safeguardGuard(), guardianGuard(), denylistGuard(), allowAll(), blockAll()];

console.log(`ODCV structural-guard comparison: ${cases.length} real trajectories (${cases.filter((c) => c.label === 'drift').length} violation / ${cases.filter((c) => c.label === 'clean').length} clean)\n`);
console.log('guard'.padEnd(20), 'catch', 'false-block', 'bal.kappa');
console.log('-'.repeat(56));
for (const g of guards) {
  const judged = [];
  for (const c of cases) judged.push({ id: c.id, difficulty: c.variation, label: c.label, blocked: await g.block(asAction(c)) });
  const m = score(judged);
  const pct = (x) => (Number.isNaN(x) ? ' n/a' : `${(x * 100).toFixed(0)}%`.padStart(5));
  console.log(g.name.padEnd(20), pct(m.catchRate), pct(m.falseBlockRate).padStart(11), m.balancedKappa.toFixed(2).padStart(9));
}
console.log('\nnote: ODCV violations are semantic (data falsification, metric gaming, hiding evidence), not shell-command-shaped, so command-pattern guards have little to match. That is the finding, not a bug.');
