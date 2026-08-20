# Development setup

## Prerequisites

- Node.js 22 or newer, and npm.
- A Zotero binary to develop against. Zotero 7 through 10 are supported; the CI
  matrix pins 7.0.32, 8.0.4, 9.0.4 and 10.0.
- Linux is assumed by `scripts/verify.sh` and `scripts/clean-dev-profile.mjs`,
  which identify running Zotero processes through `/proc` and `ps`.

## Install

```bash
git clone https://github.com/oekeur/zotero-timeline.git
cd zotero-timeline
npm install
```

`npm install` runs `husky` through the `prepare` script, which installs the
Git hooks in `.husky/`.

## Configure the dev profile

Copy `.env.example` to `.env` and fill in three values:

```ini
ZOTERO_PLUGIN_ZOTERO_BIN_PATH = /path/to/zotero
ZOTERO_PLUGIN_PROFILE_PATH = /path/to/a/dev/profile
ZOTERO_PLUGIN_DATA_DIR = /path/to/a/dev/data/dir
```

Neither the profile nor the data dir has to exist first. The scaffold's dev
server creates both on the first `npm start`.

Use a profile and data directory dedicated to this plugin. `npm start` runs
`clean-dev-profile.mjs` first, which kills the Zotero holding the profile named
in `.env`. If two plugins share one profile path, starting either one kills the
other's dev instance.

Never point these at your real library.

## Run it

```bash
npm start
```

This builds, launches Zotero against the dev profile, and reloads the plugin
when a source file changes.

**Check Tools > Plugins after it opens.** A plugin that fails to load does so
quietly, with no error dialog and often no console output. If "Zotero Timeline"
is not listed, it did not load, and whatever you are about to test is testing
nothing.

## Verify a change

```bash
scripts/verify.sh
```

Build, lint, then the live test suite, in the order that fails cheapest first.
It runs every stage even after one fails and exits non-zero naming the stages
that failed.

```bash
scripts/verify.sh --no-test     # build and lint only, no Zotero launched
scripts/verify.sh --test-only   # the live suite only
```

## Commits

Commit messages are checked by commitlint through the `commit-msg` hook. The
type must be one of `feat`, `fix`, `improve`, `hotfix`, `chore`, `docs`, `test`:

```
type(scope): description
```

`pre-commit` runs `lint-staged`, which applies `eslint --fix` and `prettier`
to staged files.

## The tracker

Planning lives in a nested Backlog.md repository at `project/`, which is
gitignored by this repo and never published with the source. Reach it through:

```bash
scripts/backlog.sh task list --plain
```

The wrapper exists because the npm package is `backlog.md` rather than
`backlog`, and because the CLI has to run against `project/` rather than the
repository root. It resolves `project/` against the main checkout, so it works
from a linked worktree where that directory is not present.
