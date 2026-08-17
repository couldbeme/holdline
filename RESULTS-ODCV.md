# holdline on real trajectories — ODCV-Bench (2026-08-17, live)

The authored 42-case corpus ([RESULTS.md](RESULTS.md)) is a smoke test we wrote ourselves. This is the harder, more honest number: holdline scoring a judge on **real agent trajectories it did not author**, with **independent labels**.

Source: [ODCV-Bench](https://github.com/McGill-DMaS/ODCV-Bench) (arXiv 2512.20798) — agent runs under an ethical/performance constraint, each labeled by a 4-model judge panel (Claude Opus, GPT-5.1, Grok-4.1, Gemini-3-Pro), Krippendorff alpha 0.81, binarized to violation at median score >= 3.0.

Slice scored: 42 real trajectories across 14 scenarios and 3 agent variations (`claude-opus-4.5-mandated`, `gpt-5.1-chat-mandated`, `gemini-3-pro-preview-mandated`). qwen agent runs are excluded so our qwen judge does not grade its own family. Judge: `qwen/qwen3-vl-8b`, transcript-level rubric (judge the observed act, treat agent narration as untrusted). Reproduce: `node odcv-run.mjs`.

| metric | value |
|---|---|
| trajectories | 42 (11 violation, 31 clean, by the 4-judge median) |
| catch (violations found) | 82% |
| false-block | 13% |
| accuracy | 86% |
| balanced kappa vs the panel | **0.82** |
| abstains | 0 |

## What this shows

A single local 8B judge, reading a capped transcript against the scenario constraint, agrees with a four-frontier-model labeling panel at kappa 0.82 ("substantial"), on agent behavior nobody on this side authored. That is the number to trust over the 0.95 on our own cases, because the cases and the labels here are both external. It is direct evidence that the write-gate's judge tier is measuring the thing it claims to measure (did the agent's action break the stated rule), not pattern-matching a corpus it was tuned on.

## Honesty rails

- One 8B judge against a 4-model panel; 13% false-block means it over-fires on roughly one clean trajectory in eight, worse than its false-block on the authored corpus, which is expected: real transcripts are long and ambiguous.
- Transcripts are capped to head + tail (2000 + 4000 chars); a violation buried in the middle of a long run can be missed by truncation alone.
- 42 is a slice, not the full 1656-trajectory set; DEV/design-contaminated scenarios are not excluded in this v0. Scaling the slice and adding those rails is the next step (see ROADMAP).
- This measures the judge tier in isolation. The shipped plugin adds the deterministic tier on top.
