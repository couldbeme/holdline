/**
 * Bootstrap confidence intervals for guard metrics.
 *
 * Trajectories from the same scenario are not independent: one scenario's
 * constraint is either easy or hard for the guard across every agent run.
 * Resampling trajectories as if independent then gives intervals that are too
 * narrow. With `clusterBy`, whole clusters (scenarios) are resampled instead.
 * Without it, each row is its own cluster (the naive bootstrap), kept for
 * comparison.
 *
 * Seeded and deterministic: same rows, statistic, B and seed give the same interval.
 * No dependency: a cluster bootstrap with a seeded PRNG is ~40 lines, and no
 * maintained JS package does it with a seed.
 */
import type { Judged } from './score.js';

export interface CI {
  point: number; // statistic on the full sample
  lo: number;
  hi: number;
  B: number;
  clusters: number;
  undefinedResamples: number; // resamples where the statistic was NaN, excluded
}

export interface CIOptions {
  clusterBy?: (id: string) => string;
  B?: number;
  seed?: number;
  alpha?: number;
}

/** Scenario name: ODCV ids are `<scenario>::<agent>-<framing>`. */
export const scenarioOf = (id: string): string => {
  const i = id.indexOf('::');
  return i === -1 ? id : id.slice(0, i);
};

// mulberry32: small, seedable, good enough for resampling indices.
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const quantile = (sorted: number[], q: number): number => {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = sorted[lo]!;
  return a + (sorted[hi]! - a) * (pos - lo);
};

export function bootstrapCI(rows: Judged[], stat: (rows: Judged[]) => number, opts: CIOptions = {}): CI {
  const { clusterBy, B = 2000, seed = 1, alpha = 0.05 } = opts;
  const groups = new Map<string, Judged[]>();
  rows.forEach((r, i) => {
    const key = clusterBy ? clusterBy(r.id) : String(i);
    const g = groups.get(key);
    if (g) g.push(r);
    else groups.set(key, [r]);
  });
  const clusters = [...groups.values()];
  const next = rng(seed);
  const stats: number[] = [];
  let undefinedResamples = 0;
  for (let b = 0; b < B; b++) {
    const sample: Judged[] = [];
    for (let k = 0; k < clusters.length; k++) sample.push(...clusters[Math.floor(next() * clusters.length)]!);
    const s = stat(sample);
    if (Number.isNaN(s)) undefinedResamples++;
    else stats.push(s);
  }
  stats.sort((x, y) => x - y);
  return {
    point: stat(rows),
    lo: stats.length ? quantile(stats, alpha / 2) : Number.NaN,
    hi: stats.length ? quantile(stats, 1 - alpha / 2) : Number.NaN,
    B,
    clusters: clusters.length,
    undefinedResamples,
  };
}

export interface GroupRow {
  group: string;
  n: number;
  drift: number;
  clean: number;
  tp: number; // drift blocked
  fp: number; // clean blocked
  correct: number;
}

/** Confusion counts per group (e.g. per scenario), sorted by group name. */
export function perGroup(rows: Judged[], groupBy: (id: string) => string): GroupRow[] {
  const out = new Map<string, GroupRow>();
  for (const r of rows) {
    const key = groupBy(r.id);
    let g = out.get(key);
    if (!g) {
      g = { group: key, n: 0, drift: 0, clean: 0, tp: 0, fp: 0, correct: 0 };
      out.set(key, g);
    }
    const drift = r.label === 'drift';
    g.n++;
    if (drift) g.drift++;
    else g.clean++;
    if (drift && r.blocked) g.tp++;
    if (!drift && r.blocked) g.fp++;
    if (drift === r.blocked) g.correct++;
  }
  return [...out.values()].sort((a, b) => a.group.localeCompare(b.group));
}
