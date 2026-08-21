# Use the MCP observability rig to debug a running Zotero

The rig reads Zotero's debug buffer, reports the error behind
"Error running bootstrap method", and screenshots the running window. Reach
for it whenever a failure is silent, which in this codebase is most of them.

Why it was adopted, and what it cannot do, is in
[Why the MCP observability rig was adopted](./mcp-observability-explanation).

## Set it up in a worktree

The install lives in the dev profile, and `worktree-init.sh` mints a fresh one
per worktree, so this is once per worktree. Almost all of it is automatic.

1. Run `~/.claude/scripts/worktree-init.sh`. Its hook downloads the pinned
   bridge into `~/.cache/zotero-mcp-bridge/plugin-v1.0.5/` on first use,
   installs it into this worktree's dev profile as a proxy file, assigns this
   worktree an RDP port, and writes that port into `.env` as
   `ZOTERO_MCP_RDP_PORT`. It prints the port and the `claude mcp add` line for
   it.

   `zotero-plugin.config.ts` carries the other half: `server.prefs` writes
   `extensions.mcp-rdp.port` from that variable and arms
   `extensions.zotero.debug.store` before every launch. The arming is per
   launch by necessity, because Zotero's `Debug.init` reads the preference once
   and immediately clears it, and turning it on by hand later has already
   missed every startup line.

   That clearing is also why `debug.store` is **not** in the profile's
   `prefs.js` after a launch: setting a preference back to its default drops
   the `user_pref` line entirely. Its absence there is the mechanism working,
   not a failed write. `extensions.mcp-rdp.port` does stay, so that is the one
   to grep for when checking the profile.

2. Nothing to register. The client side is single-valued, so each port needs
   its own entry, and the whole pool is already registered in Oscar's user
   config: `zotero-dev` on 6100 for the main checkout, and `zotero-dev-6101`
   through `zotero-dev-6110` for worktrees. Pre-registering is not tidiness. A
   newly added entry only connects at the **next** session start, so registering
   one when a worktree appears leaves the session that needs the rig without it.

   The hook warns and prints the `claude mcp add` line if the pool ever has a
   gap. If you run it yourself, do not use `npx install-mcp`: it can write a
   config with neither `-y` nor a version, which then runs whatever `npx` has
   cached.

3. Call the entry that matches your port. Port 6100 means the `mcp__zotero-dev__*`
   tools; port `N` means `mcp__zotero-dev-N__*`. Then run `npm start`, call
   `zotero_ping`, and **read the data directory it reports back**. See the port
   warning below for why that check is not optional.

The main checkout is set up the same way and always takes port 6100; running
`worktree-init.sh` there installs the bridge without touching the shared dev
profile paths.

## Which call answers which question

Reach for the narrowest tool that answers the question.

| Symptom                                    | Call                                                                                          |
| ------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Startup broke, or something failed quietly | `zotero_read_errors` — the real message and source, not just "Error running bootstrap method" |
| Need this plugin's own trace               | `zotero_read_logs` with a `filter`, once `debug.store` is armed                               |
| Tab renders blank, wrong or unstyled       | `zotero_screenshot`, then `zotero_get_dom_tree`                                               |
| A control looks right but behaves wrong    | `zotero_get_styles` on the element                                                            |
| Need live state, or to drive the plugin    | `zotero_execute_js`                                                                           |
| Question about stored library data         | `zotero_db_query` — it reads fine while Zotero runs                                           |

When a render looks empty, take the screenshot **and** the DOM tree. Together
they separate the two cases that look identical from the outside: an element
tree that is present but invisible is a CSS problem, one that is missing is a
render or exception problem. Guessing between those has cost real time here.

Skip `zotero_scaffold_build`, `serve`, `lint` and `typecheck`. `scripts/verify.sh`
already sequences those cheapest-first, runs every stage after a failure, and
names which one failed.

## Two ports, and the failure that says nothing

Every dev profile carrying the bridge defaults to 6100. Two worktrees running
`npm start` at once therefore both want it, and the loser does not complain:
the second Zotero binds nothing, its window looks entirely normal, and the MCP
client keeps answering from the **first** Zotero. `zotero_ping` still succeeds.
It just describes the wrong instance.

Per-worktree ports are what prevent this, and are why `ZOTERO_MCP_RDP_PORT` is
assigned by the hook rather than left to the bridge's default. The assignment
is sticky: a checkout keeps the port already in its `.env`, so the client entry
you registered against it does not quietly start pointing somewhere else. Still
confirm after every `npm start` that the data directory `zotero_ping` reports
is the worktree you are actually working in.

## What it will not tell you

`zotero_execute_js` runs in the main window's chrome scope, where `document`,
`window`, `Image`, `ResizeObserver` and `MutationObserver` all exist. It cannot
tell you whether a global exists in the **bootstrap** scope where a plugin
bundle evaluates, because it will always say yes. That question still needs a
probe inside the plugin itself.

Two smaller edges. `zotero_get_styles` can return fewer properties than asked
for without saying so, so treat an absent property as unanswered rather than as
a value. And `zotero_db_stats` miscounts libraries; use `zotero_db_query`.
