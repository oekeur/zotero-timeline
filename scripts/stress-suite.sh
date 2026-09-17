#!/usr/bin/env bash
#
# Stress harness for TASK-81: reproduce the intermittent full-suite stall
# that only shows up under several concurrent test:fast runs on one box.
#
#   scripts/stress-suite.sh [N] [--dry-run]
#
#   N          number of concurrent runs, positive integer, default 5
#   --dry-run  print every command this run would execute, prefixed "+ ",
#              and create nothing (no worktrees, no output directory)
#
# Every git and worktree operation targets the zoteroTimeline checkout this
# script lives in, resolved from its own path rather than the caller's CWD,
# so this prints and runs the same plan whether invoked from this repo, a
# sibling project's directory, or /tmp.
#
# For each of the N runs this:
#   1. creates a throwaway detached worktree off main under
#      <main checkout>/.claude/worktrees/stress-<timestamp>-<n>, provisioned
#      through ~/.claude/scripts/worktree-init.sh. A non-zero exit there
#      aborts the whole run through the same trap that tears down worktrees
#      on any other failure. The sole exception is the hook's own "no free
#      RDP port" warning, which it already reports as non-fatal on its own
#      (exit 0, warning on stderr) since test:fast never uses that port; a
#      zero exit with node_modules still missing is treated as a failure too.
#   2. applies project/probes/queue-instrumentation.patch in it. If the
#      patch fails `git apply --check` in the FIRST worktree, the whole run
#      aborts before any further worktree is created.
#   3. launches `npm run test:fast` under setsid, so it can be killed by
#      process group, with output at
#      project/probes/stress/<timestamp>/run-<n>.log. Always the full suite:
#      any ZT_TEST_ENTRIES in the caller's environment is unset before the
#      first run starts.
#
# While every run is in flight, load average, free memory and swap free are
# sampled every 5s into load.log beside the run logs. Once every run has
# exited, each run-<n>.log is parsed for its "Test run completed" line and
# its first failing ("✖") spec, and a one-line verdict is printed per run. A
# log with no completion line - a healthy-but-slow suite hitting
# run-tests.mjs's own 900s hang timeout reads the same as an actual stall
# otherwise - gets run-tests.mjs's own hang-timeout line instead, if it
# printed one, plus the last spec title the log saw. Every worktree is then
# torn down through ~/.claude/scripts/worktree-teardown.sh followed by
# `git worktree remove --force`.
#
# Refuses to start (exit 2) while another stress-suite.sh or a verify.sh is
# running, so a gate never lands mid-stress-run. This check runs before
# --dry-run does anything else, too.
#
# A trap on EXIT/INT/TERM tears every worktree this run created back down and
# kills the sampler and any still-running test:fast process groups, so an
# interrupted run leaves no worktrees and no stray Zotero processes. Zotero
# itself sits in a process group of its own (run-tests.mjs launches it
# detached), so after TERM the trap polls for up to 30s for that group to
# exit on its own before escalating to KILL, then kills by PID any zotero-bin
# whose own -profile argument still points under the worktree being torn
# down, in case the group died without taking Zotero with it. A Zotero whose
# profile lies elsewhere - another worktree, the sibling zoteroMindmap
# project, the user's own library - is never touched.

set -euo pipefail

usage() {
  sed -n '2,59p' "$0" | sed 's/^# \{0,1\}//'
}

DRY_RUN=0
N=5

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run)
      DRY_RUN=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      if [[ "$1" =~ ^[0-9]+$ ]]; then
        N="$1"
      else
        printf 'stress-suite: unrecognized argument: %s\n' "$1" >&2
        exit 2
      fi
      ;;
  esac
  shift
done

# A ZT_TEST_ENTRIES exported in the caller's environment would silently
# narrow every run's test:fast invocation away from the full suite.
unset ZT_TEST_ENTRIES

if [ "$N" -lt 1 ]; then
  printf 'stress-suite: N must be a positive integer\n' >&2
  exit 2
fi

