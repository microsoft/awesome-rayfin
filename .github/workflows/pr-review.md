---
description: |
  Automatic substantive review of pull requests to the Rayfin templates gallery, on
  open/update. Reviews every PR — including forks and external contributors — because
  it reads the PR via the GitHub API with no local checkout. Shares its logic with the
  /review command via a shared component.

on:
  pull_request:
    types: [opened, synchronize, reopened]

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
