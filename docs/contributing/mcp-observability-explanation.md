# Why the MCP observability rig was adopted

Trialled 2026-08-20 against `@introfini/mcp-server-zotero-dev@1.1.3` with its
companion `zotero-mcp-bridge` plugin at `plugin-v1.0.5`, on Zotero
10.0-beta.25 under Linux. **Verdict: adopt.** Both conditions the trial was
supposed to decide on came back positive: hot reload survives the bridge, and
the error path reports what previously reached nobody.

The comparison is not against a good status quo. `zotero-plugin-scaffold`
discards Zotero's stdout and never passes `-ZoteroDebugText`, so before this
there was no log stream at all, and every visual check was handed to a human.

## What the rig is

Two halves. An MCP server that runs under the AI client, and a small Zotero
plugin (the bridge) that opens a Firefox Remote Debugging Protocol listener on
a port agreed in advance, default 6100. The server drives Zotero through that
listener.

The bridge exists because the port scaffold already opens cannot be reached.
`npm start` does start a DevTools server: `startZoteroInstance` calls
`findFreeTcpPort()`, which is `srv.listen(0)` against an OS-assigned ephemeral
port, then passes `-start-debugger-server <port>` and connects to it itself for
hot reload. The number changes every run and is logged only at `trace`.

## The risk that could have killed it, and why it did not

Two RDP listeners on one Zotero was the stated reason to run this trial before
committing to anything: the scaffold's hot reload rides on its own connection,
and `installTemporaryAddon` runs through it.

They do not collide, and the bridge's source says why. It builds its own
loader with `new DevToolsLoader({ freshCompartment: true })` and calls
`DevToolsServer.init()` inside that compartment, so it gets a separate
`DevToolsServer` instance from the one the scaffold's `-start-debugger-server`
flag starts. Two servers, one listener each, rather than two listeners fighting
over one server.

Measured, not just read: with the bridge installed, scaffold reported
`Installed ... as a temporary add-on`, and editing `src/hooks.ts` rebuilt and
reloaded the plugin with the new code running. A marker added to `onStartup`
appeared in the log after the reload that introduced it.

## What each probe returned

**Errors, the highest-value call.** A deliberate `throw` from `onStartup`
produced this from `zotero_read_errors`:

```
Error running bootstrap method 'startup' on zoterotimeline@oekeur.github.io
[timeline-probe] deliberate startup failure
  at .../.scaffold/build/addon//content/scripts/zoterotimeline.js:0:44230
```

The first line is what Debug Output shows today and is the entire signal
currently available. The second and third are new: the actual message and the
file it came from. There is no source map, so the position is an offset into
the bundle rather than a line in the TypeScript, which is worth knowing before
relying on it.

**Logs, with a precondition nothing documents.** `zotero_read_logs` returned
"Debug output is not enabled" and told us to run `Zotero.Debug.init(true)`.
That alone is not enough and the message is wrong to imply it is: `init` sets
whether output is _emitted_, while the buffer the bridge reads is governed by
`debug.store`. Reading Zotero's own `Debug.init`:

```js
_store = Zotero.Prefs.get("debug.store");
if (_store) {
  Zotero.Prefs.set("debug.store", false);
}
```

The preference is read once at startup and immediately cleared, so it is a
one-shot that has to be re-armed for every launch. Enabling it by hand at
runtime is also too late for the thing most worth reading, since the startup
lines are already gone. Writing it through scaffold's `server.prefs` fixes
both, because those prefs are written into the dev profile before each launch.
With that in place the bridge's own boot sequence was in the buffer:

```
[MCP RDP] startup() called, reason=1
[MCP RDP] Starting RDP server on port 6100
[MCP RDP] Listener opened on port 6100
```

**Ports, and a silent failure worth designing against.** Every dev profile
carrying the bridge defaults to 6100, so two worktrees running `npm start` at
once both want it. Setting `extensions.mcp-rdp.port` works, but only from
bridge `plugin-v1.0.5`: the 1.0.4 notes claimed the fix and shipped without it,
because the change landed in `src/bootstrap.ts` while the build packages
`src/bootstrap.js`. Two instances were run side by side and `ss` confirmed one
Zotero process per port, 6100 and 6101.

