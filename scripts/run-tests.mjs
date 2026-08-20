#!/usr/bin/env node
// Runs `zotero-plugin test` but kills Zotero as soon as the test run's
// completion line appears in stdout, instead of waiting for Zotero to exit
// on its own (scaffold's exitOnFinish quits Zotero on mocha's "end" event,
// but the GUI sometimes hangs and never actually exits — see CLAUDE.md's
// manual verification protocol).
import { spawn } from "node:child_process";

const DONE_PATTERN = /Test run completed - (\d+) passed(?:, (\d+) failed)?/;
// Counts from launch, not from the last line of output, so it has to clear the
// whole suite. Several tests wait on Zotero's own notification timing and
// cannot be made instant, so this is generous on purpose: it exists to catch a
// plugin that never initialises, not to police how long the suite takes.
const HANG_TIMEOUT_MS = 900_000;

// detached puts the run in its own process group, so the Zotero that
// `zotero-plugin test` spawns underneath can be killed by group id. Killing by
// pattern instead (`pkill -9 -f zotero-bin`) matched every Zotero on the
// machine: a dev instance from `npm start`, a concurrent test run in another
// worktree, and the user's own library along with them.
const child = spawn("npx", ["zotero-plugin", "test"], {
  stdio: ["ignore", "pipe", "pipe"],
  detached: true,
});

let settled = false;
let buffer = "";

function killRun() {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    // ESRCH: the group is already gone
  }
}

function finish(code) {
  if (settled) return;
  settled = true;
  clearTimeout(hangTimer);
  killRun();
  process.exit(code);
}

// A detached child no longer sits in the terminal's foreground group, so Ctrl-C
// reaches this wrapper but not Zotero. Relay it, or an interrupted run leaves
// Zotero holding the test profile.
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => finish(1));
}

function handleChunk(chunk) {
  process.stdout.write(chunk);
  buffer += chunk.toString();
  const match = buffer.match(DONE_PATTERN);
  if (match) {
    const failed = Number(match[2] ?? 0);
    console.log(
      `run-tests: completion line seen, killing Zotero instead of waiting for its own exit (failed=${failed})`,
    );
    finish(failed > 0 ? 1 : 0);
  }
}

child.stdout.on("data", handleChunk);
child.stderr.on("data", (chunk) => process.stderr.write(chunk));

const hangTimer = setTimeout(() => {
  console.error(
    `run-tests: no completion line after ${HANG_TIMEOUT_MS / 1000}s, treating as a hang`,
  );
  finish(1);
}, HANG_TIMEOUT_MS);

child.on("exit", (code) => {
  // Zotero exited on its own (exitOnFinish) before we saw the completion line
  finish(code ?? 1);
});
