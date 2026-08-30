// gate-bench runner. Scores each guard over the labeled corpus (base 34 + injection 8)
// and prints a table. Usage: node run.mjs [--endpoint http://127.0.0.1:1234] [--model qwen/qwen3-vl-8b] [--runs N]
// Guards needing a live model are skipped (clearly) if no endpoint answers.
// --runs N (default 1, suggest 5 for live guards): repeats the corpus N times for any
// guard whose meta.live is true and reports a mean/min-max variance band per metric.
// Deterministic guards (meta.live=false) always run once; a repeated run of a pure
// function is identical, so a band would misreport certainty as noise.
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

/**
 * Runs one guard over every case. The guard sees guardInput(c); scoring sees c.
 * `opts.timingSink`, if provided, gets one wall-clock duration (ms) pushed per case,
 * measured with `opts.clock` (defaults to Date.now, injectable for tests).
 * `opts.errorSink`, if provided, gets one boolean pushed per case: whether that call
 * threw. All opts are opt-in and side-effect-only: a plain two-arg call, the
 * pre-existing contract used by examples/score-your-guard.mjs, is completely
 * unaffected, and its `score(await runGuard(...))` still works unchanged because the
 * return value is still exactly the judged array -- `errors` and `errorRate` are
 * attached as extra own properties on that same array, not a wrapper around it.
 *
 * `errors`/`errorRate` exist because fail-closed alone makes a dead transport
 * indistinguishable from a working judge in the score: a guard whose block() throws on
 * every case (e.g. every call 402s) scores identically to one that genuinely catches
 * everything. A contributor's live run hit exactly this. Counting exceptions is what
 * lets the table tell the two apart.
 */
export async function runGuard(g, cases, opts = {}) {
  const { timingSink, clock = Date.now, errorSink } = opts;
  const judged = [];
  let errors = 0;
  for (const c of cases) {
    const start = clock();
    let blocked = false;
    let errored = false;
    try { blocked = await g.block(guardInput(c)); } catch (e) { blocked = true; errored = true; errors++; } // a guard that errors fails closed
    finally {
      timingSink?.push(clock() - start);
      errorSink?.push(errored);
    }
    judged.push({ id: c.id, difficulty: c.difficulty, label: c.label, blocked });
  }
  judged.errors = errors;
  judged.errorRate = cases.length ? errors / cases.length : 0;
  return judged;
}

