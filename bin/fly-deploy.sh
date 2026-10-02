#!/usr/bin/env bash
#
# A hand-run deploy that stamps the image the same way the workflow does.
#
# `.github/workflows/deploy.yml` is the normal route — a merge to `main` deploys itself,
# and this script is for the cases it cannot cover: a tree that is not `main`, or a
# redeploy while the workflow is unavailable.
#
# **Why it exists at all.** Without it, a hand-run deploy produces an unstamped image,
# and `GET /api/health` can only say `source: unknown` — which collapses "a person
# deployed this from a checkout" and "nothing here was ever stamped" into one answer.
# Stamping both routes is what turns that field into provenance rather than a hint.
#
# The dirty flag is the part worth having. A deploy from an uncommitted tree ships
# something no commit names, and it is exactly the deploy somebody wants to know about
# three weeks later; the hash alone would point at a tree that was never what shipped.
#
# Usage:
#   ./bin/fly-deploy.sh                 # deploy this working tree, stamped
#   ./bin/fly-deploy.sh --dry-run       # print the command and the stamps, deploy nothing
#   ./bin/fly-deploy.sh --app other     # somewhere other than production
#
# Any further arguments are passed through to `flyctl deploy`.
set -euo pipefail

cd "$(dirname "$0")/.."

app="the-roving-office"
dry=""
passthrough=()
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) dry="1"; shift ;;
    --app) app="$2"; shift 2 ;;
    *) passthrough+=("$1"); shift ;;
  esac
done

sha="$(git rev-parse HEAD)"
# Tracked modifications *and* untracked files: both change what the build context
# contains, so both make the commit an incomplete description of what is being shipped.
dirty=""
if [ -n "$(git status --porcelain)" ]; then dirty="1"; fi
built_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

args=(
  deploy --app "$app"
  --build-arg "GIT_SHA=$sha"
  --build-arg "GIT_DIRTY=$dirty"
  --build-arg "DEPLOY_SOURCE=local"
  --build-arg "DEPLOY_RUN="
  --build-arg "BUILD_TIME=$built_at"
)

echo "app        $app"
echo "commit     $sha${dirty:+  (dirty — uncommitted changes are in this build)}"
echo "built at   $built_at"

if [ -n "$dry" ]; then
  echo
  echo "would run: flyctl ${args[*]} ${passthrough[*]-}"
  exit 0
fi

echo
exec flyctl "${args[@]}" ${passthrough[@]+"${passthrough[@]}"}
