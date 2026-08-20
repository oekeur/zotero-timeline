#!/usr/bin/env bash
#
# Runs the Backlog.md CLI against this project's tracker.
#
#   scripts/backlog.sh <args...>        e.g. scripts/backlog.sh task list --plain
#   scripts/backlog.sh --help           this text
#   scripts/backlog.sh help             the CLI's own help
#
# Three things this gets right that typing the command by hand does not:
#
#   - The npm package is `backlog.md`, not `backlog`. `npx backlog` resolves to
#     an unrelated package.
#   - The tracker is the nested repo at project/, not the repo root. Run from
#     the root and the CLI reports "No Backlog.md project found".
#   - project/ lives in the main checkout. From a linked worktree it may not be
#     present at all, so the path is resolved against the main checkout rather
#     than the current directory.

set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

MAIN_ROOT="$(git worktree list --porcelain | awk '/^worktree /{print $2; exit}')"
BACKLOG_DIR="$MAIN_ROOT/project"

if [ ! -d "$BACKLOG_DIR/backlog" ]; then
  printf 'backlog: no tracker at %s\n' "$BACKLOG_DIR" >&2
  exit 1
fi

# BACKLOG_CWD points the CLI at the tracker without changing this shell's
# directory, so relative paths in the caller's arguments still resolve.
BACKLOG_CWD="$BACKLOG_DIR" exec npx --yes backlog.md "$@"
