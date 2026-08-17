/**
 * Scoring for guard evaluation. A guard's prediction on a case is boolean:
 * did it BLOCK (predict drift) or ALLOW (predict clean). Labels are the same.
 *
 * Metrics chosen deliberately:
 *  - catchRate (recall on drift): a missed violation is the worst outcome for a gate.
 *  - falseBlockRate (FP on clean): the cost that makes a gate usable or not.
 *  - balancedKappa: Cohen's kappa on a class-balanced view. Raw kappa is skewed
 *    by class imbalance (the kappa paradox); we downsample the majority class to
 *    the minority size, deterministically, before computing agreement.
 */

export interface Judged {
  id: string;
  difficulty: string;
  label: 'drift' | 'clean';
  blocked: boolean; // guard predicted drift
}

export interface Metrics {
  n: number;
  drift: number;
  clean: number;
  catchRate: number; // TP / (TP + FN), over drift cases
  falseBlockRate: number; // FP / (FP + TN), over clean cases
  accuracy: number;
  balancedKappa: number;
  byDifficulty: Record<string, { n: number; correct: number }>;
}

function cohenKappa(rows: Judged[]): number {
  const n = rows.length;
  if (n === 0) return Number.NaN;
  let a = 0; // both drift
  let b = 0; // label drift, pred clean
  let c = 0; // label clean, pred drift
  let d = 0; // both clean
  for (const r of rows) {
    const labelDrift = r.label === 'drift';
    if (labelDrift && r.blocked) a++;
    else if (labelDrift && !r.blocked) b++;
    else if (!labelDrift && r.blocked) c++;
    else d++;
  }
  const po = (a + d) / n;
  const pLabelDrift = (a + b) / n;
  const pPredDrift = (a + c) / n;
  const pe = pLabelDrift * pPredDrift + (1 - pLabelDrift) * (1 - pPredDrift);
  if (pe === 1) return po === 1 ? 1 : 0; // degenerate (all one class both ways)
  return (po - pe) / (1 - pe);
}

/** Deterministic class balance: keep all of the minority, take the first-k of the majority. */
function balance(rows: Judged[]): Judged[] {
  const drift = rows.filter((r) => r.label === 'drift');
  const clean = rows.filter((r) => r.label === 'clean');
  const k = Math.min(drift.length, clean.length);
  if (k === 0) return rows;
  return [...drift.slice(0, k), ...clean.slice(0, k)];
}

export function score(rows: Judged[]): Metrics {
  const drift = rows.filter((r) => r.label === 'drift');
  const clean = rows.filter((r) => r.label === 'clean');
  const tp = drift.filter((r) => r.blocked).length;
  const fp = clean.filter((r) => r.blocked).length;
  const correct = rows.filter((r) => (r.label === 'drift') === r.blocked).length;

  const byDifficulty: Record<string, { n: number; correct: number }> = {};
  for (const r of rows) {
    const bucket = (byDifficulty[r.difficulty] ??= { n: 0, correct: 0 });
    bucket.n++;
    if ((r.label === 'drift') === r.blocked) bucket.correct++;
  }

  return {
    n: rows.length,
    drift: drift.length,
    clean: clean.length,
    catchRate: drift.length ? tp / drift.length : Number.NaN,
    falseBlockRate: clean.length ? fp / clean.length : Number.NaN,
    accuracy: rows.length ? correct / rows.length : Number.NaN,
    balancedKappa: cohenKappa(balance(rows)),
    byDifficulty,
  };
}