# pgrep -f matches the FULL command line, which includes an interactive
# shell's own quoting of whatever it was asked to run - a shell invoked as
# `sh -c "... scripts/stress-suite.sh ..."` matches on that text alone, with
# no stress-suite.sh process behind it at all. So candidates from pgrep are
# a first pass only; a candidate counts as a real running instance only if
# one of its OWN argv entries (read from /proc/<pid>/cmdline, which keeps
# each argument separate) is exactly the script name or ends in a path
# separator followed by it. That is true for `bash scripts/stress-suite.sh`
# or `./scripts/stress-suite.sh`, but it is ALSO true for a wrapper that
# quotes the name inside one larger argv string ending in it - a single
# `sh -c 'sleep 15 # scripts/verify.sh'` argument ends in "/verify.sh" and
# matches the same suffix check. That is a false positive, not a bug to
# route around: refusing a real run rather than risking one alongside a gate
# is the fail-safe direction this whole check exists for.
#
# A candidate that is $$'s own descendant or ancestor is skipped, because
# either relationship can share this process's exact argv without being a
# second instance. Descendant: `others="$(find_running_script ...)"` itself
# forks a subshell for the command substitution, and that subshell briefly
# shows up in /proc carrying this process's own cmdline before it execs
# pgrep - that child is this run's own bookkeeping, not a second run.
# Ancestor: a wrapper that execs bash with this script as an argument but
# stays alive to supervise it (`timeout 60 bash scripts/stress-suite.sh ...`,
# `nohup`, `setsid`) keeps its OWN argv containing the script path for as
# long as the child runs, so pgrep -f matches the wrapper too; excluding
# only descendants misses it, since the wrapper is $$'s parent or further up,
# never its child.
ppid_of() {
  local pid="$1" stat rest
  IFS= read -r stat 2>/dev/null <"/proc/$pid/stat" || { printf ''; return; }
  rest="${stat#*) }"
  set -- $rest
  printf '%s' "${2:-}"
}

# Every ancestor pid of $1, walked via ppid_of up to pid 1, space-separated.
self_ancestors() {
  local pid="$1" anc=""
  while [ -n "$pid" ] && [ "$pid" != "1" ]; do
    pid="$(ppid_of "$pid")"
    [ -n "$pid" ] || break
    anc="$anc $pid"
  done
  printf '%s' "${anc# }"
}

find_running_script() {
  local script_name="$1" exclude_pid="$2" pid tok matched="" ancestors
  ancestors=" $(self_ancestors "$exclude_pid") "
  for pid in $(pgrep -f "$script_name" 2>/dev/null || true); do
    [ "$pid" = "$exclude_pid" ] && continue
    [ "$(ppid_of "$pid")" = "$exclude_pid" ] && continue
    case "$ancestors" in
      *" $pid "*) continue ;;
    esac
    [ -r "/proc/$pid/cmdline" ] || continue
    while IFS= read -r -d '' tok; do
      case "$tok" in
        "$script_name" | */"$script_name")
          matched="$matched $pid"
          break
          ;;
      esac
    done <"/proc/$pid/cmdline"
  done
  printf '%s' "${matched# }"
}

# Refuses to start next to another stress run or a gate, so a gate never
# lands mid-stress-run.
check_no_concurrent_runs() {
  local self_pid=$$ others
  others="$(find_running_script 'stress-suite.sh' "$self_pid")"
  if [ -n "$others" ]; then
    printf 'stress-suite: another stress-suite.sh is already running (pid %s) - refusing to start\n' \
      "$others" >&2
    exit 2
  fi
  others="$(find_running_script 'verify.sh' "$self_pid")"
  if [ -n "$others" ]; then
    printf 'stress-suite: verify.sh is running (pid %s) - refusing to start a stress run while a gate is in flight\n' \
      "$others" >&2
    exit 2
  fi
}
check_no_concurrent_runs

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MAIN_ROOT="$(git -C "$SCRIPT_DIR" worktree list --porcelain | awk '/^worktree /{print $2; exit}')"
if [ -z "$MAIN_ROOT" ]; then
  printf 'stress-suite: could not resolve the main checkout from %s\n' "$SCRIPT_DIR" >&2
  exit 1
fi

