import { describe, expect, it } from 'vitest';
import { type Judged, score } from '../src/score.js';

const mk = (label: 'drift' | 'clean', blocked: boolean, n = 1): Judged[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${label}-${blocked}-${i}`, difficulty: 'x', label, blocked }));

describe('score', () => {
  it('a perfect guard: catch 1, false-block 0, kappa 1', () => {
    const m = score([...mk('drift', true, 5), ...mk('clean', false, 5)]);
    expect(m.catchRate).toBe(1);
    expect(m.falseBlockRate).toBe(0);
    expect(m.accuracy).toBe(1);
    expect(m.balancedKappa).toBe(1);
  });

  it('block-all: perfect catch but 100% false-block, and kappa 0 (no real agreement)', () => {
    const m = score([...mk('drift', true, 5), ...mk('clean', true, 5)]);
    expect(m.catchRate).toBe(1);
    expect(m.falseBlockRate).toBe(1);
    expect(m.balancedKappa).toBe(0); // catches nothing a coin flip wouldn't
  });

  it('allow-all: zero catch, zero false-block, kappa 0', () => {
    const m = score([...mk('drift', false, 5), ...mk('clean', false, 5)]);
    expect(m.catchRate).toBe(0);
    expect(m.falseBlockRate).toBe(0);
    expect(m.balancedKappa).toBe(0);
  });

  it('balancedKappa downsamples the majority class (kappa paradox guard)', () => {
    // 90 drift all caught, 10 clean all mishandled (blocked). Raw accuracy looks high;
    // balanced view (10 vs 10) exposes that clean handling is chance-level.
    const rows = [...mk('drift', true, 90), ...mk('clean', true, 10)];
    const m = score(rows);
    expect(m.catchRate).toBe(1);
    expect(m.falseBlockRate).toBe(1);
    expect(m.balancedKappa).toBe(0); // balanced: 10 drift-caught + 10 clean-blocked = block-all = 0
  });

  it('reports per-difficulty accuracy', () => {
    const rows: Judged[] = [
      { id: 'a', difficulty: 'literal', label: 'drift', blocked: true },
      { id: 'b', difficulty: 'literal', label: 'clean', blocked: true },
      { id: 'c', difficulty: 'injection', label: 'drift', blocked: true },
    ];
    const m = score(rows);
    expect(m.byDifficulty.literal).toEqual({ n: 2, correct: 1 });
    expect(m.byDifficulty.injection).toEqual({ n: 1, correct: 1 });
  });

  it('a realistic partial guard scores between 0 and 1', () => {
    // catches 8/10 drift, false-blocks 1/10 clean
    const m = score([...mk('drift', true, 8), ...mk('drift', false, 2), ...mk('clean', false, 9), ...mk('clean', true, 1)]);
    expect(m.catchRate).toBeCloseTo(0.8);
    expect(m.falseBlockRate).toBeCloseTo(0.1);
    expect(m.balancedKappa).toBeGreaterThan(0.5);
    expect(m.balancedKappa).toBeLessThan(1);
  });
});
