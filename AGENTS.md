# AGENTS.md

Read [README.md](README.md) and [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) first; this file adds only what is specific to agents.

## Process

- You may open pull requests in this repository (GitHub MCP tools or `gh`, whichever is available). GitHub writes go to `thomasfosterau/effect-choice` only.
- When you spot work outside your task, file an issue and move on.
- Write idiomatic Effect (see docs/CONTRIBUTING.md). Non-idiomatic code you find: fix it if trivial, otherwise file an issue naming the sites and the idiomatic replacement.
- Before reporting work as done, run `vp run ci` and say which gates passed and which couldn't run.

## Pitfalls

- **The README is the npm page**: its links must stay absolute, and the guide it links (`docs/mechanisms.md`) is published through `package.json` `files`.
- **Rules are law, not taste.** Hare-Clark and the AOFM's tender rules are set out in legislation and published procedures, and the AFL's draft rules change most years; a change to a counting or allocation rule cites its source in the module's doc comment.
- **`effect-tsgo patch` is version-locked.** `@effect/tsgo`, `@typescript/native` and `vite-plus` move together, or `vp install` fails; read the catalog comments first.
- **`{@link}` must resolve in the published surface** (a name in scope or a namespace path such as `{@link TieBreak.TieBreak}`), or `vp run docgen` fails.

## Pull requests

- **Write the PR body with the `pr` skill** from Matt Pocock's skills (`mattpocock-skills:pr`), filling in the repository's pull request template where there is one.
- **Resolve merge conflicts before you hand a PR over.** Rebase onto `origin/trunk` and push; a PR that conflicts with `trunk` isn't finished.
- **Mark the PR ready for review as soon as the initial draft is finished.** Don't wait for CI to run, for reviews, or for the owner to do it. Keep fixing CI failures and review findings on the ready PR.

## Fallow

- `vp install` links the `fallow` skill into `.claude/skills/fallow` from the installed package (approved under `permissions` in `pnpm-workspace.yaml`); the repository's own fallow rules are in [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md).
