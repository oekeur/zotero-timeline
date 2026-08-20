#!/usr/bin/env bash
# PreToolUse gate for `git merge` (see .claude/settings.json's `if` filter,
# which only invokes this for Bash(git merge *) commands). Blocks a merge into
# main unless build, lint and the full `npm test` suite all pass on the MERGE
# RESULT.
#
# Testing main's pre-merge working tree instead would gate the state being
# left rather than the state being created: a branch whose whole purpose is
# repairing failing tests could never land, because the gate fails on exactly
# the failures the merge removes. So the merge is replayed in a throwaway
# detached worktree and the suite runs there. main's own tree is never touched.
#
# npm test (zotero-plugin test) spins up a live Zotero GUI instance that does
# NOT exit on its own once it has printed its pass/fail summary -- confirmed
# empirically: the wrapper process still shows up in `pgrep` minutes after
# "Test run completed" appears in its own output. Because of that, this script
# does not trust `npm test`'s exit code (a killed process reports an exit code
# reflecting the kill, not the actual outcome) -- it parses the printed summary
# line directly instead. Only this run's own Zoteros are killed, identified by
# the temp worktree path in their arguments rather than by when they appeared,
# so any other Zotero on the machine survives whenever it started.

set -u

input=$(cat)
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty')

allow() { echo '{}'; exit 0; }
block() { jq -n --arg reason "$1" '{decision:"block", reason:$reason}'; exit 0; }

# Not a real merge attempt (aborting/continuing/quitting an existing one).
if printf '%s' "$cmd" | grep -qE -- '--abort|--continue|--quit'; then
  allow
fi

branch=$(git branch --show-current 2>/dev/null)
if [ "$branch" != "main" ]; then
  allow
fi

repo_root=$(git rev-parse --show-toplevel 2>/dev/null)

# The ref being merged: first non-flag token after `merge`, skipping the
# values of flags that take one. shlex keeps quoted -m messages in one piece.
ref=$(printf '%s' "$cmd" | python3 -c '
import shlex, sys
try:
    t = shlex.split(sys.stdin.read())
    i = t.index("merge") + 1
except ValueError:
    sys.exit(0)
takes_value = {"-m", "--message", "-F", "--file", "-s", "--strategy",
               "-X", "--strategy-option", "-S", "--gpg-sign"}
skip = False
for tok in t[i:]:
    if skip:
        skip = False
        continue
    if tok in takes_value:
        skip = True
        continue
    if tok.startswith("-"):
        continue
    print(tok)
    break
')

if [ -z "$ref" ]; then
  block "pre-merge gate could not determine which ref '$cmd' merges, so it could not test the merge result. Merge manually if this is intended."
fi

if ! git rev-parse --verify --quiet "$ref^{commit}" >/dev/null; then
  block "pre-merge gate could not resolve '$ref' to a commit."
fi

tmp=$(mktemp -d /tmp/zoterotimeline-premerge.XXXXXX)
work="$tmp/work"
log="$tmp/test.log"

cleanup() {
  git worktree remove --force "$work" >/dev/null 2>&1
  git worktree prune >/dev/null 2>&1
  # Remove the mktemp dir itself, not just the worktree inside it. Without this
  # every gated merge leaves /tmp/zoterotimeline-premerge.XXXXXX behind holding
  # test.log. The guard is against an unset $tmp turning this into `rm -rf /`;
  # the kept log on a failure path lives outside $tmp and survives.
  [ -n "${tmp:-}" ] && [ -d "$tmp" ] && rm -rf "$tmp"
}
trap cleanup EXIT

if ! git worktree add --detach "$work" HEAD >/dev/null 2>&1; then
  block "pre-merge gate could not create a temporary worktree to test the merge result."
fi

if ! ( cd "$work" && git merge --no-commit --no-ff "$ref" >/dev/null 2>&1 ); then
  # A conflicted merge is a real answer: report it rather than running tests.
  conflicts=$( cd "$work" && git diff --name-only --diff-filter=U | tr '\n' ' ')
  block "merging '$ref' into main conflicts, so the gate could not test the result. Conflicting paths: ${conflicts:-unknown}"
fi

# The suite needs installed deps and a Zotero binary path; the test profile and
# data dirs it creates are CWD-relative, so they land inside the temp worktree.
ln -s "$repo_root/node_modules" "$work/node_modules" 2>/dev/null
if [ -f "$repo_root/.env" ]; then
  sed -e "s|^ZOTERO_PLUGIN_PROFILE_PATH.*|ZOTERO_PLUGIN_PROFILE_PATH = $work/.scaffold/dev-profile|" \
      -e "s|^ZOTERO_PLUGIN_DATA_DIR.*|ZOTERO_PLUGIN_DATA_DIR = $work/.scaffold/dev-data|" \
      "$repo_root/.env" > "$work/.env"
fi

# Zotero processes belonging to THIS run, identified by path rather than by a
# time window. The scaffold resolves the test profile and data dir relative to
# CWD, so both land under $work and appear in the process's own arguments:
#
#   zotero-bin ... -profile $work/.scaffold/test/profile --dataDir $work/...
#
# $work is a fresh mktemp path, so nothing outside this run can name it. The
# previous approach diffed `pgrep -f zotero-bin` before and after and killed
# the difference, which killed any Zotero that happened to start while the
# gate was running, including one launched by hand.
#
# Two things this deliberately does not do. It does not match `pgrep -f`
# alone, because any command line merely mentioning zotero-bin matches itself.
# And it does not expect content processes to carry the path: they are spawned
# as `-contentproc ... -parentPid <pid>` with no profile argument, so they are
# swept separately below, after their parents are gone.
gate_zotero_pids() {
  local pid args
  ps -ww -e -o pid=,args= 2>/dev/null | while read -r pid args; do
    case "$args" in
      *"$work"*) ;;
      *) continue ;;
    esac
    case "$args" in
      */zotero-bin\ * | */zotero\ * | */zotero-bin | */zotero) printf '%s\n' "$pid" ;;
    esac
  done
}

