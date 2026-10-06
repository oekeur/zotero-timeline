#!/usr/bin/env bash
#
# Opens an issue, once, when an upgrade Dependabot has been told to ignore
# becomes possible upstream.
#
# Each line of WATCHES is: package|peer|version|ignore. The watch fires when
# the `peer` range declared by `package@latest` on npm admits `version`;
# `ignore` names the dependabot.yml rule the issue tells you to remove. When
# the rule is gone, delete its line here too.
#
#   .github/upstream-watch.sh            check, open issues
#   DRY_RUN=1 .github/upstream-watch.sh  check, print what it would open
#
# Needs npm and, unless DRY_RUN is set, an authenticated gh (GH_TOKEN in CI).
# semver is fetched by npx at run time rather than added to package.json:
# Node has no range check of its own, and this is the only caller.

set -euo pipefail

WATCHES=(
  # TypeScript 7 is the Go port; typescript-eslint needs its compiler API.
  "typescript-eslint|typescript|7.0.0|typescript >= 7"
)

SEMVER="semver@7.8.5"
LABEL="upstream-watch"

for watch in "${WATCHES[@]}"; do
  IFS="|" read -r package peer version ignore <<<"$watch"
  range=$(npm view "$package@latest" "peerDependencies.$peer")
  if [ -z "$range" ]; then
    echo "::warning::$package@latest declares no $peer peer; check the watch"
    continue
  fi
  if ! npx --yes "$SEMVER" -r "$range" "$version" >/dev/null; then
    echo "$package@latest peers $peer \"$range\": $version not admitted yet"
    continue
  fi

  title="$package now admits $peer $version: remove the Dependabot ignore for $ignore"
  body="\`$package@latest\` declares \`$peer\` \`$range\`, which admits $version.

Remove the \`$ignore\` ignore from \`.github/dependabot.yml\` and this watch's line from \`.github/upstream-watch.sh\`. Dependabot then offers the upgrade on its next run."

  if [ -n "${DRY_RUN:-}" ]; then
    echo "would open: $title"
    continue
  fi
  # Open and closed alike: one issue per watch, ever, until its line goes.
  existing=$(gh issue list --state all --label "$LABEL" --search "\"$title\" in:title" --json number --jq length)
  if [ "$existing" != "0" ]; then
    echo "already reported: $title"
    continue
  fi
  gh label create "$LABEL" --color "c5def5" --description "Opened by .github/upstream-watch.sh" 2>/dev/null || true
  gh issue create --title "$title" --body "$body" --label "$LABEL"
done