PATCH_FILE="$MAIN_ROOT/project/probes/queue-instrumentation.patch"
if [ ! -f "$PATCH_FILE" ]; then
  printf 'stress-suite: patch not found at %s\n' "$PATCH_FILE" >&2
  exit 1
fi

TS="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_DIR="$MAIN_ROOT/project/probes/stress/$TS"
LOAD_LOG="$OUT_DIR/load.log"
SAMPLE_INTERVAL=5

printf 'stress-suite: output directory: %s\n' "$OUT_DIR"

if [ "$DRY_RUN" = 0 ]; then
  mkdir -p "$OUT_DIR"
fi

worktree_path_for() {
  printf '%s/.claude/worktrees/stress-%s-%s' "$MAIN_ROOT" "$TS" "$1"
}

# Populated only for real runs; empty in --dry-run, which is what keeps the
# EXIT trap a no-op there.
WT_PATHS=()
WT_PGIDS=()
SAMPLER_PID=""

# PIDs of actual Zotero processes, identified by /proc/<pid>/comm rather than
# by matching "zotero-bin" against pgrep -f's full command line, which any
# unrelated process merely mentioning it would also match.
zotero_bin_pids() {
  local pid comm
  for pid in $(pgrep -f zotero-bin 2>/dev/null || true); do
    comm="$(cat "/proc/$pid/comm" 2>/dev/null || true)"
    [ "$comm" = "zotero-bin" ] && printf '%s\n' "$pid"
  done
}

# The value of a pid's own -profile argument, read from /proc/<pid>/cmdline
# with arguments kept separate (never a substring match on the joined
# command line, which a launch flag's own value could accidentally satisfy).
# Empty if the pid has no -profile argument or its cmdline is unreadable.
profile_arg_of() {
  local pid="$1" tok prev=""
  [ -r "/proc/$pid/cmdline" ] || return 0
  while IFS= read -r -d '' tok; do
    if [ "$prev" = "-profile" ]; then
      printf '%s' "$tok"
      return
    fi
    prev="$tok"
  done <"/proc/$pid/cmdline"
}

