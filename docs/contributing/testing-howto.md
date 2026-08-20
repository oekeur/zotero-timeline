# Running tests

## The short version

```bash
npm run test:fast
```

A real Zotero starts, the plugin is installed into it as a temporary add-on,
Mocha runs inside that privileged window, and the wrapper kills the run once
the summary line appears.

Expect it to take a couple of minutes, most of which is Zotero starting.

## Through the verification gate

```bash
scripts/verify.sh
```

Build, lint, then the suite. Use this before opening a pull request; it is what
the PR template asks for.

```bash
scripts/verify.sh --test-only
```

Skips build and lint when you have already run them.

## Writing a test

Tests live in `test/` and are ordinary Mocha with Chai's `assert`. They execute
inside Zotero, so the Zotero globals are available directly:

```ts
import { assert } from "chai";
import { config } from "../package.json";

describe("startup", function () {
  it("should have plugin instance defined", function () {
    assert.isNotEmpty(Zotero[config.addonInstance]);
  });
});
```

`test/tsconfig.json` covers this directory. The root `tsc --noEmit` that
`npm run build` runs does not, so a test file broken by a changed export
signature is caught only when the suite runs.

## The startup gate

Before running anything, the scaffold polls the expression in
`zotero-plugin.config.ts`:

```ts
test: {
  waitForPlugin: `() => Zotero.${pkg.config.addonInstance}.data.initialized`,
},
```

Two things have to hold or every run fails before the first test. The plugin
must register itself as `Zotero.ZoteroTimeline`, which `src/index.ts` does, and
`onStartup` in `src/hooks.ts` must set `addon.data.initialized = true` when it
finishes.

If you see `Plugin awaiting timeout`, that flag was never set. The plugin threw
during startup, or never loaded at all. Look at Help > Debug Output rather than
at the test output, which will only tell you the poll expired.

## Running before you have a fix

A test that fails and a plugin that never loads produce different output, and
it is worth knowing which you have. `Test run completed - N passed, M failed`
means the plugin loaded and your assertion is wrong. Anything that ends in a
timeout means the plugin did not get far enough to run a test.

## In CI

`.github/workflows/ci.yml` runs `npm run test` once per claimed Zotero major,
against a pinned download rather than the beta channel, so a green run records
what it passed against. A separate un-pinned beta job gives early warning of
the next Zotero and carries `continue-on-error`, so it never gates a merge.
