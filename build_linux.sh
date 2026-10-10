#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"

export GOOS=linux
export GOARCH=amd64

exec "$SCRIPT_DIR/build.sh"
