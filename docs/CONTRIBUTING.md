# Contributing

## Workflow

- Branch off `trunk` and open a pull request into `trunk`; never commit to `trunk` directly. Open a draft PR as soon as you start, and keep one PR per change, however large. Squash-merge with a conventional prefix (`feat:`, `fix:`, `docs:`, `chore:`). Rebase onto `origin/trunk` rather than merging it in.
- File an issue for anything you notice that is out of scope, and keep issue bodies evergreen: edit the body as understanding improves rather than appending comments.
- Dependabot keeps dependencies current. Its `toolchain` group needs hand edits it can't make: the npm-alias catalog entries (`vite` must equal `vite-plus`; `typescript` / `@typescript/native` must be a pair `@effect/tsgo` supports), an `@effect/tsgo` release that supports the new oxlint, and the devcontainer image tag. Make them in a PR from a new branch started from its PR's head (never push to a `dependabot/*` branch, which stops it rebasing); Dependabot closes its own PR once yours merges.

## Toolchain

[Vite+](https://viteplus.dev) (`vp`) manages Node and pnpm and runs every task. `vp install` installs dependencies, the git hooks (pre-commit runs `vp staged`, then `vp run fallow:audit`) and, through `prepare`, the Effect-patched `tsc` and oxlint.

| Command                                  | What it does                                                                 |
| ---------------------------------------- | ---------------------------------------------------------------------------- |
| `vp check`                               | Format (Oxfmt) and lint (Oxlint with the Effect presets, type-aware)         |
| `vp run check`                           | Type gate: the Effect-patched native `tsc`, which reports Effect diagnostics |
| `vp run test:unit`                       | Unit tests, writing the coverage map fallow reads                            |
| `vp run fallow` / `vp run fallow:health` | Dead code and duplication / complexity                                       |
| `vp run build`                           | `vp pack` → `dist/`                                                          |
| `vp run check:dist`                      | Type-checks `test/dist-consumer/` against the emitted declarations           |
| `vp run docgen`                          | TypeDoc; fails on an undocumented export or an unresolved `{@link}`          |
| `vp run ci`                              | Everything CI runs, in order (`pnpm audit` needs the network)                |

[Fallow](https://docs.fallow.tools) is a guide, not dogma: use it to polish your work. `vp run fallow:audit` (the pre-commit hook) fails only on findings your change introduces. Before deleting "unused" code, trace it: `vp exec fallow dead-code --trace <file>:<export>`.

Every external version lives in the `pnpm-workspace.yaml` catalog; never edit one in `package.json`.

## Coding guidelines

- Use Effect idioms throughout, and strongly prefer Effect v4's own modules (`Array`, `Option`, `Data`, `Rational`, `DateTime`, `Schema`, …) over hand-rolled equivalents. Read the installed `effect` package rather than guessing at an API.
- One module per mechanism: each mechanism imports only the shared core (`Choice` and `TieBreak`), never another mechanism. Fallow's boundaries enforce it.
- Every mechanism is framed the same way: actors express choices over alternatives, and the mechanism resolves them. A sealed mechanism exposes a `Choice.Mechanism`; a sequential one a `Choice.Protocol`. Ties a mechanism's own rules cannot settle go to `TieBreak.choose`, never to input order or `Math.random`.
- Exports follow Effect's layout: `src/index.ts` re-exports each module as a PascalCase namespace, and each is also importable from its own PascalCase subpath (`@thomasfosterau/effect-choice/HareClark`). A new mechanism adds both, plus its `exports` entry in `package.json`, a fallow boundary zone, and a section in [mechanisms.md](mechanisms.md).
- The build is `platform: "neutral"`: no Node imports in `src/`.
- Counting and allocation rules cite the rule they implement in the module's doc comment, and say where they simplify it.
- Absent values are `Option`. Options-object members are `readonly x?: T` (`exactOptionalPropertyTypes` is on); wire schemas keep native optionals.
- Errors are `Schema.TaggedError` classes with a brand type argument. Relative imports carry `.ts`.
- Fix lint findings in code; a rule is relaxed only in `vite.config.ts`, scoped, with its reason.
- Comments: a short file header only where it adds context; doc comments on exports where they add to IntelliSense (description first, then tags; TypeDoc needs every export documented and every `{@link}` resolvable in the published surface). Inline comments only for the non-obvious. No references to issues, PRs or history.
- Tests take `it` / `layer` from `@effect/vitest` and the rest from `vite-plus/test`. Prefer small hand-worked examples whose every number a reader can check, plus seeded random inputs (`Random.withSeed`) for invariants. Test logic and edge cases, not what the type system already checks.

## Before pushing

Run `vp run ci`. CI ([ci.yml](../.github/workflows/ci.yml)) runs it on Node `lts` and `latest` with no secrets. Workflows pin actions by exact tag, locked to commits by `.github/workflows/actions.lock`: run `gh actions-lock` after changing a `uses:`. `uvx zizmor --offline .github` audits the workflows.

## Dependencies

Dependabot ([dependabot.yml](../.github/dependabot.yml)) opens `@thomasfosterau/*` updates daily and every other update weekly, on Wednesday morning Melbourne time: the named runtime sets (`effect` and the like) each in one PR, and every other development dependency in the single `toolchain` group. Security updates skip the schedule and open as soon as an advisory lands, one PR each. Vite+ selects Node.js from `.node-version` and pnpm from `packageManager`; pnpm's own switching is off (`runtimeOnFail` / `pmOnFail`), so one version of each is installed and used.

## Changesets

Every change to the published package's behaviour or its `.d.ts` (doc comments included, as a `patch`) needs a changeset: `vp exec changeset`. Docs-, CI- and tooling-only changes need none. The package stays on 0.x: a breaking change is a `minor`, never a `major` (see [PUBLISHING.md](PUBLISHING.md#versioning)), and its changeset says how to migrate. Never version or publish by hand: the Release workflow opens the `chore: version packages` PR, and merging it publishes.
