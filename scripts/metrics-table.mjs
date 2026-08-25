// Confusion-matrix and derived-rate reporting for RESULTS.md's "how to read these
// numbers" section. Zero deps. Reads results.latest.json (authored corpus, per-guard
// aggregate rates) and odcv-progress.jsonl (548 labeled ODCV-Bench judge rows) and
// prints one markdown block combining both. Regenerate with `node scripts/metrics-table.mjs`.
//
// Positive class = drift; positive call = block (matches src/score.ts and RESULTS.md).
// sensitivity = catchRate, specificity = 1 - falseBlockRate, FAR = falseBlockRate.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const pct = (x) => (Number.isFinite(x) ? `${(x * 100).toFixed(0)}%` : 'n/a');

/**
 * Recovers integer TP/FN/FP/TN from a guard's aggregate rates. results.latest.json
 * stores only the derived rates (run.mjs strips the per-case judged rows before
 * writing), so the counts are reconstructed from catchRate * drift and
 * falseBlockRate * clean, which score.ts computed as an exact fraction of an
 * integer count. Math.round removes float noise only, never a real ambiguity.
 */
export function confusionFromRates({ drift, clean, catchRate, falseBlockRate }) {
  const tp = Number.isFinite(catchRate) ? Math.round(catchRate * drift) : 0;
  const fp = Number.isFinite(falseBlockRate) ? Math.round(falseBlockRate * clean) : 0;
  return { tp, fn: drift - tp, fp, tn: clean - fp };
}

/** Confusion matrix straight from labeled rows: {label: 'drift'|'clean', blocked: boolean}. */
export function confusionFromRows(rows) {
  let tp = 0;
  let fn = 0;
  let fp = 0;
  let tn = 0;
  for (const r of rows) {
    const drift = r.label === 'drift';
    if (drift && r.blocked) tp++;
    else if (drift && !r.blocked) fn++;
    else if (!drift && r.blocked) fp++;
    else tn++;
  }
  return { tp, fn, fp, tn };
}

/** Loads and parses odcv-progress.jsonl into a confusion matrix. Real data, no cached copy. */
export function loadOdcvConfusion(path = join(root, 'odcv-progress.jsonl')) {
  const rows = readFileSync(path, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  return confusionFromRows(rows);
}

export function loadAuthoredResults(path = join(root, 'results.latest.json')) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * Rates derived from one confusion matrix. precision/NPV/prevalence only carry
 * meaning where the positive base rate reflects the real world (ODCV); the
 * authored corpus is hand-balanced by construction, so its table omits them.
 */
export function metricsFromConfusion({ tp, fn, fp, tn }) {
  const n = tp + fn + fp + tn;
  const positives = tp + fn;
  const negatives = fp + tn;
  const predictedPositive = tp + fp;
  const predictedNegative = fn + tn;
  return {
    n,
    tp,
    fn,
    fp,
    tn,
    sensitivity: positives ? tp / positives : Number.NaN,
    specificity: negatives ? tn / negatives : Number.NaN,
    far: negatives ? fp / negatives : Number.NaN,
    precision: predictedPositive ? tp / predictedPositive : Number.NaN,
    npv: predictedNegative ? tn / predictedNegative : Number.NaN,
    prevalence: n ? positives / n : Number.NaN,
  };
}

const row = (cells) => `| ${cells.join(' | ')} |`;
const divider = (n) => row(Array.from({ length: n }, () => '---'));

export function buildMarkdown({ authored, odcv }) {
  const lines = [];
  lines.push('### Authored corpus (results.latest.json)');
  lines.push('');
  lines.push(row(['guard', 'TP', 'FN', 'FP', 'TN', 'sensitivity', 'specificity', 'FAR']));
  lines.push(divider(8));
  for (const r of authored.results) {
    const conf = confusionFromRates(r.metrics);
    const m = metricsFromConfusion(conf);
    lines.push(row([r.guard, m.tp, m.fn, m.fp, m.tn, pct(m.sensitivity), pct(m.specificity), pct(m.far)]));
  }
  lines.push('');
  lines.push(`### ODCV-Bench, ${odcv.n} trajectories (odcv-progress.jsonl, judge only)`);
  lines.push('');
  lines.push(row(['n', 'TP', 'FN', 'FP', 'TN', 'sensitivity', 'specificity', 'FAR', 'precision', 'NPV', 'prevalence']));
  lines.push(divider(11));
  lines.push(
    row([
      odcv.n,
      odcv.tp,
      odcv.fn,
      odcv.fp,
      odcv.tn,
      pct(odcv.sensitivity),
      pct(odcv.specificity),
      pct(odcv.far),
      pct(odcv.precision),
      pct(odcv.npv),
      pct(odcv.prevalence),
    ]),
  );
  return lines.join('\n');
}

function main() {
  const authored = loadAuthoredResults();
  const odcv = metricsFromConfusion(loadOdcvConfusion());
  console.log(buildMarkdown({ authored, odcv }));
}

// Only run when executed directly (`node scripts/metrics-table.mjs`), not when its
// exports are imported by tests. Same pattern as run.mjs.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
