#!/usr/bin/env bash
# Generated vectors must match their generators: regenerate and fail on any difference.
set -euo pipefail
cd "$(dirname "$0")/.."
node scripts/gen-substitution-vectors.mjs vectors/substitution >/dev/null
node scripts/gen-substitution-solve-vectors.mjs vectors/substitution-solve >/dev/null
if ! git diff --quiet -- vectors || [ -n "$(git status --porcelain -- vectors)" ]; then
  git status --short -- vectors
  echo "vectors differ from their generators: run the generators and commit the result" >&2
  exit 1
fi
echo "generated vectors OK"
