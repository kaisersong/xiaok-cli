#!/usr/bin/env python3
"""
Windows terminal E2E for clipboard image import.

This test starts xiaok in a real tmux TTY, seeds the Windows system clipboard
with a bitmap image, sends Alt+V (M-v), and verifies that `[image 0]` becomes
visible in the input footer.
"""

from __future__ import annotations

import importlib.util
import os
import subprocess
import sys
import time
from pathlib import Path


def load_tmux_e2e_module():
    module_path = Path(__file__).with_name("tmux-e2e.py")
    spec = importlib.util.spec_from_file_location("tmux_e2e", module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"unable to load tmux helpers from {module_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def seed_windows_clipboard_image() -> None:
    script = r"""
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap 2, 2
$bmp.SetPixel(0, 0, [System.Drawing.Color]::Red)
$bmp.SetPixel(1, 0, [System.Drawing.Color]::Blue)
$bmp.SetPixel(0, 1, [System.Drawing.Color]::Green)
$bmp.SetPixel(1, 1, [System.Drawing.Color]::Black)
[System.Windows.Forms.Clipboard]::SetImage($bmp)
"""
    result = subprocess.run(
        ["powershell", "-STA", "-NoProfile", "-Command", script],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=10,
    )
    if result.returncode != 0:
        raise RuntimeError(f"failed to seed clipboard image:\n{result.stderr}")


def run_windows_image_paste_e2e(project_dir: Path) -> None:
    if os.name != "nt":
        raise RuntimeError("windows-image-paste-e2e.py must run on Windows")

    tmux_e2e = load_tmux_e2e_module()
    cli_entry = project_dir / "dist" / "index.js"
    if not cli_entry.exists():
        raise AssertionError(f"CLI entry not found: {cli_entry}")

    tmux_bin = tmux_e2e.resolve_tmux_binary()
    server = tmux_e2e.FakeOpenAIServer([])
    tmp_root = project_dir / "tests" / "e2e" / ".tmp"
    tmp_root.mkdir(parents=True, exist_ok=True)
    work_root = tmp_root / f"run-{int(time.time() * 1000)}"
    work_root.mkdir(parents=True, exist_ok=True)
    config_dir = work_root / "config"
    home_dir = work_root / "home"
    project_fixture = work_root / "project"
    config_dir.mkdir(parents=True, exist_ok=True)
    home_dir.mkdir(parents=True, exist_ok=True)
    project_fixture.mkdir(parents=True, exist_ok=True)

    session = f"xiaok-image-paste-{int(time.time())}"
    tmux = tmux_e2e.TmuxHarness(
        session,
        project_fixture,
        config_dir,
        home_dir,
        cli_entry,
        tmux_bin,
    )

    try:
        print("------------------------------------------------------------------------")
        print("Terminal E2E: windows clipboard image import")
        print(f"Project: {project_dir}")
        print("------------------------------------------------------------------------")
        os.environ.pop("TMUX", None)
        server.start()
        tmux_e2e.write_config(config_dir, server.base_url)
        seed_windows_clipboard_image()
        tmux.tmux("start-server", check=False)
        tmux.start()
        welcome = tmux.wait_for(
            lambda text: "欢迎使用 xiaok code" in text and tmux_e2e.has_input_prompt(text),
            timeout=12,
        )
        if "欢迎使用 xiaok code" not in welcome:
            raise AssertionError(f"xiaok did not reach the welcome screen:\n{welcome}")
        if "[image 0]" in welcome:
            raise AssertionError(f"unexpected pre-existing image placeholder:\n{welcome}")

        # tmux-windows does not reliably translate M-v into the same raw bytes
        # the real Windows terminal sends. Inject the exact ESC + v sequence so
        # the pane still exercises the real TTY rendering path.
        tmux.tmux("send-keys", "-H", "-t", session, "1b", "76")
        imported = tmux.wait_for(
            lambda text: "[image 0]" in text and tmux_e2e.has_input_prompt(text),
            timeout=8,
        )
        if "[image 0]" not in imported:
            raise AssertionError(f"image placeholder did not appear in the input footer:\n{imported}")

        print("PASS: Alt+V imports the clipboard image into the visible input footer")
        print("Visible footer snapshot:")
        print("\n".join(imported.splitlines()[-6:]))
    finally:
        tmux.stop()
        server.close()


if __name__ == "__main__":
    run_windows_image_paste_e2e(Path(__file__).resolve().parents[2])
