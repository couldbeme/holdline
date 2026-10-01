import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The tracked 548-trajectory judge roster is the input; no network, no model.
const run = () =>
  JSON.parse(execFileSync('node', ['scripts/odcv-ci.mjs', '--json', '--B', '400'], { encoding: 'utf8' }));

describe('odcv-ci on the tracked roster', () => {
  const out = run();

  it('reproduces the canonical headline as the point estimate', () => {
    expect(out.n).toBe(548);
    expect(out.metrics.balancedKappa.point.toFixed(2)).toBe('0.64');
  });

  it('clusters by the 40 scenarios and reports the naive interval beside it', () => {
    expect(out.metrics.balancedKappa.scenario.clusters).toBe(40);
    expect(out.metrics.balancedKappa.iid.clusters).toBe(548);
    for (const k of ['balancedKappa', 'catchRate', 'falseBlockRate', 'accuracy']) {
      const m = out.metrics[k];
      expect(m.scenario.lo).toBeLessThanOrEqual(m.point);
      expect(m.scenario.hi).toBeGreaterThanOrEqual(m.point);
    }
  });

  it('the interval published in RESULTS-ODCV.md and README.md is the one the script computes', () => {
    // Default B=2000, seed=1: the exact settings the docs cite.
    const full = JSON.parse(execFileSync('node', ['scripts/odcv-ci.mjs', '--json'], { encoding: 'utf8' }));
    const k = full.metrics.balancedKappa.scenario;
    const claim = `0.64 (95% CI ${k.lo.toFixed(2)} to ${k.hi.toFixed(2)}, scenario-clustered bootstrap)`;
    expect(readFileSync('RESULTS-ODCV.md', 'utf8')).toContain(claim);
    expect(readFileSync('README.md', 'utf8')).toContain(claim);
    const words = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
    const none = full.perScenario.filter((g) => g.drift === 0).length;
    expect(readFileSync('RESULTS-ODCV.md', 'utf8')).toContain(`${words[none]} scenarios have no violations at all`);
  });

  it('emits one per-scenario row per scenario, summing to 548', () => {
    expect(out.perScenario).toHaveLength(40);
    expect(out.perScenario.reduce((s, g) => s + g.n, 0)).toBe(548);
  });
});
