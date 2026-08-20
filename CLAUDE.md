# CLAUDE.md

## Project status

There is deliberately no status summary in this file. Read it from the sources
that move on their own: `scripts/backlog.sh task list --plain` for what is done
and what is open, `git tag` and the GitHub releases for what has shipped, and
`src/` for what exists. A prose summary here drifts the moment a task lands,
and a stale one has already sent a planning pass down the wrong path.

Planning lives in the nested tracker at `project/`. Read `project/PRODUCT.md`
for the product charter and `project/data-model.md` for the stored shapes
before designing anything that touches storage.

## Commands

- `npm start` — builds and hot-reloads the plugin into a running Zotero dev
  profile (`zotero-plugin serve`). Requires `.env` (copy from `.env.example`)
  with `ZOTERO_PLUGIN_ZOTERO_BIN_PATH` and `ZOTERO_PLUGIN_PROFILE_PATH` set.
- `npm run build` — bundles `src/` and `addon/` into `.scaffold/build/` via
  `zotero-plugin build`, then type-checks with `tsc --noEmit`. Produces the
  .xpi, `update.json` and `update-beta.json`.
- `npm run lint:check` / `npm run lint:fix` — Prettier plus ESLint
  (`@zotero-plugin/eslint-config`).
- `npm test` — runs `test/` via `zotero-plugin test` (Mocha/Chai) against a
  live Zotero. Locally this is a watch session and will not exit on its own.
- `npm run test:fast` — the same run through `scripts/run-tests.mjs`, killed
  the moment the completion line prints. Prefer this for a one-shot pass/fail.
  Safe alongside a dev Zotero from `npm start`: it kills its own process group,
  not everything matching `zotero-bin`.
- `npm run clean:profile` — the `prestart` cleanup on demand.
- `npm run docs:dev` / `docs:build` / `docs:preview` — the VitePress site under
  `docs/`. `docs:build` fails on a dead internal link.
- `npm run release` — version bump plus GitHub release via
  `zotero-plugin release`. The build runs inside it through
  `release.bumpp.execute` in `zotero-plugin.config.ts`.
- `npm run update-deps` — `npm update --save`. It will move the exact pins;
  re-run the build afterwards.

## Scripts

- `scripts/verify.sh` — the verification gate: build, lint, then the live
  Zotero test suite, cheapest stage first. Runs every stage even after one
  fails and exits non-zero naming which. `--no-test` stops before Zotero is
  launched; `--test-only` runs the live stage alone. Linux-only: it identifies
  Zotero processes through `/proc/<pid>/comm`.
- `scripts/backlog.sh` — the Backlog.md CLI pointed at the tracker in
  `project/`. It resolves the package name (`backlog.md`, not `backlog`) and
  the tracker path from the main checkout, so it works from a worktree where
  `project/` is absent.
- `scripts/run-tests.mjs` (`npm run test:fast`) and
  `scripts/clean-dev-profile.mjs` (`npm run clean:profile`, and automatically
  via `prestart`) — see `docs/contributing/npm-scripts-reference.md`.

Per-worktree setup is not a project script: run
`~/.claude/scripts/worktree-init.sh` after creating a worktree. Its hook,
`~/.claude/worktree-hooks/zoteroTimeline.sh`, repoints
`ZOTERO_PLUGIN_PROFILE_PATH` and `ZOTERO_PLUGIN_DATA_DIR` in the worktree's
`.env` at `.scaffold/dev-profile` and `.scaffold/dev-data`, so two worktrees
can run `npm start` without colliding on one shared dev profile.
`~/.claude/scripts/worktree-teardown.sh` removes them again. The hook is
matched by the checkout's **directory** name, `zoteroTimeline`, not by the
repository name on the remote.

## Architecture

A Zotero bootstrap plugin built from `windingwind/zotero-plugin-template`.
`addon/bootstrap.js` calls exactly four lifecycle hooks on the registered
plugin instance: `onStartup`, `onMainWindowLoad`, `onMainWindowUnload` and
`onShutdown`. Everything else hangs off those.

`src/index.ts` constructs the `Addon` instance and registers it as
`Zotero.ZoteroTimeline`, and defines the global `ztoolkit` getter.
`src/hooks.ts` holds the four hooks and nothing that does real work; hooks
dispatch, modules act. `onStartup` sets `addon.data.initialized = true` as its
last step, which is the signal the test harness polls (see Testing below).

Naming flows from one place. `package.json`'s `config` block supplies
`addonName`, `addonID`, `addonRef`, `addonInstance` and `prefsPrefix`, and
`zotero-plugin.config.ts` derives the bundle name, the plugin id, the
namespace, the preference prefix and the `waitForPlugin` expression from it.
Renaming anything means editing that block, not the files that read it.

### Repository layout

