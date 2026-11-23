#!/usr/bin/env bash
set -e
retry="$PWD/.github/scripts/retry.sh"
cd ../kai-xiaok-plugins/plugins/kai-report-creator/mcp-servers/report-renderer
bash "$retry" npm ci
npm run build
npm run build:bundle