# Kills, by PID, any zotero-bin whose -profile argument is under
# $worktree_path, and waits for it to exit. This is the fallback for a
# stress worktree's Zotero surviving its own process group's teardown: matched
# by the exact -profile value, never by name or by a substring of the joined
# command line, so a sibling worktree's or the user's own Zotero - which
# share this box - is never touched (mirrors scripts/verify.sh's
# clear_stale_test_zotero).
kill_zotero_under_profile() {
  local worktree_path="$1" pid profile
  for pid in $(zotero_bin_pids); do
    profile="$(profile_arg_of "$pid")" || true
    [ -n "$profile" ] || continue
    case "$profile" in
      "$worktree_path" | "$worktree_path"/*)
        kill -KILL "$pid" 2>/dev/null || true
        while kill -0 "$pid" 2>/dev/null; do
          sleep 0.5
        done
        ;;
    esac
  done
}

cleanup() {
  local status=$? pgid path still_running i
  trap - EXIT INT TERM
  # A stray reaped pid or any other transient failure inside this trap must
  # never abort teardown partway through: every remaining worktree still
  # needs its Zotero killed and its `git worktree remove` run.
  set +e

  if [ -n "$SAMPLER_PID" ] && kill -0 "$SAMPLER_PID" 2>/dev/null; then
    kill "$SAMPLER_PID" 2>/dev/null || true
    wait "$SAMPLER_PID" 2>/dev/null || true
  fi

  if [ "${#WT_PGIDS[@]}" -gt 0 ]; then
    for pgid in "${WT_PGIDS[@]}"; do
      kill -TERM -"$pgid" 2>/dev/null || true
    done
    # run-tests.mjs, inside these groups, reacts to TERM by SIGKILLing its own
    # Zotero child group - but that is a fixed `sleep 2` away from here, and a
    # node starved by N concurrent runs can miss it. Poll instead of trusting
    # one fixed wait, so a slow-but-alive group is not torn out from under a
    # run that was about to exit cleanly.
    for i in $(seq 1 60); do
      still_running=0
      for pgid in "${WT_PGIDS[@]}"; do
        kill -0 -"$pgid" 2>/dev/null && still_running=1
      done
      [ "$still_running" = 0 ] && break
      sleep 0.5
    done
    for pgid in "${WT_PGIDS[@]}"; do
      kill -KILL -"$pgid" 2>/dev/null || true
    done
  fi

  for path in "${WT_PATHS[@]:-}"; do
    [ -n "$path" ] || continue
    if [ -d "$path" ]; then
      kill_zotero_under_profile "$path"
      ( cd "$path" && "$HOME/.claude/scripts/worktree-teardown.sh" ) 2>/dev/null || true
      git -C "$MAIN_ROOT" worktree remove --force "$path" 2>/dev/null || true
    fi
  done

  exit "$status"
}
trap cleanup EXIT INT TERM

for n in $(seq 1 "$N"); do
  path="$(worktree_path_for "$n")"

  if [ "$DRY_RUN" = 1 ]; then
    printf '+ git -C %s worktree add --detach %s main\n' "$MAIN_ROOT" "$path"
    printf '+ (cd %s && ~/.claude/scripts/worktree-init.sh)\n' "$path"
  else
    git -C "$MAIN_ROOT" worktree add --detach "$path" main
    WT_PATHS+=("$path")
    if ! ( cd "$path" && "$HOME/.claude/scripts/worktree-init.sh" ); then
      printf 'stress-suite: worktree-init.sh failed in %s - aborting\n' "$path" >&2
      exit 1
    fi
    if [ ! -d "$path/node_modules" ]; then
      printf 'stress-suite: worktree-init.sh exited 0 but %s/node_modules is missing - aborting\n' \
        "$path" >&2
      exit 1
    fi
  fi

  if [ "$n" -eq 1 ]; then
    if [ "$DRY_RUN" = 1 ]; then
      printf '+ git -C %s apply --check %s\n' "$path" "$PATCH_FILE"
    else
      if ! git -C "$path" apply --check "$PATCH_FILE"; then
        printf 'stress-suite: %s does not apply cleanly in %s - aborting before creating further worktrees\n' \
          "$PATCH_FILE" "$path" >&2
        exit 1
      fi
    fi
  fi

  if [ "$DRY_RUN" = 1 ]; then
    printf '+ git -C %s apply %s\n' "$path" "$PATCH_FILE"
  else
    git -C "$path" apply "$PATCH_FILE"
  fi

  log="$OUT_DIR/run-$n.log"
  if [ "$DRY_RUN" = 1 ]; then
    printf '+ (cd %s && setsid npm run test:fast >%s 2>&1) &\n' "$path" "$log"
  else
    ( cd "$path" || exit 1; exec setsid npm run test:fast >"$log" 2>&1 ) &
    WT_PGIDS+=("$!")
  fi
done

if [ "$DRY_RUN" = 1 ]; then
  printf '+ full-suite: ZT_TEST_ENTRIES is unset, every run uses the complete suite\n'
  printf '+ sampler: every %ss -> %s\n' "$SAMPLE_INTERVAL" "$LOAD_LOG"
  for n in $(seq 1 "$N"); do
    path="$(worktree_path_for "$n")"
    printf '+ (cd %s && ~/.claude/scripts/worktree-teardown.sh)\n' "$path"
    printf '+ git -C %s worktree remove --force %s\n' "$MAIN_ROOT" "$path"
  done
  printf 'stress-suite: dry run - nothing created; a real run would write output under %s\n' "$OUT_DIR"
  trap - EXIT INT TERM
  exit 0
fi

(
  while true; do
    ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    loadavg="$(cut -d' ' -f1-3 /proc/loadavg)"
    freemb="$(free -m | awk 'NR==2{print $4}')"
    swapfreekb="$(awk '/^SwapFree:/{print $2}' /proc/meminfo)"
    printf '%s loadavg=%s free_mb=%s swap_free_kb=%s\n' "$ts" "$loadavg" "$freemb" "$swapfreekb"
    sleep "$SAMPLE_INTERVAL"
  done
) >"$LOAD_LOG" 2>&1 &
SAMPLER_PID=$!

for pgid in "${WT_PGIDS[@]}"; do
  wait "$pgid" || true
done

if [ -n "$SAMPLER_PID" ]; then
  kill "$SAMPLER_PID" 2>/dev/null || true
  wait "$SAMPLER_PID" 2>/dev/null || true
  SAMPLER_PID=""
fi

DONE_PATTERN='Test run completed - ([0-9]+) passed(, ([0-9]+) failed)?'

# Strips the ANSI colour codes the scaffold's logger wraps its symbols and
# messages in (FORCE_COLOR is set in this environment), so a captured line
# prints clean instead of carrying raw escape sequences.
strip_ansi() {
  sed 's/\x1b\[[0-9;]*m//g'
}

# The last real spec/suite line a log saw, from run-tests.mjs's own progress
# markers. Restricted to lines at or after the first ✔/✖: the scaffold logs
# its own build-phase tips ("→ Preparing static assets", "→ Bundling
# scripts") with the same → glyph mocha suite headers use, so before any
# pass/fail has actually printed, a → line is a build step, not progress
# into the suite. Empty if no ✔/✖ ever appeared.
last_spec_line() {
  local log="$1" first_result_line
  first_result_line="$(grep -n -m1 -E '✔|✖' "$log" 2>/dev/null | cut -d: -f1)"
  [ -n "$first_result_line" ] || return 0
  tail -n "+$first_result_line" "$log" | grep -E '✔|✖|→' | tail -n1 | strip_ansi | sed 's/^[[:space:]]*//'
}

