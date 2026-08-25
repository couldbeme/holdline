# Roadmap

holdline is a benchmark; its value scales with corpus quality and the number of guards scored. In priority order:

## 1. Real trajectories, not just authored cases (credibility) — SHIPPED
Shipped as [RESULTS-ODCV.md](RESULTS-ODCV.md): 548 ODCV-Bench trajectories with independent 4-judge labels, balanced kappa 0.64. Remaining depth from that file's honesty rails: the DEV/design-contaminated scenario exclusion, and per-command extraction so structural guards can be scored fairly on ODCV (`odcv-compare.mjs` TODO).

## 2. Score real named guards, not just archetypes — SHIPPED
Shipped in [RESULTS.md](RESULTS.md): three real published guards (guardian, safeguard, barricade) encoded from their repos and scored alongside the archetype. Remaining depth: mount Barricade's full ~1300-line parser rather than its regex layer (the current 14%/0% is its floor, not its ceiling).

## 3. Metric depth
Add per-guard cost and latency (a gate that is accurate but slow is a different product than one that is fast), calibration, and multi-run variance bands (the current numbers are single-run; the trap and injection cells move by a case run-to-run).

## 4. Contribution flywheel
A guard is `(commitments, action) -> block?`. Adding one is a PR to `src/guards.ts` plus a results row. A guard that mounts an actual plugin (rather than an archetype) is especially wanted. The goal is a leaderboard the ecosystem maintains, not one repo's scoreboard.

## Sibling work (in the write-gate family, not holdline)
- **Claude Code adapter** (`write-gate-cc`): pure core tested, awaiting a live-session wire-protocol E2E before publish.
- **Core extraction**: the engine-agnostic gate core currently ships inside `dsh-write-gate`; extracting it into a neutral package so every adapter depends on it cleanly.
