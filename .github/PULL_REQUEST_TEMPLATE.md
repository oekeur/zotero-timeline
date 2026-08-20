<!--- PR title follows the commit convention: type(scope)!: description #issue -->
<!--- type is one of: feat, fix, improve, hotfix, chore, docs, test -->

## What?

<!--- Summary of the change. -->

## Why?

<!--- The problem it solves. Link the issue it closes. -->

## How?

<!--- The approach, and anything a reviewer would otherwise have to reverse-engineer. -->

## Type of change

<!--- Check all that apply, remove the rest. -->

- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature (non-breaking change that adds functionality)
- [ ] Breaking change (changes existing behaviour, data format, or a public API)
- [ ] Improve (existing functionality, not a bug and not a feature)
- [ ] Documentation
- [ ] Chore (dependencies, tooling, CI)

## Verification

- [ ] `scripts/verify.sh` passes (build, lint, live-Zotero startup check)

<!--- Delete the block below if this PR touches no XUL, vis-timeline, or live Zotero API code.
      Nothing in that surface is unit-testable and most failures here are silent. -->

Touches XUL, vis-timeline, or live Zotero API code, so also:

- [ ] Driven manually via `npm start`, not just built
- [ ] "Zotero Timeline" still appears under Tools -> Plugins
- [ ] Debug Output shows no "Error running bootstrap method"

<!--- Delete if this PR changes neither package.json nor addon/manifest.json.
      These three fail silently rather than erroring. -->

Changes `package.json` or `addon/manifest.json`, so also:

- [ ] `repository.url` and `homepage` are correct
- [ ] `strict_max_version` still admits the target Zotero version

## Documentation

- [ ] User-facing behaviour changed and `docs/user-guide/` is updated, or no user-facing change
- [ ] Non-obvious constraints landed in `docs/internals/`, or none came up

## Screenshots

<!--- For anything visual: before and after. -->
