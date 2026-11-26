#!/usr/bin/env bash
set -euo pipefail

echo "=== npm ls vite (installed tree) ==="
npm ls vite --all || true

echo
echo "=== npm view vitest version (latest available) ==="
npm view vitest version || true

echo
echo "=== npm view vite version (latest available) ==="
npm view vite version || true

echo
echo "Done. If you need a JSON list of versions try: npm view vitest versions --json"
