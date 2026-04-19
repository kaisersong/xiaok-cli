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
ResponseScript = str | list[dict]


def resolve_command(primary: str, fallback: str) -> str:
    resolved = shutil.which(primary) or shutil.which(fallback)
    return resolved or fallback


def resolve_tmux_binary() -> str:
    env_override = os.environ.get("TMUX_BINARY")
    if env_override:
        return env_override

    resolved = shutil.which("tmux.exe" if os.name == "nt" else "tmux") or shutil.which("tmux")
    if resolved:
        return resolved

    if os.name == "nt":
        local_appdata = os.environ.get("LOCALAPPDATA", "")
        candidate_roots = [
            Path(local_appdata) / "Microsoft" / "WinGet" / "Links",
            Path(local_appdata) / "Microsoft" / "WinGet" / "Packages",
            Path(r"C:\Program Files\Git\usr\bin"),
            Path(r"C:\Program Files\Git\bin"),
            Path(r"C:\msys64\usr\bin"),
        ]
        for root in candidate_roots:
            if not root.exists():
                continue
            direct = root / "tmux.exe"
            if direct.exists():
                return str(direct)
            if root.name == "Packages":
                matches = list(root.glob("arndawg.tmux-windows*\\tmux.exe"))
                if matches:
                    return str(matches[0])

    raise FileNotFoundError(
        "tmux binary not found. Install tmux and add it to PATH, or set TMUX_BINARY "
        "to the full tmux executable path before running tests/e2e/tmux-e2e.py."
    )


def shell_quote_posix(value: str) -> str:
    return shlex.quote(value)


def shell_quote_cmd(value: str) -> str:
    escaped = value.replace("^", "^^").replace("&", "^&").replace("|", "^|")
    return escaped.replace("<", "^<").replace(">", "^>").replace('"', '""')


def build_cli_launch_command(
    project_dir: Path,
    config_dir: Path,
    cli_entry: Path,
    home_dir: Path,
    auto_mode: bool = True,
) -> str:
    node_cmd = resolve_command("node.exe" if os.name == "nt" else "node", "node")
    auto_flag = " --auto" if auto_mode else ""
    if os.name == "nt":
        project_value = str(project_dir).replace('"', '""')
        config_value = shell_quote_cmd(str(config_dir))
        home_value = shell_quote_cmd(str(home_dir))
        node_value = str(node_cmd).replace('"', '""')
        cli_value = str(cli_entry).replace('"', '""')
        return (
            'cmd /v:on /c "'
            f'cd /d "{project_value}" && '
            f'set "XIAOK_CONFIG_DIR={config_value}" && '
            f'set "HOME={home_value}" && '
            f'set "USERPROFILE={home_value}" && '
            f'"{node_value}" "{cli_value}"{auto_flag} 2>nul'
            '"'
        )

    return " ".join(
        [
            f"cd {shell_quote_posix(str(project_dir))} &&",
            f"XIAOK_CONFIG_DIR={shell_quote_posix(str(config_dir))}",
            f"HOME={shell_quote_posix(str(home_dir))}",
            shell_quote_posix(node_cmd),
            shell_quote_posix(str(cli_entry)),
            *(["--auto"] if auto_mode else []),
            "2>/dev/null",
        ],
    )


