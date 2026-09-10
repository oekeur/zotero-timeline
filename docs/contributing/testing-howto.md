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

## When a failing run is not about your change

One failure signature has three unrelated causes, and they are indistinguishable
by symptom: **widespread `"before each" hook … undefined` failures across spec
files that have nothing to do with what you changed**, passes and failures
interleaved, assertion messages lost. Sometimes the run ends in
`Zotero exited (code 0) before printing a completion line` or an esbuild
deadlock instead.

The three causes, all measured:

1. **A second run against the same worktree.** `npm run test:fast` takes longer
   than the Bash tool's default timeout, so it gets backgrounded automatically
   even when nobody asked for that. Starting another run then collides with the
   first on `.scaffold/test/profile`. Pass an explicit long timeout on a full
   run, and check `ps -eo pid,args | grep '[z]otero-plugin test'` before
   starting one. `pgrep -f` matches the checking command itself, so use the
   bracket form.
2. **An orphaned Zotero holding the test profile** from a run that was killed.
   `ps -eo pid,args | grep '[z]otero-bin'` and match the `-profile` argument
   against this worktree's path; another project's processes look identical and
   must be left alone. Then `rm -rf .scaffold/test`.
3. **Memory pressure**, usually another checkout's dev instances. Read
   `free -m`'s **Swap** line, not `Mem` — available RAM can look healthy while
   swap is exhausted.

None of these says anything about your code. Clear the cause and re-run once
before reading a single failure.

If a run still looks wrong, the cheap discriminator is an A/B against the
previous commit: check it out in a throwaway detached worktree with its own
profile and RDP port, and run the same narrowed command. **Both legs must be
isolated** — running one leg in a worktree where something else is already
running produces a difference that proves nothing.

Do not pipe a run through `| tail -N`. It discards the detail you need to read
the failure later. Capture to a file and read the file.

## Diagnosing a section that will not update

Zotero has six independent gates between "the plugin wants its item-pane
section re-rendered" and "the section re-renders", and documents none of them.
A fix aimed at one gate passes its own spec and fails on the next, so reading
the code and fixing what looks wrong discovers roughly one gate per attempt.

Print all six first. `test/support-renderGates.ts` reads them for every live
instance of a section:

```ts
import { describeRenderGates } from "./support-renderGates";

// in a failure message, or a temporary probe
describeRenderGates(win, "zoterotimeline-citing-events");
```

It reports, per instance: the item the pane displays versus the item the
section last rendered (these diverge, and the divergence is the cause of
several defects), `hidden`, `skipRender`, the section's `_syncRenderPending`,
item-details' `_pendingRender`, whether Zotero considers the pane visible, and
`_lastScrollTop`.

Two things that follow from the gates and are easy to get wrong:

- **Never re-render by calling your render function against a captured body
  element.** That bypasses the wrapper's render bookkeeping and leaves the
  section showing another item's content permanently. Use the `refresh()` prop
  that `registerSection`'s `onInit` hook receives.
- **State belongs to the section element, not the window.** `ItemPaneManager`
  creates one instance per `item-details`, and the context pane builds a
  separate one for every reader and note tab. Key anything you cache on the
  element and drop it in `onDestroy`.

## In CI

`.github/workflows/ci.yml` runs `npm run test` once per claimed Zotero major,
against a pinned download rather than the beta channel, so a green run records
what it passed against. A separate un-pinned beta job gives early warning of
the next Zotero and carries `continue-on-error`, so it never gates a merge.
