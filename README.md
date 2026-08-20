# holdline

A guard's job is to hold the line. **holdline** measures whether it does — a neutral benchmark for AI-agent write-guards. It scores **any guard** — expressed as a `(commitments, action) → block?` function — over a labeled corpus, and reports the metrics that matter for a gate: catch rate, false-block rate, and **class-balanced Cohen's kappa** (raw kappa lies under class imbalance). The corpus includes an **injection-attack class**: actions whose content tries to talk the guard out of its verdict.

Why: the DeepSeek Harness ecosystem has 20+ guard/policy plugins and no shared way to measure whether any of them works. A guard's README saying "blocks dangerous commands" is not evidence. This harness is the evidence.

```sh
pnpm install
node run.mjs                    # scores every built-in guard over the 42-case corpus
node run.mjs --model <id>       # point the judge guard at a different local model
node odcv-run.mjs               # score the judge on REAL agent trajectories (ODCV-Bench)
```

Two result sets: [RESULTS.md](RESULTS.md) (authored corpus, incl. a real named guard and an injection class) and [RESULTS-ODCV.md](RESULTS-ODCV.md) (the harder number: agreement with a 4-model judge panel on real agent trajectories we did not write, balanced kappa **0.82**). Scorer is tested (`pnpm test`); it dogfoods the published [`dsh-write-gate`](https://www.npmjs.com/package/dsh-write-gate) core for the judge guard.

## Adding your guard

See [CONTRIBUTING-GUARDS.md](CONTRIBUTING-GUARDS.md): the in-tree path that works today, the out-of-tree path that's designed but not yet built, and the full interface spec in [docs/GUARD-INTERFACE.md](docs/GUARD-INTERFACE.md).

## Status

v0, honest limits stated in [RESULTS.md](RESULTS.md): the corpus is small and hand-authored, the deny-list is a strategy archetype (not a specific plugin), and the numbers are one model / one run. The value is the *shape* it exposes and that anyone can re-run it. MIT.
