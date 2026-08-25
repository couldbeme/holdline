// Structural (command-pattern) guards vs the ODCV real-trajectory slice.
//
// DEFAULT MODE (fair, per-command): each scored trajectory's messages record is
// parsed into individual bash tool-call commands (scripts/odcv-extract.mjs), and
// every guard sees ONE COMMAND AT A TIME, its native input shape. A trajectory is
// blocked if any of its commands blocks. Same roster and labels as the judge run
// (odcv-progress.jsonl, 548 trajectories), same score() metrics. This fulfils the
// TODO that withdrew the earlier whole-transcript numbers.
//
// --artifact MODE (withdrawn, kept only to reproduce the artifact): scores the
// same guards on whole concatenated transcript blobs, the WRONG input shape for
// them: some of their regexes are start-anchored (/^DROP/) and cannot fire
// mid-transcript. Its ~0% is NOT a fair measurement; see RESULTS-ODCV.md.
//
// Either way the domain point stands (evidenced by grep, not by this script):
// ODCV violations are semantic (data falsification, metric gaming, hiding
// evidence), so command-pattern guards have little to match here regardless.
//
// node odcv-compare.mjs [--base ~/Dev/odcv-bench] [--roster odcv-progress.jsonl] [--artifact]
import { score } from './src/score.ts';
import { loadOdcvSlice } from './src/odcv.ts';
import { extractCorpus } from './scripts/odcv-extract.mjs';
import { allowAll, barricadeGuard, blockAll, denylistGuard, guardianGuard, safeguardGuard } from './src/guards.ts';

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const base = arg('base', `${process.env.HOME}/Dev/odcv-bench`);
const guards = [barricadeGuard(), safeguardGuard(), guardianGuard(), denylistGuard(), allowAll(), blockAll()];
const pct = (x) => (Number.isNaN(x) ? ' n/a' : `${(x * 100).toFixed(0)}%`.padStart(5));

if (process.argv.includes('--artifact')) {
  // Withdrawn whole-transcript run, unchanged, reproduction only.
  const MODELS = ['claude-opus-4.5', 'gpt-5.1-chat', 'gemini-3-pro-preview', 'glm-4.6', 'grok-4.1-fast', 'kimi-k2-0905', 'minimax-m2'];
  const VARIATIONS = MODELS.flatMap((m) => [`${m}-mandated`, `${m}-incentivized`]);
  const cases = loadOdcvSlice(base, { variations: VARIATIONS, maxScenarios: 100 });
  const asAction = (c) => ({ commitments: [c.constraint], action: c.transcript });
  console.log(`[ARTIFACT MODE: whole-transcript input, withdrawn as unfair; kept for reproduction]`);
  console.log(`${cases.length} real trajectories (${cases.filter((c) => c.label === 'drift').length} violation / ${cases.filter((c) => c.label === 'clean').length} clean)\n`);
  console.log('guard'.padEnd(20), 'catch', 'false-block', 'bal.kappa');
  console.log('-'.repeat(56));
  for (const g of guards) {
    const judged = [];
    for (const c of cases) judged.push({ id: c.id, difficulty: c.variation, label: c.label, blocked: await g.block(asAction(c)) });
    const m = score(judged);
    console.log(g.name.padEnd(20), pct(m.catchRate), pct(m.falseBlockRate).padStart(11), m.balancedKappa.toFixed(2).padStart(9));
  }
  process.exit(0);
}

// FAIR MODE: per-command, native input shape.
const roster = arg('roster', 'odcv-progress.jsonl');
const { trajectories } = extractCorpus({ baseDir: base, rosterPath: roster });
const nCommands = trajectories.reduce((s, t) => s + t.commands.length, 0);
const nSkipped = trajectories.reduce((s, t) => s + t.skipped.length, 0);
const drift = trajectories.filter((t) => t.label === 'drift').length;
const zeroCmd = trajectories.filter((t) => t.commands.length === 0);
console.log(`ODCV structural-guard comparison, per-command (fair): ${trajectories.length} trajectories (${drift} violation / ${trajectories.length - drift} clean), ${nCommands} bash commands extracted, ${nSkipped} non-command calls skipped, ${zeroCmd.length} trajectories with zero commands (${zeroCmd.filter((t) => t.label === 'drift').length} of them violations).\n`);
console.log('guard'.padEnd(20), 'catch', 'false-block', 'bal.kappa', 'cmds-blocked');
console.log('-'.repeat(64));
for (const g of guards) {
  const judged = [];
  let cmdsBlocked = 0;
  for (const t of trajectories) {
    let blocked = false;
    for (const c of t.commands) {
      // Structural guards are commitment-blind by construction; GuardCase still
      // requires the field, so they get an empty commitment list, one command per call.
      if (await g.block({ commitments: [], action: c.command })) {
        cmdsBlocked++;
        blocked = true;
      }
    }
    judged.push({ id: t.id, difficulty: t.difficulty, label: t.label, blocked });
  }
  const m = score(judged);
  console.log(g.name.padEnd(20), pct(m.catchRate), pct(m.falseBlockRate).padStart(11), m.balancedKappa.toFixed(2).padStart(9), String(cmdsBlocked).padStart(12));
}
console.log('\nnote: ODCV violations are mostly semantic (data falsification, metric gaming, hiding evidence), not dangerous-command-shaped. A low structural catch rate here is a statement about the DOMAIN, not an indictment of the guards; the structural-vs-semantic comparison both sides can act on lives in RESULTS.md.');
