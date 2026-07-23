#!/usr/bin/env bash
set -euo pipefail

echo "[DPN] bootstrap start"

if [[ ! -f ".env.local" ]]; then
  echo "[DPN] .env.local mangler. Kopier fra .env.example"
else
  echo "[DPN] .env.local fundet"
fi

if [[ -f "scripts/setup-inkling-server.sh" ]]; then
  echo "[DPN] inkling setup script fundet"
fi

if [[ -f "scripts/setup-ab-tables.sql" ]]; then
  echo "[DPN] AB SQL script fundet"
fi

echo "[DPN] bootstrap complete"
