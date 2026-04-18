#!/usr/bin/env python3
"""
End-to-end terminal test for the interactive chat UI.

The test creates a real TTY with tmux, starts xiaok against a local
OpenAI-compatible SSE server, types into the prompt, and captures the pane.
It does not use the user's real config or external model APIs.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import shlex
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Callable


ROWS = 24
COLS = 120
SPINNER_LABELS = ("Thinking", "Answering", "Working")


class FakeOpenAIServer:
    def __init__(self, responses: list[str], first_token_delay: float = 0.9) -> None:
        self.responses = responses
        self.first_token_delay = first_token_delay
        self.requests: list[dict] = []
        self._server = ThreadingHTTPServer(("127.0.0.1", 0), self._handler_class())
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)

    @property
    def base_url(self) -> str:
        host, port = self._server.server_address
        return f"http://{host}:{port}/v1"

    def start(self) -> None:
        self._thread.start()

    def close(self) -> None:
        self._server.shutdown()
        self._server.server_close()
        self._thread.join(timeout=5)

    def _next_response(self) -> str:
        if self.responses:
            return self.responses.pop(0)
        return "DONE"

    def _handler_class(self) -> type[BaseHTTPRequestHandler]:
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self) -> None:  # noqa: N802 - http.server API
                length = int(self.headers.get("content-length", "0"))
                raw_body = self.rfile.read(length).decode("utf-8")
                try:
                    outer.requests.append(json.loads(raw_body))
                except json.JSONDecodeError:
                    outer.requests.append({"_raw": raw_body})

                body = outer._next_response()
                self.send_response(200)
                self.send_header("content-type", "text/event-stream")
                self.send_header("cache-control", "no-cache")
                self.send_header("connection", "close")
                self.end_headers()

                time.sleep(outer.first_token_delay)
                self._write_chunk({"choices": [{"index": 0, "delta": {"content": body}, "finish_reason": None}]})
                self._write_chunk({"choices": [], "usage": {"prompt_tokens": 100, "completion_tokens": 4}})
                self._write_chunk({"choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]})
                self.wfile.write(b"data: [DONE]\n\n")
                self.wfile.flush()

            def log_message(self, _format: str, *_args: object) -> None:
                return

            def _write_chunk(self, payload: dict) -> None:
                self.wfile.write(f"data: {json.dumps(payload)}\n\n".encode("utf-8"))
                self.wfile.flush()

        return Handler


class TmuxHarness:
    def __init__(self, session: str, project_dir: Path, config_dir: Path, cli_entry: Path) -> None:
        self.session = session
        self.project_dir = project_dir
        self.config_dir = config_dir
        self.cli_entry = cli_entry

    def tmux(self, *args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
        result = subprocess.run(
            ["tmux", *args],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if check and result.returncode != 0:
            raise RuntimeError(f"tmux {' '.join(args)} failed: {result.stderr.strip()}")
        return result

    def start(self) -> None:
        self.tmux("kill-session", "-t", self.session, check=False)
        self.tmux(
            "new-session",
            "-d",
            "-s",
            self.session,
            "-x",
            str(COLS),
            "-y",
            str(ROWS),
            "-c",
            str(self.project_dir),
        )
        command = " ".join(
            [
                f"XIAOK_CONFIG_DIR={shlex.quote(str(self.config_dir))}",
                shlex.quote(shutil.which("node") or "node"),
                shlex.quote(str(self.cli_entry)),
                "--auto",
                "2>/dev/null",
            ],
        )
        self.tmux("send-keys", "-t", self.session, command, "Enter")

    def stop(self) -> None:
        self.tmux("kill-session", "-t", self.session, check=False)

    def capture(self, ansi: bool = False) -> str:
        flag = "-ep" if ansi else "-p"
        return self.tmux("capture-pane", flag, "-t", self.session).stdout

    def send_text(self, text: str) -> None:
        self.tmux("send-keys", "-l", "-t", self.session, text)

    def send_key(self, key: str) -> None:
        self.tmux("send-keys", "-t", self.session, key)

    def wait_for(self, predicate: Callable[[str], bool], timeout: float = 10.0, interval: float = 0.2) -> str:
        deadline = time.time() + timeout
        last = ""
        while time.time() < deadline:
            last = self.capture()
            if predicate(last):
                return last
            time.sleep(interval)
        return last


def strip_ansi(text: str) -> str:
    return re.sub(r"\x1b\[[0-9;?]*[ -/]*[@-~]", "", text)


def visible_lines(content: str) -> list[str]:
    return [strip_ansi(line).rstrip() for line in content.splitlines()]


def write_config(config_dir: Path, base_url: str) -> None:
    config_dir.mkdir(parents=True, exist_ok=True)
    config = {
        "schemaVersion": 1,
        "defaultModel": "custom",
        "models": {
            "custom": {
                "baseUrl": base_url,
                "apiKey": "test-key",
                "model": "gpt-terminal-e2e",
            },
        },
        "defaultMode": "interactive",
        "contextBudget": 4000,
        "channels": {},
    }
    (config_dir / "config.json").write_text(json.dumps(config, indent=2), encoding="utf-8")


def assert_true(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def assert_contains(content: str, needle: str, message: str) -> None:
    if needle not in content:
        raise AssertionError(f"{message}\nMissing: {needle}\nLast capture:\n{content}")


def activity_line_count(content: str) -> int:
    count = 0
    for line in visible_lines(content):
        if any(label in line for label in SPINNER_LABELS):
            count += 1
    return count


def footer_has_empty_prompt(content: str) -> bool:
    for line in visible_lines(content)[-4:]:
        if line.strip() == "❯":
            return True
    return False


def assert_activity_above_prompt_with_gap(content: str) -> None:
    lines = visible_lines(content)
    prompt_index = next((i for i, line in enumerate(lines) if line.strip().startswith("❯")), -1)
    assert_true(prompt_index >= 2, f"input prompt was not visible near the footer:\n{content}")
    activity_line = lines[prompt_index - 2]
    gap_line = lines[prompt_index - 1]
    assert_true(
        any(label in activity_line for label in SPINNER_LABELS),
        f"activity was not rendered above the input prompt:\n{content}",
    )
    assert_true(gap_line.strip() == "", f"expected a blank gap between activity and input prompt:\n{content}")
    assert_true(
        not any(label in lines[prompt_index] for label in SPINNER_LABELS),
        f"activity leaked into the input prompt row:\n{content}",
    )
    for status_fragment in ("gpt-terminal-e2e", "auto", "project"):
        assert_true(
            status_fragment not in activity_line,
            f"activity line should not include footer status text:\n{content}",
        )


def run_terminal_e2e(project_dir: Path, keep_session: bool = False) -> None:
    cli_entry = project_dir / "dist" / "index.js"
    assert_true(cli_entry.exists(), f"CLI entry not found: {cli_entry}")

    work_root = Path(tempfile.mkdtemp(prefix="xiaok-terminal-e2e-"))
    project_fixture = work_root / "project"
    config_dir = work_root / "config"
    project_fixture.mkdir(parents=True)

    first_response = "E2E_RESPONSE_ONE"
    second_response = "E2E_RESPONSE_TWO"
    server = FakeOpenAIServer([first_response, second_response], first_token_delay=1.5)
    server.start()
    write_config(config_dir, server.base_url)

    session = f"xiaok-e2e-{os.getpid()}"
    tmux = TmuxHarness(session, project_fixture, config_dir, cli_entry)

    try:
        tmux.start()

        print("--- E2E 1: welcome and fixed footer ---")
        welcome = tmux.wait_for(lambda text: "欢迎使用 xiaok code" in text and "❯" in text, timeout=12)
        assert_contains(welcome, "欢迎使用 xiaok code", "welcome screen did not render")
        assert_contains(welcome, "❯", "input footer prompt did not render")
        bottom = "\n".join(visible_lines(welcome)[-4:])
        assert_true("❯" in bottom, f"input prompt is not near bottom footer:\n{bottom}")
        assert_true("gpt-terminal-e2e" in welcome, "status line did not include configured model")
        print("PASS: welcome screen and footer are visible")

        print("--- E2E 2: multiline input stays inside footer ---")
        tmux.send_text("1")
        tmux.send_key("C-j")
        tmux.send_text("2")
        tmux.send_key("C-j")
        tmux.send_text("3")
        tmux.send_key("C-j")
        tmux.send_text("4")
        time.sleep(0.5)
        multiline = tmux.capture()
        lines = visible_lines(multiline)
        prompt_lines = [line for line in lines if "❯" in line]
        body_input_lines = [line.strip() for line in lines if line.strip() in {"2", "3", "4"}]
        status_lines = [line for line in visible_lines(multiline) if "gpt-terminal-e2e" in line]
        assert_true(len(prompt_lines) == 1, f"expected one prompt line, got {len(prompt_lines)}:\n{multiline}")
        assert_true("1" in prompt_lines[0], f"first multiline input row was not visible in footer:\n{multiline}")
        assert_true(body_input_lines == ["2", "3", "4"], f"multiline input rows were not visible in footer:\n{multiline}")
        assert_true(len(status_lines) == 1, f"expected one status line, got {len(status_lines)}:\n{multiline}")
        print("PASS: multiline input does not duplicate prompt or status")

        tmux.stop()
        tmux.start()
        welcome = tmux.wait_for(lambda text: "欢迎使用 xiaok code" in text and "❯" in text, timeout=12)
        assert_contains(welcome, "欢迎使用 xiaok code", "welcome screen did not render after multiline restart")

        print("--- E2E 3: slash input and overlay ---")
        tmux.send_text("/hel")
        time.sleep(0.5)
        slash = tmux.capture()
        assert_contains(slash, "/hel", "typed slash input was not visible")
        assert_contains(slash, "/help", "slash menu overlay was not visible")
        print("PASS: typed input and slash overlay are visible")

        tmux.stop()
        tmux.start()
        welcome = tmux.wait_for(lambda text: "欢迎使用 xiaok code" in text and "❯" in text, timeout=12)
        assert_contains(welcome, "欢迎使用 xiaok code", "welcome screen did not render after session restart")

        print("--- E2E 4: streamed answer preserves output and footer ---")
        tmux.send_text("first terminal request")
        time.sleep(0.15)
        tmux.send_key("Enter")
        time.sleep(0.75)
        first_pending = tmux.capture()
        first_pending_lines = visible_lines(first_pending)
        welcome_index = next((i for i, line in enumerate(first_pending_lines) if "欢迎使用 xiaok code" in line), -1)
        submitted_index = next((i for i, line in enumerate(first_pending_lines) if "first terminal request" in line), -1)
        assert_true(welcome_index >= 0, f"welcome card disappeared before the first response:\n{first_pending}")
        assert_true(submitted_index > welcome_index, f"first submitted input did not render below the welcome card:\n{first_pending}")
        assert_activity_above_prompt_with_gap(first_pending)
        first = tmux.wait_for(
            lambda text: first_response in text and len(server.requests) >= 1 and footer_has_empty_prompt(text),
            timeout=20,
        )
        assert_contains(first, "first terminal request", "submitted user input disappeared")
        assert_contains(first, first_response, "assistant response did not render")
        assert_true(activity_line_count(first) <= 2, f"too many activity lines after first response:\n{first}")
        assert_true("❯" in "\n".join(visible_lines(first)[-4:]), "footer prompt missing after first response")
        print("PASS: first streamed response and footer are stable")

        print("--- E2E 5: second turn does not eat previous output ---")
        time.sleep(0.2)
        tmux.send_text("second terminal request")
        time.sleep(0.15)
        tmux.send_key("Enter")
        second = tmux.wait_for(
            lambda text: (
                first_response in text
                and second_response in text
                and len(server.requests) >= 2
                and footer_has_empty_prompt(text)
            ),
            timeout=20,
        )
        assert_contains(second, first_response, "first response was overwritten by second turn")
        assert_contains(second, second_response, "second assistant response did not render")
        assert_true(activity_line_count(second) <= 2, f"too many activity lines after second response:\n{second}")
        print("PASS: multi-turn output remains visible without activity duplication")

        print("--- E2E Summary ---")
        print(f"Requests observed by fake OpenAI server: {len(server.requests)}")
        assert_true(len(server.requests) >= 2, "expected at least two model requests")
        print("PASS: terminal e2e completed")
    finally:
        if keep_session:
            print(f"Keeping tmux session for inspection: {session}")
        else:
            tmux.stop()
        server.close()
        if not keep_session:
            shutil.rmtree(work_root, ignore_errors=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="Run xiaok interactive terminal e2e in tmux")
    parser.add_argument(
        "--project-dir",
        default=os.environ.get("XIAOK_PROJECT_DIR", os.getcwd()),
        help="xiaok project directory containing dist/index.js",
    )
    parser.add_argument("--keep-session", action="store_true", help="leave tmux session running after failure")
    args = parser.parse_args()

    project_dir = Path(args.project_dir).resolve()
    print("=" * 72)
    print("Terminal E2E: tmux interactive chat")
    print(f"Project: {project_dir}")
    print("=" * 72)

    result = subprocess.run(["npm", "run", "build"], cwd=project_dir, text=True, timeout=60)
    if result.returncode != 0:
        return result.returncode

    run_terminal_e2e(project_dir, keep_session=args.keep_session)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
