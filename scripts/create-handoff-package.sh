#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT="${1:-"$ROOT/open-brain-handoff.tar.gz"}"

tar \
  --exclude='node_modules' \
  --exclude='dist' \
  --exclude='.temp' \
  --exclude='.env' \
  --exclude='.env.local' \
  --exclude='client_secret_*.json' \
  -czf "$OUTPUT" \
  -C "$ROOT" \
  README.md \
  OBSIDIAN_GUIDE.md \
  .env.example \
  slack-app-manifest.example.yaml \
  docs \
  supabase \
  mcp-server \
  scripts

echo "Created clean handoff package: $OUTPUT"
