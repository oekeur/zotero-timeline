# Why tests run against live Zotero

The suite starts a real Zotero, installs the plugin into it, and runs Mocha
inside that window. That is slow, it needs a display, and it cannot run in a
plain Node process. It is still the right choice, for one reason: almost
nothing this plugin does is meaningful outside Zotero's privileged scope.

## What a mocked test would be testing

A Zotero plugin is mostly calls into Zotero: item creation, note content reads
and writes, the notifier, tab registration, preference panes, Fluent string
resolution. Mock those and the test asserts that your code calls your mock the
way you wrote your mock to be called. It passes whether or not the real API
behaves that way.

The failures that actually happen here are exactly the ones a mock cannot
reproduce:

- An API that exists on Zotero 10 but not on 7.
- A manifest field whose wrong value blocks loading with no output at all.
- A library that assumes a browser `document` or `window` and finds neither.
- A tab type restored from `session.json` before the plugin registered it.

## The cost, and where it lands

**It is slow.** Most of the runtime is Zotero starting, not tests running.
`npm run test:fast` exists to stop it being slower than it has to be: the GUI
does not reliably exit after Mocha finishes, so the wrapper watches for the
completion line and kills the run there rather than waiting for an exit that
may never come.

**Exit codes are unreliable.** Because the run is killed, the process's exit
code reflects the kill, not the outcome. Both the wrapper and the pre-merge
gate parse the printed `Test run completed` summary line instead, and treat a
missing line as a failure.

**Killing is dangerous.** The obvious way to clean up, matching `zotero-bin`
against every process's command line, matches your own library, another
worktree's test run, and any shell command that happens to mention the string.
That mistake was made here and took down every Zotero on the machine. The
current code identifies a process by `argv[0]` plus the exact `-profile`
argument, or by process group id for a run it started itself.

**Concurrency needs care.** Test profiles are resolved relative to the working
directory and the debugger port is picked dynamically, so concurrent runs in
different worktrees do not collide. The dev profile from `npm start` is not
like that: it comes from `.env`, so each worktree gets its own repointed at
`.scaffold/dev-profile`.

## What is not covered

Anything requiring a person to look at it. Rendering, drag behaviour, whether
a menu entry appears in the right place, whether a tab survives a restart. The
suite proves the plugin loads and its logic holds; it cannot prove the UI is
right.

That gap is why the pull request template asks separately for a manual pass
through `npm start`, and why acceptance criteria in the tracker are marked
`(human-verified)` when a person has to see or click the result.
