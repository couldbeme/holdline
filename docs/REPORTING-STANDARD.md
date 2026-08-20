# Reporting standard

A number in a results table is a claim about methodology as much as it's a claim about
performance. This is the checklist for what a results claim about a guard needs to carry, and
honestly, which part of each item the harness actually checks versus what stays on the honor
system.

It's derived from what PR #1's author volunteered about their own numbers: a different transport
than ours, temperature 0.3 against our 0, and misses that flipped on a second ask. Nobody made
them disclose any of that. This standard exists because they did, so it's aimed at making that
kind of disclosure structural instead of optional, not at auditing them after the fact.

## Checklist

- **Temperature stated.** *Machine-enforced, fully*, once this round's required `meta.temperature`
  lands. Why: a result at 0.3 and a result at 0 are different claims about the same guard; without
  a stated value the number floats free of the setting that produced it.

- **Module pinned.** *Machine-enforced, next round, via hashing (not built yet).* Why:
  `meta.transport` is a declaration, not a proof; hashing the actual module is what turns "I say
  this is what ran" into "this is what ran."

- **Same code path as contributed.** *Partial.* `meta.transport` forces a declaration up front;
  whether that declaration matches what's actually in the pinned module needs human review, the
  harness doesn't check it. Why: a guard can be honestly declared and still drift from what a
  reviewer assumes it does.

- **n and per-difficulty breakdown.** *Human*, tightened by requiring the actual
  `results.latest.json` artifact rather than a hand-typed table. Why: a hand-typed summary can
  round away exactly the breakdown, which difficulty bucket, which case, that tells you whether a
  number is real or lucky.

- **Run-to-run variance disclosed.** *Trigger is machine-detectable* (`meta.live === true` and
  `meta.temperature !== 0` together flag a guard whose number can move between runs), *the action
  stays human*: re-running and reporting a range, or saying you didn't. Why: a single run of a
  non-deterministic guard is a sample, not a result.

- **Affiliation disclosed.** *Human. No structural field fits this.* Why: if you wrote the guard
  being scored, or you work on the model behind it, say so in the PR. There's nowhere in
  `GuardMeta` for that to live, on purpose, it's not a technical fact about the guard.

## What this is not

This isn't a gate that blocks a PR. Most of the checklist is still human judgment, and it says so
item by item rather than pretending the required-field additions cover more than they do.

`RESULTS-EXTERNAL.md`, a results file that keeps out-of-tree guards' numbers visibly separate from
the in-tree ones, is **specified for when the loader exists but is not built**. See the status
table in [GUARD-INTERFACE.md](GUARD-INTERFACE.md). Until then, a guard scored via the in-tree path
(see [../CONTRIBUTING-GUARDS.md](../CONTRIBUTING-GUARDS.md)) reports into `RESULTS.md` like
anything else, with the same disclosure checklist applying.
