# Use the MCP observability rig to debug a running Zotero

The rig reads Zotero's debug buffer, reports the error behind
"Error running bootstrap method", and screenshots the running window. Reach
for it whenever a failure is silent, which in this codebase is most of them.

Why it was adopted, and what it cannot do, is in
[Why the MCP observability rig was adopted](./mcp-observability-explanation).
Wiring it into `worktree-init.sh` and `zotero-plugin.config.ts` is TASK-20 and
has not landed, so the setup below is manual for now.

## Set it up in a worktree

The install lives in the dev profile, and `worktree-init.sh` mints a fresh one
per worktree, so this is once per worktree. It needs no file picker.

1. Download and unpack the bridge, pinned. The port preference does nothing
   before `plugin-v1.0.5`.

   ```sh
   gh release download plugin-v1.0.5 --repo introfini/mcp-server-zotero-dev \
     --dir /tmp/mcp-bridge
   unzip -o -d .scaffold/mcp-bridge /tmp/mcp-bridge/zotero-mcp-bridge-1.0.5.xpi
   ```

2. Point the dev profile at the unpacked directory with a proxy file whose
   only content is that absolute path. The dev profile scaffold builds already
   sets `extensions.autoDisableScopes: 0`, so nothing holds the plugin for
   approval.

   ```sh
   mkdir -p .scaffold/dev-profile/extensions
   echo "$PWD/.scaffold/mcp-bridge" \
     > ".scaffold/dev-profile/extensions/mcp-rdp@zotero.org"
   ```

3. Add the two preferences to `zotero-plugin.config.ts`. Scaffold writes
   `server.prefs` into the profile before every launch, which is what makes
   `debug.store` work at all: Zotero reads it once at startup and immediately
   clears it, so it has to be re-armed per launch, and turning it on by hand
   later misses every startup line.

   ```ts
   server: {
     prefs: {
       "extensions.mcp-rdp.port": Number(process.env.ZOTERO_MCP_RDP_PORT ?? 6100),
       "extensions.zotero.debug.store": true,
       "extensions.zotero.debug.log": true,
     },
   },
   ```

4. Register the MCP server in your own Claude Code config, pinned, with
   `ZOTERO_RDP_PORT` matching the port above. Do not run `npx install-mcp`; it
   can write a config with neither `-y` nor a version, which then runs whatever
   `npx` has cached.

   ```sh
   claude mcp add zotero-dev --scope user \
     --env ZOTERO_RDP_PORT=6100 \
     -- npx -y @introfini/mcp-server-zotero-dev@1.1.3
   ```

5. Run `npm start`, then call `zotero_ping` and **read the data directory it
   reports back**. See the port warning below for why that check is not
   optional.

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

So give each worktree its own port through `ZOTERO_MCP_RDP_PORT` in its `.env`,
register a second server entry against that port, and confirm after every
`npm start` that the data directory `zotero_ping` reports is the worktree you
are actually working in.

## What it will not tell you

`zotero_execute_js` runs in the main window's chrome scope, where `document`,
`window`, `Image`, `ResizeObserver` and `MutationObserver` all exist. It cannot
tell you whether a global exists in the **bootstrap** scope where a plugin
bundle evaluates, because it will always say yes. That question still needs a
probe inside the plugin itself.

Two smaller edges. `zotero_get_styles` can return fewer properties than asked
for without saying so, so treat an absent property as unanswered rather than as
a value. And `zotero_db_stats` miscounts libraries; use `zotero_db_query`.
