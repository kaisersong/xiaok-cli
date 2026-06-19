#!/usr/bin/env bash
set -euo pipefail

app_path="${1:-desktop/release/mac-arm64/xiaok.app}"
timeout_seconds="${NOTARY_TIMEOUT_SECONDS:-3600}"
poll_interval_seconds="${NOTARY_POLL_INTERVAL_SECONDS:-30}"
submit_attempts="${NOTARY_SUBMIT_ATTEMPTS:-3}"
submit_retry_seconds="${NOTARY_SUBMIT_RETRY_SECONDS:-20}"
submit_timeout_seconds="${NOTARY_SUBMIT_TIMEOUT_SECONDS:-600}"

: "${APPLE_API_KEY:?APPLE_API_KEY must point to the App Store Connect API key .p8 file}"
: "${APPLE_API_KEY_ID:?APPLE_API_KEY_ID is required}"
: "${APPLE_API_ISSUER:?APPLE_API_ISSUER is required}"

if [[ ! -d "$app_path" ]]; then
  echo "App bundle does not exist: $app_path" >&2
  exit 1
fi

if ! command -v xcrun >/dev/null 2>&1; then
  echo "xcrun is required for macOS notarization" >&2
  exit 1
fi

if ! command -v ditto >/dev/null 2>&1; then
  echo "ditto is required to create the notarization archive" >&2
  exit 1
fi

work_dir="${RUNNER_TEMP:-}"
if [[ -z "$work_dir" ]]; then
  work_dir="$(mktemp -d)"
else
  mkdir -p "$work_dir"
fi

app_base="$(basename "${app_path%.app}")"
zip_path="$work_dir/${app_base}-notary.zip"
submit_json="$work_dir/${app_base}-notary-submit.json"

echo "Creating notarization archive: $zip_path"
rm -f "$zip_path"
ditto -c -k --keepParent "$app_path" "$zip_path"

run_with_timeout() {
  local timeout="$1"
  local output_file="$2"
  shift 2

  rm -f "$output_file"
  "$@" >"$output_file" &
  local pid="$!"
  local elapsed=0
  local interval=5

  while kill -0 "$pid" >/dev/null 2>&1; do
    if ((elapsed >= timeout)); then
      echo "Command exceeded ${timeout}s: $*" >&2
      kill "$pid" >/dev/null 2>&1 || true
      sleep 2
      kill -9 "$pid" >/dev/null 2>&1 || true
      wait "$pid" >/dev/null 2>&1 || true
      return 124
    fi

    sleep "$interval"
    elapsed=$((elapsed + interval))
  done

  set +e
  wait "$pid"
  local exit_code="$?"
  set -e
  return "$exit_code"
}

submission_id=""
for ((attempt = 1; attempt <= submit_attempts; attempt++)); do
  echo "Submitting notarization request (attempt $attempt/$submit_attempts)"
  if run_with_timeout "$submit_timeout_seconds" "$submit_json" \
    xcrun notarytool submit "$zip_path" \
    --key "$APPLE_API_KEY" \
    --key-id "$APPLE_API_KEY_ID" \
    --issuer "$APPLE_API_ISSUER" \
    --output-format json >"$submit_json"; then
    submission_id="$(
      /usr/bin/python3 - "$submit_json" <<'PY'
import json
import sys

with open(sys.argv[1], "r", encoding="utf-8") as handle:
    data = json.load(handle)
print(data.get("id") or data.get("submissionId") or "")
PY
    )"
    if [[ -n "$submission_id" ]]; then
      break
    fi
    echo "notarytool submit succeeded but did not return a submission id" >&2
    cat "$submit_json" >&2
  else
    echo "notarytool submit failed" >&2
    if [[ -s "$submit_json" ]]; then
      cat "$submit_json" >&2
    fi
  fi

  if ((attempt < submit_attempts)); then
    sleep "$submit_retry_seconds"
  fi
done

if [[ -z "$submission_id" ]]; then
  echo "Unable to create an Apple notarization submission" >&2
  exit 1
fi

echo "Notary submission id: $submission_id"
if [[ -n "${GITHUB_ACTIONS:-}" ]]; then
  echo "::notice title=Apple notarization::Submission id ${submission_id}"
fi

deadline=$((SECONDS + timeout_seconds))
attempt=0
last_status=""

while ((SECONDS < deadline)); do
  attempt=$((attempt + 1))
  info_json="$work_dir/${app_base}-notary-info-${attempt}.json"
  info_err="$work_dir/${app_base}-notary-info-${attempt}.err"

  if xcrun notarytool info "$submission_id" \
    --key "$APPLE_API_KEY" \
    --key-id "$APPLE_API_KEY_ID" \
    --issuer "$APPLE_API_ISSUER" \
    --output-format json >"$info_json" 2>"$info_err"; then
    status="$(
      /usr/bin/python3 - "$info_json" <<'PY'
import json
import sys

with open(sys.argv[1], "r", encoding="utf-8") as handle:
    data = json.load(handle)
print(data.get("status") or "")
PY
    )"
    if [[ "$status" != "$last_status" ]]; then
      echo "Notary status: ${status:-unknown}"
      last_status="$status"
    else
      echo "Notary status: ${status:-unknown} (poll $attempt)"
    fi

    case "$status" in
      Accepted)
        echo "Stapling notarization ticket to $app_path"
        xcrun stapler staple "$app_path"
        xcrun stapler validate "$app_path"
        exit 0
        ;;
      Invalid | Rejected)
        echo "Notarization failed with status: $status" >&2
        log_json="$work_dir/${app_base}-notary-log.json"
        if xcrun notarytool log "$submission_id" \
          --key "$APPLE_API_KEY" \
          --key-id "$APPLE_API_KEY_ID" \
          --issuer "$APPLE_API_ISSUER" \
          --output-format json >"$log_json"; then
          cat "$log_json" >&2
        fi
        exit 1
        ;;
    esac
  else
    echo "notarytool info failed on poll $attempt; retrying" >&2
    if [[ -s "$info_err" ]]; then
      cat "$info_err" >&2
    fi
  fi

  remaining=$((deadline - SECONDS))
  if ((remaining <= 0)); then
    break
  fi
  if ((remaining < poll_interval_seconds)); then
    sleep "$remaining"
  else
    sleep "$poll_interval_seconds"
  fi
done

echo "Timed out after ${timeout_seconds}s waiting for notarization submission ${submission_id}" >&2
xcrun notarytool info "$submission_id" \
  --key "$APPLE_API_KEY" \
  --key-id "$APPLE_API_KEY_ID" \
  --issuer "$APPLE_API_ISSUER" \
  --output-format json >&2 || true
exit 124
