# Guard interface

What a guard actually is: `(commitments, action) -> block?`. This document specs the whole
interface, the part that's shipped, the part landing this round, and the part that's agreed on
but not built yet.

## Status, read this first

| Piece | State |
|---|---|
| `Case` shape | shipped |
| `Guard` shape (`name`, `kind`, `note`, `block`) | shipped |
| Label strip (`block()` never sees `Case.label`) | landing this round, alongside these docs |
| `GuardMeta` / required `meta` field | landing this round, alongside these docs |
| `kind: 'external'` | landing this round (reserved, no loader consumes it yet) |
| `meta` rendered in `run.mjs`'s printed table | landing this round |
| `--guard <path>` out-of-tree loader | **specified below, not built** |
| Load-time fail-closed probe | **specified below, not built** |
| Enforced outer timeout | **specified below, not built** |
| `RESULTS-EXTERNAL.md` | **specified in `REPORTING-STANDARD.md`, not built** |

If you've checked out a commit where `src/guards.ts`'s `Guard` type doesn't have `meta` yet,
that's the label-strip/meta change not merged on your branch, not a doc error.

## `Case`

From `src/guards.ts`:

```ts
export interface Case {
  id: string;
  difficulty: string;
  label: 'drift' | 'clean';
  commitments: string[];
  action: string;
}
```

`label` is ground truth, used only for scoring in `run.mjs`, after a guard has already answered.
This round strips it before the object reaches `block()`. No in-tree guard reads it today, they're
trusted by code review not to, but an out-of-tree module is opaque and the corpus is public and
stable, so a guard could key off `c.label` or `c.id` and report a perfect, meaningless kappa. Once
this lands, `block()` receives `commitments` and `action` (plus `id`, `difficulty`), never `label`.

## `Guard`

```ts
export type Guard = {
  name: string;
  kind: 'real' | 'archetype' | 'baseline' | 'external';
  note: string;
  meta: GuardMeta;
  block(c: GuardCase): Promise<boolean>;   // GuardCase = Omit<Case, 'label'>
};
```

`kind` describes what the guard is standing in for, not how well it does:

- `real`: an actual published guard plugin, encoded to score it (`barricadeGuard`,
  `safeguardGuard`, `guardianGuard` in `src/guards.ts`).
- `archetype`: models a strategy, not any specific plugin (`denylistGuard`).
- `baseline`: `allowAll` / `blockAll`, there to show catch rate alone means nothing.
- `external`: reserved for a guard supplied through the loader, once it exists.

## `GuardMeta`

The idea for a required, construction-time declaration of how a guard actually runs (not what it
claims in a README) came from PR #1's author. We adopted it and generalized it: every guard now
has to carry one, in-tree or out.

```ts
export interface GuardMeta {
  transport: 'http' | 'in-process' | 'local-model';
  model: string | null;
  temperature: number | null;
  live: boolean;   // true iff the call leaves the process
}
```

In-tree declarations, once this lands:

| guard | transport | model | temperature | live |
|---|---|---|---|---|
| `denylistGuard`, `barricadeGuard`, `safeguardGuard`, `guardianGuard`, `allowAll`, `blockAll` | `in-process` | `null` | `null` | `false` |
| `judgeGuard(endpoint, model)` | `local-model` | the `model` argument | `0` | `true` |

`judgeGuard`'s `temperature: 0` in `meta` matches the `temperature: 0` already pinned in its own
fetch body in `src/guards.ts`, it isn't a new claim, it's existing behavior finally declared
somewhere the results table can render it.

### The honest limit on `meta`

`meta` enforces presence, not truthfulness. Nothing stops a guard from declaring
`{ transport: 'in-process', live: false }` and calling the network anyway. This is the same class
of problem PR #1 surfaced by disclosing its own numbers came from a different transport than ours:
a self-reported field is only as good as the person filling it in. What closes that gap is module
hashing, pinning the actual code instead of a claim about it, and that's next round's work, not
this one's. Don't read `meta` as verified. Read it as "the author was asked to say this out loud,
somewhere a diff review can catch it later if it's wrong."

## Fail-closed is load-bearing, not incidental

From `run.mjs`:

```js
try { blocked = await g.block(c); } catch (e) { blocked = true; } // a guard that errors fails closed
```

Every uncaught error in `block()` becomes a BLOCK. That's the harness's whole safety property, and
it only holds if a guard lets its own transport and parse errors propagate. A guard that catches
internally and returns `false` inverts this silently, its apparently low false-block rate might
just be dropped calls, not judgment. This is exactly the pattern in PR #1's diff
(`if (!res.ok) return false; // fail open` and `catch { return false; // fail open }`), and it's
why it isn't being merged as-is. If you're wiring a guard against a real endpoint: let it throw.
Don't catch to be polite.

## Specified, not built: the loader, the probe, the timeout

None of this exists yet. It's written down here so the shape is agreed before it's built, and so
nobody mistakes the plan for the product.

**`--guard <path>` loader.** Points `run.mjs` at an out-of-tree module exporting something shaped
like `Guard`, scored alongside the in-tree guards with `kind: 'external'`.

**Load-time fail-closed probe.** Before scoring any case, the loader calls `block()` once with
`fetch` stubbed to reject, and refuses to load any guard that resolves to `false` instead of
throwing. One call at load time, not one per case, it's checking the guard obeys the fail-closed
contract above, not re-checking it every run.

**Enforced outer timeout.** A bound on how long `block()` is allowed to run before the harness
treats it as a fail-closed error. This is a harness gap today, not a constraint being imposed on
outsiders: no in-tree guard has any timeout at all. `judgeGuard`'s own call into the judge library
sets no timeout, and the only explicit `AbortSignal` anywhere in this repo's code guards
`run.mjs`'s pre-flight liveness probe (`endpointUp()`, 800ms), not any guard's verdict call. PR #1
already passes `AbortSignal.timeout(15000)`, which means it's more careful about this than
anything currently in-tree. When the outer timeout lands, it closes a hole that applies to
`judgeGuard` too, not just to guards coming in through a loader.

## Minimal worked example: an out-of-tree guard

This is what a guard module will look like once the loader exists. It doesn't import anything from
holdline, it just has to match the shape.

```js
// my-guard.mjs
export default function myGuard() {
  return {
    name: 'my-guard',
    kind: 'external',
    note: 'blocks anything that touches /etc',
    meta: { transport: 'in-process', model: null, temperature: null, live: false },
    async block(c) {
      // c has { id, difficulty, commitments, action } but never `label`
      return /\/etc\b/.test(c.action);
    },
  };
}
```

Under twenty lines, and every field in it is either load-bearing (`block`) or accountable (`kind`,
`meta`). Once `--guard ./my-guard.mjs` exists, this is the whole contract.
