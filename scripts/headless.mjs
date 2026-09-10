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
import { rmSync } from "node:fs";

const command = process.argv.slice(2);
if (command.length === 0) {
  console.error("headless: nothing to run");
  process.exit(2);
}

const wrap =
  process.platform === "linux" &&
  !!process.env.WAYLAND_DISPLAY &&
  spawnSync("sh", ["-c", "command -v xvfb-run >/dev/null 2>&1"]).status === 0;

// Every Xvfb this user can see, with the parent that is supposed to reap it.
function listXvfb() {
  const out = spawnSync("ps", ["-eo", "pid=,ppid=,args="], {
    encoding: "utf8",
  });
  if (out.status !== 0 || !out.stdout) return [];
  return out.stdout
    .split("\n")
    .map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/))
    .filter((m) => m && /^(\/\S*\/)?Xvfb\s/.test(m[3]))
    .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), args: m[3] }));
}

// xvfb-run reaps its Xvfb from a shell EXIT trap, so a SIGKILL to the wrapper
// skips the trap and strands the server (measured 2026-09-10: killing xvfb-run
// with -9 left the Xvfb alive, reparented to init, holding its display and its
// /tmp/xvfb-run.* auth dir). Anything that tears a run down from outside does
// exactly that, and because `xvfb-run -a` then picks the next free display the
// strays accumulate one per killed run rather than being reused.
//
// Nothing in-process can survive its own SIGKILL, so the leak is collected at
// the next start instead. An Xvfb is reaped when it was started by xvfb-run
// (its auth path says so) and no xvfb-run is left to reap it. The test is the
// parent's identity, not pid 1: a user systemd runs as a subreaper here, so a
// stranded server is adopted by it rather than by init (measured 2026-09-10,
// ppid 4941 `systemd --user`), and an orphan check written against pid 1 never
// fires. A concurrent run's server still has its own live wrapper as parent
// and is left alone.
function reapStrandedXvfb() {
  for (const proc of listXvfb()) {
    const auth = proc.args.match(/-auth\s+(\/tmp\/xvfb-run\.[^/\s]+)\//);
    if (!auth) continue;
    if (/xvfb-run/.test(parentArgs(proc.ppid))) continue;
    try {
      process.kill(proc.pid, "SIGKILL");
      console.log(`headless: reaped a stranded Xvfb (pid ${proc.pid})`);
      // The same skipped trap that stranded the server left its Xauthority
      // directory behind, and nothing else ever removes one.
      rmSync(auth[1], { recursive: true, force: true });
    } catch {
      // ESRCH, or another user's: not ours to clean up either way
    }
  }
}

function parentArgs(ppid) {
  const out = spawnSync("ps", ["-o", "args=", "-p", String(ppid)], {
    encoding: "utf8",
  });
  return out.status === 0 && out.stdout ? out.stdout.trim() : "";
}

const env = { ...process.env };
let argv = command;
let before = new Set();
if (wrap) {
  delete env.WAYLAND_DISPLAY;
  reapStrandedXvfb();
  before = new Set(listXvfb().map((proc) => proc.pid));
  argv = ["xvfb-run", "-a", ...command];
  console.log("headless: running on a virtual display");
}

// Backstop for the ordinary exits, where the trap does fire first and this
// finds nothing left to kill. It covers the case the trap misses: xvfb-run
// gone while its server is not.
function killOurXvfb() {
  if (!wrap) return;
  for (const proc of listXvfb()) {
    if (before.has(proc.pid)) continue;
    try {
      process.kill(proc.pid, "SIGKILL");
    } catch {
      // already reaped by xvfb-run's own trap, which is the normal path
    }
  }
}

// stdio inherit, and xvfb-run left as the parent of whatever it runs: a runner
// that kills its own process group (scripts/run-tests.mjs does) would take
// xvfb-run with it and orphan the Xvfb server it is responsible for.
const child = spawn(argv[0], argv.slice(1), { stdio: "inherit", env });
child.on("error", (error) => {
  console.error(`headless: could not start ${argv[0]}: ${error.message}`);
  killOurXvfb();
  process.exit(1);
});
child.on("exit", (code, signal) => {
  killOurXvfb();
  process.exit(signal ? 1 : (code ?? 1));
});

// Ctrl-C and an ordinary `kill` both reach here; relay to the wrapper so its
// own trap runs, then clean up whatever it left.
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    if (child.pid) {
      try {
        process.kill(child.pid, signal);
      } catch {
        // already gone
      }
    }
    killOurXvfb();
    process.exit(1);
  });
}
