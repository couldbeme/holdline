import { describe, expect, it } from 'vitest';
import { bootstrapCI, perGroup, scenarioOf } from '../src/ci.js';
import { type Judged, score } from '../src/score.js';

const kappa = (rows: Judged[]) => score(rows).balancedKappa;

// A scenario where the guard is right on every trajectory, or wrong on every one.
const scenario = (name: string, right: boolean, n = 6): Judged[] =>
  Array.from({ length: n }, (_, i) => {
    const label = i % 2 === 0 ? 'drift' : 'clean';
    const blocked = right ? label === 'drift' : label !== 'drift';
    return { id: `${name}::agent-${i}`, difficulty: `agent-${i}`, label, blocked };
  });

describe('scenarioOf', () => {
  it('takes the part of the id before "::"', () => {
    expect(scenarioOf('Academic-Research-Integrity-Finding::gpt-5.1-chat-mandated')).toBe(
      'Academic-Research-Integrity-Finding',
    );
  });
  it('falls back to the whole id when there is no separator', () => {
    expect(scenarioOf('plain-id')).toBe('plain-id');
  });
});

describe('bootstrapCI', () => {
  // 20 scenarios, 14 fully right and 6 fully wrong: errors are perfectly clustered.
  const rows = [
    ...Array.from({ length: 14 }, (_, s) => scenario(`ok${s}`, true)).flat(),
    ...Array.from({ length: 6 }, (_, s) => scenario(`bad${s}`, false)).flat(),
  ];

  it('is deterministic for a fixed seed', () => {
    const a = bootstrapCI(rows, kappa, { clusterBy: scenarioOf, B: 300, seed: 7 });
    const b = bootstrapCI(rows, kappa, { clusterBy: scenarioOf, B: 300, seed: 7 });
    expect(a).toEqual(b);
  });

  it('reports the full-sample point estimate and an interval that brackets it', () => {
    const ci = bootstrapCI(rows, kappa, { clusterBy: scenarioOf, B: 500, seed: 1 });
    expect(ci.point).toBeCloseTo(kappa(rows), 12);
    expect(ci.lo).toBeLessThanOrEqual(ci.point);
    expect(ci.hi).toBeGreaterThanOrEqual(ci.point);
    expect(ci.clusters).toBe(20);
    expect(ci.B).toBe(500);
  });

  it('is wider when resampling whole scenarios than when resampling trajectories, if errors cluster', () => {
    const iid = bootstrapCI(rows, kappa, { B: 1000, seed: 3 });
    const clustered = bootstrapCI(rows, kappa, { clusterBy: scenarioOf, B: 1000, seed: 3 });
    expect(iid.clusters).toBe(rows.length);
    expect(clustered.hi - clustered.lo).toBeGreaterThan(1.5 * (iid.hi - iid.lo));
  });

  it('has zero width when every cluster is identical', () => {
    const same = Array.from({ length: 10 }, (_, s) => scenario(`s${s}`, true)).flat();
    const ci = bootstrapCI(same, kappa, { clusterBy: scenarioOf, B: 200, seed: 5 });
    expect(ci.lo).toBe(1);
    expect(ci.hi).toBe(1);
  });

  it('skips resamples where the statistic is undefined and counts them', () => {
    // One all-drift cluster and one all-clean cluster: a resample of only one kind
    // has no clean (or no drift) rows, so catch or false-block rate is NaN there.
    const lopsided: Judged[] = [
      { id: 'a::1', difficulty: 'x', label: 'drift', blocked: true },
      { id: 'b::1', difficulty: 'x', label: 'clean', blocked: false },
    ];
    const ci = bootstrapCI(lopsided, (r) => score(r).falseBlockRate, { clusterBy: scenarioOf, B: 400, seed: 2 });
    expect(ci.undefinedResamples).toBeGreaterThan(0);
    expect(ci.undefinedResamples).toBeLessThan(400);
    expect(Number.isNaN(ci.lo)).toBe(false);
  });
});

describe('perGroup', () => {
  it('splits rows by scenario with counts that sum to the total', () => {
    const rows = [...scenario('A', true, 4), ...scenario('B', false, 6)];
    const t = perGroup(rows, scenarioOf);
    expect(t.map((g) => g.group).sort()).toEqual(['A', 'B']);
    expect(t.reduce((s, g) => s + g.n, 0)).toBe(10);
    const a = t.find((g) => g.group === 'A');
    const b = t.find((g) => g.group === 'B');
    expect(a).toMatchObject({ n: 4, drift: 2, clean: 2, tp: 2, fp: 0, correct: 4 });
    expect(b).toMatchObject({ n: 6, drift: 3, clean: 3, tp: 0, fp: 3, correct: 0 });
  });
});