# The last non-blank line of a log, for when no spec marker ever appeared -
# labelled so a reader can tell "stalled during the build" from "the log has
# no output at all".
last_build_line() {
  local log="$1"
  grep -v '^[[:space:]]*$' "$log" 2>/dev/null | tail -n1 | strip_ansi | sed 's/^[[:space:]]*//'
}

# One run's verdict line, given its log path. A run that never printed a
# completion line - a healthy-but-slow suite under N-fold load hitting
# run-tests.mjs's own 900s hang timeout looks identical to an actual stall
# otherwise - reports that explicitly instead of a bare "?", quoting
# run-tests.mjs's own hang-timeout line when it printed one, plus the last
# spec title seen, so a reader can tell "timed out mid-suite at spec X" from
# "completed, but the log was cut short".
parse_verdict() {
  local log="$1" verdict_line first_fail passed failed hang_line last_spec build_line

  verdict_line="$(grep -m1 -E 'Test run completed - [0-9]+ passed' "$log" 2>/dev/null | strip_ansi || true)"

  if [[ "$verdict_line" =~ $DONE_PATTERN ]]; then
    passed="${BASH_REMATCH[1]}"
    failed="${BASH_REMATCH[3]:-0}"
    first_fail="$(grep -m1 -F '✖' "$log" 2>/dev/null | strip_ansi || true)"
    if [ -z "$first_fail" ]; then
      first_fail="(none)"
    else
      first_fail="$(printf '%s' "$first_fail" | sed 's/^[[:space:]]*//')"
    fi
    printf 'passed=%s failed=%s first_failure=%s' "$passed" "$failed" "$first_fail"
    return
  fi

  hang_line="$(grep -m1 -F 'treating as a hang' "$log" 2>/dev/null | strip_ansi || true)"
  [ -n "$hang_line" ] || hang_line="(no hang line in log)"
  last_spec="$(last_spec_line "$log")" || true
  if [ -n "$last_spec" ]; then
    printf 'no completion line - %s - last spec: %s' "$hang_line" "$last_spec"
    return
  fi
  build_line="$(last_build_line "$log")" || true
  [ -n "$build_line" ] || build_line="(no output in log)"
  printf 'no completion line - %s - last line (build step, no spec ran): %s' "$hang_line" "$build_line"
}

for n in $(seq 1 "$N"); do
  log="$OUT_DIR/run-$n.log"
  printf 'run-%s: %s\n' "$n" "$(parse_verdict "$log")"
done

printf 'stress-suite: done - output under %s\n' "$OUT_DIR"
