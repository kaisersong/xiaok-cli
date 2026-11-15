#!/usr/bin/env bash
set -e
retry="$PWD/.github/scripts/retry.sh"
bash "$retry" npm ci --prefix ../kai-xiaok-plugins/plugins/kai-infinity-canvas
npm run build --prefix ../kai-xiaok-plugins/plugins/kai-infinity-canvas
bash "$retry" npm ci --prefix ../kai-xiaok-plugins/plugins/kai-infinity-canvas/mcp-servers/canvas-server
npm run build:bundle --prefix ../kai-xiaok-plugins/plugins/kai-infinity-canvas/mcp-servers/canvas-server
