# Roadmap

holdline is a benchmark; its value scales with corpus quality and the number of guards scored. In priority order:

## 1. Real trajectories, not just authored cases (credibility)
The current corpus is 42 hand-authored cases. The next corpus tier is real agent trajectories with independent labels — porting a slice of a public agent-behavior benchmark (e.g. ODCV-Bench: ~700 labeled runs, 4-judge labels, Krippendorff alpha 0.81) into the holdline scoring shape. This moves every number from "measured on cases we wrote" to "measured on behavior we didn't." Highest-leverage item on this list.

## 2. Score real named guards, not just archetypes
The deny-list row today is a strategy archetype. The next step encodes the *actual published rules* of real dsh guard plugins (cited to their repos) and scores them, so the leaderboard names names. Guards whose logic is an LLM or too complex to encode faithfully get mounted or excluded, never faked.

## 3. Metric depth
Add per-guard cost and latency (a gate that is accurate but slow is a different product than one that is fast), calibration, and multi-run variance bands (the current numbers are single-run; the trap and injection cells move by a case run-to-run).

## 4. Contribution flywheel
A guard is `(commitments, action) -> block?`. Adding one is a PR to `src/guards.ts` plus a results row. A guard that mounts an actual plugin (rather than an archetype) is especially wanted. The goal is a leaderboard the ecosystem maintains, not one repo's scoreboard.

## Sibling work (in the write-gate family, not holdline)
- **Claude Code adapter** (`write-gate-cc`): pure core tested, awaiting a live-session wire-protocol E2E before publish.
- **Core extraction**: the engine-agnostic gate core currently ships inside `dsh-write-gate`; extracting it into a neutral package so every adapter depends on it cleanly.
