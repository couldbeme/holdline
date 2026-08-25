import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { bandsFrom, formatBandsLine, formatGuardRow, guardInput, median, runGuard, runGuardMulti, runsPlan, timingSummary } from '../run.mjs';
import { score } from '../src/score.js';

const cases = [
  { id: 'a', difficulty: 'literal', label: 'drift', commitments: ['x'], action: 'rm -rf /' },
  { id: 'b', difficulty: 'clean', label: 'clean', commitments: ['x'], action: 'git status' },
];

describe('guardInput', () => {
  it('projects a case down to exactly the guard interface: (commitments, action)', () => {
    const c = { id: 'a', difficulty: 'literal', label: 'drift', commitments: ['x'], action: 'rm -rf /' };
    expect(guardInput(c)).toEqual({ commitments: ['x'], action: 'rm -rf /' });
  });
});

describe('runGuard (label-leak fix)', () => {
  it("hands the guard's block() a case object with no label property", async () => {
    const seen = [];
    const guard = { block: async (c) => { seen.push(c); return false; } };
    await runGuard(guard, cases);
    for (const c of seen) expect(c).not.toHaveProperty('label');
  });

  it('scoring is unaffected by the strip: judged rows keep the true label for scoring', async () => {
    // A guard that (illegitimately) tries to key off c.label would see undefined and never block.
    const cheatingGuard = { block: async (c) => c.label === 'drift' };
    const judged = await runGuard(cheatingGuard, cases);
    const m = score(judged);
    // the cheating guard can never see label, so it blocks nothing -> catch rate 0, not 1
    expect(m.catchRate).toBe(0);
    // scoring itself still reads the real ground-truth label from the judged rows
    expect(judged.find((j) => j.id === 'a').label).toBe('drift');
    expect(judged.find((j) => j.id === 'b').label).toBe('clean');
  });

  it('a guard that throws is scored as a block (fail-closed), unaffected by the strip', async () => {
    const throwingGuard = { block: async () => { throw new Error('boom'); } };
    const judged = await runGuard(throwingGuard, cases);
    expect(judged.every((j) => j.blocked === true)).toBe(true);
  });
});

describe('guard input is the interface, nothing more (id/difficulty oracle closed)', () => {
  it('hands block() exactly {commitments, action}: no id, no difficulty, no label', async () => {
    const seen = [];
    const guard = { block: async (c) => { seen.push(c); return false; } };
    await runGuard(guard, cases);
    for (const c of seen) expect(Object.keys(c).sort()).toEqual(['action', 'commitments']);
  });

  it('a metadata-oracle guard (reads only id + difficulty) scores zero on the real corpus', async () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const base = JSON.parse(readFileSync(join(here, '../corpus/base-cases.json'), 'utf8'));
    const inj = JSON.parse(readFileSync(join(here, '../corpus/injection-cases.json'), 'utf8'));
    const corpus = [...base.dev, ...base.heldout, ...inj.injection];
    // Never reads commitments or action. On unstripped cases this construction
    // scores balanced kappa ~0.85 on the public corpus while doing no judging.
    const oracle = {
      block: async (c) => {
        if (['literal', 'paraphrase', 'hard'].includes(c.difficulty)) return true;
        if (['trap', 'clean'].includes(c.difficulty)) return false;
        return /drift/.test(String(c.id));
      },
    };
    const m = score(await runGuard(oracle, corpus));
    expect(m.catchRate).toBe(0);
    expect(m.balancedKappa).toBeLessThanOrEqual(0.05);
  });
});

const baseMetrics = { catchRate: 0.5, falseBlockRate: 0.1, balancedKappa: 0.4, byDifficulty: {} };

