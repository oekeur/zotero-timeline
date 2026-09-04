#!/usr/bin/env node
// Runs a command on a virtual display when the session would otherwise put a
// Zotero window on the real screen.
//
// Why this exists at all. The suite drives a live Zotero GUI, so on a desktop
// session it competes with whatever else is on screen, and that competition is
// this suite's largest source of intermittent failures. Measured 2026-09-04 on
// one commit, minutes apart: 20 failures, then 18, then 1, then 0 on the real
// display, against 372 passed with zero failures on four consecutive runs on a
// virtual one. Almost every failure is a wait on a Fluent-backed label that
// resolves in well under a second or never resolves at all.
//
// scripts/verify.sh wrapped its own call and nothing else did, so the gate was
// safe while a bare `npm test` or `npm run test:fast` was not. Both looked
// equally authoritative, which is how TASK-50 came to be reverted over code
// that was never broken. One wrapper in front of every entry point is the
// point: there is no way left to run the suite on the real display by accident.
//
// Unsetting WAYLAND_DISPLAY is the lever, not xvfb-run alone, and it fails
// silently otherwise: /opt/zotero-beta/zotero exports MOZ_ENABLE_WAYLAND=1, so
// Gecko connects to the compositor named by the inherited WAYLAND_DISPLAY and
// paints on the real screen while DISPLAY points at an Xvfb nothing draws on.
// The launcher's own export cannot be overridden from out here.
//
// A WAYLAND_DISPLAY that is already absent means something above us has
// already done this, which is also the guard against nesting a second Xvfb.
// Absent xvfb-run (CI images, macOS) the command runs unwrapped, because a
// headless CI runner has no real display to be pushed onto in the first place.
import { spawn, spawnSync } from "node:child_process";

const command = process.argv.slice(2);
if (command.length === 0) {
  console.error("headless: nothing to run");
  process.exit(2);
}

const wrap =
  process.platform === "linux" &&
  !!process.env.WAYLAND_DISPLAY &&
  spawnSync("sh", ["-c", "command -v xvfb-run >/dev/null 2>&1"]).status === 0;

const env = { ...process.env };
let argv = command;
if (wrap) {
  delete env.WAYLAND_DISPLAY;
  argv = ["xvfb-run", "-a", ...command];
  console.log("headless: running on a virtual display");
}

// stdio inherit, and xvfb-run left as the parent of whatever it runs: a runner
// that kills its own process group (scripts/run-tests.mjs does) would take
// xvfb-run with it and orphan the Xvfb server it is responsible for.
const child = spawn(argv[0], argv.slice(1), { stdio: "inherit", env });
child.on("error", (error) => {
  console.error(`headless: could not start ${argv[0]}: ${error.message}`);
  process.exit(1);
});
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
