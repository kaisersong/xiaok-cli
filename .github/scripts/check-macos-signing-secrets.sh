#!/usr/bin/env bash
missing=()
for name in MACOS_CERTIFICATE_P12_BASE64 MACOS_CERTIFICATE_PASSWORD APPLE_TEAM_ID APPLE_API_KEY_ID APPLE_API_ISSUER APPLE_API_KEY_P8_BASE64; do
  if [[ -z "${!name:-}" ]]; then
    missing+=("$name")
  fi
done
if (( ${#missing[@]} )); then
  printf 'Missing macOS signing secret(s): %s\n' "${missing[*]}" >&2
  exit 1
fi
if [[ "$APPLE_TEAM_ID" != "Y9YR86UG94" ]]; then
  printf 'APPLE_TEAM_ID must be Y9YR86UG94 for com.xiaok.desktop\n' >&2
  exit 1
fi
