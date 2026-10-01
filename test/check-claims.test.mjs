import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The claims gate exists because a written rule did not protect the README (the withdrawn
// 0.82 sat on the front page for 8 days beside a lock sentence saying 0.64). A gate that has
// only ever been seen passing is itself an unfalsified claim, so this test seeds the exact
// failure it was built for and asserts it trips.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const gate = join(repoRoot, 'scripts/check-claims.mjs');
const run = (root) => spawnSync(process.execPath, [gate, root], { encoding: 'utf8' });

function seededCopy(mutate) {
  const root = mkdtempSync(join(tmpdir(), 'holdline-claims-'));
  mkdirSync(join(root, 'docs'));
  for (const f of ['README.md', 'RESULTS.md', 'RESULTS-ODCV.md', 'ROADMAP.md', 'CONTRIBUTING-GUARDS.md']) {
    cpSync(join(repoRoot, f), join(root, f));
  }
  cpSync(join(repoRoot, 'docs'), join(root, 'docs'), { recursive: true });
  mutate(root);
  return root;
}

describe('claims gate (scripts/check-claims.mjs)', () => {
  it('passes on the repository as committed', () => {
    const r = run(repoRoot);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/claims gate OK/);
  });

  it('fails when RESULTS-ODCV.md stops citing the ODCV-Bench release its labels came from', () => {
    const root = seededCopy((d) => {
      const p = join(d, 'RESULTS-ODCV.md');
      const before = readFileSync(p, 'utf8');
      const after = before.replaceAll('7353f1c', 'unknown');
      if (after === before) throw new Error('seed did not apply: release commit not cited');
      writeFileSync(p, after);
    });
    const r = run(root);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/7353f1c/);
  });

  it('fails when the withdrawn 0.82 is seeded back into the README headline', () => {
    const root = seededCopy((d) => {
      const p = join(d, 'README.md');
      const before = readFileSync(p, 'utf8');
      const after = before.replace('balanced kappa **0.64', 'balanced kappa **0.82');
      // A seed that silently fails to apply would let this test pass on an unseeded copy.
      if (after === before) throw new Error('seed did not apply: README headline wording changed');
      writeFileSync(p, after);
    });
    const r = run(root);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/0\.82/);
    expect(r.stderr).toMatch(/README\.md/);
  });

  it('fails when the lock sentence disappears from RESULTS-ODCV.md', () => {
    const root = seededCopy((d) => {
      const p = join(d, 'RESULTS-ODCV.md');
      writeFileSync(p, readFileSync(p, 'utf8').replace('0.64, not 0.82', '0.64'));
    });
    const r = run(root);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/lock sentence/);
  });
});