```
addon/            packaged plugin resources
  bootstrap.js      the four lifecycle entry points
  manifest.json     identity and the Zotero version range
  content/          icons, preferences.xhtml, stylesheet
  locale/           Fluent strings, en-US and zh-CN
  prefs.js          preference defaults
src/
  index.ts          registers Zotero.ZoteroTimeline, defines ztoolkit
  addon.ts          the Addon class and its data bag
  hooks.ts          the four lifecycle hooks, dispatch only
  utils/            locale, prefs, window, ztoolkit, edtfRange
test/             Mocha specs, executed inside Zotero
typings/          ambient declarations, including one for edtf
docs/             VitePress site, Diataxis-structured
scripts/          verify.sh, backlog.sh, run-tests.mjs, clean-dev-profile.mjs
.github/          CI matrix, release, docs deploy, issue and PR templates
project/          nested Backlog.md repo, gitignored, never published
```

Three gitignored siblings sit beside the source and are reference material,
not project code:

- `zotero-plugin-docs/` — a clone of `windingwind/doc-for-zotero-plugin-dev`,
  the plugin development documentation. Read it before guessing at a Zotero
  API. Refresh with `git -C zotero-plugin-docs pull`.
- `zotero-plugin-toolkit-docs/` — a clone of
  `windingwind/zotero-plugin-toolkit`, the source of the toolkit this plugin
  depends on. The published API docs are thin, so the source is the reference.
  Refresh with `git -C zotero-plugin-toolkit-docs pull`.
- `zotero-plugin-template-examples/` — the template's example modules, moved
  out of `src/` rather than deleted. Menu registration, shortcuts, item-pane
  sections and the VirtualizedTable preference pane are the patterns worth
  having on hand.

Re-clone any of them with `git clone --depth 1 <url> <dir>`; none is required
to build.

## Engineering standards

- **Linting/formatting**: Prettier and ESLint via `@zotero-plugin/eslint-config`.
  `eslint.config.mjs` adds one override, Node globals for `scripts/**`, which
  run under plain Node rather than in Zotero's sandbox. `no-unused-vars` is
  deliberately **not** disabled here; the upstream template turns it off to
  tolerate its own example code, and that code is gone. Prefix a genuinely
  unused binding with `_`.
- **Static analysis**: `tsc --noEmit`, run as the second half of
  `npm run build`. It uses the root `tsconfig.json` and therefore does not
  cover `test/`, which has its own. A changed export signature that breaks a
  test file is caught only when the suite runs.
- **Testing**: Mocha and Chai, executed inside a real Zotero rather than in
  Node. `zotero-plugin.config.ts` sets
  `waitForPlugin: () => Zotero.ZoteroTimeline.data.initialized`; the scaffold
  polls it for 10s and fails the run if the startup hook never sets the flag.
  `Plugin awaiting timeout` therefore means the plugin did not load, not that
  an assertion failed. Why almost nothing here is unit-testable outside Zotero
  is in `docs/contributing/testing-explanation.md`.
- **Manual verification protocol** (for any change touching XUL, vis-timeline,
  or the live Zotero API — none of it is unit-testable, and most failure modes
  in this codebase are _silent_ rather than thrown): before declaring such a
  change done —
  1. Run `scripts/verify.sh`. It covers build, lint and the live suite in one
     pass, and leaves a dev Zotero from `npm start` running while it does. The
     startup check is a real pass/fail signal rather than eyeballing:
     `waitForPlugin` polls the initialized flag for 10s and fails the run if the
     startup hook never sets it. Why `test:fast` rather than raw `npm test` is
     in `docs/contributing/npm-scripts-reference.md`.
  2. There is no log file to tail. `zotero-plugin-scaffold` discards Zotero's
     stdout entirely and never passes `-ZoteroDebugText`, so a failing test run,
     or Help > Debug Output for "Error running bootstrap method", is the only
     signal available.
  3. Working in a worktree: run `~/.claude/scripts/worktree-init.sh` first,
     which gives that worktree its own dev profile. Without it two `npm start`
     instances attach to the same profile and collide: crashes, stale state,
     silent failures. `npm test` needs nothing extra; it resolves its profile
     and data dirs relative to CWD and picks a debugger port dynamically, so
     concurrent test runs across worktrees are already isolated.
  4. Stale state between `npm start` runs is handled: `prestart` runs
     `scripts/clean-dev-profile.mjs`, which kills the Zotero holding this
     checkout's dev profile (otherwise `zotero-plugin serve` silently reuses it
     instead of picking up your fix) and strips leftover `zoterotimeline-*` tab
     entries from the profile's `session.json` (otherwise Zotero restores a
     custom tab type before the plugin registers it, crashing startup before
     your change loads). It identifies that instance by the `-profile` argument
     the scaffold launched it with, so another worktree's dev Zotero, a test
     run, and your own library all survive it.
  5. Confirm the plugin actually appears under Tools > Plugins. A version
     ceiling mismatch (`strict_max_version` in `addon/manifest.json`) blocks
     loading with no console error and no install failure at all.
  6. If Debug Output shows nothing where an error is expected, that is not
     proof of success; console output can be filtered or misrouted. Temporarily
     swap the suspect `Zotero.debug()` calls for
     `ztoolkit.getGlobal("alert")("Reached: <location>")` and bracket the
     failing operation to confirm actual execution flow.
  7. If a third-party library throws a bare `ReferenceError` (`document`,
     `console`, `Image`, `ResizeObserver`, `MutationObserver` undefined), read
     the bundled source directly (`node_modules/<pkg>/dist/*.js`) at the failing
     line rather than guessing. Zotero's bootstrap scope lacks browser globals
     these libraries assume are always present.
  8. Before shipping any `package.json` or manifest change, explicitly check
     the three fields known to fail silently rather than erroring:
     `repository.url` and `homepage` in `package.json` (a missing or
     placeholder value breaks install with no build-time signal) and
     `strict_max_version` in `addon/manifest.json` (blocks loading with no
     console output).
  9. A custom `Zotero_Tabs` tab type persists into `<profile>/session.json`
     across restarts. `prestart` clears this plugin's own entries (step 4), but
     a tab type renamed mid-session leaves an entry under the old name that
     nothing strips. If startup breaks with core `tabs.js` or `itemTree.js`
     errors unrelated to your change, that stale entry is why.