/** Median of a list of numbers. Empty input is NaN, not a crash. */
export function median(values) {
  if (!values.length) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Cost/latency summary for a guard's measured per-case timings. Reported only for
 * transports that leave the process (http, local-model): an in-process guard's
 * wall-clock time is not a meaningful cost figure, it is not what the judge's
 * accuracy advantage is being weighed against.
 */
export function timingSummary(guard, msValues) {
  const remote = guard.meta.transport === 'http' || guard.meta.transport === 'local-model';
  return { medianMs: remote ? median(msValues) : null, calls: remote ? msValues.length : null };
}

/**
 * How many times to actually run a guard, given the requested --runs count.
 * Deterministic guards (meta.live=false) always run exactly once: repeated calls to a
 * pure function return identical scores, so a variance band would misreport certainty
 * as noise. Only live guards (meta.live=true) get the requested multi-run treatment.
 */
export function runsPlan(guard, requestedRuns) {
  if (!guard.meta.live) {
    return {
      runs: 1,
      reason: requestedRuns > 1 ? 'deterministic guard (meta.live=false): repeat runs are identical, ran once' : null,
    };
  }
  return { runs: Math.max(1, requestedRuns), reason: null };
}

const injectionAccuracy = (m) => {
  const b = m.byDifficulty.injection;
  return b ? b.correct / b.n : Number.NaN;
};

function band(values) {
  const finite = values.filter((v) => Number.isFinite(v));
  if (!finite.length) return null;
  const mean = finite.reduce((a, v) => a + v, 0) / finite.length;
  return { mean, min: Math.min(...finite), max: Math.max(...finite) };
}

/** Per-metric mean/min/max across >=2 runs. A single run has nothing to compare against. */
export function bandsFrom(perRunMetrics) {
  if (perRunMetrics.length < 2) return null;
  return {
    catchRate: band(perRunMetrics.map((m) => m.catchRate)),
    falseBlockRate: band(perRunMetrics.map((m) => m.falseBlockRate)),
    balancedKappa: band(perRunMetrics.map((m) => m.balancedKappa)),
    injection: band(perRunMetrics.map(injectionAccuracy)),
  };
}

/**
 * Runs a guard `runs` times over the corpus. The first run's own metrics and judged
 * rows are what the headline row and results.latest.json report (unchanged shape from
 * a single run); `bands` is the mean/min-max spread across all runs, null when runs=1.
 * Per-case timings are pooled across every run (not just the first) into one sample
 * before the median is taken, and `calls` counts every one of them: more runs is a
 * bigger, more honest timing sample, not a discarded one. `clock` is injectable so
 * tests never depend on real wall-clock time.
 *
 * `errors` pools the error count across every run the same way timing is pooled:
 * `{ count, total }` over every call made, not just the first run. A run in which
 * EVERY case errored (a dead transport for that run, not a judgment) is excluded from
 * `bandsFrom` entirely -- its 100% fail-closed "verdicts" are not judging anything, and
 * folding them into the mean/min-max would either hide a dead run behind a wide band or,
 * worse, make it look like real disagreement. If fewer than 2 runs remain valid after
 * that exclusion, `bandsFrom` already returns null (same rule a single run gets: nothing
 * to compare against).
 */
export async function runGuardMulti(g, cases, runs, clock = Date.now) {
  const perRun = [];
  const perRunErrorRate = [];
  let firstJudged = null;
  const timingSink = [];
  const errorSink = [];
  let totalErrors = 0;
  for (let i = 0; i < runs; i++) {
    const judged = await runGuard(g, cases, { timingSink, clock, errorSink });
    if (i === 0) firstJudged = judged;
    perRun.push(score(judged));
    perRunErrorRate.push(judged.errorRate);
    totalErrors += judged.errors;
  }
  const validRuns = perRun.filter((_, i) => perRunErrorRate[i] < 1);
  return {
    runs: perRun.length,
    first: perRun[0],
    judged: firstJudged,
    bands: bandsFrom(validRuns),
    timing: timingSummary(g, timingSink),
    errors: { count: totalErrors, total: cases.length * runs },
  };
}

/** One printed line for a live guard's variance band, mean with [min-max] per tracked metric. */
export function formatBandsLine(guardName, bands) {
  const fmt = (b) => (b ? `${pct(b.mean).trim()} [${pct(b.min).trim()}-${pct(b.max).trim()}]` : 'n/a');
  return `  ${guardName.padEnd(22)} catch ${fmt(bands.catchRate)}   falseBlock ${fmt(bands.falseBlockRate)}   kappa ${fmt(bands.balancedKappa)}   injection ${fmt(bands.injection)}`;
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
 * renders whatever the guard declared. `r.timing` (median-ms, calls) is optional: a
 * dash means no measurement was taken (typically an in-process guard, see
 * timingSummary), not a zero-cost claim.
 *
 * `r.errors` (`{ count, total }`, optional) renders the same way: a dash for zero
 * errors or for no error data at all (older row shape), `N/total` for a partial count.
 * A row where every single call errored (`count === total > 0`) gets an explicit
 * `INVALID: errored on every case` marker appended, because a dead transport that
 * fails closed on every call scores identical to a genuinely strict guard -- catch-rate
 * and kappa alone cannot tell the two apart, only the error count can.
 */
export function formatGuardRow(r) {
  const injBucket = r.metrics.byDifficulty.injection;
  const injAcc = injBucket ? pct(injBucket.correct / injBucket.n) : ' n/a ';
  const temp = r.meta.temperature === null ? '-' : String(r.meta.temperature);
  const live = r.meta.live ? 'yes' : 'no';
  const medianMs = r.timing?.medianMs != null ? `${Math.round(r.timing.medianMs)}ms` : '-';
  const calls = r.timing?.calls != null ? String(r.timing.calls) : '-';
  const errCount = r.errors?.count;
  const errTotal = r.errors?.total;
  const errorsCell = !errCount ? '-' : `${errCount}/${errTotal}`;
  const invalid = Boolean(errTotal) && errCount === errTotal;
  const row = [
    r.guard.padEnd(22),
    pct(r.metrics.catchRate),
    pct(r.metrics.falseBlockRate).padStart(10),
    pct(r.metrics.balancedKappa).padStart(9),
    injAcc.padStart(7),
    ' ' + r.kind.padEnd(10),
    r.meta.transport.padEnd(13),
    `temp: ${temp}`.padEnd(9),
    `live: ${live}`.padEnd(10),
    `median: ${medianMs}`.padEnd(14),
    `calls: ${calls}`.padEnd(11),
    `errors: ${errorsCell}`,
  ].join(' ');
  return invalid ? `${row}  INVALID: errored on every case` : row;
}

async function main() {
  const endpoint = arg('endpoint', 'http://127.0.0.1:1234');
  const model = arg('model', 'qwen/qwen3-vl-8b');
  const requestedRuns = Number(arg('runs', '1'));

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
    const plan = runsPlan(g, requestedRuns);
    if (plan.reason) console.log(`(${g.name}: ${plan.reason})`);
    const multi = await runGuardMulti(g, cases, plan.runs);
    results.push({ guard: g.name, kind: g.kind, note: g.note, meta: g.meta, metrics: multi.first, bands: multi.bands, timing: multi.timing, errors: multi.errors, judged: multi.judged });
  }

  console.log(`corpus: ${cases.length} cases (${results[0].metrics.drift} drift, ${results[0].metrics.clean} clean); injection class: ${inj.injection.length}\n`);
  console.log(
    'guard'.padEnd(22), 'catch', 'falseBlock', 'bal.kappa', 'inj-acc', ' kind'.padEnd(11), 'transport'.padEnd(13),
    'temp    ', 'live      ', 'median-ms     ', 'calls      ', 'errors',
  );
  console.log('-'.repeat(140));
  for (const r of results) console.log(formatGuardRow(r));
  console.log('\nper-difficulty accuracy (correct/n):');
  for (const r of results) {
    const parts = Object.entries(r.metrics.byDifficulty).map(([k, v]) => `${k} ${v.correct}/${v.n}`);
    console.log(`  ${r.guard.padEnd(22)} ${parts.join('  ')}`);
  }

  const withBands = results.filter((r) => r.bands);
  console.log(`\nrun-to-run variance (--runs ${requestedRuns}, live guards only; mean [min-max]):`);
  if (withBands.length) {
    for (const r of withBands) console.log(formatBandsLine(r.guard, r.bands));
  } else {
    console.log('  (no live guard ran more than once; pass --runs N with a live guard up to see bands)');
  }

  const stamp = arg('stamp', 'unstamped');
  writeFileSync(
    join(here, 'results.latest.json'),
    JSON.stringify({ stamp, endpoint, model, runs: requestedRuns, cases: cases.length, results: results.map(({ judged, ...r }) => r) }, null, 2),
  );
  console.log('\nnotes: deny-list is a commitment-blind archetype of the swarm strategy, not a specific published plugin.');
  console.log('catch-rate alone is meaningless (see block-all); read it against false-block and balanced kappa.');
}

// Only run the bench when this file is executed directly (`node run.mjs`), not when
// its exports (guardInput, runGuard) are imported by tests.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main();
}
