#!/usr/bin/env bash
# Build or update the structural concept graph for the compiled Obsidian wiki.
# Run after compile_wiki to refresh the notes graph.
# Uses OpenAI backend (OPENAI_API_KEY in .env.local). Cost: ~$0.02 per full rebuild.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env.local"
VAULT_WIKI="$HOME/Desktop/Second Brain Vault/wiki"
GRAPH="$VAULT_WIKI/graphify-out/graph.json"

# Load API key from .env.local if not already in environment
if [ -z "${OPENAI_API_KEY:-}" ] && [ -f "$ENV_FILE" ]; then
  export OPENAI_API_KEY
  OPENAI_API_KEY=$(grep '^OPENAI_API_KEY=' "$ENV_FILE" | cut -d'=' -f2-)
fi

if [ -z "${OPENAI_API_KEY:-}" ]; then
  echo "ERROR: OPENAI_API_KEY not found in environment or .env.local"
  exit 1
fi

echo "Building notes concept graph..."
graphify "$VAULT_WIKI"

echo ""
echo "Labeling communities..."
graphify cluster-only "$VAULT_WIKI" --backend=openai

echo ""
echo "Notes graph: $GRAPH"
echo ""
echo "Query it:"
echo "  graphify query \"what are the most-connected themes?\" --graph \"$GRAPH\""
echo ""
echo "MCP server (expose note structure to AI sessions):"
echo "  graphify-mcp \"$GRAPH\""
