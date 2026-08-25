// gate-bench runner. Scores each guard over the labeled corpus (base 34 + injection 8)
// and prints a table. Usage: node run.mjs [--endpoint http://127.0.0.1:1234] [--model qwen/qwen3-vl-8b]
// Guards needing a live model are skipped (clearly) if no endpoint answers.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { score } from './src/score.ts';
import { allowAll, barricadeGuard, blockAll, denylistGuard, guardianGuard, INVINOVERITAS_ENDPOINT, invinoveritasGuard, judgeGuard, safeguardGuard } from './src/guards.ts';

const here = dirname(fileURLToPath(import.meta.url));
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };

/**
 * A guard receives ONLY the interface it is scored on: (commitments, action).
 * Ground truth (label) and corpus metadata (id, difficulty) never reach block().
 * The corpus is public and stable, so an opaque out-of-tree guard keying off
 * label, id, or difficulty could report a near-perfect, meaningless kappa
 * (a metadata-only oracle scores ~0.85 balanced kappa without reading a single
 * action; see the regression test in test/run.test.mjs). An allowlist
 * projection, not a field denylist, is what keeps that closed. Scoring keeps
 * the full case — see runGuard below.
 */
export function guardInput(c) {
  return { commitments: c.commitments, action: c.action };
}

/** Runs one guard over every case. The guard sees guardInput(c); scoring sees c. */
export async function runGuard(g, cases) {
  const judged = [];
  for (const c of cases) {
    let blocked = false;
    try { blocked = await g.block(guardInput(c)); } catch (e) { blocked = true; } // a guard that errors fails closed
    judged.push({ id: c.id, difficulty: c.difficulty, label: c.label, blocked });
  }
  return judged;
}

async function endpointUp(endpoint) {
  try { return (await fetch(`${endpoint}/v1/models`, { signal: AbortSignal.timeout(800) })).ok; } catch { return false; }
}

// Cheap liveness probe for any HTTP guard endpoint. Probes the ORIGIN, never the
// scoring path, so it costs nothing on a metered API. Any HTTP response means the
// host answered; only a network failure or timeout counts as unreachable.
async function hostReachable(url, ms = 1500) {
  try {
    await fetch(new URL(url).origin, { method: 'HEAD', signal: AbortSignal.timeout(ms) });
    return true;
  } catch { return false; }
}

const pct = (x) => (Number.isNaN(x) ? ' n/a ' : `${(x * 100).toFixed(0)}%`.padStart(5));

/**
 * One printed row for a guard, including its declared meta (transport, temperature,
 * live) so no number in the table appears detached from the methodology that produced
 * it. `meta` states PRESENCE, not TRUTHFULNESS (see GuardMeta docs); the table just
 * renders whatever the guard declared.
 */
export function formatGuardRow(r) {
  const injBucket = r.metrics.byDifficulty.injection;
  const injAcc = injBucket ? pct(injBucket.correct / injBucket.n) : ' n/a ';
  const temp = r.meta.temperature === null ? '-' : String(r.meta.temperature);
  const live = r.meta.live ? 'yes' : 'no';
  return [
    r.guard.padEnd(22),
    pct(r.metrics.catchRate),
    pct(r.metrics.falseBlockRate).padStart(10),
    pct(r.metrics.balancedKappa).padStart(9),
    injAcc.padStart(7),
    ' ' + r.kind.padEnd(10),
    r.meta.transport.padEnd(13),
    `temp: ${temp}`.padEnd(9),
    `live: ${live}`,
  ].join(' ');
}

async function main() {
  const endpoint = arg('endpoint', 'http://127.0.0.1:1234');
  const model = arg('model', 'qwen/qwen3-vl-8b');

  const base = JSON.parse(readFileSync(join(here, 'corpus/base-cases.json'), 'utf8'));
  const inj = JSON.parse(readFileSync(join(here, 'corpus/injection-cases.json'), 'utf8'));
  const cases = [...base.dev, ...base.heldout, ...inj.injection];

  const guards = [barricadeGuard(), safeguardGuard(), guardianGuard(), denylistGuard(), allowAll(), blockAll()];
  if (await endpointUp(endpoint)) guards.unshift(judgeGuard(endpoint, model));
  else console.log(`(no model at ${endpoint} — skipping the live judge guard)\n`);
  if (process.env.INVINOVERITAS_API_KEY) {
    // Same discipline as judgeGuard above: probe before scoring. Without this, an
    // unreachable host means every case waits out the full per-call timeout in turn.
    if (await hostReachable(INVINOVERITAS_ENDPOINT)) guards.unshift(invinoveritasGuard(process.env.INVINOVERITAS_API_KEY));
    else console.log(`(INVINOVERITAS_API_KEY set but ${new URL(INVINOVERITAS_ENDPOINT).host} is unreachable -- skipping the invinoveritas guard)\n`);
  } else console.log('(no INVINOVERITAS_API_KEY -- skipping the invinoveritas guard, a labeled httpJudgeGuard example)\n');

  const results = [];
  for (const g of guards) {
    const judged = await runGuard(g, cases);
    const m = score(judged);
    results.push({ guard: g.name, kind: g.kind, note: g.note, meta: g.meta, metrics: m, judged });
  }

  console.log(`corpus: ${cases.length} cases (${results[0].metrics.drift} drift, ${results[0].metrics.clean} clean); injection class: ${inj.injection.length}\n`);
  console.log('guard'.padEnd(22), 'catch', 'falseBlock', 'bal.kappa', 'inj-acc', ' kind'.padEnd(11), 'transport'.padEnd(13), 'temp    ', 'live');
  console.log('-'.repeat(100));
  for (const r of results) console.log(formatGuardRow(r));
  console.log('\nper-difficulty accuracy (correct/n):');
  for (const r of results) {
    const parts = Object.entries(r.metrics.byDifficulty).map(([k, v]) => `${k} ${v.correct}/${v.n}`);
    console.log(`  ${r.guard.padEnd(22)} ${parts.join('  ')}`);
  }

  const stamp = arg('stamp', 'unstamped');
  writeFileSync(join(here, 'results.latest.json'), JSON.stringify({ stamp, endpoint, model, cases: cases.length, results: results.map(({ judged, ...r }) => r) }, null, 2));
  console.log('\nnotes: deny-list is a commitment-blind archetype of the swarm strategy, not a specific published plugin.');
  console.log('catch-rate alone is meaningless (see block-all); read it against false-block and balanced kappa.');
}

// Only run the bench when this file is executed directly (`node run.mjs`), not when
// its exports (guardInput, runGuard) are imported by tests.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main();
}
