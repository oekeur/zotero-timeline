# Contributing

## Reporting a bug

Open a [bug report](https://github.com/oekeur/zotero-timeline/issues/new/choose).
Before you do, check that "Zotero Timeline" actually appears under
Tools -> Plugins. A plugin that fails to load does so quietly, with no error
dialog, and that accounts for most reports that turn out not to be bugs.

Attach debug output where you can: Help -> Debug Output Logging -> Enable,
reproduce the problem, then View Output. The plugin writes no log file, so that
panel is usually the only signal available.

## Requesting a feature

Open a [feature request](https://github.com/oekeur/zotero-timeline/issues/new/choose).
Describe the situation in your own library first and the feature second. What
gets tedious, impossible, or lossy today is the part that is hard to guess.

Some things are ruled out by design rather than not yet built. The
"What this is not" section of [README.md](README.md) lists them with the
reasoning, so check there before writing up a proposal.

## Setting up

Full instructions are in
[Development setup](https://oekeur.github.io/zotero-timeline/contributing/development-setup).
The short version:

```bash
npm install
cp .env.example .env    # then fill in the Zotero binary, profile and data dir
npm start
```

Point `ZOTERO_PLUGIN_PROFILE_PATH` and `ZOTERO_PLUGIN_DATA_DIR` at a profile
and data directory used only for developing this plugin, never at your real
library. Neither path has to exist first; the dev server creates both.

## Before you open a pull request

Run the verification gate:

```bash
scripts/verify.sh
```

It runs build, lint and the live Zotero test suite, continues past a failing
stage, and exits non-zero naming which stages failed.

**If your change touches XUL, vis-timeline, or the live Zotero API, drive it
manually as well.** None of that surface is unit-testable here, and its
failures are silent rather than thrown: no exception, no console error, just a
panel that does not render or a plugin that never loads. Run `npm start`,
exercise the change, confirm the plugin still lists under Tools -> Plugins, and
check Debug Output for "Error running bootstrap method".

Changing `package.json` or `addon/manifest.json` adds three fields to check by
hand, because all three fail silently: `repository.url` and `homepage` (a wrong
value breaks installation with no build-time signal) and `strict_max_version`
(blocks loading with no console output at all).

## Commits and branches

Commit messages follow `type(scope): description`, checked by commitlint
through the `commit-msg` hook. Type is one of `feat`, `fix`, `improve`,
`hotfix`, `chore`, `docs`, `test`. Branches follow the same vocabulary:
`feat/*`, `fix/*`, `improve/*`, `hotfix/*`, `release/*`.

`pre-commit` runs `lint-staged`, which applies `eslint --fix` and Prettier to
staged files, so most formatting fixes itself.

## Documentation

The site under `docs/` is VitePress, organised by audience and by Diataxis
type: `user-guide/`, `contributing/` and `internals/`, with the type carried in
the filename (`-howto`, `-reference`, `-explanation`). Tutorials carry no
suffix.

```bash
npm run docs:dev      # live preview
npm run docs:build    # what CI runs; fails on a dead internal link
```

Run `docs:build` before pushing a docs change. Prose references to a renamed
page break silently in the source and loudly there.

User-facing behaviour changes belong in `docs/user-guide/`. Constraints a
future contributor would otherwise have to rediscover belong in
`docs/internals/`. Images go in `docs/images/` and are referenced by relative
path.

## License

AGPL-3.0-or-later. See [LICENSE](LICENSE). By contributing you agree that your
contributions are licensed under it.
