# Contributing a guard

There are two ways to get a guard scored. One works today. The other is designed but not built,
and this doc says so plainly rather than describing it like it's already live.

## Path 1: in-tree (works today)

1. Implement the `Guard` shape in `src/guards.ts` (full spec in
   [docs/GUARD-INTERFACE.md](docs/GUARD-INTERFACE.md)):
   - `name`, `kind` (`'real'` for an actual published plugin you're encoding, `'archetype'` for a
     strategy that isn't tied to one plugin, `'baseline'` for a reference point like
     allow-all/block-all), `note`.
   - `meta`, once the label-strip/meta change lands this round: declare `transport`, `model`,
     `temperature`, `live` honestly. It's checked for presence, not checked against what your code
     actually does, see the honest-limit note in `docs/GUARD-INTERFACE.md`.
   - `block(c)`: let transport and parse errors propagate. Don't catch-and-return-false to be
     polite, a thrown error is scored as a correct fail-closed block; a silent `false` is scored as
     a guard that let something through. See the fail-closed section of
     `docs/GUARD-INTERFACE.md`.
2. Add your guard to the `guards` array in `run.mjs`. If it needs a live endpoint, gate it the way
   `judgeGuard` is gated: only added to the list when `endpointUp()` succeeds, with a console line
   explaining why it's skipped otherwise.
3. Run `pnpm test` (must stay green, existing tests aren't yours to break) and `node run.mjs` to
   generate a results row.
4. Open a PR with your guard and its results row. A guard that mounts an actual published plugin,
   encoded from its real source, is worth more to this repo than another commitment-blind
   archetype (see `ROADMAP.md` #2), but archetypes that model a real strategy are welcome too.

Files a PR usually touches: `src/guards.ts`, `run.mjs`, and a results row (maintainers fold new
rows into `RESULTS.md`, you don't need to hand-edit its prose). `src/score.ts` is out of scope for
a guard PR, it's the scoring math, not the guard.

## Path 2: out-of-tree (specified, not built)

The idea here, and the required `meta` field that makes it honest, came from a suggestion on
PR #1: an external guard shouldn't have to be trusted by code review the way an in-tree one is, so
it needs to declare, up front, how it actually runs. We agreed, and generalized the requirement to
every guard, in-tree included.

What's actually built right now: `kind: 'external'` exists in the type union, reserved. What's
not: the `--guard <path>` loader that would let a guard live in its own repo and get scored without
a PR against this one at all, the load-time probe that refuses a guard which fails open, and the
outer timeout that bounds how long any guard, including the in-tree ones, is allowed to take. All
three are specced in [docs/GUARD-INTERFACE.md](docs/GUARD-INTERFACE.md).

Until the loader exists, the only way to get a guard scored is Path 1. If your guard already
exists as its own module and you don't want it living in `src/guards.ts` long term, open the PR
anyway and say so, that's useful signal for prioritizing the loader.

## Either way

Run `pnpm typecheck` and `pnpm test` before opening the PR. Read
[docs/REPORTING-STANDARD.md](docs/REPORTING-STANDARD.md): most of it is still human judgment, the
doc says exactly which parts, and a PR that answers the checklist up front moves faster than one
that gets asked about it in review.
