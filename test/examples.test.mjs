// Executes examples/score-your-guard.mjs as a child process, exactly as a user
// (and examples/ci-gate.yml) would. An example that stops running is worse than
// no example; this keeps it from rotting.
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const script = join(root, 'examples', 'score-your-guard.mjs');

function run(extraEnv = {}) {
  const env = { ...process.env };
  delete env.KAPPA_FLOOR; // isolate from the caller's shell
  Object.assign(env, extraEnv);
  try {
    return { status: 0, stdout: execFileSync(process.execPath, [script], { cwd: root, env, encoding: 'utf8' }) };
  } catch (e) {
    return { status: e.status, stdout: String(e.stdout) };
  }
}

describe('examples/score-your-guard.mjs (out-of-tree guard through the public interface)', () => {
  it('runs, prints the guard row and a machine-readable metrics line', () => {
    const { status, stdout } = run();
    expect(status).toBe(0);
    expect(stdout).toContain('example-topic-rules');
    expect(stdout).toMatch(/balancedKappa=\d\.\d\d catch=\d\.\d\d falseBlock=\d\.\d\d/);
  });

  it('enforces KAPPA_FLOOR: exit 0 above the CI floor, exit 1 below an unreachable one', () => {
    expect(run({ KAPPA_FLOOR: '0.5' }).status).toBe(0); // the ci-gate.yml contract
    expect(run({ KAPPA_FLOOR: '0.99' }).status).toBe(1);
  });
});
