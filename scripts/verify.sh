#!/usr/bin/env bash
#
# The verification gate: build, lint, and the live-Zotero test suite, in the
# order that fails cheapest first.
#
#   scripts/verify.sh [--no-test] [--test-only]
#
#   --no-test    build and lint only; no Zotero is launched
#   --test-only  skip build and lint, run the live test suite only
#
# Runs every requested stage even after one fails, then exits non-zero naming
# the stages that failed. `npm run build` covers tsc --noEmit for src/ but not
# for test/, so the test stage is the only thing that catches a changed export
# signature breaking a test file.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

RUN_STATIC=1
RUN_TEST=1

while [ $# -gt 0 ]; do
  case "$1" in
    --no-test) RUN_TEST=0 ;;
    --test-only) RUN_STATIC=0 ;;
    -h|--help) sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) printf 'verify: unknown option: %s\n' "$1" >&2; exit 2 ;;
  esac
  shift
done

cd "$(dirname "$0")/.."

say() { printf '\n◆ %s\n' "$*"; }
warn() { printf '  ! %s\n' "$*" >&2; }

FAILED=()

run_stage() {
  local name="$1"; shift
  say "$name"
  if "$@"; then
    printf '  %s ok\n' "$name"
  else
    warn "$name FAILED"
    FAILED+=("$name")
  fi
}

# PIDs of actual Zotero processes. Matching `pgrep -f zotero-bin` alone is not
# enough: any shell command that merely mentions zotero-bin matches its own
# command line, and a false positive here is a kill sent to an unrelated pid.
# /proc/<pid>/comm is the executable name, so it cannot be tripped that way.
# Linux-only for that reason; there is no /proc on macOS.
zotero_pids() {
  local pid comm
  for pid in $(pgrep -f zotero-bin 2>/dev/null); do
    comm="$(cat "/proc/$pid/comm" 2>/dev/null || true)"
    [ "$comm" = "zotero-bin" ] && printf '%s\n' "$pid"
  done
}

pid_cmdline() {
  tr '\0' ' ' <"/proc/$1/cmdline" 2>/dev/null || true
}

# A test instance left behind by an interrupted run holds the profile the next
# run wants. Safe to kill: the path proves it belongs to a test run. Killed by
# PID rather than `pkill -f`, which would also match an unrelated shell.
# Scoped to THIS checkout's test profile, by absolute path.
#
# `*scaffold/test*` stood here and matched every Zotero on the machine running
# any checkout's test profile, so this gate reached into a sibling project's
# in-flight suite and SIGTERMed it. Measured 2026-09-04 from the receiving end:
# a zoteroMindmap gate killed two of three zoteroTimeline runs mid-suite, and
# because SIGTERM lets Zotero shut down cleanly the symptom is an exit code of
# 0 with no crash dump and no failed assertions -- indistinguishable, from the
# inside, from the suite quietly deciding to stop. Two hours went into blaming
# the code under test for it.
#
# zoteroMindmap carries the same helper with the same defect; filed there too.
clear_stale_test_zotero() {
  local pid cmd killed=0
  local own_profile="$REPO_ROOT/.scaffold/test"
  for pid in $(zotero_pids); do
    cmd="$(pid_cmdline "$pid")"
    case "$cmd" in
      *"$own_profile"*) kill "$pid" 2>/dev/null && killed=1 ;;
    esac
  done
  if [ "$killed" = 1 ]; then
    warn "cleared a leftover test-profile Zotero"
    # kill returns before the process is gone; give it a moment to release the
    # profile lock rather than racing the next launch into a stale lock.
    sleep 2
  fi
}

if [ "$RUN_STATIC" = 1 ]; then
  run_stage build npm run build
  run_stage lint npm run lint:check
  # test/ has its own tsconfig and is NOT covered by `npm run build`'s
  # tsc --noEmit, which reads the root config. Until this stage existed,
  # `tsc -p test` type-checked zero files under test/ (its inherited `include`
  # resolved against the root config), so a changed export signature that broke
  # a spec was caught only by the four-minute live suite. This stage costs a
  # couple of seconds and catches that class before a commit.
  run_stage typecheck npm run typecheck
fi

# Safe next to a dev Zotero from `npm start`: `npm run test:fast` kills its own
# process group and the test profile is CWD-relative, so the dev instance is
# left alone. clear_stale_test_zotero is scoped to this checkout's own test
# profile by absolute path, so another worktree's in-flight run survives it.
#
# The suite runs off-screen: `npm run test:fast` goes through
# scripts/headless.mjs, which puts it on a virtual display on a Wayland session
# and explains there why that matters. It used to be wrapped here instead,
# which left a bare `npm test` on the real display and flaky while the gate was
# clean.
if [ "$RUN_TEST" = 1 ]; then
  clear_stale_test_zotero
  run_stage test npm run test:fast
fi

if [ "${#FAILED[@]}" -gt 0 ]; then
  printf '\n◆ FAILED: %s\n' "${FAILED[*]}" >&2
  exit 1
fi

printf '\n◆ All stages passed.\n'
