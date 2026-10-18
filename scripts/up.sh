#!/usr/bin/env bash
# One-command bring-up: Inji Certify + Inji Verify + Postgres + the playground, bootstrapped.
#   ./scripts/up.sh            → http://localhost:4000
# Needs only Docker (with the compose plugin).
set -euo pipefail
cd "$(dirname "$0")/.."

echo "▸ Building and starting Inji Certify, Inji Verify, Postgres and the playground…"
docker compose --profile app up -d --build

setup() { docker compose --profile app exec -T playground node --import tsx src/cli/setup.ts --no-restart "$@"; }

echo "▸ Deriving Inji Certify's issuer did:key…"
DID=$(setup --print-did | tail -n 1)
CURRENT=$(grep -s '^CERTIFY_ISSUER_DID=' .env | cut -d= -f2- || true)
if [ "$DID" != "$CURRENT" ]; then
  grep -sv '^CERTIFY_ISSUER_DID=' .env > .env.tmp || true
  echo "CERTIFY_ISSUER_DID=$DID" >> .env.tmp && mv .env.tmp .env
  echo "▸ Restarting Certify with issuer $DID"
  docker compose up -d certify
fi

echo "▸ Registering credential configurations…"
setup --configs-only
echo "✔ Playground ready at http://localhost:4000"