def text_response_events(body: str) -> list[dict]:
    return [
        {"choices": [{"index": 0, "delta": {"content": body}, "finish_reason": None}]},
        {"choices": [], "usage": {"prompt_tokens": 100, "completion_tokens": 4}},
        {"choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]},
    ]


def tool_call_response_events(name: str, arguments: dict, call_id: str) -> list[dict]:
    return [
        {
            "choices": [
                {
                    "delta": {
                        "tool_calls": [
                            {
                                "index": 0,
                                "id": call_id,
                                "function": {
                                    "name": name,
                                    "arguments": "",
                                },
                            },
                        ],
                    },
                    "finish_reason": None,
                },
            ],
        },
        {
            "choices": [
                {
                    "delta": {
                        "tool_calls": [
                            {
                                "index": 0,
                                "function": {
                                    "arguments": json.dumps(arguments),
                                },
                            },
                        ],
                    },
                    "finish_reason": None,
                },
            ],
        },
        {"choices": [{"index": 0, "delta": {}, "finish_reason": "tool_calls"}]},
    ]


class FakeOpenAIServer:
    def __init__(self, responses: list[ResponseScript], first_token_delay: float = 0.9) -> None:
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

    def _next_response(self) -> ResponseScript:
        if self.responses:
            return self.responses.pop(0)
        return text_response_events("DONE")

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

                script = outer._next_response()
                self.send_response(200)
                self.send_header("content-type", "text/event-stream")
                self.send_header("cache-control", "no-cache")
                self.send_header("connection", "close")
                self.end_headers()

                time.sleep(outer.first_token_delay)
                events = text_response_events(script) if isinstance(script, str) else script
                for event in events:
                    self._write_chunk(event)
                self.wfile.write(b"data: [DONE]\n\n")
                self.wfile.flush()

            def log_message(self, _format: str, *_args: object) -> None:
                return

            def _write_chunk(self, payload: dict) -> None:
                self.wfile.write(f"data: {json.dumps(payload)}\n\n".encode("utf-8"))
                self.wfile.flush()

        return Handler


class TmuxHarness:
    def __init__(
        self,
        session: str,
        project_dir: Path,
        config_dir: Path,
        home_dir: Path,
        cli_entry: Path,
        tmux_bin: str,
        auto_mode: bool = True,
    ) -> None:
        self.session = session
        self.project_dir = project_dir
        self.config_dir = config_dir
        self.home_dir = home_dir
        self.cli_entry = cli_entry
        self.tmux_bin = tmux_bin
        self.auto_mode = auto_mode

    def tmux(self, *args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
        result = subprocess.run(
            [self.tmux_bin, *args],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=10,
        )
        if check and result.returncode != 0:
            raise RuntimeError(f"tmux {' '.join(args)} failed: {result.stderr.strip()}")
        return result

    def start(self) -> None:
        self.tmux("kill-session", "-t", self.session, check=False)
        args = [
            "new-session",
            "-d",
            "-s",
            self.session,
            "-x",
            str(COLS),
            "-y",
            str(ROWS),
        ]
        if os.name == "nt":
            args.append(os.environ.get("COMSPEC") or "cmd.exe")
        else:
            args.extend(["-c", str(self.project_dir)])
        self.tmux(
            *args,
        )
        command = build_cli_launch_command(
            self.project_dir,
            self.config_dir,
            self.cli_entry,
            self.home_dir,
            auto_mode=self.auto_mode,
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


def count_occurrences(content: str, needle: str) -> int:
    return sum(1 for line in visible_lines(content) if needle in line)


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
    tmux_bin = resolve_tmux_binary()

    work_root = Path(tempfile.mkdtemp(prefix="xiaok-terminal-e2e-"))
    project_fixture = work_root / "project"
    sandbox_fixture = work_root / "outside-workdir"
    config_dir = work_root / "config"
    home_dir = work_root / "home"
    project_fixture.mkdir(parents=True)
    sandbox_fixture.mkdir(parents=True)
    home_dir.mkdir(parents=True)
    (sandbox_fixture / "marker.txt").write_text("sandbox fixture\n", encoding="utf-8")

    first_response = "E2E_RESPONSE_ONE"
    second_response = "E2E_RESPONSE_TWO"
    permission_response_one = "E2E_PERMISSION_RESPONSE_ONE"
    permission_response_two = "E2E_PERMISSION_RESPONSE_TWO"
    permission_command = "cmd /c echo E2E_PERMISSION_OK"
    sandbox_response_one = "E2E_SANDBOX_RESPONSE_ONE"
    sandbox_response_two = "E2E_SANDBOX_RESPONSE_TWO"
    sandbox_command = "cmd /c echo E2E_SANDBOX_OK"
    server = FakeOpenAIServer([
        text_response_events(first_response),
        text_response_events(second_response),
        tool_call_response_events("bash", {"command": permission_command}, "call_permission_1"),
        text_response_events(permission_response_one),
        tool_call_response_events("bash", {"command": permission_command}, "call_permission_2"),
        text_response_events(permission_response_two),
        tool_call_response_events("bash", {
            "command": sandbox_command,
            "workdir": str(sandbox_fixture),
        }, "call_sandbox_1"),
        text_response_events(sandbox_response_one),
        tool_call_response_events("bash", {
            "command": sandbox_command,
            "workdir": str(sandbox_fixture),
        }, "call_sandbox_2"),
        text_response_events(sandbox_response_two),
    ], first_token_delay=1.5)
    server.start()
    write_config(config_dir, server.base_url)

    session = f"xiaok-e2e-{os.getpid()}"
    tmux = TmuxHarness(session, project_fixture, config_dir, home_dir, cli_entry, tmux_bin)

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

        print("--- E2E 3: long single-line input soft-wraps instead of horizontally scrolling ---")
        long_input = f"WRAP_START_{'x' * 125}_WRAP_MIDDLE_{'y' * 35}_WRAP_END"
        tmux.send_text(long_input)
        time.sleep(0.5)
        wrapped = tmux.capture()
        wrapped_lines = visible_lines(wrapped)
        wrapped_prompt_lines = [line for line in wrapped_lines if "❯" in line]
        wrapped_status_lines = [line for line in wrapped_lines if "gpt-terminal-e2e" in line]
        assert_true(len(wrapped_prompt_lines) == 1, f"expected one wrapped prompt row:\n{wrapped}")
        assert_true("WRAP_START_" in wrapped, f"long single-line input start was not visible:\n{wrapped}")
        assert_true("_WRAP_MIDDLE_" in wrapped, f"long single-line input did not wrap into additional footer rows:\n{wrapped}")
        assert_true(len(wrapped_status_lines) == 1, f"expected one wrapped status line:\n{wrapped}")
        print("PASS: long single-line input wraps inside the footer")

        tmux.stop()
        tmux.start()
        welcome = tmux.wait_for(lambda text: "欢迎使用 xiaok code" in text and "❯" in text, timeout=12)
        assert_contains(welcome, "欢迎使用 xiaok code", "welcome screen did not render after wrap restart")

        print("--- E2E 4: slash input and overlay ---")
        tmux.send_text("/hel")
        time.sleep(0.5)
        slash = tmux.capture()
        assert_contains(slash, "/hel", "typed slash input was not visible")
        assert_contains(slash, "/help", "slash menu overlay was not visible")
        print("PASS: typed input and slash overlay are visible")

        print("--- E2E 5: built-in slash command renders visible output ---")
        tmux.send_key("Enter")
        help_output = tmux.wait_for(
            lambda text: "/skills-reload" in text and "/help    - 显示帮助" in text and "可用 skills：" in text,
            timeout=12,
        )
        assert_contains(help_output, "/skills-reload", "built-in /help output was not visible")
        assert_contains(help_output, "/help    - 显示帮助", "built-in /help output did not list /help")
        assert_contains(help_output, "可用 skills：", "built-in /help output did not include skills section")
        print("PASS: built-in slash command output is visible")

        tmux.stop()
        tmux.start()
        welcome = tmux.wait_for(lambda text: "欢迎使用 xiaok code" in text and "❯" in text, timeout=12)
        assert_contains(welcome, "欢迎使用 xiaok code", "welcome screen did not render after session restart")

        print("--- E2E 6: streamed answer preserves output and footer ---")
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

        print("--- E2E 7: second turn does not eat previous output ---")
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

        tmux.auto_mode = False
        tmux.stop()
        tmux.start()
        welcome = tmux.wait_for(lambda text: "欢迎使用 xiaok code" in text and "❯" in text, timeout=12)
        assert_contains(welcome, "欢迎使用 xiaok code", "welcome screen did not render before permission flow")

        print("--- E2E 8: permission menu remains intact and project allow persists ---")
        tmux.send_text("trigger permission prompt")
        time.sleep(0.15)
        tmux.send_key("Enter")
        permission_prompt = tmux.wait_for(
            lambda text: "xiaok 想要执行以下操作" in text and "bash" in text and permission_command in text,
            timeout=12,
        )
        assert_contains(permission_prompt, "xiaok 想要执行以下操作", "permission title did not render")
        assert_contains(permission_prompt, "bash", "permission tool name did not render")
        assert_contains(permission_prompt, permission_command, "permission command summary did not render")
        assert_true(count_occurrences(permission_prompt, "xiaok 想要执行以下操作") == 1, f"permission prompt duplicated:\n{permission_prompt}")
        assert_true("❯ 允许一次" in permission_prompt, f"default permission selection was not visible:\n{permission_prompt}")

        tmux.send_key("Down")
        tmux.send_key("Down")
        time.sleep(0.2)
        project_selected = tmux.capture()
        assert_true(
            "❯ 始终允许 bash(cmd *) (保存到项目)" in project_selected,
            f"permission selection did not move to project allow:\n{project_selected}",
        )
        tmux.send_key("Enter")

        first_permission_result = tmux.wait_for(
            lambda text: permission_response_one in text and "xiaok 想要执行以下操作" not in text,
            timeout=20,
        )
        assert_contains(first_permission_result, permission_response_one, "permission flow response did not render")
        assert_true("xiaok 想要执行以下操作" not in first_permission_result, f"permission prompt text leaked after approval:\n{first_permission_result}")

        settings_path = project_fixture / ".xiaok" / "settings.json"
        assert_true(settings_path.exists(), f"project settings file was not written: {settings_path}")
        settings_raw = settings_path.read_text(encoding="utf-8")
        assert_true("bash(cmd *)" in settings_raw, f"project permission rule was not persisted:\n{settings_raw}")

        tmux.stop()
        tmux.start()
        welcome = tmux.wait_for(lambda text: "欢迎使用 xiaok code" in text and "❯" in text, timeout=12)
        assert_contains(welcome, "欢迎使用 xiaok code", "welcome screen did not render before persisted permission replay")

        tmux.send_text("trigger permission prompt again")
        time.sleep(0.15)
        tmux.send_key("Enter")
        time.sleep(1.8)
        no_reprompt = tmux.capture()
        assert_true("xiaok 想要执行以下操作" not in no_reprompt, f"persisted project permission still prompted:\n{no_reprompt}")

        second_permission_result = tmux.wait_for(
            lambda text: permission_response_two in text and len(server.requests) >= 6,
            timeout=20,
        )
        assert_contains(second_permission_result, permission_response_two, "persisted permission response did not render")
        assert_true("xiaok 想要执行以下操作" not in second_permission_result, f"permission prompt reappeared after persisted allow:\n{second_permission_result}")
        print("PASS: permission prompt is stable and project allow persists across restart")

        tmux.stop()
        tmux.start()
        welcome = tmux.wait_for(lambda text: "欢迎使用 xiaok code" in text and "❯" in text, timeout=12)
        assert_contains(welcome, "欢迎使用 xiaok code", "welcome screen did not render before sandbox permission flow")

        print("--- E2E 9: sandbox expansion prompt persists project approval across restart ---")
        tmux.send_text("trigger sandbox permission prompt")
        time.sleep(0.15)
        tmux.send_key("Enter")
        sandbox_prompt = tmux.wait_for(
            lambda text: "xiaok 想要执行以下操作" in text and "sandbox-expand:bash" in text and str(sandbox_fixture) in text,
            timeout=12,
        )
        assert_contains(sandbox_prompt, "sandbox-expand:bash", "sandbox prompt tool name did not render")
        assert_contains(sandbox_prompt, str(sandbox_fixture), "sandbox prompt target path did not render")

        tmux.send_key("Down")
        tmux.send_key("Down")
        time.sleep(0.2)
        sandbox_project_selected = tmux.capture()
        assert_true(
            "保存到项目" in sandbox_project_selected and "❯ 始终允许 sandbox-expand:bash(" in sandbox_project_selected,
            f"sandbox prompt selection did not move to project allow:\n{sandbox_project_selected}",
        )
        tmux.send_key("Enter")

        first_sandbox_result = tmux.wait_for(
            lambda text: sandbox_response_one in text and "xiaok 想要执行以下操作" not in text,
            timeout=20,
        )
        assert_contains(first_sandbox_result, sandbox_response_one, "sandbox approval response did not render")

        sandbox_settings_raw = settings_path.read_text(encoding="utf-8")
        assert_true(
            "sandbox-expand:bash(" in sandbox_settings_raw,
            f"sandbox expansion rule was not persisted to project settings:\n{sandbox_settings_raw}",
        )

        tmux.stop()
        tmux.start()
        welcome = tmux.wait_for(lambda text: "欢迎使用 xiaok code" in text and "❯" in text, timeout=12)
        assert_contains(welcome, "欢迎使用 xiaok code", "welcome screen did not render before persisted sandbox replay")

        tmux.send_text("trigger sandbox permission prompt again")
        time.sleep(0.15)
        tmux.send_key("Enter")
        time.sleep(1.8)
        sandbox_no_reprompt = tmux.capture()
        assert_true("sandbox-expand:bash" not in sandbox_no_reprompt, f"persisted sandbox approval still prompted:\n{sandbox_no_reprompt}")

        second_sandbox_result = tmux.wait_for(
            lambda text: sandbox_response_two in text and len(server.requests) >= 10,
            timeout=20,
        )
        assert_contains(second_sandbox_result, sandbox_response_two, "persisted sandbox approval response did not render")
        assert_true("sandbox-expand:bash" not in second_sandbox_result, f"sandbox prompt reappeared after persisted project allow:\n{second_sandbox_result}")
        print("PASS: sandbox expansion approval persists across restart")

        print("--- E2E Summary ---")
        print(f"Requests observed by fake OpenAI server: {len(server.requests)}")
        assert_true(len(server.requests) >= 10, "expected at least ten model requests")
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

    npm_cmd = resolve_command("npm.cmd" if os.name == "nt" else "npm", "npm")
    result = subprocess.run(
        [npm_cmd, "run", "build"],
        cwd=project_dir,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=60,
    )
    if result.returncode != 0:
        return result.returncode

    run_terminal_e2e(project_dir, keep_session=args.keep_session)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
