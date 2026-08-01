#!/usr/bin/env bash
#
# Bring up a local single-node CockroachDB on localhost:26257 and create the
# `sifta` database.
#
# Prefers Docker when it is available (matches docker-compose.yml). Falls back
# to a downloaded CockroachDB binary otherwise — the build machine for this
# project has no container runtime. Both paths produce the same cluster on the
# same port, so nothing downstream needs to know which one ran.
#
# Usage: npm run db:up
set -euo pipefail
# Without pipefail a failed `curl | tar` reports tar's status and a truncated
# download extracts a silently broken binary. This bit us once already.

CRDB_VERSION="${CRDB_VERSION:-v25.4.0}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# The binary and the database store live OUTSIDE the repo. This repo sits in an
# iCloud Drive folder, and a running database store inside a sync root invites
# file eviction and sync conflicts mid-write. Override with SIFTA_HOME.
SIFTA_HOME="${SIFTA_HOME:-$HOME/.sifta}"
VENDOR_DIR="$SIFTA_HOME/cockroach-$CRDB_VERSION"
DATA_DIR="$SIFTA_HOME/cockroach-data"
LOG_FILE="$SIFTA_HOME/cockroach-start.log"

wait_for_sql() {
  local sql_cmd=("$@")
  for _ in $(seq 1 60); do
    if "${sql_cmd[@]}" -e 'SELECT 1' >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "error: CockroachDB did not become ready within 60s" >&2
  [ -f "$LOG_FILE" ] && tail -30 "$LOG_FILE" >&2
  return 1
}

# ---------------------------------------------------------------------------
# Path A — Docker
# ---------------------------------------------------------------------------
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  echo "==> Docker detected; starting cluster via docker compose"
  docker compose -f "$REPO_ROOT/docker-compose.yml" up -d
  wait_for_sql docker exec sifta-crdb cockroach sql --insecure
  docker exec sifta-crdb cockroach sql --insecure \
    -e 'CREATE DATABASE IF NOT EXISTS sifta'
  echo "==> Ready: postgresql://root@localhost:26257/sifta?sslmode=disable"
  exit 0
fi

# ---------------------------------------------------------------------------
# Path B — standalone binary
# ---------------------------------------------------------------------------
echo "==> No Docker; using standalone CockroachDB $CRDB_VERSION binary"

COCKROACH="$VENDOR_DIR/cockroach"

if [ ! -x "$COCKROACH" ]; then
  case "$(uname -s)" in
    Darwin)
      # amd64 macOS builds are published under the darwin-10.9 prefix,
      # arm64 under darwin-11.0. They are not interchangeable.
      if [ "$(uname -m)" = "arm64" ]; then
        PLATFORM="darwin-11.0-arm64"
      else
        PLATFORM="darwin-10.9-amd64"
      fi
      ;;
    Linux)
      PLATFORM="linux-amd64"
      [ "$(uname -m)" = "aarch64" ] && PLATFORM="linux-arm64"
      ;;
    *)
      echo "error: unsupported platform $(uname -s); install Docker and retry" >&2
      exit 1
      ;;
  esac

  TARBALL="cockroach-$CRDB_VERSION.$PLATFORM.tgz"
  BASE_URL="https://binaries.cockroachdb.com"
  DL_DIR="$SIFTA_HOME/downloads"
  ARCHIVE="$DL_DIR/$TARBALL"
  mkdir -p "$DL_DIR" "$VENDOR_DIR"

  # Download to a file rather than piping straight into tar: the archive is
  # ~150MB and a mid-transfer stall would otherwise extract a truncated binary
  # that fails silently at run time. -C - resumes a partial file across retries.
  echo "==> Downloading $TARBALL (~150MB, resumable)"
  curl -fL --retry 8 --retry-all-errors --retry-delay 2 \
    --connect-timeout 20 --speed-limit 1024 --speed-time 60 \
    -C - -o "$ARCHIVE" "$BASE_URL/$TARBALL"

  echo "==> Verifying checksum"
  EXPECTED="$(curl -fsSL "$BASE_URL/$TARBALL.sha256sum" | awk '{print $1}')"
  ACTUAL="$(shasum -a 256 "$ARCHIVE" | awk '{print $1}')"
  if [ "$EXPECTED" != "$ACTUAL" ]; then
    echo "error: checksum mismatch for $TARBALL" >&2
    echo "  expected $EXPECTED" >&2
    echo "  actual   $ACTUAL" >&2
    echo "  removing corrupt archive; re-run 'npm run db:up' to retry" >&2
    rm -f "$ARCHIVE"
    exit 1
  fi

  echo "==> Extracting"
  tar -xzf "$ARCHIVE" -C "$VENDOR_DIR" --strip-components=1
  chmod +x "$COCKROACH"
  rm -f "$ARCHIVE"
fi

# A truncated or wrong-arch binary fails here rather than 60s later in a
# confusing readiness timeout.
if ! "$COCKROACH" version >/dev/null 2>&1; then
  echo "error: $COCKROACH is not runnable; removing so the next run re-downloads" >&2
  rm -rf "$VENDOR_DIR"
  exit 1
fi

if "$COCKROACH" sql --insecure --host=localhost:26257 -e 'SELECT 1' >/dev/null 2>&1; then
  echo "==> Cluster already running"
else
  echo "==> Starting single-node cluster (store: $DATA_DIR)"
  mkdir -p "$DATA_DIR"
  "$COCKROACH" start-single-node \
    --insecure \
    --listen-addr=localhost:26257 \
    --http-addr=localhost:8080 \
    --store="$DATA_DIR" \
    --background \
    --pid-file="$DATA_DIR/cockroach.pid" \
    >"$LOG_FILE" 2>&1
  wait_for_sql "$COCKROACH" sql --insecure --host=localhost:26257
fi

"$COCKROACH" sql --insecure --host=localhost:26257 \
  -e 'CREATE DATABASE IF NOT EXISTS sifta'

echo "==> Ready: postgresql://root@localhost:26257/sifta?sslmode=disable"
echo "==> DB Console: http://localhost:8080"
