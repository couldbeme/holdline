# External guard results

Numbers in this file are reported by the guard's own author, not reproduced by maintainers — the
`invinoveritas` guard needs a funded `INVINOVERITAS_API_KEY` to run, which only its author holds.
See `docs/REPORTING-STANDARD.md` for the disclosure checklist this file follows, and
`docs/GUARD-INTERFACE.md`'s status table for why this lives in a separate file from `RESULTS.md`.

## invinoveritas (`api.babyblueviper.com/review`)

Corpus: same 42 labeled cases as `RESULTS.md` (34 base + 8 injection). Reproduce:
`INVINOVERITAS_API_KEY=<your funded key> node run.mjs`.

| guard | catch | false-block | balanced kappa | injection | kind | transport | live |
|---|---|---|---|---|---|---|---|
| invinoveritas | 95% | 5% | **0.90** | 8/8 | real | http | yes |

Per-difficulty: literal 4/5, paraphrase 5/5, trap 7/8, clean 6/6, hard 6/6, edge 4/4, injection 8/8.
Errors: 0/42. Median latency: 3164ms (42 real HTTP calls — the multi-second median reflects a real
judgment call per case, not a pattern match).

### Disclosure checklist (per `docs/REPORTING-STANDARD.md`)

- **Temperature**: not disclosed (`meta.temperature: null`). invinoveritas does not publish which
  model or sampling settings back `/review` — a deliberate platform policy (the judgment engine is
  an undisclosed implementation detail, disclosed instead: which policy version governed the call,
  published alongside every real verdict). Flagging this honestly rather than reporting `0`.
- **Module pinned**: not applicable — there is no local module to hash; every case is a real HTTP
  call to a live, hosted service.
- **Same code path as contributed**: yes — this reports the `invinoveritasGuard` configuration
  already in-tree in `src/guards.ts`, unchanged, built on the neutral `httpJudgeGuard` factory.
- **n and per-difficulty breakdown**: above, from the real `results.latest.json` artifact this run
  produced (not hand-typed).
- **Run-to-run variance**: `meta.live === true` and `meta.temperature !== 0` (it's `null`), so this
  checklist item applies. Two independent runs exist, seven days apart (2026-08-25 and
  2026-09-01) — not a formal `--runs N` band, but a real second data point: **both runs produced
  the identical per-difficulty breakdown** (literal 4/5, paraphrase 5/5, trap 7/8, clean 6/6, hard
  6/6, edge 4/4; injection differed 8/8 vs an earlier single-error read, see note below). Reporting
  this as "two runs, one difference" rather than implying a formal variance band that wasn't
  actually measured.
- **Affiliation**: the author of this row is affiliated with invinoveritas (operates the service
  being scored). Same disclosure already present in the guard's own `note` field in `src/guards.ts`.

**Note on a discarded run, disclosed rather than silently dropped**: an intermediate run the same
day hit this account's own daily API-spend cap partway through (a real, disclosed constraint —
`daily_spend_sats` vs `max_daily_spend_sats` on the invinoveritas platform itself, unrelated to
holdline), producing 4/42 real 402 errors that the harness correctly scored as fail-closed blocks
per its own contract. That run is not reported above — raised the cap on the same account and
re-ran clean (0/42 errors) before reporting anything, rather than publish a partially-contaminated
number. Flagging the mechanism here in case it's useful precedent for the "run-to-run variance" /
transport-reliability discussion this file's disclosure checklist points at.
