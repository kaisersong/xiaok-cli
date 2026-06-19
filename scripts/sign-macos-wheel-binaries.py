#!/usr/bin/env python3
"""Sign Mach-O binaries embedded inside macOS wheel archives.

Apple notarization inspects nested archives in an app bundle. Python wheels can
contain Mach-O extension modules, and those modules must be signed with a
Developer ID certificate and a secure timestamp before the wheels are bundled.
"""

from __future__ import annotations

import argparse
import base64
import csv
import hashlib
import os
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

MACHO_MAGICS = {
    b"\xfe\xed\xfa\xce",
    b"\xfe\xed\xfa\xcf",
    b"\xce\xfa\xed\xfe",
    b"\xcf\xfa\xed\xfe",
    b"\xca\xfe\xba\xbe",
    b"\xbe\xba\xfe\xca",
}


def is_macho(path: Path) -> bool:
    try:
        with path.open("rb") as handle:
            return handle.read(4) in MACHO_MAGICS
    except OSError:
        return False


def run(command: list[str]) -> None:
    subprocess.run(command, check=True)


def sign_binary(path: Path, identity: str, keychain: str | None) -> None:
    command = [
        "codesign",
        "--force",
        "--sign",
        identity,
        "--timestamp",
        "--options",
        "runtime",
    ]
    if keychain:
        command.extend(["--keychain", keychain])
    command.append(str(path))
    run(command)
    run(["codesign", "--verify", "--strict", "--verbose=2", str(path)])


def record_hash(path: Path) -> str:
    digest = hashlib.sha256(path.read_bytes()).digest()
    return "sha256=" + base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")


def rewrite_record(root: Path) -> None:
    records = sorted(root.glob("*.dist-info/RECORD"))
    if len(records) != 1:
        raise RuntimeError(f"expected exactly one RECORD file in {root}, found {len(records)}")

    record_path = records[0]
    rows: list[list[str]] = []
    for path in sorted(p for p in root.rglob("*") if p.is_file()):
        rel = path.relative_to(root).as_posix()
        if path == record_path:
            rows.append([rel, "", ""])
        else:
            rows.append([rel, record_hash(path), str(path.stat().st_size)])

    with record_path.open("w", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerows(rows)


def repack_wheel(root: Path, wheel_path: Path) -> None:
    files = sorted(p for p in root.rglob("*") if p.is_file())
    record_files = [p for p in files if p.match("*.dist-info/RECORD")]
    other_files = [p for p in files if p not in record_files]

    with zipfile.ZipFile(wheel_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in other_files + record_files:
            archive.write(path, path.relative_to(root).as_posix())


def sign_wheel(wheel_path: Path, identity: str, keychain: str | None) -> int:
    with tempfile.TemporaryDirectory(prefix="xiaok-wheel-sign-") as tmp:
        root = Path(tmp) / "wheel"
        root.mkdir()
        with zipfile.ZipFile(wheel_path) as archive:
            archive.extractall(root)

        binaries = [path for path in root.rglob("*") if path.is_file() and is_macho(path)]
        if not binaries:
            return 0

        for binary in binaries:
            sign_binary(binary, identity, keychain)

        rewrite_record(root)
        replacement = Path(tmp) / wheel_path.name
        repack_wheel(root, replacement)
        shutil.move(str(replacement), wheel_path)
        return len(binaries)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("wheel_dir", type=Path)
    parser.add_argument("--identity", required=True)
    parser.add_argument("--keychain")
    args = parser.parse_args()

    if sys.platform != "darwin":
        raise SystemExit("sign-macos-wheel-binaries.py must run on macOS")

    wheel_dir = args.wheel_dir.resolve()
    if not wheel_dir.is_dir():
        raise SystemExit(f"wheel directory not found: {wheel_dir}")

    total_binaries = 0
    signed_wheels = 0
    for wheel_path in sorted(wheel_dir.glob("*.whl")):
        signed_count = sign_wheel(wheel_path, args.identity, args.keychain)
        if signed_count:
            signed_wheels += 1
            total_binaries += signed_count
            print(f"signed {signed_count} Mach-O file(s) in {wheel_path.name}")

    print(f"signed {total_binaries} Mach-O file(s) across {signed_wheels} wheel(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
