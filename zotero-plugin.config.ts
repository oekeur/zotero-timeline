import { mkdirSync, rmSync, symlinkSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "zotero-plugin-scaffold";
import pkg from "./package.json";

// The RDP port the MCP observability bridge listens on, written per checkout
// into .env by ~/.claude/worktree-hooks/zoteroTimeline.sh. Parsed rather than
// coerced: a malformed value must land on the default, because the bridge
// treats a non-numeric port as a pipe path and opens successfully, so a bad
// value costs an unreachable Zotero with nothing in the log to say why.
const mcpRdpPort =
  Number.parseInt(process.env.ZOTERO_MCP_RDP_PORT ?? "", 10) || 6100;

// Which spec files the live suite runs. The whole directory unless
// ZT_TEST_ENTRIES names files, comma-separated, each a path under test/ with
// or without the .ts suffix:
//
//   ZT_TEST_ENTRIES=itemPaneSection npm run test:fast
//
// A full run is around ten minutes, too slow to settle a predicate that needs
// several attempts; the two attempts at the item-pane refresh guard that were
// paid for at full-run price bought two contradictory answers. Narrowed runs
// are for diagnosis only, and nothing merges on one: this suite has a recorded
// history of specs that pass alone and fail in company.
const named = (process.env.ZT_TEST_ENTRIES ?? "")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);
// The scaffold globs each entry as a DIRECTORY (`${dir}/**/*.{spec,test}.[jt]s`),
// so naming a file here matches nothing and the run reports "0 passed" rather
// than erroring. A directory of symlinks is the way to narrow it; esbuild
// follows them and bundles the real files.
function narrowedTestDir(names: string[]): string {
  const dir = ".scaffold/test-subset";
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const name of names) {
    const bare = name.replace(/^test\//, "").replace(/(\.test)?\.ts$/, "");
    const file = `${bare}.test.ts`;
    symlinkSync(resolve("test", file), resolve(dir, file));
  }
  return dir;
}

const testEntries = named.length ? narrowedTestDir(named) : "test";

export default defineConfig({
  source: ["src", "addon"],
  dist: ".scaffold/build",
  name: pkg.config.addonName,
  id: pkg.config.addonID,
  namespace: pkg.config.addonRef,
  updateURL: `https://github.com/{{owner}}/{{repo}}/releases/download/release/${
    pkg.version.includes("-") ? "update-beta.json" : "update.json"
  }`,
  xpiDownloadLink:
    "https://github.com/{{owner}}/{{repo}}/releases/download/v{{version}}/{{xpiName}}.xpi",

  build: {
    assets: ["addon/**/*.*"],
    define: {
      ...pkg.config,
      author: pkg.author,
      description: pkg.description,
      homepage: pkg.homepage,
      buildVersion: pkg.version,
      buildTime: "{{buildTime}}",
    },
    prefs: {
      prefix: pkg.config.prefsPrefix,
    },
    esbuildOptions: [
      {
        entryPoints: ["src/index.ts"],
        define: {
          __env__: `"${process.env.NODE_ENV}"`,
        },
        bundle: true,
        target: "firefox115",
        outfile: `.scaffold/build/addon/content/scripts/${pkg.config.addonRef}.js`,
      },
    ],
  },

  server: {
    // Written into the dev profile's prefs.js before every launch, which is
    // what makes debug.store work at all: Zotero's Debug.init reads it once and
    // immediately clears it, so it has to be re-armed per launch, and turning
    // it on by hand later has already missed every startup line. debug.log is
    // deliberately absent — it routes output to a stdout scaffold discards.
    prefs: {
      "extensions.mcp-rdp.port": mcpRdpPort,
      "extensions.zotero.debug.store": true,
    },
  },

  test: {
    // Whole suite by default. ZT_TEST_ENTRIES narrows it to named files for a
    // diagnostic loop: a full run is around ten minutes, which is too slow to
    // settle a predicate that needs several attempts, and the two attempts at
    // the item-pane refresh guard that were paid for at full-run price bought
    // two contradictory answers. Comma-separated, each entry a path under
    // test/ with or without the .ts suffix.
    //
    //   ZT_TEST_ENTRIES=itemPaneSection npm run test:fast
    //
    // Narrowed runs are for diagnosis only. Nothing merges on one: this suite
    // has a recorded history of specs that pass alone and fail in company.
    entries: testEntries,
    waitForPlugin: `() => Zotero.${pkg.config.addonInstance}.data.initialized`,
  },

  release: {
    bumpp: {
      // Runs after the version bump and before the commit, with
      // throwOnError, so a broken build aborts the release instead of
      // tagging it. In CI this is also what produces the .xpi and update
      // JSON that the GitHub release step uploads.
      execute: "npm run build",
    },
  },

  // If you need to see a more detailed log, uncomment the following line:
  // logLevel: "trace",
});
