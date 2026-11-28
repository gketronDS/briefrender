#!/usr/bin/env bash
set -euo pipefail
[[ "$PREVIEW_RUN" =~ ^[0-9]+$ ]] || { echo 'Enter the numeric preview run ID.' >&2; exit 1; }
gh api "repos/$GITHUB_REPOSITORY/actions/runs/$PREVIEW_RUN" > run.json
jq -e '.path == ".github/workflows/fac-103-evaluation.yml" and .head_branch == "main" and .event == "workflow_dispatch" and .conclusion == "success"' run.json
gh run download "$PREVIEW_RUN" --repo "$GITHUB_REPOSITORY" --name fac-103-preview --dir frozen