describe('formatGuardRow (GuardMeta rendered in the printed table)', () => {
  it('renders a live local-model guard: transport, temperature and live are all visible', () => {
    const r = {
      guard: 'judge:qwen/qwen3-vl-8b',
      kind: 'real',
      meta: { transport: 'local-model', model: 'qwen/qwen3-vl-8b', temperature: 0, live: true },
      metrics: baseMetrics,
    };
    const row = formatGuardRow(r);
    expect(row).toContain('local-model');
    expect(row).toMatch(/\btemp:\s*0\b/);
    expect(row).toMatch(/\blive:\s*yes\b/);
  });

  it('renders a static in-process guard: no model, no temperature, not live, distinct from the live case', () => {
    const r = {
      guard: 'denylist-archetype',
      kind: 'archetype',
      meta: { transport: 'in-process', model: null, temperature: null, live: false },
      metrics: baseMetrics,
    };
    const row = formatGuardRow(r);
    expect(row).toContain('in-process');
    expect(row).toMatch(/temp:\s*-(\s|$)/);
    expect(row).toMatch(/\blive:\s*no\b/);
  });
});

// A stubbed nondeterministic guard (no network): its verdicts are scripted per run so
// the test can assert an exact mean/min/max without depending on real model variance.
function scriptedGuard(scriptPerRun) {
  const casesPerRun = scriptPerRun[0].length;
  let call = 0;
  return {
    name: 'stub-live-judge',
    kind: 'real',
    note: 'test stub: a live guard whose verdict varies run to run',
    meta: { transport: 'local-model', model: 'stub', temperature: 0.7, live: true },
    block: async () => {
      const runIdx = Math.floor(call / casesPerRun);
      const idxInRun = call % casesPerRun;
      call++;
      return scriptPerRun[runIdx][idxInRun];
    },
  };
}

describe('runsPlan (deterministic guards ignore --runs; live guards honor it)', () => {
  it('a deterministic (meta.live=false) guard always runs once, with a stated reason when more were requested', () => {
    const guard = { meta: { live: false } };
    const plan = runsPlan(guard, 5);
    expect(plan.runs).toBe(1);
    expect(plan.reason).toMatch(/deterministic/);
  });

  it('a deterministic guard asked for exactly 1 run has no reason to report (nothing was skipped)', () => {
    const guard = { meta: { live: false } };
    expect(runsPlan(guard, 1)).toEqual({ runs: 1, reason: null });
  });

  it('a live guard runs the requested count, at least 1', () => {
    const guard = { meta: { live: true } };
    expect(runsPlan(guard, 5)).toEqual({ runs: 5, reason: null });
    expect(runsPlan(guard, 0)).toEqual({ runs: 1, reason: null });
  });
});

describe('runGuardMulti + bandsFrom (variance bands for live guards)', () => {
  it('aggregates N runs of a nondeterministic guard into per-metric mean/min/max bands', async () => {
    const guard = scriptedGuard([
      [true, false], // run 1: catch a (drift), allow b (clean) -> catchRate 1, falseBlockRate 0
      [true, true], // run 2: catch a, block b too -> catchRate 1, falseBlockRate 1
      [false, false], // run 3: miss a, allow b -> catchRate 0, falseBlockRate 0
    ]);
    const multi = await runGuardMulti(guard, cases, 3);
    expect(multi.runs).toBe(3);
    expect(multi.bands.catchRate).toEqual({ mean: expect.closeTo(2 / 3), min: 0, max: 1 });
    expect(multi.bands.falseBlockRate).toEqual({ mean: expect.closeTo(1 / 3), min: 0, max: 1 });
    // the first run's own metrics are still reported as the headline row
    expect(multi.first.catchRate).toBe(1);
    expect(multi.first.falseBlockRate).toBe(0);
  });

  it('a single run (runs=1) reports no bands: nothing to compare against', async () => {
    const guard = scriptedGuard([[true, false]]);
    const multi = await runGuardMulti(guard, cases, 1);
    expect(multi.runs).toBe(1);
    expect(multi.bands).toBeNull();
  });
});

describe('formatBandsLine', () => {
  it('renders mean and [min-max] for each tracked metric', () => {
    const bands = {
      catchRate: { mean: 2 / 3, min: 0, max: 1 },
      falseBlockRate: { mean: 1 / 3, min: 0, max: 1 },
      balancedKappa: { mean: 0.5, min: 0.2, max: 0.8 },
      injection: null,
    };
    const line = formatBandsLine('stub-live-judge', bands);
    expect(line).toContain('stub-live-judge');
    expect(line).toMatch(/67%.*\[0%-100%\]/);
    expect(line).toContain('n/a'); // injection band absent
  });
});

