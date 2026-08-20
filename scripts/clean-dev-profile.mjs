#!/usr/bin/env node
// Cleans dev-profile state that causes silent breakage between npm start runs:
// - a Zotero left running against this checkout's dev profile after a crash or
//   manifest error (masks fixes because `zotero-plugin serve` reuses it instead
//   of launching fresh)
// - leftover custom-tab entries in session.json for this addon's tab types
//   (Zotero restores them before the plugin registers the type, crashing startup)
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function parseEnvFile(envPath) {
  const vars = {};
  if (!existsSync(envPath)) return vars;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    vars[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return vars;
}

// Kills only the Zotero holding this checkout's dev profile. The scaffold
// launches it with `-profile <resolved path>` (ZoteroRunner.startZoteroInstance
// in zotero-plugin-scaffold), and that argument is the only thing separating it
// from another worktree's dev instance, a concurrent test run, and the user's
// own library. `pkill -9 -f zotero-bin` stood here and killed all of them.
function killDevZotero(profilePath) {
  let listing;
  try {
    listing = execSync("ps -ww -e -o pid=,args=", { encoding: "utf8" });
  } catch {
    console.warn("clean-dev-profile: ps failed, skipping the process check");
    return;
  }

  for (const line of listing.split("\n")) {
    const match = line.match(/^\s*(\d+)\s+(\S+)\s*(.*)$/);
    if (!match) continue;
    const [, pid, binary, args] = match;
    // Match on argv[0] rather than the whole line: any shell command that
    // merely mentions zotero-bin or the profile path matches its own command
    // line, and killing one of those would be worse than missing a cleanup.
    if (!/\/zotero(-bin)?$/.test(binary)) continue;
    if (!args.includes(`-profile ${profilePath}`)) continue;

    try {
      process.kill(Number(pid), "SIGKILL");
      console.log(
        `clean-dev-profile: killed the dev Zotero holding ${profilePath} (pid ${pid})`,
      );
    } catch {
      // ESRCH: it exited between the listing and the kill. EPERM: not ours.
    }
  }
}

function cleanSessionTabs(profilePath, addonRef) {
  const sessionPath = path.join(profilePath, "session.json");
  if (!existsSync(sessionPath)) return;

  const session = JSON.parse(readFileSync(sessionPath, "utf8"));
  const prefix = `${addonRef}-`;
  let removed = 0;

  for (const win of session.windows ?? []) {
    const before = win.tabs?.length ?? 0;
    win.tabs = (win.tabs ?? []).filter((tab) => !tab.type?.startsWith(prefix));
    removed += before - win.tabs.length;
    if (removed > 0 && !win.tabs.some((tab) => tab.selected)) {
      const fallback = win.tabs[win.tabs.length - 1];
      if (fallback) fallback.selected = true;
    }
  }

  if (removed > 0) {
    writeFileSync(sessionPath, JSON.stringify(session));
    console.log(
      `clean-dev-profile: removed ${removed} leftover "${prefix}*" tab(s) from session.json`,
    );
  }
}

const pkg = JSON.parse(
  readFileSync(path.join(rootDir, "package.json"), "utf8"),
);
const env = parseEnvFile(path.join(rootDir, ".env"));

// Resolved the way the scaffold resolves it, so the string compared against
// the running process's arguments is the same one it was launched with.
const profilePath = env.ZOTERO_PLUGIN_PROFILE_PATH
  ? path.resolve(env.ZOTERO_PLUGIN_PROFILE_PATH)
  : null;

if (profilePath) {
  killDevZotero(profilePath);
  cleanSessionTabs(profilePath, pkg.config.addonRef);
} else {
  // Without the profile path there is nothing to identify our own instance by,
  // so killing anything here would be a guess.
  console.warn(
    "clean-dev-profile: ZOTERO_PLUGIN_PROFILE_PATH not set in .env, skipping the process check and session.json cleanup",
  );
}
