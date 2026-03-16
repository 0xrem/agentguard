#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

DO_PULL=1
DO_INSTALL=1

for arg in "$@"; do
  case "$arg" in
    --no-pull)
      DO_PULL=0
      ;;
    --no-install)
      DO_INSTALL=0
      ;;
    *)
      echo "Unknown option: $arg"
      echo "Usage: scripts/start-latest.sh [--no-pull] [--no-install]"
      exit 1
      ;;
  esac
done

log() {
  printf "\n[agentguard-start] %s\n" "$1"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1"
    exit 1
  fi
}

require_cmd git
require_cmd pnpm

cd "$REPO_ROOT"

log "Repository: $REPO_ROOT"

if [[ "$DO_PULL" -eq 1 ]]; then
  if git remote get-url origin >/dev/null 2>&1; then
    if git diff --quiet && git diff --cached --quiet; then
      log "Checking for latest code (fast-forward only)"
      git fetch origin

      if git rev-parse --abbrev-ref --symbolic-full-name @{u} >/dev/null 2>&1; then
        git pull --ff-only
      else
        log "No upstream branch configured, skipping git pull"
      fi
    else
      log "Working tree has local changes, skipping git pull to keep your edits safe"
    fi
  else
    log "No origin remote found, skipping git pull"
  fi
fi

if [[ "$DO_INSTALL" -eq 1 ]]; then
  log "Installing/updating workspace dependencies"
  pnpm install --frozen-lockfile || pnpm install
fi

log "Starting local stack"
pnpm stack:up

log "Launching desktop app (keeps running in this terminal)"
pnpm desktop:dev
