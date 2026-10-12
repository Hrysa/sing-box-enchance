#!/usr/bin/env bash
exec docker run -d --name sing-box-disconnect-collector --init --restart unless-stopped -v "$(pwd):/app" -v /etc/localtime:/etc/localtime:ro -w /app -e "CLASH_WS_URL=${CLASH_WS_URL:-ws://192.168.2.3:9090/connections/disconnect}" harbor.fy2.me/hub/node:22-alpine node disconnect-collector.mjs
