# Dependabot Trial Design

## Goal

Add a repository-local Dependabot configuration for Devvit MCP that keeps npm
dependencies and GitHub Actions current while delaying ordinary releases for
seven days and making security-update pull requests easy to distinguish.

## Scope

- Create `.github/dependabot.yml` on the default branch.
- Configure the `npm` ecosystem at the repository root.
- Configure the `github-actions` ecosystem at the repository root.
- Run ordinary version-update checks weekly on Monday at 11:00 in
  `America/Los_Angeles`, matching the existing Renovate schedule as closely as
  Dependabot permits.
- Apply a seven-day cooldown to ordinary version updates in each ecosystem.
- Add one security-only group per ecosystem: `security-vulnerabilities-npm`
  and `security-vulnerabilities-github-actions`.

## Behavior

Dependabot will defer an ordinary candidate release until it is at least seven
days old. Dependabot security updates are intentionally not subject to the
cooldown and remain alert-triggered. The security group identifiers make the
corresponding security pull request title and branch distinguishable from
ordinary version-update pull requests.

No custom labels are included: Dependabot cannot apply labels only to security
updates. A separate PR-triage automation would be required for an exact
`security` label and is outside this trial.

## Verification

Parse the file as YAML locally and inspect the final configuration for both
ecosystems, their seven-day cooldowns, and their security-only groups. GitHub
will perform authoritative Dependabot validation when it reads the file after
it is pushed.

## Out of Scope

- Organization-wide rollout or synchronization.
- A GitHub App or Action that applies security-only labels.
- Routine version-update grouping beyond Dependabot's default per-dependency
  pull requests.
