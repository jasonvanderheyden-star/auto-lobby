#!/usr/bin/env bash
#
# agent-worktree-guard.sh — guardrail against subagents disrupting the SHARED
# git working tree (switching branches mid-review, leaving it on the wrong
# branch, or reverting/adding tracked files). See AGENTS.md → "Working-tree
# discipline & the orchestrator guard".
#
# Two real incidents motivated this: a review subagent ran `git checkout main`
# (and `git checkout main -- .`) to "compare" and either left the tree on the
# wrong branch or ran a check against it, silently invalidating the review.
#
# Usage:
#   scripts/agent-worktree-guard.sh fingerprint
#       Prints a one-line fingerprint of the tree state:  <branch>|<HEAD>|<status-hash>
#
#   scripts/agent-worktree-guard.sh assert <expected-branch> [<expected-fingerprint>]
#       Exits 0 and prints "guard ok" if the current branch matches
#       <expected-branch> and (when given) the fingerprint is unchanged.
#       Exits 1 LOUDLY otherwise, so a pipeline stage fails fast instead of
#       proceeding on a corrupted tree.
#
# Pattern (orchestrator wraps each Bash-capable subagent stage):
#   FP=$(scripts/agent-worktree-guard.sh fingerprint)      # before dispatch
#   ... run the subagent ...
#   scripts/agent-worktree-guard.sh assert "$BRANCH" "$FP"  # after it returns
#
set -uo pipefail

fingerprint() {
  local branch head status
  branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null) || { echo "GUARD ERROR: not inside a git repo" >&2; exit 2; }
  head=$(git rev-parse HEAD 2>/dev/null)
  # Hash of the porcelain status so legitimate pre-existing uncommitted work is
  # captured identically before and after — we detect *changes*, not dirtiness.
  status=$(git status --porcelain 2>/dev/null | LC_ALL=C sort | shasum | awk '{print $1}')
  printf '%s|%s|%s\n' "$branch" "$head" "$status"
}

cmd="${1:-}"
case "$cmd" in
  fingerprint)
    fingerprint
    ;;
  assert)
    expected_branch="${2:-}"
    expected_fp="${3:-}"
    if [ -z "$expected_branch" ]; then
      echo "usage: $0 assert <expected-branch> [<expected-fingerprint>]" >&2
      exit 2
    fi
    cur_branch=$(git rev-parse --abbrev-ref HEAD)
    cur_fp=$(fingerprint)
    fail=0
    if [ "$cur_branch" != "$expected_branch" ]; then
      echo "🛑 GUARD FAIL: working tree is on branch '$cur_branch' but expected '$expected_branch'." >&2
      echo "   A subagent or step switched branches on the shared tree and did not return." >&2
      fail=1
    fi
    if [ -n "$expected_fp" ] && [ "$cur_fp" != "$expected_fp" ]; then
      echo "🛑 GUARD FAIL: working-tree state changed unexpectedly." >&2
      echo "   before: $expected_fp" >&2
      echo "   after:  $cur_fp" >&2
      echo "   Files were reverted/added or HEAD moved. Any git-dependent conclusions from this step are SUSPECT." >&2
      fail=1
    fi
    if [ "$fail" -ne 0 ]; then
      echo "   Restore the original branch/state ('git checkout $expected_branch'), then re-run the affected step." >&2
      exit 1
    fi
    echo "guard ok: $cur_fp"
    ;;
  *)
    echo "usage: $0 {fingerprint | assert <expected-branch> [<expected-fingerprint>]}" >&2
    exit 2
    ;;
esac
