// Confusion-matrix / rate reporting used by RESULTS.md's "how to read these numbers"
// section. Two proof obligations: the arithmetic is right on a tiny known fixture,
// and it reproduces the canonical ODCV confusion matrix (TP=121 FN=41 FP=35 TN=351)
// straight from the real odcv-progress.jsonl, not a copy of the numbers.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  buildMarkdown,
  confusionFromRates,
  confusionFromRows,
  loadOdcvConfusion,
  metricsFromConfusion,
} from '../scripts/metrics-table.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');

describe('metricsFromConfusion (tiny fixture)', () => {
  it('computes sensitivity, specificity, FAR, precision, NPV, prevalence from TP/FN/FP/TN', () => {
    // 8 true positives, 2 false negatives, 1 false positive, 9 true negatives.
    const m = metricsFromConfusion({ tp: 8, fn: 2, fp: 1, tn: 9 });
    expect(m.n).toBe(20);
    expect(m.sensitivity).toBeCloseTo(0.8); // 8 / (8 + 2)
    expect(m.specificity).toBeCloseTo(0.9); // 9 / (9 + 1)
    expect(m.far).toBeCloseTo(0.1); // 1 / (1 + 9), FAR = 1 - specificity
    expect(m.precision).toBeCloseTo(8 / 9); // 8 / (8 + 1)
    expect(m.npv).toBeCloseTo(9 / 11); // 9 / (9 + 2)
    expect(m.prevalence).toBeCloseTo(0.5); // (8 + 2) / 20
  });

  it('an empty matrix reports NaN rates, not a divide-by-zero crash', () => {
    const m = metricsFromConfusion({ tp: 0, fn: 0, fp: 0, tn: 0 });
    expect(m.n).toBe(0);
    expect(Number.isNaN(m.sensitivity)).toBe(true);
    expect(Number.isNaN(m.precision)).toBe(true);
  });
});

describe('confusionFromRates (recovers integer counts from results.latest.json-shaped rates)', () => {
  it('round-trips a tiny fixture: 22 drift cases at catchRate 0.409090909... -> TP 9, FN 13', () => {
    const conf = confusionFromRates({ drift: 22, clean: 20, catchRate: 9 / 22, falseBlockRate: 1 / 20 });
    expect(conf).toEqual({ tp: 9, fn: 13, fp: 1, tn: 19 });
  });

  it('a guard with zero drift cases (NaN catchRate) recovers TP 0 without crashing', () => {
    const conf = confusionFromRates({ drift: 0, clean: 5, catchRate: Number.NaN, falseBlockRate: 0.2 });
    expect(conf).toEqual({ tp: 0, fn: 0, fp: 1, tn: 4 });
  });
});

describe('confusionFromRows + loadOdcvConfusion (real ODCV totals, not a copy)', () => {
  it('confusionFromRows counts a small labeled set correctly', () => {
    const rows = [
      { label: 'drift', blocked: true }, // TP
      { label: 'drift', blocked: false }, // FN
      { label: 'clean', blocked: true }, // FP
      { label: 'clean', blocked: false }, // TN
      { label: 'clean', blocked: false }, // TN
    ];
    expect(confusionFromRows(rows)).toEqual({ tp: 1, fn: 1, fp: 1, tn: 2 });
  });

  it('loadOdcvConfusion on the real odcv-progress.jsonl reproduces the canonical matrix', () => {
    const conf = loadOdcvConfusion(join(repoRoot, 'odcv-progress.jsonl'));
    expect(conf).toEqual({ tp: 121, fn: 41, fp: 35, tn: 351 });
  });
});

describe('buildMarkdown', () => {
  it('renders both tables with the per-guard confusion counts and the ODCV precision/NPV/prevalence columns', () => {
    const authored = {
      results: [
        { guard: 'denylist-archetype', metrics: { drift: 22, clean: 20, catchRate: 9 / 22, falseBlockRate: 1 / 20 } },
      ],
    };
    const odcv = metricsFromConfusion({ tp: 121, fn: 41, fp: 35, tn: 351 });
    const md = buildMarkdown({ authored, odcv });
    expect(md).toContain('denylist-archetype');
    expect(md).toContain('| denylist-archetype | 9 | 13 | 1 | 19 |');
    expect(md).toContain('precision');
    expect(md).toContain('NPV');
    expect(md).toContain('prevalence');
    expect(md).toContain('121');
    expect(md).toContain('351');
  });
});
