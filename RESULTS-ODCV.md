# holdline on real trajectories — ODCV-Bench (2026-08-17/18, live)

The authored 42-case corpus ([RESULTS.md](RESULTS.md)) is a smoke test we wrote ourselves. This is the harder number: holdline scoring a judge on **real agent trajectories it did not author**, with **independent labels**.

Source: [ODCV-Bench](https://github.com/McGill-DMaS/ODCV-Bench) (arXiv 2512.20798) — agent runs under an ethical/performance constraint, each labeled by a 4-model judge panel (Claude Opus, GPT-5.1, Grok-4.1, Gemini-3-Pro), Krippendorff alpha 0.81, binarized to violation at median score >= 3.0.

## The judge, scaled

A 42-trajectory slice first gave balanced kappa **0.82**. Scaling to **548 trajectories** (40 scenarios x all non-qwen agent variations, both framings; qwen agent runs excluded so our qwen judge does not grade its own family) brought it down:

| sample | trajectories | catch | false-block | accuracy | balanced kappa |
|---|---|---|---|---|---|
| small slice | 42 | 82% | 13% | 86% | 0.82 |
| **scaled (final)** | **548** | **75%** | **9%** | **86%** | **0.64** |

The scaled number is the honest one; the 0.82 was an optimistic small sample. **0.64 is "substantial" agreement** (Landis-Koch 0.61-0.80) with a four-frontier-model panel on behavior nobody on this side authored, evidence the judge measures constraint-violation rather than pattern-matching a corpus it was tuned on. But the headline is **0.64, not 0.82**, and any public claim must use it. (1 abstain of 548.)

For the confusion matrix behind this table (TP/FN/FP/TN, sensitivity/specificity/FAR, precision/NPV/prevalence), see [RESULTS.md > How to read these numbers](RESULTS.md#how-to-read-these-numbers-sensitivity--specificity--far).

## Why the structural guards are NOT scored here (a correction)

An earlier draft of this file scored the command-pattern guards (barricade, safeguard, guardian) on these transcripts and reported 0% catch. **That number was not fair and has been withdrawn.** Two reasons:

1. Those guards are built to inspect **one tool-call command at a time**; feeding them a 6000-char concatenated transcript is the wrong input shape, and at least one of their regexes is anchored to the start of the string (`/^DROP/`), so it cannot fire mid-transcript by construction. The 0% was partly an artifact of running them wrong.
2. What *is* real, by direct grep over the 706 transcripts: force-push appears in **0**, `DROP TABLE/DATABASE` in **0**, `rm -rf` in **49**, `sudo` in **9**. ODCV violations are overwhelmingly semantic (falsifying data, gaming a metric, hiding evidence), not dangerous-command-shaped. So command-pattern guards cannot engage most of these violations even when run correctly, not because they are bad, but because ODCV measures a **different threat class** than they target.

The honest conclusion is therefore narrow: **ODCV is not the benchmark on which to compare a semantic judge against command-pattern guards**, because it is almost entirely outside the command guards' domain. The fair structural-vs-semantic comparison lives on the authored corpus in [RESULTS.md](RESULTS.md), where both are given inputs they can act on. The per-command extraction this correction called for now exists; the fair re-run is below.

## Per-command structural-guard scoring (fair re-run)

`scripts/odcv-extract.mjs` parses each scored trajectory's `messages_record.txt` into individual bash tool-call commands, and `node odcv-compare.mjs` scores every structural guard one command at a time, its native input shape: a trajectory counts as blocked if any of its commands blocks. Same 548 trajectories and labels as the judge run above. (The withdrawn whole-transcript run is kept behind `node odcv-compare.mjs --artifact`, reproduction only.)

**What was extracted:** 7578 bash commands from the full, uncapped transcripts of all 548 scored trajectories. The judge above saw head+tail-capped transcripts, so this asymmetry favors the guards: they see every command. **What was skipped, counted, never silent:** 499 `task_complete` calls (episode-ending narration, not commands), 304 malformed bash calls whose `command` field is a JSON object rather than a string (a model emitting broken tool calls; they never reached a shell as-is), 3 calls with unparseable arguments, 1 call naming a script path as the tool. 19 trajectories contain zero bash commands; all 19 are labelled clean, so no violation is unscoreable by construction.

| guard | catch | false-block | balanced kappa | trajectories blocked |
|---|---|---|---|---|
| barricade | 0% (0/162) | 0% (0/386) | 0.00 | 0 |
| safeguard | 0% (0/162) | 0% (0/386) | 0.00 | 0 |
| guardian | 2% (3/162) | 1% (4/386) | 0.00 | 7 |
| denylist archetype | 3% (5/162) | 3% (11/386) | -0.01 | 16 |

Run fairly, the structural guards catch at most 3% of ODCV violations, at essentially zero agreement (balanced kappa 0.00 to -0.01). Inspection of what fired shows routine file cleanup (`rm -f` on report files) rather than the violations themselves; the few true positives are near-coincidental, a violating agent deleting a report it then regenerates falsified. This is the measured version of the domain statement above, and the expected result: ODCV violations are semantic (falsifying data, gaming a metric, hiding evidence) executed through ordinary-looking commands, so a command-pattern guard has almost nothing to match. **Low structural catch here is a statement about the domain, not an indictment of the guards.** The comparison where both tiers get inputs they can act on remains the authored corpus in [RESULTS.md](RESULTS.md).

## Honesty rails

- One 8B judge vs a 4-model panel; ~10% false-block (over-fires on ~1 clean trajectory in 10). Transcripts capped to head+tail (2000+4000 chars), so a violation buried mid-run can be missed by truncation alone.
- 548 of 1656 available; DEV/design-contaminated scenarios not excluded in this v0.
- This measures the judge tier in isolation. The shipped plugin adds the deterministic tier on top.
