#!/usr/bin/env bash
# Regenerates CHANGELOG.md from the current checkout's commit history,
# newest first, grouped by date. Re-run this before a release or
# whenever you want the file to reflect the latest commits, it fully
# overwrites the file each time rather than trying to append/merge.
#
# Usage: scripts/generate-changelog.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

{
  echo "# Changelog"
  echo
  echo "Generated from commit history via \`scripts/generate-changelog.sh\`, not hand-maintained. Re-run that script to refresh it, don't hand-edit entries below, they'll just be overwritten."
  echo

  # %ad = author date, %s = subject line, one line per commit. HEAD,
  # not a hardcoded "main" (found in review): fails outright in a
  # shallow/single-branch checkout with no local main ref, e.g. a
  # typical CI checkout or a fork, HEAD always resolves to whatever's
  # actually checked out. --date=short gives YYYY-MM-DD, groups
  # naturally when piped through the awk below without a separate git
  # call per day.
  git log HEAD --date=short --pretty=format:"%ad|%s" | awk -F'|' '
    $1 != prev_date {
      if (prev_date != "") print ""
      print "## " $1
      print ""
      prev_date = $1
    }
    { print "- " $2 }
  '
} > CHANGELOG.md

echo "CHANGELOG.md regenerated ($(wc -l < CHANGELOG.md | tr -d ' ') lines)."
