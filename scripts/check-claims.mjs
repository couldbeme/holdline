// Claims gate: the published docs must carry the canonical numbers and must not
// resurrect withdrawn ones. Exists because a written rule did not protect the
// README (RESULTS-ODCV.md locked the headline to 0.64 while README.md still said
// 0.82); only an enforced check does. Runs in CI after the test suite.
// Usage: node scripts/check-claims.mjs [repo-root]   (root arg exists so the
// gate itself can be tested against a seeded-bad copy of the docs)
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const failures = [];

// 1. README must headline the canonical scaled ODCV result.
const readme = read('README.md');
if (!readme.includes('0.64') || !readme.includes('548')) {
  failures.push('README.md must state the canonical ODCV headline: balanced kappa 0.64 on 548 trajectories.');
}

// 2. The withdrawn small-slice 0.82 may appear ONLY inside RESULTS-ODCV.md,
//    where it is framed as superseded. Everywhere else it is a resurrection.
const mdFiles = [
  ...readdirSync(root).filter((f) => f.endsWith('.md')),
  ...readdirSync(join(root, 'docs')).map((f) => join('docs', f)).filter((f) => f.endsWith('.md')),
];
for (const f of mdFiles) {
  if (f === 'RESULTS-ODCV.md') continue;
  if (/0\.82/.test(read(f))) {
    failures.push(`${f} mentions 0.82 — that number is withdrawn; the public claim is 0.64 (RESULTS-ODCV.md).`);
  }
}

// 3. RESULTS-ODCV.md must keep the lock sentence that makes rule 2 legible.
if (!read('RESULTS-ODCV.md').includes('0.64, not 0.82')) {
  failures.push('RESULTS-ODCV.md lost the headline-lock sentence ("0.64, not 0.82").');
}

// 3b. RESULTS-ODCV.md must cite the ODCV-Bench release its labels came from;
//     ODCV relabels between releases, so an uncited 0.64 is unreproducible.
if (!read('RESULTS-ODCV.md').includes('7353f1c')) {
  failures.push('RESULTS-ODCV.md must cite the ODCV-Bench release commit 7353f1c that the 548 labels come from.');
}

// 4. RESULTS.md must state the authored-corpus judge number.
if (!read('RESULTS.md').includes('0.95')) {
  failures.push('RESULTS.md must state the authored-corpus judge kappa (0.95).');
}

if (failures.length) {
  console.error('claims gate FAILED:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`claims gate OK (${mdFiles.length + 1} markdown files checked)`);
