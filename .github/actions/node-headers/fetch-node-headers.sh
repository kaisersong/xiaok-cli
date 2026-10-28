#!/usr/bin/env bash
# Prepare a node-gyp --nodedir for the running Node (issue #99).
# Env: NODE_VERSION (vX.Y.Z), NODE_ARCH (x64|arm64|ia32), HEADERS_DIR, DIST_URL.
# Optional: GITHUB_ENV / GITHUB_OUTPUT (exported when set), RUNNER_OS.
set -euo pipefail
: "${NODE_VERSION:?}" "${NODE_ARCH:?}" "${HEADERS_DIR:?}"
DIST_URL="${DIST_URL:-https://nodejs.org/download/release}"
base="$DIST_URL/$NODE_VERSION"
is_windows=false
case "${RUNNER_OS:-$(uname -s)}" in Windows|MINGW*|MSYS*|CYGWIN*) is_windows=true ;; esac
lib_rel="win-$NODE_ARCH/node.lib"

fetch() { # url dest
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 5 --connect-timeout 20 --max-time 300 -o "$2" "$1"
}
verify() { # file name-in-SHASUMS
  local want
  want="$(awk -v f="$2" '$2==f{print $1}' "$work/SHASUMS256.txt")"
  if [ -z "$want" ] || [ "$(sha256 "$1")" != "$want" ]; then echo "::error::checksum mismatch for $2"; exit 1; fi
}
sha256() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
valid() {
  [ -f "$HEADERS_DIR/include/node/node.h" ] && [ -f "$HEADERS_DIR/include/node/common.gypi" ] || return 1
  if $is_windows; then [ -s "$HEADERS_DIR/Release/node.lib" ] || return 1; fi
  [ "$(cat "$HEADERS_DIR/.node-version" 2>/dev/null)" = "$NODE_VERSION" ]
}

if valid; then
  echo "Node $NODE_VERSION headers already present in $HEADERS_DIR"
else
  work="$(mktemp -d)"
  trap 'rm -rf "$work"' EXIT
  fetch "$base/SHASUMS256.txt" "$work/SHASUMS256.txt"
  tarball="node-$NODE_VERSION-headers.tar.gz"
  fetch "$base/$tarball" "$work/$tarball"
  verify "$work/$tarball" "$tarball"
  rm -rf "$HEADERS_DIR"; mkdir -p "$HEADERS_DIR"
  (cd "$HEADERS_DIR" && tar -xzf "$work/$tarball" --strip-components=1)
  if $is_windows; then
    fetch "$base/$lib_rel" "$work/node.lib"
    verify "$work/node.lib" "$lib_rel"
    # With --nodedir, node-gyp links $(Configuration)/node.lib; keep the
    # default <arch>/ layout too for tools that ignore nodedir.
    mkdir -p "$HEADERS_DIR/Release" "$HEADERS_DIR/Debug" "$HEADERS_DIR/$NODE_ARCH"
    for d in Release Debug "$NODE_ARCH"; do cp "$work/node.lib" "$HEADERS_DIR/$d/node.lib"; done
  fi
  echo "$NODE_VERSION" > "$HEADERS_DIR/.node-version"
  valid || { echo "::error::prepared headers in $HEADERS_DIR are incomplete"; exit 1; }
fi

nodedir="$HEADERS_DIR"
if $is_windows && command -v cygpath >/dev/null; then nodedir="$(cygpath -w "$HEADERS_DIR")"; fi
echo "npm_config_nodedir=$nodedir"
if [ -n "${GITHUB_ENV:-}" ]; then echo "npm_config_nodedir=$nodedir" >> "$GITHUB_ENV"; fi
if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "nodedir=$nodedir" >> "$GITHUB_OUTPUT"; fi
exit 0
