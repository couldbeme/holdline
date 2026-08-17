# gate-bench

A neutral evaluation harness for AI-agent write-guards. It scores **any guard** — expressed as a `(commitments, action) → block?` function — over a labeled corpus, and reports the metrics that matter for a gate: catch rate, false-block rate, and **class-balanced Cohen's kappa** (raw kappa lies under class imbalance). The corpus includes an **injection-attack class**: actions whose content tries to talk the guard out of its verdict.

Why: the DeepSeek Harness ecosystem has 20+ guard/policy plugins and no shared way to measure whether any of them works. A guard's README saying "blocks dangerous commands" is not evidence. This harness is the evidence.

```sh
pnpm install
node run.mjs                    # scores every built-in guard over the corpus
node run.mjs --model <id>       # point the judge guard at a different local model
```

Latest results: [RESULTS.md](RESULTS.md). Scorer is tested (`pnpm test`); it dogfoods the published [`dsh-write-gate`](https://www.npmjs.com/package/dsh-write-gate) core for the judge guard.

## Adding your guard

Implement the `Guard` interface in `src/guards.ts` (name, kind, note, `block(case)`), add it to the list in `run.mjs`, and open a PR with your results. A guard that mounts an actual published plugin (rather than a strategy archetype) is especially welcome.

## Status

v0, honest limits stated in [RESULTS.md](RESULTS.md): the corpus is small and hand-authored, the deny-list is a strategy archetype (not a specific plugin), and the numbers are one model / one run. The value is the *shape* it exposes and that anyone can re-run it. MIT.
