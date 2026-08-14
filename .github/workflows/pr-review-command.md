---
description: |
  On-demand substantive PR review, invoked with the /review command on a pull request.
  Works on any PR (including forks/external contributors) because it reads the PR via the
  GitHub API with no local checkout. Shares its logic with the automatic PR review.

on:
  slash_command: "review"

# No `contents: read` on purpose — see the note in shared/pr-review.md. It would inject a
# "Checkout PR branch" step that hard-fails on forks and external-contributor PRs.
permissions:
  pull-requests: read
  issues: read
  actions: read
  copilot-requests: write # Native billing: Actions token for Copilot inference (billed to the org), no PAT needed.

timeout-minutes: 15

imports:
  - .github/workflows/shared/pr-review.md
---

Review this pull request following the shared PR-review instructions.
