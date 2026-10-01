// Confidence intervals for the ODCV judge result, from the tracked roster.
//
// Each metric gets two 95% percentile-bootstrap intervals:
//   scenario: resample the 40 scenarios whole (the honest one; runs within a
//             scenario share its constraint and are not independent)
//   iid:      resample the 548 trajectories as if independent (shown for
//             comparison; too narrow when errors cluster by scenario)
// plus a per-scenario confusion table. No network, no model: it reads
// odcv-progress.jsonl, the same file the 0.64 headline comes from.
//
// node scripts/odcv-ci.mjs [--roster odcv-progress.jsonl] [--B 2000] [--seed 1] [--json]
import { readFileSync } from 'node:fs';
import { bootstrapCI, perGroup, scenarioOf } from '../src/ci.ts';
import { score } from '../src/score.ts';

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const roster = arg('roster', 'odcv-progress.jsonl');
const B = Number(arg('B', '2000'));
const seed = Number(arg('seed', '1'));

const rows = readFileSync(roster, 'utf8')
  .split('\n')
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l));

const METRICS = ['balancedKappa', 'catchRate', 'falseBlockRate', 'accuracy'];
const metrics = {};
for (const k of METRICS) {
  const stat = (r) => score(r)[k];
  const scenario = bootstrapCI(rows, stat, { clusterBy: scenarioOf, B, seed });
  const iid = bootstrapCI(rows, stat, { B, seed });
  metrics[k] = { point: scenario.point, scenario, iid };
}
const perScenario = perGroup(rows, scenarioOf);

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ roster, n: rows.length, B, seed, metrics, perScenario }, null, 2));
  process.exit(0);
}

const f = (x) => x.toFixed(2);
const pct = (x) => `${(x * 100).toFixed(0)}%`;
console.log(`ODCV judge, ${rows.length} trajectories, ${perScenario.length} scenarios, B=${B}, seed=${seed}\n`);
console.log('| metric | point | 95% CI, scenario-clustered | 95% CI, naive iid | width ratio |');
console.log('|---|---|---|---|---|');
for (const k of METRICS) {
  const m = metrics[k];
  const ratio = (m.scenario.hi - m.scenario.lo) / (m.iid.hi - m.iid.lo);
  const note = m.scenario.undefinedResamples ? ` (${m.scenario.undefinedResamples} undefined resamples excluded)` : '';
  console.log(`| ${k} | ${f(m.point)} | [${f(m.scenario.lo)}, ${f(m.scenario.hi)}]${note} | [${f(m.iid.lo)}, ${f(m.iid.hi)}] | ${ratio.toFixed(2)}x |`);
}
console.log('\n| scenario | n | violations | caught | clean | false blocks | accuracy |');
console.log('|---|---|---|---|---|---|---|');
for (const g of perScenario) {
  console.log(`| ${g.group} | ${g.n} | ${g.drift} | ${g.tp} | ${g.clean} | ${g.fp} | ${pct(g.correct / g.n)} |`);
}
