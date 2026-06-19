#!/usr/bin/env bash
set -euo pipefail

app_path="${1:-desktop/release/mac-arm64/xiaok.app}"
timeout_seconds="${NOTARY_TIMEOUT_SECONDS:-7200}"
poll_interval_seconds="${NOTARY_POLL_INTERVAL_SECONDS:-30}"
reuse_in_progress="${NOTARY_REUSE_IN_PROGRESS:-true}"
reuse_window_seconds="${NOTARY_REUSE_WINDOW_SECONDS:-7200}"

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
archive_key="${NOTARY_ARCHIVE_KEY:-${GITHUB_SHA:-}}"
if [[ -z "$archive_key" ]]; then
  archive_key="$(
    codesign -dv --verbose=4 "$app_path" 2>&1 \
      | awk -F= '/^CDHash=/{print $2; exit}' \
      | tr -cd '[:alnum:]'
  )"
fi
archive_key="$(printf '%s' "$archive_key" | tr -cd '[:alnum:]')"
archive_key="${archive_key:0:12}"
if [[ -n "$archive_key" ]]; then
  zip_path="$work_dir/${app_base}-${archive_key}-notary.zip"
else
  zip_path="$work_dir/${app_base}-notary.zip"
fi
notary_archive_name="$(basename "$zip_path")"

notary_auth_args=(
  --key "$APPLE_API_KEY"
  --key-id "$APPLE_API_KEY_ID"
  --issuer "$APPLE_API_ISSUER"
  --output-format json
)

json_value() {
  local file_path="$1"
  local field_name="$2"
  /usr/bin/python3 - "$file_path" "$field_name" <<'PY'
import json
import sys

with open(sys.argv[1], "r", encoding="utf-8") as handle:
    data = json.load(handle)
print(data.get(sys.argv[2]) or "")
PY
}

try_staple_existing_ticket() {
  echo "Checking for an existing notarization ticket"
  if xcrun stapler staple "$app_path"; then
    xcrun stapler validate "$app_path"
    echo "Existing notarization ticket stapled successfully"
    return 0
  fi
  echo "No existing ticket is currently available"
  return 1
}

find_reusable_submission_id() {
  local history_json="$work_dir/${app_base}-notary-history.json"
  if ! xcrun notarytool history "${notary_auth_args[@]}" >"$history_json"; then
    echo "Unable to read notarytool history; submitting a new archive" >&2
    return 1
  fi

  /usr/bin/python3 - "$history_json" "$notary_archive_name" "$reuse_window_seconds" <<'PY'
import datetime as dt
import json
import sys

history_path, archive_name, window_seconds = sys.argv[1], sys.argv[2], int(sys.argv[3])
with open(history_path, "r", encoding="utf-8") as handle:
    payload = json.load(handle)

if isinstance(payload, list):
    entries = payload
elif isinstance(payload, dict):
    entries = (
        payload.get("history")
        or payload.get("submissions")
        or payload.get("items")
        or payload.get("data")
        or []
    )
else:
    entries = []

now = dt.datetime.now(dt.timezone.utc)
candidates = []
for entry in entries:
    if not isinstance(entry, dict):
        continue
    if entry.get("name") != archive_name:
        continue
    if entry.get("status") != "In Progress":
        continue
    submission_id = entry.get("id") or entry.get("submissionId")
    created_raw = entry.get("createdDate") or entry.get("created_at")
    if not submission_id or not created_raw:
        continue
    try:
        created = dt.datetime.fromisoformat(created_raw.replace("Z", "+00:00"))
    except ValueError:
        continue
    age = (now - created).total_seconds()
    if 0 <= age <= window_seconds:
        candidates.append((created, submission_id))

if candidates:
    candidates.sort(reverse=True)
    print(candidates[0][1])
PY
}

poll_submission() {
  local submission_id="$1"
  local deadline=$((SECONDS + timeout_seconds))
  local attempt=0
  local last_status=""

  echo "Notary submission id: $submission_id"
  if [[ -n "${GITHUB_ACTIONS:-}" ]]; then
    echo "::notice title=Apple notarization::Submission id ${submission_id}"
  fi

  while ((SECONDS < deadline)); do
    attempt=$((attempt + 1))
    local info_json="$work_dir/${app_base}-notary-info-${attempt}.json"
    local info_err="$work_dir/${app_base}-notary-info-${attempt}.err"

    if xcrun notarytool info "$submission_id" "${notary_auth_args[@]}" >"$info_json" 2>"$info_err"; then
      local status
      status="$(json_value "$info_json" status)"
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
          local log_json="$work_dir/${app_base}-notary-log.json"
          if xcrun notarytool log "$submission_id" "${notary_auth_args[@]}" >"$log_json"; then
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

    local remaining=$((deadline - SECONDS))
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
  xcrun notarytool info "$submission_id" "${notary_auth_args[@]}" >&2 || true
  xcrun notarytool log "$submission_id" "${notary_auth_args[@]}" >&2 || true
  exit 124
}

if try_staple_existing_ticket; then
  exit 0
fi

if [[ "$reuse_in_progress" == "true" ]]; then
  reusable_submission_id="$(find_reusable_submission_id || true)"
  if [[ -n "$reusable_submission_id" ]]; then
    echo "Reusing recent in-progress notarization submission: $reusable_submission_id"
    poll_submission "$reusable_submission_id"
  fi
fi

echo "Creating notarization archive: $zip_path"
rm -f "$zip_path"
ditto -c -k --keepParent "$app_path" "$zip_path"
du -h "$zip_path"

submit_json="$work_dir/${app_base}-notary-submit.json"
echo "Submitting notarization request"
if ! xcrun notarytool submit "$zip_path" "${notary_auth_args[@]}" >"$submit_json"; then
  echo "notarytool submit failed" >&2
  if [[ -s "$submit_json" ]]; then
    cat "$submit_json" >&2
  fi
  exit 1
fi

submission_id="$(json_value "$submit_json" id)"
if [[ -z "$submission_id" ]]; then
  submission_id="$(json_value "$submit_json" submissionId)"
fi
if [[ -z "$submission_id" ]]; then
  echo "notarytool submit succeeded but did not return a submission id" >&2
  cat "$submit_json" >&2
  exit 1
fi

poll_submission "$submission_id"
