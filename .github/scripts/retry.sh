#!/usr/bin/env bash
# Usage: bash .github/scripts/retry.sh <command...>
# Retries a flaky install command (npm ci) up to RETRY_ATTEMPTS times (default 3)
# with a growing delay (issue #99). npm ci wipes node_modules on each attempt.
set -uo pipefail
attempts="${RETRY_ATTEMPTS:-3}"; delay="${RETRY_DELAY:-15}"
for ((i = 1; i <= attempts; i++)); do
  "$@" && exit 0
  status=$?
  if ((i == attempts)); then echo "::error::'$*' failed after $attempts attempts (exit $status)"; exit "$status"; fi
  echo "::warning::'$*' failed (exit $status), attempt $i/$attempts; retrying in $((delay * i))s"
  sleep $((delay * i))
done
