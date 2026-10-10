#!/usr/bin/env bash
exec docker run -d --init --restart unless-stopped -v "$(pwd):/app" -w /app -e "CLASH_WS_URL=${CLASH_WS_URL:-ws://192.168.2.3:9090/connections/disconnect}" node:22-alpine node disconnect-collector.mjs
