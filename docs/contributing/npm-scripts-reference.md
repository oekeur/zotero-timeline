# npm scripts

Every script defined in `package.json`, and what it actually runs.

## Build and run

| Script          | Runs                                  | Notes                                                                         |
| --------------- | ------------------------------------- | ----------------------------------------------------------------------------- |
| `start`         | `zotero-plugin serve`                 | Launches Zotero against the `.env` dev profile and reloads on change.         |
| `prestart`      | `node scripts/clean-dev-profile.mjs`  | Runs automatically before `start`. See below.                                 |
| `build`         | `zotero-plugin build && tsc --noEmit` | Produces the .xpi, `update.json` and `update-beta.json` in `.scaffold/build`. |
| `release`       | `zotero-plugin release`               | Bumps the version and builds through `release.bumpp.execute`.                 |
| `clean:profile` | `node scripts/clean-dev-profile.mjs`  | The same cleanup, on demand.                                                  |

`build` type-checks `src/` but not `test/`, because `tsc --noEmit` here uses the
root `tsconfig.json`. A changed export signature that breaks a test file is
caught by the test stage, not the build.

## Lint

| Script       | Runs                                   |
| ------------ | -------------------------------------- |
| `lint:check` | `prettier --check . && eslint .`       |
| `lint:fix`   | `prettier --write . && eslint . --fix` |

## Test

| Script      | Runs                         | Notes                                      |
| ----------- | ---------------------------- | ------------------------------------------ |
| `test`      | `zotero-plugin test`         | What CI runs.                              |
| `test:fast` | `node scripts/run-tests.mjs` | The same suite, wrapped. Use this locally. |

`test:fast` exists because `zotero-plugin test` starts a real Zotero GUI that
does not reliably exit once the suite has finished. The wrapper watches stdout
for the `Test run completed` line and kills the run at that point rather than
waiting.

It spawns the run detached, in its own process group, so it can kill that group
by id. Killing by pattern instead matches every Zotero on the machine: a dev
instance from `npm start`, another worktree's test run, and your own library
along with them.

Its exit code comes from the parsed summary line, not from the killed process.
A run that prints no summary within 15 minutes is treated as a hang and exits
non-zero.

## Docs

| Script         | Runs                     |
| -------------- | ------------------------ |
| `docs:dev`     | `vitepress dev docs`     |
| `docs:build`   | `vitepress build docs`   |
| `docs:preview` | `vitepress preview docs` |

`docs:build` validates internal links and fails on a dead one. Prose references
to a renamed page break silently in the source and loudly here, which is the
point of running it.

## Housekeeping

| Script        | Runs                | Notes                                          |
| ------------- | ------------------- | ---------------------------------------------- |
| `prepare`     | `husky`             | Installs the Git hooks. Runs on `npm install`. |
| `update-deps` | `npm update --save` | Will move the pinned versions; see below.      |

## What `clean-dev-profile.mjs` does

Two things that otherwise cause silent breakage between `npm start` runs.

It kills the Zotero still holding this checkout's dev profile after a crash or
a manifest error. Without that, `zotero-plugin serve` reuses the running
instance and your fix appears not to have worked.

It identifies that instance by two conditions together: `argv[0]` ends in
`/zotero` or `/zotero-bin`, **and** the remaining arguments contain the literal
`-profile <resolved path>` from your `.env`. That pair is what keeps it from
touching another worktree's dev Zotero or your own library.

It also strips leftover custom-tab entries for this plugin from the profile's
`session.json`. Zotero restores open tabs before plugins register their tab
types, so a stale entry crashes startup.

With no `ZOTERO_PLUGIN_PROFILE_PATH` in `.env` it does nothing and says so.
There is nothing to identify the right process by, and guessing means killing
someone else's Zotero.

## Pinned versions

`zotero-plugin-toolkit`, `zotero-types`, `vis-timeline` and `edtf` are pinned
exactly, with no caret. The toolkit and types ranges in the upstream template
resolve to newer betas with renamed exports, and `tsc --noEmit` then fails on
code that did not change. `update-deps` will move them; check the build after
running it.