- **Commit convention**: `type(scope): description`, enforced by commitlint
  through the `commit-msg` hook. Type is one of `feat`, `fix`, `improve`,
  `hotfix`, `chore`, `docs`, `test`. `pre-commit` runs `lint-staged`.
- **Editor config**: `.editorconfig` — UTF-8, LF, two-space indent, final
  newline, trailing whitespace trimmed except in Markdown.
- **CI**: `.github/workflows/ci.yml` runs lint, build, and one test job per
  claimed Zotero major against a pinned download (7.0.32, 8.0.4, 9.0.4, 10.0).
  An un-pinned beta job gives early warning and carries `continue-on-error`, so
  it never gates a merge. `.github/workflows/deploy-docs.yml` publishes the
  site and then fetches the published URL to confirm it actually rendered.

## Working conventions

- **Code comments** describe intent and invariants, not provenance. Don't
  reference a tracker id, milestone name, or acceptance-criterion number in a
  code comment; that history belongs in commit messages and the tracker, not in
  code that outlives them.
- **Dependency additions**: don't add a new npm dependency without asking
  first. Use `AskUserQuestion` and frame it concretely — what the workaround
  costs (extra code to write and maintain, a narrower feature, a rougher edge
  case) against what the dependency buys, plus its footprint (bundle size,
  maintenance surface, license). Skip the question only when there is no
  genuine tradeoff to weigh, and then just don't add it.
- **`project/` commits**: the `backlog` CLI and manual edits to
  `project/PRODUCT.md` write directly into that nested repo's working tree
  without committing. Commit planning changes there promptly after a planning
  pass; don't leave `project/` dirty across sessions.
- **Abstraction threshold (rule of three)**: don't extract a shared helper,
  base class, or generic type until the same logic shows up at a third call
  site. Two occurrences stay duplicated; a third is the signal it is an actual
  pattern rather than a coincidence. Applies to `src/` logic and XUL wiring
  alike, and not to files where structural repetition is inherent to the format
  (per-locale `.ftl` entries, tracker files).
- **Periodic duplication sweep**: at each milestone boundary, scan `src/` for
  logic duplicated three or more times that the rule-of-three threshold missed
  in the moment. Report candidates rather than refactoring unprompted; this is
  a flag-for-review step, not a license to abstract on sight.
- **zoteroMindmap is this plugin's reference implementation, and its source is
  the authority.** `/home/oscar/projects/zoteroMindmap` is a shipped Zotero 7-10
  plugin by the same author, for the same user, on the same platform, with the
  same storage and sync design. Most of what is left to build here already works
  there: the item-pane section, the library context menu, the tab shell, the
  render path, the authoring form, the vocabulary editor. Before writing a
  module, read the corresponding one; `project/mindmap-reference-map.md` maps
  every module to every milestone, and each m-1 task carries a pointer to the
  file it should be read against. Read the _source_, not its `CLAUDE.md`,
  `CONTRIBUTING.md` or project memory: all three lag its code, in at least two
  places where the code is right. A deviation is allowed and needs a reason;
  two are already decided and recorded in the map.
- **Code copied from another repo gets read against its code, and its defects
  get filed where they came from.** Most of this repo's tooling came from
  zoteroMindmap. Copying carried across live bugs and comments describing
  behaviour that had been deleted, none of which its own hand-off notes
  mentioned, because those notes checked that a file names no plugin rather
  than that it is correct. When a copied file turns out to be wrong, fix it here
  and file a task in the source repo too; a fix that lands only here leaves the
  other project running the bug.
- **Version pins**: `zotero-plugin-toolkit`, `zotero-types`, `vis-timeline` and
  `edtf` are pinned exactly, without a caret. The upstream template's ranges
  resolve to newer betas with renamed exports, and `tsc --noEmit` then fails on
  code that did not change.
