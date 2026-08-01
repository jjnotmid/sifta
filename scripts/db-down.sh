#!/usr/bin/env bash
#
# Stop the local CockroachDB started by scripts/db-up.sh, whichever path
# brought it up. Data is left on disk; pass --wipe to remove it.
#
# Usage: npm run db:down [-- --wipe]
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SIFTA_HOME="${SIFTA_HOME:-$HOME/.sifta}"
DATA_DIR="$SIFTA_HOME/cockroach-data"
PID_FILE="$DATA_DIR/cockroach.pid"
WIPE="${1:-}"

if command -v docker >/dev/null 2>&1 && docker ps -q -f name=sifta-crdb | grep -q .; then
  echo "==> Stopping docker compose cluster"
  if [ "$WIPE" = "--wipe" ]; then
    docker compose -f "$REPO_ROOT/docker-compose.yml" down -v
  else
    docker compose -f "$REPO_ROOT/docker-compose.yml" down
  fi
  exit 0
fi

if [ -f "$PID_FILE" ]; then
  PID="$(cat "$PID_FILE")"
  if kill -0 "$PID" 2>/dev/null; then
    echo "==> Stopping cluster (pid $PID)"
    # SIGTERM lets the node drain; the binary removes its own pid file.
    kill "$PID"
    for _ in $(seq 1 30); do
      kill -0 "$PID" 2>/dev/null || break
      sleep 1
    done
  fi
  rm -f "$PID_FILE"
else
  echo "==> No local cluster pid file; nothing to stop"
fi

if [ "$WIPE" = "--wipe" ]; then
  echo "==> Wiping $DATA_DIR"
  rm -rf "$DATA_DIR"
fi
