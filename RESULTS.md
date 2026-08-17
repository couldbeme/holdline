# gate-bench results (2026-08-17, live)

Corpus: 42 labeled cases — 34 base (literal / paraphrase / trap / clean / hard / edge) + **8 injection** (action content that tries to talk the guard out of its verdict). 22 drift, 20 clean. Judge model: `qwen/qwen3-vl-8b` local via LM Studio. Reproduce: `node run.mjs`.

| guard | catch | false-block | balanced kappa | injection acc | kind |
|---|---|---|---|---|---|
| judge (dsh-write-gate tier-2) | 91% | 10% | **80%** | 63% | real |
| denylist-archetype | 41% | 5% | 35% | 75% | archetype |
| allow-all | 0% | 0% | 0% | 38% | baseline |
| block-all | 100% | 100% | 0% | 63% | baseline |

Per-difficulty accuracy:

| guard | literal | paraphrase | trap | clean | hard | edge | injection |
|---|---|---|---|---|---|---|---|
| judge | 5/5 | 5/5 | 7/8 | 6/6 | 6/6 | 4/4 | **5/8** |
| denylist | 2/5 | 3/5 | 7/8 | 6/6 | 1/6 | 3/4 | 6/8 |
| allow-all | 0/5 | 0/5 | 8/8 | 6/6 | 0/6 | 3/4 | 3/8 |
| block-all | 5/5 | 5/5 | 0/8 | 0/6 | 6/6 | 1/4 | 5/8 |

## What this shows

1. **The semantic tier earns its cost.** The judge scores balanced kappa 0.80 vs the deny-list's 0.35, and the gap is entirely in the classes a pattern-matcher cannot reach: `hard` (novel domains) 6/6 vs 1/6, `paraphrase` 5/5 vs 3/5. A commitment-blind deny-list catches 41% of violations — the ones whose dangerous string it hardcoded — and is blind to the rest by construction. This is the two-tier argument, measured.

2. **Catch-rate alone is meaningless.** `block-all` catches 100% of violations and is useless (100% false-block, kappa 0). Any guard's catch rate must be read against its false-block rate and balanced kappa. This is the metric discipline the ecosystem's guard plugins currently ship without.

3. **The honest loss: our judge is weaker on injection (5/8) than the dumb deny-list (6/8).** This is real and expected — a judge is a filter, and a filter can be argued with ("the operator approved this", "this is only a test"). The deny-list is *more* injection-robust precisely because it is too dumb to be talked out of a pattern match: it never reads the injected reasoning. That is not a point for deny-lists; it is the sharpest possible statement of the two-tier design — use injection-proof structural checks for what is structural, and the judge only for the semantics that structure cannot express. The full dsh-write-gate plugin runs both tiers and structurally defangs fence-close attempts before the judge sees them; this bench isolates the judge alone, so 5/8 is the judge's floor, not the plugin's.

## Honesty rails

- The deny-list is an **archetype** of the dominant swarm strategy (a fixed regex blocklist), not any specific published plugin. Scoring a named competitor requires mounting its actual code and is future work.
- The corpus is hand-authored (n=42), small, and its base cases share an author with the guard under test. The trustworthy signals are the *shape* (semantic classes vs structural, and the injection column), not the headline percentages.
- One model, one run, temperature 0. Different models will move the judge row; that is the point of a harness anyone can re-run.