describe('runGuard timing instrumentation (opt-in third arg, backward compatible)', () => {
  it('a plain 2-arg call (the pre-existing contract used by examples/score-your-guard.mjs) is unaffected', async () => {
    const guard = { block: async () => false };
    const judged = await runGuard(guard, cases);
    expect(judged).toHaveLength(2);
  });

  it('records one wall-clock duration per case into the provided timingSink, using the injected clock', async () => {
    const guard = { block: async () => false };
    const times = [0, 5, 10, 30]; // start,end per case: case 1 = 5ms, case 2 = 20ms
    let i = 0;
    const clock = () => times[i++];
    const timingSink = [];
    await runGuard(guard, cases, { timingSink, clock });
    expect(timingSink).toEqual([5, 20]);
  });

  it('a guard that throws is still timed: the fail-closed path does not skip instrumentation', async () => {
    const guard = { block: async () => { throw new Error('boom'); } };
    const times = [100, 108];
    let i = 0;
    const clock = () => times[i++];
    const timingSink = [];
    await runGuard(guard, [cases[0]], { timingSink, clock });
    expect(timingSink).toEqual([8]);
  });
});

describe('median', () => {
  it('odd-length array: the middle value', () => {
    expect(median([5, 1, 3])).toBe(3);
  });

  it('even-length array: the average of the two middle values', () => {
    expect(median([10, 20, 30, 40])).toBe(25);
  });

  it('empty array: NaN, not a crash', () => {
    expect(Number.isNaN(median([]))).toBe(true);
  });
});

describe('timingSummary (HTTP/local-model transports only; in-process is not applicable)', () => {
  it('reports medianMs and calls for a local-model (live) guard', () => {
    const guard = { meta: { transport: 'local-model', live: true } };
    expect(timingSummary(guard, [10, 20, 30])).toEqual({ medianMs: 20, calls: 3 });
  });

  it('reports medianMs and calls for an http guard', () => {
    const guard = { meta: { transport: 'http', live: true } };
    expect(timingSummary(guard, [5, 15])).toEqual({ medianMs: 10, calls: 2 });
  });

  it('reports null for an in-process guard regardless of measured values: latency is not the point there', () => {
    const guard = { meta: { transport: 'in-process', live: false } };
    expect(timingSummary(guard, [1, 2, 3])).toEqual({ medianMs: null, calls: null });
  });
});

describe('runGuardMulti timing (pools all runs into one sample, not just the first)', () => {
  it('combines per-case timings from every run before computing the median and total calls', async () => {
    const guard = scriptedGuard([
      [false, false],
      [false, false],
    ]);
    // 4 case-durations across 2 runs of 2 cases: 10, 10, 20, 30
    const times = [0, 10, 10, 20, 20, 40, 40, 70];
    let i = 0;
    const clock = () => times[i++];
    const multi = await runGuardMulti(guard, cases, 2, clock);
    expect(multi.timing).toEqual({ medianMs: 15, calls: 4 });
  });
});

describe('formatGuardRow (median-ms / calls columns)', () => {
  it('renders median-ms and calls when timing data is present', () => {
    const r = {
      guard: 'judge:qwen/qwen3-vl-8b',
      kind: 'real',
      meta: { transport: 'local-model', model: 'qwen/qwen3-vl-8b', temperature: 0, live: true },
      metrics: baseMetrics,
      timing: { medianMs: 842, calls: 42 },
    };
    const row = formatGuardRow(r);
    expect(row).toMatch(/median:\s*842ms/);
    expect(row).toMatch(/calls:\s*42\b/);
  });

  it('renders a dash for median-ms/calls when no timing data is present (in-process guard)', () => {
    const r = {
      guard: 'denylist-archetype',
      kind: 'archetype',
      meta: { transport: 'in-process', model: null, temperature: null, live: false },
      metrics: baseMetrics,
    };
    const row = formatGuardRow(r);
    expect(row).toMatch(/median:\s*-/);
    expect(row).toMatch(/calls:\s*-/);
  });
});
