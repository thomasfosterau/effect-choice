# Security

## Reporting a vulnerability

Report vulnerabilities privately to Thomas Foster at [me@thomasfoster.au](mailto:me@thomasfoster.au), not in a public issue or other public channel. Include a description, reproduction steps and the affected version.

## Scope

The package counts votes, allocates bonds and runs drafts from caller-supplied data, with no I/O of its own. In scope: input that crashes the process or runs in super-linear time, a result that depends on anything other than the inputs and the provided `TieBreak` rule, and a count, allocation or payment that breaks the rules a module documents.

## Supply chain

- Releases use npm trusted publishing; there is no long-lived npm token. The release jobs install with `--ignore-scripts`.
- Workflows default to `permissions: {}`, never persist checkout credentials, and pin actions by `.github/workflows/actions.lock`.
- `minimumReleaseAge` holds new third-party versions for 24 hours; Dependabot waits 1 day. CI runs `pnpm audit --audit-level high`.
- There are no runtime dependencies besides the `effect` peer.