When the second instance is left on the default, it does not fail loudly. It
binds nothing and keeps running, its window open and normal, while the MCP
client goes on answering from the _first_ Zotero. `zotero_ping` still succeeds;
it just describes the wrong instance. Nothing in the client distinguishes that
from the case you intended. Per-worktree ports are what prevent it.

**Persistence.** The bridge survives a `prestart` cycle.
`scripts/clean-dev-profile.mjs` kills one process by its `-profile` argument
and rewrites `session.json`, and never touches `extensions/`. It does not
survive a new worktree, since `worktree-init.sh` mints a fresh
`.scaffold/dev-profile`, so installing it is a per-worktree step.

**Installation needs nobody at the keyboard.** The trial expected a
Tools > Plugins > Install Plugin From File. It is not necessary. Unpack the
XPI somewhere stable and write a proxy file at
`<profile>/extensions/mcp-rdp@zotero.org` containing the absolute path to that
directory. This is the same mechanism scaffold implements in
`installProxyPlugin`, and the dev profile it builds already sets
`extensions.autoDisableScopes: 0`, so the sideloaded plugin is not held for
approval.

**The database reads fine while Zotero runs.** `zotero_db_query` answered
against a live instance with no lock error, so the "Zotero must be closed"
caveat did not bite. Two rough edges: computed or aliased columns come back as
`col1`, `col2`, `col3` with the aliases discarded, though real column names
survive; and `zotero_db_stats` reported "Libraries (7)" all `undefined` where
`SELECT libraryID, type FROM libraries` returned exactly one row, so that
particular summary is not to be trusted.

## What the UI half is actually worth

The intended experiment was to screenshot the timeline, comment out
`ensureStylesheet()`, and screenshot it again, on the theory that vis-timeline's
bundled `styleInject` is dead in Zotero's bootstrap scope.

**That experiment has no second state any more, and the reason is a finding
about this repo rather than about the tools.** `./fixture` is imported
dynamically at tab-open, deliberately, so Hammer sees a real window. By then
`ensureWindowGlobals()` has installed `document` on `globalThis`. vis-timeline
therefore evaluates with `typeof document === "object"`, `styleInject` runs,
and the CSS is injected as `<style>` blocks regardless of `ensureStylesheet()`.
Removing the call changed nothing, on a hot reload and on a cold start alike.
The comment above `ensureStylesheet` still describes the older situation. It is
recorded here and left alone; deciding what to do about a now-redundant call is
separate work.

An equivalent failure was staged instead by deleting the injected `<style>`
elements at runtime, which produces the same class of silent visual break. The
answer is unambiguous. Styled, the tab shows four bordered event boxes across a
1565-1605 axis in two labelled rows. Stripped, the axis, the grid and both row
labels remain and **every event box is gone**. Nobody needs to squint at those
two images to tell them apart, and nothing was thrown in either state.

The supporting calls behave. `zotero_get_styles` on `.vis-item` showed
`position` dropping from `absolute` to `static` and the background going
transparent. `zotero_get_dom_tree` showed the element tree fully intact with
`vis-itemset` still holding its two children, which is the distinction that
matters when a render looks empty: the DOM is present and the CSS is missing,
not the other way round. One wrinkle, `zotero_get_styles` silently returned
three of the four properties asked for, dropping `border-top-style` without
saying so, so treat an absent property as unanswered rather than as a value.

## One thing it does not do

`zotero_execute_js` runs in the main window's chrome scope; `location` reads
`chrome://zotero/content/zoteroPane.xhtml`, and `document`, `window`, `Image`,
`ResizeObserver` and `MutationObserver` all exist there. It cannot answer
whether a global exists in the _bootstrap_ scope where a plugin bundle
evaluates, because it will always say yes. That question still needs a probe
inside the plugin. The read-the-bundled-source-and-guess loop in the
verification protocol is narrowed by this tool, not retired by it.

## The dependency

Single author, MIT, 46 commits at the time of the trial. That is a real
consideration and it is stated rather than left implicit. It is acceptable
here because nothing ships against it: it is a development-time observability
tool, and losing it costs visibility, not a release.