# Content processes of the pids just killed. They exit with their parent, but
# sweep any that outlive it rather than leaving orphans holding the profile.
gate_zotero_children() {
  local parents="$1" pid args
  [ -n "$parents" ] || return 0
  ps -ww -e -o pid=,args= 2>/dev/null | while read -r pid args; do
    case "$args" in
      *-contentproc*) ;;
      *) continue ;;
    esac
    for parent in $parents; do
      case "$args" in
        *"-parentPid $parent "* | *"-parentPid $parent") printf '%s\n' "$pid" ;;
      esac
    done
  done
}

# Static stages first, and they are the reason this exists: the gate used to run
# `npm test` alone, which never type-checks src/. A commit failing
# `tsc --noEmit` passed the gate and landed on main red, caught only by CI's
# separate build job afterwards.
#
# `scripts/verify.sh --no-test` is exactly the build-and-lint pair, so this
# reuses verify.sh's definition of the static stages rather than restating it.
# The test stage is deliberately NOT delegated to verify.sh: the machinery below
# owns killing the live Zotero it starts, and nesting that inside verify.sh's own
# test runner would leave two kill mechanisms racing.
static_log="$tmp/verify-static.log"
if ! ( cd "$work" && ./scripts/verify.sh --no-test >"$static_log" 2>&1 ); then
  keep=$(mktemp /tmp/zoterotimeline-premerge-static.XXXXXX.log)
  cp "$static_log" "$keep" 2>/dev/null
  failed_stages=$(grep -E "^◆ FAILED:" "$static_log" | tail -1)
  block "build or lint failed on the result of merging '$ref' into main: ${failed_stages:-see log}. Full log: $keep"
fi

( cd "$work" && npm test >"$log" 2>&1 ) &
test_pid=$!

# Wait up to 12 minutes for the summary line to appear, polling every 2s.
# The suite takes about 2 minutes in isolation but stretches several-fold
# when other Zotero instances are running on the same machine, so a tighter
# ceiling blocks merges that would have passed.
elapsed=0
while [ "$elapsed" -lt 720 ]; do
  if grep -q "Test run completed" "$log" 2>/dev/null; then
    break
  fi
  if ! kill -0 "$test_pid" 2>/dev/null; then
    break
  fi
  sleep 2
  elapsed=$((elapsed + 2))
done

mine=$(gate_zotero_pids | sort -u)
for pid in $mine; do
  kill -9 "$pid" >/dev/null 2>&1
done
for pid in $(gate_zotero_children "$mine" | sort -u); do
  kill -9 "$pid" >/dev/null 2>&1
done
pkill -9 -P "$test_pid" >/dev/null 2>&1
wait "$test_pid" 2>/dev/null

summary=$(grep "Test run completed" "$log" | tail -1)

if [ -z "$summary" ]; then
  keep=$(mktemp /tmp/zoterotimeline-premerge-test.XXXXXX.log)
  cp "$log" "$keep" 2>/dev/null
  block "npm test did not finish within the timeout while testing the result of merging '$ref' into main. Full log: $keep"
elif printf '%s' "$summary" | grep -qE '[1-9][0-9]* failed'; then
  keep=$(mktemp /tmp/zoterotimeline-premerge-test.XXXXXX.log)
  cp "$log" "$keep" 2>/dev/null
  block "npm test failed on the result of merging '$ref' into main: ${summary}. Full log: $keep"
fi

allow
