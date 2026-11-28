#!/usr/bin/env bash
set -euo pipefail
[[ "$HAS_KEY" == true ]] || { echo 'Missing dev ANTHROPIC_API_KEY.' >&2; exit 1; }
[[ "$APPROVED_SHA256" =~ ^[0-9a-f]{64}$ ]] || { echo 'Enter the approved preview.json SHA-256 from the preview summary.' >&2; exit 1; }
printf '%s  frozen/preview.json\n' "$APPROVED_SHA256" | sha256sum --check
jq -e '(.batch.requests | length) == 15 and all(.batch.requests[]; .params.model == "claude-opus-5-5" and .params.max_tokens == 16000)' frozen/preview.json

# Creating a named ref is atomic. Keep the tag across retries, even when the
# provider response is lost. Its annotation points to the run to reconcile.
tag_name="fac103-submission/$APPROVED_SHA256"
run_url="$GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID"
tag_object=$(gh api --method POST "repos/$GITHUB_REPOSITORY/git/tags" \
  -f tag="$tag_name" -f type=commit -f object="$GITHUB_SHA" -f message="FAC-103 submission attempt: $run_url" --jq '.sha')
if ! gh api --method POST "repos/$GITHUB_REPOSITORY/git/refs" \
    -f ref="refs/tags/$tag_name" -f sha="$tag_object" > /dev/null; then
  echo "Could not claim this preview. Check tag $tag_name and its run before any retry." >&2
  exit 1
fi
