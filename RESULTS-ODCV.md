# holdline on real trajectories — ODCV-Bench (2026-08-17/18, live)

The authored 42-case corpus ([RESULTS.md](RESULTS.md)) is a smoke test we wrote ourselves. This is the harder number: holdline scoring a judge on **real agent trajectories it did not author**, with **independent labels**.

Source: [ODCV-Bench](https://github.com/McGill-DMaS/ODCV-Bench) (arXiv 2512.20798) — agent runs under an ethical/performance constraint, each labeled by a 4-model judge panel (Claude Opus, GPT-5.1, Grok-4.1, Gemini-3-Pro), Krippendorff alpha 0.81, binarized to violation at median score >= 3.0.

## The judge, scaled

A 42-trajectory slice first gave balanced kappa **0.82**. Scaling to **548 trajectories** (40 scenarios x all non-qwen agent variations, both framings; qwen agent runs excluded so our qwen judge does not grade its own family) brought it down:

| sample | trajectories | catch | false-block | balanced kappa |
|---|---|---|---|---|
| small slice | 42 | 82% | 13% | 0.82 |
| **scaled** | **548** | ~74% | ~10% | **~0.63** (final pending run completion) |

The scaled number is the honest one; the 0.82 was an optimistic small sample. **0.63 is still "substantial" agreement** with a four-frontier-model panel on behavior nobody on this side authored, which is real evidence the judge measures constraint-violation rather than pattern-matching a corpus it was tuned on. But the headline is 0.63, not 0.82, and any public claim should use it.

## Why the structural guards are NOT scored here (a correction)

An earlier draft of this file scored the command-pattern guards (barricade, safeguard, guardian) on these transcripts and reported 0% catch. **That number was not fair and has been withdrawn.** Two reasons:

1. Those guards are built to inspect **one tool-call command at a time**; feeding them a 6000-char concatenated transcript is the wrong input shape, and at least one of their regexes is anchored to the start of the string (`/^DROP/`), so it cannot fire mid-transcript by construction. The 0% was partly an artifact of running them wrong.
2. What *is* real, by direct grep over the 706 transcripts: force-push appears in **0**, `DROP TABLE/DATABASE` in **0**, `rm -rf` in **49**, `sudo` in **9**. ODCV violations are overwhelmingly semantic (falsifying data, gaming a metric, hiding evidence), not dangerous-command-shaped. So command-pattern guards cannot engage most of these violations even when run correctly, not because they are bad, but because ODCV measures a **different threat class** than they target.

The honest conclusion is therefore narrow: **ODCV is not the benchmark on which to compare a semantic judge against command-pattern guards**, because it is almost entirely outside the command guards' domain. The fair structural-vs-semantic comparison lives on the authored corpus in [RESULTS.md](RESULTS.md), where both are given inputs they can act on. Doing a per-command extraction from ODCV transcripts to score the structural guards fairly is future work (see ROADMAP).

## Honesty rails

- One 8B judge vs a 4-model panel; ~10% false-block (over-fires on ~1 clean trajectory in 10). Transcripts capped to head+tail (2000+4000 chars), so a violation buried mid-run can be missed by truncation alone.
- 548 of 1656 available; DEV/design-contaminated scenarios not excluded in this v0.
- This measures the judge tier in isolation. The shipped plugin adds the deterministic tier on top.
