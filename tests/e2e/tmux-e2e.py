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
SPINNER_LABELS = (
    "Thinking",
    "Answering",
    "Working",
    "Still working",
    "Working through details",
    "Finalizing response",
    "Exploring codebase",
    "Digging through repo",
    "Tracing references",
    "Updating files",
    "Applying changes",
    "Finishing edits",
    "Running command",
    "Executing command",
    "Waiting for command output",
)
SPINNER_FRAMES = ("⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏")
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
    extra_args: list[str] | None = None,
    env_overrides: dict[str, str] | None = None,
) -> str:
    node_cmd = resolve_command("node.exe" if os.name == "nt" else "node", "node")
    auto_flag = " --auto" if auto_mode else ""
    extra_args = extra_args or []
    env_overrides = env_overrides or {}
    if os.name == "nt":
        project_value = str(project_dir).replace('"', '""')
        config_value = shell_quote_cmd(str(config_dir))
        home_value = shell_quote_cmd(str(home_dir))
        node_value = str(node_cmd).replace('"', '""')
        cli_value = str(cli_entry).replace('"', '""')
        extra_args_value = f" {subprocess.list2cmdline(extra_args)}" if extra_args else ""
        extra_env = " ".join(
            f'&& set "{key}={shell_quote_cmd(value)}"'
            for key, value in env_overrides.items()
        )
        return (
            'cmd /v:on /c "'
            f'cd /d "{project_value}" && '
            f'set "XIAOK_CONFIG_DIR={config_value}" && '
            f'set "HOME={home_value}" && '
            f'set "USERPROFILE={home_value}" {extra_env} && '
            f'"{node_value}" "{cli_value}"{auto_flag}{extra_args_value} 2>nul'
            '"'
        )

    env_parts = [
        f"XIAOK_CONFIG_DIR={shell_quote_posix(str(config_dir))}",
        f"HOME={shell_quote_posix(str(home_dir))}",
        *[
            f"{key}={shell_quote_posix(value)}"
            for key, value in env_overrides.items()
        ],
    ]
    return " ".join(
        [
            f"cd {shell_quote_posix(str(project_dir))} &&",
            *env_parts,
            shell_quote_posix(node_cmd),
            shell_quote_posix(str(cli_entry)),
            *(["--auto"] if auto_mode else []),
            *[shell_quote_posix(arg) for arg in extra_args],
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


def text_then_tool_call_events(prefix: str, name: str, arguments: dict, call_id: str) -> list[dict]:
    return [
        {"choices": [{"index": 0, "delta": {"content": prefix}, "finish_reason": None}]},
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
        extra_args: list[str] | None = None,
        env_overrides: dict[str, str] | None = None,
    ) -> None:
        self.session = session
        self.project_dir = project_dir
        self.config_dir = config_dir
        self.home_dir = home_dir
        self.cli_entry = cli_entry
        self.tmux_bin = tmux_bin
        self.auto_mode = auto_mode
        self.extra_args = extra_args or []
        self.env_overrides = env_overrides or {}

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

    def start(self, cols: int = COLS, rows: int = ROWS) -> None:
        self.tmux("kill-session", "-t", self.session, check=False)
        command = build_cli_launch_command(
            self.project_dir,
            self.config_dir,
            self.cli_entry,
            self.home_dir,
            auto_mode=self.auto_mode,
            extra_args=self.extra_args,
            env_overrides=self.env_overrides,
        )
        args = [
            "new-session",
            "-d",
            "-s",
            self.session,
            "-x",
            str(cols),
            "-y",
            str(rows),
        ]
        if os.name == "nt":
            args.append(os.environ.get("COMSPEC") or "cmd.exe")
            self.tmux(
                *args,
            )
            self.tmux("set-option", "-t", self.session, "remain-on-exit", "on", check=False)
            self.tmux("send-keys", "-t", self.session, command, "Enter")
        else:
            # Start the CLI as the pane command instead of typing a long shell
            # command into a login shell. The previous send-keys launch could
            # leave the command sitting at the prompt, making the E2E harness
            # report a UI failure without actually starting xiaok.
            args.extend(["-c", str(self.project_dir), command])
            self.tmux(
                *args,
            )
            self.tmux("set-option", "-t", self.session, "remain-on-exit", "on", check=False)

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

    def wait_for_checked(
        self,
        predicate: Callable[[str], bool],
        invariant: Callable[[str], None],
        timeout: float = 10.0,
        interval: float = 0.05,
    ) -> str:
        deadline = time.time() + timeout
        last = ""
        while time.time() < deadline:
            last = self.capture()
            invariant(last)
            if predicate(last):
                return last
            time.sleep(interval)
        raise AssertionError(f"timed out waiting for checked terminal state:\n{last}")


def strip_ansi(text: str) -> str:
    return re.sub(r"\x1b\[[0-9;?]*[ -/]*[@-~]", "", text)


def visible_lines(content: str) -> list[str]:
    return [strip_ansi(line).rstrip() for line in content.splitlines()]


def latest_intent_summary_line(content: str) -> str:
    rows = visible_lines(content)
    intent_index = -1
    for index, line in enumerate(rows):
        if "Intent:" in line:
            intent_index = index
    if intent_index < 0:
        return ""

    fragments = [rows[intent_index].strip()]
    for line in rows[intent_index + 1:]:
        stripped = line.strip()
        if not stripped:
            break
        if is_input_prompt_line(line) or "· auto ·" in line:
            break
        fragments.append(stripped)
    return "".join(fragments)


def write_config(config_dir: Path, base_url: str, model_name: str = "gpt-terminal-e2e") -> None:
    config_dir.mkdir(parents=True, exist_ok=True)
    config = {
        "schemaVersion": 1,
        "defaultModel": "custom",
        "models": {
            "custom": {
                "baseUrl": base_url,
                "apiKey": "test-key",
                "model": model_name,
            },
        },
        "defaultMode": "interactive",
        "contextBudget": 4000,
        "channels": {},
    }
    (config_dir / "config.json").write_text(json.dumps(config, indent=2), encoding="utf-8")


def write_feedback_resume_session(config_dir: Path, project_dir: Path, session_id: str) -> None:
    sessions_dir = config_dir / "sessions"
    sessions_dir.mkdir(parents=True, exist_ok=True)
    now = int(time.time() * 1000) - 20_000
    intent_id = "intent_feedback_footer_gap"
    stage_id = f"{intent_id}:stage:1"
    step_id = f"{stage_id}:step:compose"

    session_doc = {
        "schemaVersion": 1,
        "sessionId": session_id,
        "cwd": str(project_dir),
        "createdAt": now - 5_000,
        "updatedAt": now,
        "lineage": [session_id],
        "messages": [],
        "usage": {
            "inputTokens": 0,
            "outputTokens": 0,
        },
        "compactions": [],
        "memoryRefs": [],
        "approvalRefs": [],
        "backgroundJobRefs": [],
        "intentDelegation": {
            "sessionId": session_id,
            "instanceId": "inst_feedback_footer_gap",
            "activeIntentId": intent_id,
            "breadcrumbs": [],
            "receipt": None,
            "salvage": None,
            "ownership": {
                "state": "released",
                "updatedAt": now,
            },
            "intents": [
                {
                    "intentId": intent_id,
                    "instanceId": "inst_feedback_footer_gap",
                    "sessionId": session_id,
                    "rawIntent": "根据文档生成报告",
                    "normalizedIntent": "根据文档生成报告",
                    "providedSourcePaths": [],
                    "intentType": "generate",
                    "deliverable": "报告",
                    "finalDeliverable": "报告",
                    "explicitConstraints": [],
                    "delegationBoundary": [],
                    "riskTier": "medium",
                    "intentMode": "single_stage",
                    "segmentationConfidence": "high",
                    "templateId": "test-template",
                    "stages": [
                        {
                            "stageId": stage_id,
                            "order": 0,
                            "label": "生成报告",
                            "intentType": "generate",
                            "deliverable": "报告",
                            "templateId": "test-template",
                            "riskTier": "medium",
                            "dependsOnStageIds": [],
                            "steps": [
                                {
                                    "stepId": step_id,
                                    "key": "compose",
                                    "order": 0,
                                    "role": "compose",
                                    "skillName": "report-skill",
                                    "dependsOn": [],
                                    "status": "completed",
                                    "riskTier": "medium",
                                },
                            ],
                            "status": "completed",
                            "activeStepId": step_id,
                            "structuralValidation": "passed",
                            "semanticValidation": "passed",
                            "needsFreshContextHandoff": False,
                        },
                    ],
                    "activeStageId": stage_id,
                    "artifacts": [],
                    "steps": [
                        {
                            "stepId": step_id,
                            "key": "compose",
                            "order": 0,
                            "role": "compose",
                            "skillName": "report-skill",
                            "dependsOn": [],
                            "status": "completed",
                            "riskTier": "medium",
                        },
                    ],
                    "activeStepId": step_id,
                    "overallStatus": "completed",
                    "attemptCount": 1,
                    "latestReceipt": "Completed 报告",
                    "createdAt": now,
                    "updatedAt": now,
                },
            ],
            "latestPlan": {
                "intentId": intent_id,
                "instanceId": "inst_feedback_footer_gap",
                "sessionId": session_id,
                "rawIntent": "根据文档生成报告",
                "normalizedIntent": "根据文档生成报告",
                "providedSourcePaths": [],
                "intentType": "generate",
                "deliverable": "报告",
                "finalDeliverable": "报告",
                "explicitConstraints": [],
                "delegationBoundary": [],
                "riskTier": "medium",
                "intentMode": "single_stage",
                "segmentationConfidence": "high",
                "templateId": "test-template",
                "stages": [
                    {
                        "stageId": stage_id,
                        "order": 0,
                        "label": "生成报告",
                        "intentType": "generate",
                        "deliverable": "报告",
                        "templateId": "test-template",
                        "riskTier": "medium",
                        "dependsOnStageIds": [],
                        "steps": [
                            {
                                "stepId": step_id,
                                "key": "compose",
                                "order": 0,
                                "role": "compose",
                                "skillName": "report-skill",
                                "dependsOn": [],
                                "status": "completed",
                                "riskTier": "medium",
                            },
                        ],
                        "status": "completed",
                        "activeStepId": step_id,
                        "structuralValidation": "passed",
                        "semanticValidation": "passed",
                        "needsFreshContextHandoff": False,
                    },
                ],
                "activeStageId": stage_id,
                "artifacts": [],
                "steps": [
                    {
                        "stepId": step_id,
                        "key": "compose",
                        "order": 0,
                        "role": "compose",
                        "skillName": "report-skill",
                        "dependsOn": [],
                        "status": "completed",
                        "riskTier": "medium",
                    },
                ],
                "activeStepId": step_id,
                "overallStatus": "completed",
                "attemptCount": 1,
                "latestReceipt": "Completed 报告",
                "createdAt": now,
                "updatedAt": now,
            },
            "updatedAt": now,
        },
        "skillEval": {
            "observations": [
                {
                    "observationId": f"{step_id}:skill_eval",
                    "sessionId": session_id,
                    "intentId": intent_id,
                    "stageId": stage_id,
                    "stepId": step_id,
                    "intentType": "generate",
                    "stageRole": "compose",
                    "deliverable": "报告",
                    "deliverableFamily": "document",
                    "selectedSkillName": "report-skill",
                    "actualSkillName": "report-skill",
                    "status": "completed",
                    "artifactRecorded": True,
                    "structuralValidation": "passed",
                    "semanticValidation": "passed",
                    "createdAt": now,
                    "updatedAt": now,
                },
            ],
            "feedback": [],
            "promptedIntentIds": [],
            "updatedAt": now,
        },
    }
    (sessions_dir / f"{session_id}.json").write_text(json.dumps(session_doc, indent=2), encoding="utf-8")


def assert_true(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def assert_contains(content: str, needle: str, message: str) -> None:
    if needle not in content:
        raise AssertionError(f"{message}\nMissing: {needle}\nLast capture:\n{content}")


def activity_line_count(content: str) -> int:
    count = 0
    for line in visible_lines(content):
        if is_live_activity_line(line):
            count += 1
    return count


def is_live_activity_line(line: str) -> bool:
    stripped = line.strip()
    return (
        any(stripped.startswith(f"{frame} ") for frame in SPINNER_FRAMES)
        and any(label in stripped for label in SPINNER_LABELS)
    )


def footer_has_empty_prompt(content: str) -> bool:
    for line in visible_lines(content)[-4:]:
        if line.strip() in {"❯", ">"}:
            return True
    return False


def count_occurrences(content: str, needle: str) -> int:
    return sum(1 for line in visible_lines(content) if needle in line)


def count_bullet_lines(content: str, needle: str) -> int:
    return sum(1 for line in visible_lines(content) if line.strip() == f"● {needle}")


def is_input_prompt_line(line: str) -> bool:
    stripped = line.strip()
    return stripped.startswith("❯") or stripped.startswith(">")


def line_before_prompt_with_gap(content: str, min_blank_rows: int = 2) -> str:
    lines = visible_lines(content)
    prompt_index = next((i for i in range(len(lines) - 1, -1, -1) if is_input_prompt_line(lines[i])), -1)
    assert_true(prompt_index >= (min_blank_rows + 1), f"input prompt was not visible near the footer:\n{content}")

    blank_rows = 0
    cursor = prompt_index - 1
    while cursor >= 0 and lines[cursor].strip() == "":
        blank_rows += 1
        cursor -= 1

    assert_true(
        blank_rows >= min_blank_rows,
        f"expected at least {min_blank_rows} blank rows above the input prompt:\n{content}",
    )
    assert_true(cursor >= 0, f"no visible content remained above the input prompt:\n{content}")
    return lines[cursor]


def assert_activity_above_prompt_with_gap(content: str) -> None:
    lines = visible_lines(content)
    prompt_index = next((i for i in range(len(lines) - 1, -1, -1) if is_input_prompt_line(lines[i])), -1)
    assert_true(prompt_index >= 3, f"input prompt was not visible near the footer:\n{content}")
    activity_line = line_before_prompt_with_gap(content, min_blank_rows=2)
    assert_true(
        any(label in activity_line for label in SPINNER_LABELS),
        f"activity was not rendered above the input prompt:\n{content}",
    )
    assert_true(
        not any(label in lines[prompt_index] for label in SPINNER_LABELS),
        f"activity leaked into the input prompt row:\n{content}",
    )
    for status_fragment in ("gpt-terminal-e2e", "auto", "project"):
        assert_true(
            status_fragment not in activity_line,
            f"activity line should not include footer status text:\n{content}",
        )


def assert_overlay_above_prompt_with_gap(content: str, expected_anchor: str) -> None:
    overlay_tail = line_before_prompt_with_gap(content, min_blank_rows=2)
    assert_true(
        expected_anchor in overlay_tail,
        f"overlay did not stay at least two blank rows above the input prompt:\n{content}",
    )


def assert_overlay_block_before_prompt(
    content: str,
    required_fragments: tuple[str, ...],
    min_blank_rows: int = 2,
) -> None:
    lines = visible_lines(content)
    prompt_index = next((i for i in range(len(lines) - 1, -1, -1) if is_input_prompt_line(lines[i])), -1)
    assert_true(prompt_index >= (min_blank_rows + 1), f"input prompt was not visible near the footer:\n{content}")

    blank_rows = 0
    cursor = prompt_index - 1
    while cursor >= 0 and lines[cursor].strip() == "":
        blank_rows += 1
        cursor -= 1

    assert_true(
        blank_rows >= min_blank_rows,
        f"expected at least {min_blank_rows} blank rows above the input prompt:\n{content}",
    )
    overlay_block = lines[:cursor + 1]
    for fragment in required_fragments:
        assert_true(
            any(fragment in line for line in overlay_block),
            f"overlay block was missing {fragment!r}:\n{content}",
        )


def assert_single_footer_status(content: str, expected_status: str) -> None:
    lines = visible_lines(content)
    matches = [line for line in lines if expected_status in line]
    assert_true(
        len(matches) == 1,
        f"expected exactly one footer status line containing {expected_status!r}:\n{content}",
    )


def assert_intent_summary_hint(content: str, expected_fragment: str) -> None:
    lines = visible_lines(content)
    matches = [line for line in lines if expected_fragment in line]
    assert_true(matches, f"intent summary line was not visible:\n{content}")
    assert_true(
        any(re.match(r"^● Intent:", line) for line in matches),
        f"intent summary line did not use the bullet hint format:\n{content}",
    )


def assert_no_truncated_footer_status(content: str) -> None:
    lines = visible_lines(content)
    truncated = [line for line in lines if line.strip().startswith("pt-terminal-e2e")]
    assert_true(
        len(truncated) == 0,
        f"footer status line was truncated into the prompt row:\n{content}",
    )


def assert_footer_chrome_is_singular(
    content: str,
    expected_status: str = "gpt-terminal-e2e",
    allow_completed_summary: bool = False,
) -> None:
    lines = visible_lines(content)
    prompt_indices = [index for index, line in enumerate(lines) if is_input_prompt_line(line)]
    status_indices = [index for index, line in enumerate(lines) if expected_status in line]
    summary_indices = [index for index, line in enumerate(lines) if "Intent:" in line]
    prompt_rows = [lines[index] for index in prompt_indices]
    summary_rows = [lines[index] for index in summary_indices]

    assert_true(
        len(prompt_indices) == 1,
        f"expected exactly one visible input prompt row:\n{content}",
    )
    assert_single_footer_status(content, expected_status)
    assert_no_truncated_footer_status(content)
    prompt_index = prompt_indices[0]
    status_index = status_indices[0]
    assert_true(
        status_index == prompt_index + 1,
        f"footer status must be directly below the input prompt:\n{content}",
    )
    assert_true(
        prompt_index == len(lines) - 2 and status_index == len(lines) - 1,
        f"input prompt and status must occupy the final two terminal rows:\n{content}",
    )
    assert_true(
        all(index < prompt_index for index in summary_indices),
        f"intent summary must not render below the input prompt:\n{content}",
    )
    assert_true(
        "Intent:" not in prompt_rows[0],
        f"intent summary leaked into the prompt row:\n{content}",
    )
    assert_true(
        len(summary_rows) <= 1,
        f"expected at most one visible intent summary row:\n{content}",
    )
    if summary_rows and not allow_completed_summary:
        assert_true(
            "Completed" not in summary_rows[0],
            f"completed intent summary remained visible in active footer chrome:\n{content}",
        )


def assert_activity_frame_keeps_footer(content: str, expected_status: str = "gpt-terminal-e2e") -> None:
    lines = visible_lines(content)
    has_activity = any(is_live_activity_line(line) for line in lines)
    if not has_activity:
        return

    prompt_indices = [index for index, line in enumerate(lines) if is_input_prompt_line(line)]
    status_indices = [index for index, line in enumerate(lines) if expected_status in line]
    prompt_rows = [lines[index] for index in prompt_indices]
    assert_true(
        len(prompt_indices) == 1,
        f"activity frame rendered without exactly one input prompt row:\n{content}",
    )
    assert_single_footer_status(content, expected_status)
    prompt_index = prompt_indices[0]
    status_index = status_indices[0]
    assert_true(
        status_index == prompt_index + 1,
        f"activity frame did not keep status directly below the prompt:\n{content}",
    )
    assert_true(
        prompt_index == len(lines) - 2 and status_index == len(lines) - 1,
        f"activity frame did not keep prompt/status pinned to the final two rows:\n{content}",
    )
    assert_true(
        all(index < prompt_index for index, line in enumerate(lines) if "Intent:" in line),
        f"activity frame rendered an intent summary below the input prompt:\n{content}",
    )

    assert_true(prompt_index >= 0, f"activity frame rendered without an input prompt:\n{content}")
    assert_true(
        not is_live_activity_line(lines[prompt_index]),
        f"activity leaked into the input prompt row:\n{content}",
    )
    assert_true(
        any(is_live_activity_line(line) for line in lines[:prompt_index]),
        f"activity was not rendered above the input prompt:\n{content}",
    )


def has_input_prompt(content: str) -> bool:
    return any(is_input_prompt_line(line) for line in visible_lines(content))


def has_ready_input_prompt(content: str) -> bool:
    return any(
        is_input_prompt_line(line) and "Finishing response..." not in line
        for line in visible_lines(content)
    )


def wait_for_recorded_feedback(
    session_path: Path,
    *,
    intent_id: str,
    expected_sentiment: str,
    timeout: float = 5.0,
    interval: float = 0.2,
) -> dict:
    deadline = time.time() + timeout
    last_doc: dict = {}
    while time.time() < deadline:
        last_doc = json.loads(session_path.read_text(encoding="utf-8"))
        skill_eval = last_doc.get("skillEval", {})
        prompted = skill_eval.get("promptedIntentIds", [])
        feedback = skill_eval.get("feedback", [])
        if (
            intent_id in prompted
            and any(
                item.get("intentId") == intent_id and item.get("sentiment") == expected_sentiment
                for item in feedback
            )
        ):
            return last_doc
        time.sleep(interval)

    raise AssertionError(
        "feedback was not recorded in the resumed session as expected:\n"
        f"{json.dumps(last_doc, ensure_ascii=False, indent=2)}"
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
    report_fixture_names = [
        "01-market-overview.md",
        "02-customer-signals.txt",
        "03-execution-risks.txt",
    ]
    report_fixture_dir = project_dir / "tests" / "fixtures" / "report-intent-source"
    project_fixture.mkdir(parents=True)
    sandbox_fixture.mkdir(parents=True)
    home_dir.mkdir(parents=True)
    (sandbox_fixture / "marker.txt").write_text("sandbox fixture\n", encoding="utf-8")
    (project_fixture / "notes.txt").write_text("project file fixture line\n", encoding="utf-8")
    assert_true(report_fixture_dir.exists(), f"report intent fixture dir not found: {report_fixture_dir}")
    for name in report_fixture_names:
        shutil.copy2(report_fixture_dir / name, project_fixture / name)
    report_fixture_paths = [project_fixture / name for name in report_fixture_names]
    long_markdown_source = project_fixture / "kingdee-lingji-long-source.md"
    long_markdown_source.write_text(
        "\n\n".join(
            [
                "# 金蝶灵基 V2.0 研发计划",
                "## 背景\n金蝶灵基需要面向 CEO、研发、销售和交付团队形成一套统一叙事。",
                *[
                    (
                        f"## 模块 {index + 1}: 关键计划\n"
                        f"- 目标：打通产品化、交付、客户成功和商业化闭环。\n"
                        f"- 风险：跨团队依赖、数据治理、模型效果评估、上线节奏和客户验收。\n"
                        f"- TODO：补齐验收指标、里程碑、负责人、预算、试点客户和演示脚本。\n"
                        f"- 说明：这一节故意保持较长，用于在真实终端里制造足够多的 transcript 行，"
                        f"复现长 Markdown -> 报告 -> 幻灯片链路中的底部 footer 压力。"
                    )
                    for index in range(36)
                ],
            ],
        )
        + "\n",
        encoding="utf-8",
    )
    complex_report_prompt = (
        f"根据这些文档 {'、'.join(str(path) for path in report_fixture_paths)} 合并生成 md，然后生成报告"
    )
    report_slide_prompt = (
        f"根据这些文档 {'、'.join(str(path) for path in report_fixture_paths)} 生成 md，然后生成报告，然后生成幻灯片"
    )
    path_first_report_slide_prompt = f"{report_fixture_paths[0]} 生成报告，然后生成幻灯片"
    file_url_report_creator_prompt = (
        "file:///Users/song/Downloads/%E9%87%91%E8%9D%B6%E7%81%B5%E5%9F%BA"
        "-V1.9-%E7%A0%94%E5%8F%91%E8%AE%A1%E5%88%92%E6%8A%A5%E5%91%8A.html "
        "是 report-creator生成的吗"
    )
    long_markdown_report_slide_prompt = f"{long_markdown_source} 生成报告，然后生成幻灯片"
    long_report_followup_prompt = "复杂报告完成后请继续，重点补充制造业与 SaaS 的差异、风险、建议和下一步行动"
    project_settings_dir = project_fixture / ".xiaok"
    project_settings_dir.mkdir(parents=True, exist_ok=True)
    project_skills_dir = project_settings_dir / "skills"
    project_skills_dir.mkdir(parents=True, exist_ok=True)
    (project_skills_dir / "kai-report-creator.md").write_text(
        "\n".join([
            "---",
            "name: kai-report-creator",
            "description: Generate business reports and research documents from Markdown or source materials.",
            "---",
            "Use this for report generation.",
        ]) + "\n",
        encoding="utf-8",
    )
    (project_skills_dir / "kai-slide-creator.md").write_text(
        "\n".join([
            "---",
            "name: kai-slide-creator",
            "description: Generate HTML presentations and slide decks from reports.",
            "---",
            "Use this for slide generation.",
        ]) + "\n",
        encoding="utf-8",
    )
    (project_skills_dir / "skill-creator.md").write_text(
        "\n".join([
            "---",
            "name: skill-creator",
            "description: Create or update Codex skills. Do not use for reports or slides.",
            "---",
            "Use this only when creating a new skill.",
        ]) + "\n",
        encoding="utf-8",
    )
    slide_skill_fixture_dir = project_skills_dir / "kai-slide-creator"
    slide_skill_fixture_dir.mkdir(parents=True, exist_ok=True)
    for template_name in [
        "brief-template.json",
        "style-index.md",
        "enterprise-dark.md",
        "html-template.md",
        "base-css.md",
        "js-engine.md",
    ]:
        (slide_skill_fixture_dir / template_name).write_text(
            f"# {template_name}\nFixture content for the long markdown report-to-slides E2E.\n",
            encoding="utf-8",
        )
    (project_settings_dir / "settings.json").write_text(
        json.dumps({
            "permissions": {
                "allow": [f"write({project_fixture}/*)", "bash(printf *)", "bash(cd *)"],
            },
        }, indent=2) + "\n",
        encoding="utf-8",
    )

    first_response = "\n".join([
        "适合中午的：",
        "",
        "- 快餐：鸡腿饭",
        "- 面食：拉面",
        "- 轻食：三明治",
        "",
        "想吃点重口还是清淡的？",
    ])
    first_response_tail = "想吃点重口还是清淡的？"
    second_response = "\n".join([
        "辣的午餐：",
        "",
        "- 川菜：麻婆豆腐饭",
        "- 小吃：麻辣烫",
    ])
    second_response_head = "辣的午餐："
    second_response_tail = "• 小吃：麻辣烫"
    wrapped_footer_response = "\n".join([
        "- 报告：金蝶灵基_for_CEO_V2.0，包含 KPI 概览、里程碑时间线、组织能力地图",
        "- 幻灯片：金蝶灵基_for_CEO_V2.0，瑞士现代风格（Swiss Modern）",
        "",
        "两个文件均为零依赖，可直接浏览器打开查看；幻灯片按 F5 进入演讲模式。",
    ])
    wrapped_footer_followup_prompt = "报告后慢速长续问"
    narrow_footer_model = "kimi-for-coding-terminal-e2e"
    permission_response_one = "E2E_PERMISSION_RESPONSE_ONE"
    permission_response_two = "E2E_PERMISSION_RESPONSE_TWO"
    permission_command = "cmd /c echo E2E_PERMISSION_OK"
    sandbox_response_one = "E2E_SANDBOX_RESPONSE_ONE"
    sandbox_response_two = "E2E_SANDBOX_RESPONSE_TWO"
    sandbox_command = "cmd /c echo E2E_SANDBOX_OK"
    feedback_resume_session_id = "sess_feedback_footer_gap_e2e"
    feedback_resume_tool_session_id = "sess_feedback_footer_tool_e2e"
    feedback_resume_confirm_session_id = "sess_feedback_footer_confirm_e2e"
    feedback_resume_stress_session_id = "sess_feedback_footer_stress_e2e"
    feedback_resume_freeform_session_id = "sess_feedback_footer_freeform_e2e"
    feedback_resume_ctrlc_session_id = "sess_feedback_footer_ctrlc_e2e"
    feedback_resume_long_response = "\n".join([f"line {index + 1}" for index in range(30)])
    ask_user_question_prompt = "请用 AskUserQuestion 问我怎么处理这份报告"
    report_slide_write_path = project_fixture / "salesforce-ai-evolution-slides.html"
    long_markdown_report_write_path = project_fixture / "kingdee-lingji-long-source-report.html"
    long_markdown_slide_write_path = project_fixture / "kingdee-lingji-long-source-slides.html"
    report_slide_report_command = 'printf "E2E_REPORT_SLIDE_STAGE2" && sleep 6'
    feedback_intent_merge_command = 'printf "E2E_FEEDBACK_INTENT_MERGED_MD"'
    feedback_intent_bash_command = (
        'printf "E2E_FEEDBACK_INTENT_WRAP_BLOCK verifying footer stability after feedback skip"'
    )
    feedback_confirm_intent_merge_command = 'printf "E2E_FEEDBACK_CONFIRM_MERGED_MD"'
    feedback_confirm_intent_bash_command = (
        'printf "E2E_FEEDBACK_CONFIRM_WRAP_BLOCK verifying footer stability after feedback confirmation"'
    )
    narrow_report_write_path = project_fixture / "report-analysis.report.md"
    narrow_report_bash_command = (
        'printf "E2E_NARROW_WRAPPED_ANALYSIS const fs = require(\'fs\'); '
        "const report = fs.readFileSync('report-analysis.report.md', 'utf8'); "
        '/* analyzing merged markdown and preparing the structured report */" && sleep 2'
    )
    stress_report_write_path = project_fixture / "combined-source.report.md"
    answering_after_changed_write_path = project_fixture / "tesla-salesforce-enterprise-ai-sales-report.report.md"
    stress_report_bash_commands = [
        (
            f'cd {shell_quote_posix(str(project_fixture))} && '
            f'cat {shell_quote_posix(str(report_fixture_paths[0]))} >/dev/null && '
            f'ls -la {shell_quote_posix(str(project_fixture))} >/dev/null && '
            f'find {shell_quote_posix(str(project_fixture))} -maxdepth 2 -type f | sort >/dev/null && '
            'printf "E2E_STRESS_RAN_1" && sleep 1'
        ),
        (
            f'cd {shell_quote_posix(str(project_fixture))} && '
            f'cat {shell_quote_posix(str(report_fixture_paths[1]))} >/dev/null && '
            f'find {shell_quote_posix(str(project_fixture))} -maxdepth 2 -type f | sort >/dev/null && '
            f'cat {shell_quote_posix(str(report_fixture_paths[2]))} >/dev/null && '
            'printf "E2E_STRESS_RAN_2" && sleep 1'
        ),
        (
            f'cd {shell_quote_posix(str(project_fixture))} && '
            f'cat {shell_quote_posix(str(stress_report_write_path))} >/dev/null && '
            f'ls -la {shell_quote_posix(str(project_fixture))} >/dev/null && '
            'printf "E2E_STRESS_RAN_3" && sleep 1'
        ),
        (
            f'cd {shell_quote_posix(str(project_fixture))} && '
            f'find {shell_quote_posix(str(project_fixture))} -maxdepth 2 -type f | sort >/dev/null && '
            f'cat {shell_quote_posix(str(stress_report_write_path))} >/dev/null && '
            'printf "E2E_STRESS_RAN_4" && sleep 1'
        ),
    ]
    answering_after_changed_bash_command = 'printf "E2E_ANSWERING_AFTER_CHANGED_STAGE" && sleep 1'
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
        text_then_tool_call_events(
            "我先读取项目文件。",
            "read",
            {"file_path": str(project_fixture / "notes.txt")},
            "call_project_read_1",
        ),
        text_response_events("\n".join([
            "继续总结如下：",
            "",
            "- 第一项",
            "- 第二项",
        ])),
        text_response_events("已理解，我会先合并三份材料为 Markdown，再生成报告。"),
        tool_call_response_events("read", {"file_path": str(project_fixture / "notes.txt")}, "call_multi_tool_read"),
        tool_call_response_events("bash", {"command": 'printf "E2E_MULTI_TOOL_OK"'}, "call_multi_tool_bash"),
        text_response_events("连续多个工具块已完成。"),
        text_response_events("echo:工具块完成后继续提问"),
        text_response_events(feedback_resume_long_response),
        text_response_events(first_response),
        text_response_events(second_response),
        text_response_events(feedback_resume_long_response),
        tool_call_response_events("read", {"file_path": str(report_fixture_paths[0])}, "call_feedback_intent_read_a"),
        tool_call_response_events("read", {"file_path": str(report_fixture_paths[1])}, "call_feedback_intent_read_b"),
        tool_call_response_events("read", {"file_path": str(report_fixture_paths[2])}, "call_feedback_intent_read_c"),
        tool_call_response_events("bash", {"command": feedback_intent_merge_command}, "call_feedback_intent_bash_merge"),
        tool_call_response_events("bash", {"command": feedback_intent_bash_command}, "call_feedback_intent_bash_1"),
        tool_call_response_events("bash", {"command": 'printf "E2E_FEEDBACK_INTENT_STAGE2_OK"'}, "call_feedback_intent_bash_2"),
        text_response_events("三份文档已先合并为 Markdown，再生成报告。"),
        text_response_events("echo:报告后继续追问"),
        text_response_events(feedback_resume_long_response),
        tool_call_response_events("read", {"file_path": str(report_fixture_paths[0])}, "call_feedback_confirm_read_a"),
        tool_call_response_events("read", {"file_path": str(report_fixture_paths[1])}, "call_feedback_confirm_read_b"),
        tool_call_response_events("read", {"file_path": str(report_fixture_paths[2])}, "call_feedback_confirm_read_c"),
        tool_call_response_events("bash", {"command": feedback_confirm_intent_merge_command}, "call_feedback_confirm_bash_merge"),
        tool_call_response_events("bash", {"command": feedback_confirm_intent_bash_command}, "call_feedback_confirm_bash_1"),
        tool_call_response_events("bash", {"command": 'printf "E2E_FEEDBACK_CONFIRM_STAGE2_OK"'}, "call_feedback_confirm_bash_2"),
        text_response_events("确认反馈后，三份文档已先合并为 Markdown，再生成报告。"),
        text_response_events("echo:确认反馈后继续追问"),
        tool_call_response_events("read", {"file_path": str(report_fixture_paths[0])}, "call_narrow_report_read_a"),
        tool_call_response_events("read", {"file_path": str(report_fixture_paths[1])}, "call_narrow_report_read_b"),
        tool_call_response_events("read", {"file_path": str(report_fixture_paths[2])}, "call_narrow_report_read_c"),
        tool_call_response_events(
            "write",
            {"file_path": str(narrow_report_write_path), "content": "# merged report draft\n"},
            "call_narrow_report_write",
        ),
        tool_call_response_events("bash", {"command": narrow_report_bash_command}, "call_narrow_report_bash"),
        text_response_events("窄终端复杂报告链路已完成。"),
        text_response_events(f"echo:{long_report_followup_prompt}"),
        text_response_events(feedback_resume_long_response),
        tool_call_response_events("read", {"file_path": str(report_fixture_paths[0])}, "call_stress_report_read_a"),
        tool_call_response_events("read", {"file_path": str(report_fixture_paths[1])}, "call_stress_report_read_b"),
        tool_call_response_events("read", {"file_path": str(report_fixture_paths[2])}, "call_stress_report_read_c"),
        tool_call_response_events(
            "write",
            {"file_path": str(stress_report_write_path), "content": "# combined report draft\n"},
            "call_stress_report_write",
        ),
        tool_call_response_events("bash", {"command": stress_report_bash_commands[0]}, "call_stress_report_bash_1"),
        tool_call_response_events("bash", {"command": stress_report_bash_commands[1]}, "call_stress_report_bash_2"),
        tool_call_response_events("bash", {"command": stress_report_bash_commands[2]}, "call_stress_report_bash_3"),
        tool_call_response_events("bash", {"command": stress_report_bash_commands[3]}, "call_stress_report_bash_4"),
        text_response_events("高压复杂报告链路已完成。"),
        text_response_events("echo:高压复杂报告后继续追问"),
        tool_call_response_events("read", {"file_path": str(report_fixture_paths[0])}, "call_answering_after_changed_read_a"),
        tool_call_response_events("read", {"file_path": str(report_fixture_paths[1])}, "call_answering_after_changed_read_b"),
        tool_call_response_events("read", {"file_path": str(report_fixture_paths[2])}, "call_answering_after_changed_read_c"),
        tool_call_response_events(
            "write",
            {"file_path": str(answering_after_changed_write_path), "content": "# long changed report draft\n"},
            "call_answering_after_changed_write",
        ),
        text_then_tool_call_events(
            "我先起草报告结构，再继续补充分析。",
            "bash",
            {"command": answering_after_changed_bash_command},
            "call_answering_after_changed_bash",
        ),
        text_response_events("Changed 后进入 Answering 的复杂报告链路已完成。"),
        text_response_events("echo:Changed 后继续追问"),
        text_response_events(feedback_resume_long_response),
        text_response_events("echo:吃什么"),
        text_response_events(feedback_resume_long_response),
        text_response_events(wrapped_footer_response),
        text_response_events(f"echo:{wrapped_footer_followup_prompt}"),
        text_then_tool_call_events(
            "我先确认你的偏好。",
            "AskUserQuestion",
            {
                "questions": [
                    {
                        "header": "report-plan",
                        "question": "你希望：",
                        "options": [
                            {"label": "A) 重新生成报告", "description": "基于现有 Markdown 重做成品报告"},
                            {"label": "B) 把 PDF 内容整合进去", "description": "把补充材料一起纳入输出"},
                            {"label": "C) 只生成 Markdown", "description": "先停在中间产物，不继续出最终报告"},
                            {"label": "D) 其他需求", "description": "我再按你的补充要求改"},
                        ],
                    },
                ],
            },
            "call_ask_user_question_report",
        ),
        text_response_events("已记录你的处理偏好。"),
        text_then_tool_call_events(
            "我会先生成报告，再生成幻灯片。",
            "skill",
            {"name": "kai-report-creator", "task": "生成报告"},
            "call_report_slide_skill_report",
        ),
        tool_call_response_events("bash", {"command": report_slide_report_command}, "call_report_slide_stage2_bash"),
        tool_call_response_events(
            "skill",
            {"name": "kai-slide-creator", "task": "生成幻灯片"},
            "call_report_slide_skill_slides",
        ),
        tool_call_response_events(
            "write",
            {"file_path": str(report_slide_write_path), "content": "<!doctype html><title>slides</title>"},
            "call_report_slide_write",
        ),
        text_response_events("\n".join([
            "三阶段报告幻灯片链路已完成。",
            "",
            "- 报告：金蝶灵基_for_CEO_V2.0，包含 KPI 概览、里程碑时间线、组织能力地图",
            "- 幻灯片：金蝶灵基_for_CEO_V2.0，瑞士现代风格（Swiss Modern）",
        ])),
        text_response_events("路径开头报告幻灯片任务已完成。"),
        text_response_events("这是 report-creator 生成物检查结果。"),
        text_then_tool_call_events(
            "我先读取长 Markdown 源文件，再按报告和幻灯片两阶段推进。",
            "read",
            {"file_path": str(long_markdown_source)},
            "call_long_md_source_read",
        ),
        tool_call_response_events(
            "skill",
            {"name": "kai-report-creator", "task": "根据长 Markdown 生成报告"},
            "call_long_md_report_skill",
        ),
        tool_call_response_events(
            "write",
            {"file_path": str(long_markdown_report_write_path), "content": "<!doctype html><title>long report</title>"},
            "call_long_md_report_write",
        ),
        tool_call_response_events(
            "skill",
            {"name": "kai-slide-creator", "task": "根据报告生成幻灯片"},
            "call_long_md_slide_skill",
        ),
        tool_call_response_events(
            "read",
            {"file_path": str(slide_skill_fixture_dir / "brief-template.json")},
            "call_long_md_slide_read_brief",
        ),
        tool_call_response_events(
            "read",
            {"file_path": str(slide_skill_fixture_dir / "style-index.md")},
            "call_long_md_slide_read_style",
        ),
        tool_call_response_events(
            "read",
            {"file_path": str(slide_skill_fixture_dir / "enterprise-dark.md")},
            "call_long_md_slide_read_enterprise_dark",
        ),
        tool_call_response_events(
            "read",
            {"file_path": str(slide_skill_fixture_dir / "html-template.md")},
            "call_long_md_slide_read_html",
        ),
        tool_call_response_events(
            "read",
            {"file_path": str(slide_skill_fixture_dir / "base-css.md")},
            "call_long_md_slide_read_css",
        ),
        tool_call_response_events(
            "read",
            {"file_path": str(slide_skill_fixture_dir / "js-engine.md")},
            "call_long_md_slide_read_js",
        ),
        tool_call_response_events(
            "write",
            {"file_path": str(long_markdown_slide_write_path), "content": "<!doctype html><title>long slides</title>"},
            "call_long_md_slide_write",
        ),
        text_response_events("\n".join([
            "长 Markdown 报告和幻灯片链路已完成。",
            "",
            "- 报告：kingdee-lingji-long-source-report.html",
            "- 幻灯片：kingdee-lingji-long-source-slides.html",
        ])),
    ], first_token_delay=1.5)
    server.start()
    write_config(config_dir, server.base_url)
    write_feedback_resume_session(config_dir, project_fixture, feedback_resume_session_id)
    write_feedback_resume_session(config_dir, project_fixture, feedback_resume_tool_session_id)
    write_feedback_resume_session(config_dir, project_fixture, feedback_resume_confirm_session_id)
    write_feedback_resume_session(config_dir, project_fixture, feedback_resume_stress_session_id)
    write_feedback_resume_session(config_dir, project_fixture, feedback_resume_freeform_session_id)
    write_feedback_resume_session(config_dir, project_fixture, feedback_resume_ctrlc_session_id)

    session = f"xiaok-e2e-{os.getpid()}"
    tmux = TmuxHarness(session, project_fixture, config_dir, home_dir, cli_entry, tmux_bin)

    try:
        tmux.start()

        print("--- E2E 1: welcome and fixed footer ---")
        welcome = tmux.wait_for(lambda text: "欢迎使用 xiaok code" in text and has_input_prompt(text), timeout=12)
        assert_contains(welcome, "欢迎使用 xiaok code", "welcome screen did not render")
        assert_true(has_input_prompt(welcome), f"input footer prompt did not render:\n{welcome}")
        bottom = "\n".join(visible_lines(welcome)[-4:])
        assert_true(any(is_input_prompt_line(line) for line in bottom.splitlines()), f"input prompt is not near bottom footer:\n{bottom}")
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
        prompt_lines = [line for line in lines if is_input_prompt_line(line)]
        body_input_lines = [line.strip() for line in lines if line.strip() in {"2", "3", "4"}]
        status_lines = [line for line in visible_lines(multiline) if "gpt-terminal-e2e" in line]
        assert_true(len(prompt_lines) == 1, f"expected one prompt line, got {len(prompt_lines)}:\n{multiline}")
        assert_true("1" in prompt_lines[0], f"first multiline input row was not visible in footer:\n{multiline}")
        assert_true(body_input_lines == ["2", "3", "4"], f"multiline input rows were not visible in footer:\n{multiline}")
        assert_true(len(status_lines) == 1, f"expected one status line, got {len(status_lines)}:\n{multiline}")
        print("PASS: multiline input does not duplicate prompt or status")

        tmux.stop()
        tmux.start()
        welcome = tmux.wait_for(lambda text: "欢迎使用 xiaok code" in text and has_input_prompt(text), timeout=12)
        assert_contains(welcome, "欢迎使用 xiaok code", "welcome screen did not render after multiline restart")

        print("--- E2E 3: long single-line input soft-wraps instead of horizontally scrolling ---")
        long_input = f"WRAP_START_{'x' * 125}_WRAP_MIDDLE_{'y' * 35}_WRAP_END"
        tmux.send_text(long_input)
        time.sleep(0.5)
        wrapped = tmux.capture()
        wrapped_lines = visible_lines(wrapped)
        wrapped_prompt_lines = [line for line in wrapped_lines if is_input_prompt_line(line)]
        wrapped_status_lines = [line for line in wrapped_lines if "gpt-terminal-e2e" in line]
        assert_true(len(wrapped_prompt_lines) == 1, f"expected one wrapped prompt row:\n{wrapped}")
        assert_true("WRAP_START_" in wrapped, f"long single-line input start was not visible:\n{wrapped}")
        assert_true("_WRAP_MIDDLE_" in wrapped, f"long single-line input did not wrap into additional footer rows:\n{wrapped}")
        assert_true(len(wrapped_status_lines) == 1, f"expected one wrapped status line:\n{wrapped}")
        print("PASS: long single-line input wraps inside the footer")

        tmux.stop()
        tmux.start()
        welcome = tmux.wait_for(lambda text: "欢迎使用 xiaok code" in text and has_input_prompt(text), timeout=12)
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
            lambda text: "/help    - 显示帮助" in text and "可用 skills：" in text and "/plan -" in text,
            timeout=12,
        )
        assert_contains(help_output, "/help    - 显示帮助", "built-in /help output did not list /help")
        assert_contains(help_output, "可用 skills：", "built-in /help output did not include skills section")
        assert_contains(help_output, "/plan -", "built-in /help output did not include visible skills")
        print("PASS: built-in slash command output is visible")

        print("--- E2E 5b: slash-selected /models opens the model selector instead of the permission-mode command ---")
        tmux.send_text("/mod")
        time.sleep(0.3)
        slash_models_overlay = tmux.capture()
        assert_contains(slash_models_overlay, "/mode", "slash menu did not show /mode while filtering /mod")
        assert_contains(slash_models_overlay, "/models", "slash menu did not show /models while filtering /mod")

        selected_models_overlay = slash_models_overlay
        for _ in range(6):
            if "❯ /models" in selected_models_overlay:
                break
            tmux.send_key("Down")
            time.sleep(0.15)
            selected_models_overlay = tmux.capture()
        assert_contains(
            selected_models_overlay,
            "❯ /models",
            "slash menu did not move selection onto /models before confirmation",
        )

        tmux.send_key("Enter")

        model_selector = tmux.wait_for(
            lambda text: "Custom Default" in text or "当前权限模式" in text,
            timeout=12,
        )
        assert_contains(model_selector, "Custom Default", "slash-selected /models did not enter the model selector")
        assert_true(
            "当前权限模式" not in model_selector,
            f"/models was incorrectly routed into the /mode command path:\n{model_selector}",
        )

        tmux.send_key("Enter")
        model_switch_output = tmux.wait_for(
            lambda text: "已切换到：" in text and has_ready_input_prompt(text),
            timeout=12,
        )
        assert_contains(model_switch_output, "已切换到：", "model selector did not finish with a visible switch confirmation")
        assert_true(
            "当前权限模式" not in model_switch_output,
            f"/models flow still emitted permission-mode output after the model selector:\n{model_switch_output}",
        )
        assert_footer_chrome_is_singular(model_switch_output, "· auto · 0% · project")
        print("PASS: slash-selected /models uses the model selector and keeps the footer singular")

        tmux.stop()
        tmux.start()
        welcome = tmux.wait_for(lambda text: "欢迎使用 xiaok code" in text and has_input_prompt(text), timeout=12)
        assert_contains(welcome, "欢迎使用 xiaok code", "welcome screen did not render after session restart")

        print("--- E2E 6: streamed answer preserves output and footer ---")
        tmux.send_text("first terminal request")
        time.sleep(0.15)
        tmux.send_key("Enter")
        first_pending = tmux.wait_for(
            lambda text: (
                "first terminal request" in text
                and any(label in text for label in SPINNER_LABELS)
                and has_input_prompt(text)
            ),
            timeout=12,
        )
        first_pending_lines = visible_lines(first_pending)
        welcome_index = next((i for i, line in enumerate(first_pending_lines) if "欢迎使用 xiaok code" in line), -1)
        submitted_index = next((i for i, line in enumerate(first_pending_lines) if "first terminal request" in line), -1)
        assert_true(welcome_index >= 0, f"welcome card disappeared before the first response:\n{first_pending}")
        assert_true(submitted_index > welcome_index, f"first submitted input did not render below the welcome card:\n{first_pending}")
        assert_activity_above_prompt_with_gap(first_pending)
        first = tmux.wait_for(
            lambda text: first_response_tail in text and len(server.requests) >= 1 and footer_has_empty_prompt(text),
            timeout=20,
        )
        assert_contains(first, "first terminal request", "submitted user input disappeared")
        assert_contains(first, first_response_tail, "assistant response tail did not render")
        assert_true(activity_line_count(first) <= 2, f"too many activity lines after first response:\n{first}")
        assert_true(any(is_input_prompt_line(line) for line in visible_lines(first)[-4:]), f"footer prompt missing after first response:\n{first}")
        print("PASS: first streamed response and footer are stable")

        print("--- E2E 7: second turn does not eat previous output ---")
        time.sleep(0.2)
        tmux.send_text("second terminal request")
        time.sleep(0.15)
        tmux.send_key("Enter")
        second = tmux.wait_for(
            lambda text: (
                first_response_tail in text
                and second_response_head in text
                and len(server.requests) >= 2
                and footer_has_empty_prompt(text)
            ),
            timeout=20,
        )
        assert_contains(second, first_response_tail, "first response tail was overwritten by second turn")
        assert_contains(second, second_response_head, "second assistant response did not render")
        assert_true(activity_line_count(second) <= 2, f"too many activity lines after second response:\n{second}")
        print("PASS: multi-turn output remains visible without activity duplication")

        tmux.auto_mode = False
        tmux.stop()
        tmux.start()
        welcome = tmux.wait_for(lambda text: "欢迎使用 xiaok code" in text and has_input_prompt(text), timeout=12)
        assert_contains(welcome, "欢迎使用 xiaok code", "welcome screen did not render before permission flow")

        print("--- E2E 8: permission menu remains intact and project allow persists ---")
        tmux.send_text("trigger permission prompt")
        time.sleep(0.15)
        tmux.send_key("Enter")
        time.sleep(0.4)
        pending_permission = tmux.capture()
        assert_contains(pending_permission, "trigger permission prompt", "submitted permission-trigger input disappeared before the prompt opened")
        assert_true("xiaok 想要执行以下操作" not in pending_permission, f"permission prompt opened before pending footer state was captured:\n{pending_permission}")
        assert_true(activity_line_count(pending_permission) <= 1, f"pending permission state duplicated activity lines:\n{pending_permission}")
        assert_single_footer_status(pending_permission, "gpt-terminal-e2e")
        assert_no_truncated_footer_status(pending_permission)
        permission_prompt = tmux.wait_for(
            lambda text: (
                "xiaok 想要执行以下操作" in text
                and "bash" in text
                and permission_command in text
                and has_input_prompt(text)
            ),
            timeout=12,
        )
        assert_contains(permission_prompt, "xiaok 想要执行以下操作", "permission title did not render")
        assert_contains(permission_prompt, "bash", "permission tool name did not render")
        assert_contains(permission_prompt, permission_command, "permission command summary did not render")
        assert_true(count_occurrences(permission_prompt, "xiaok 想要执行以下操作") == 1, f"permission prompt duplicated:\n{permission_prompt}")
        assert_true("❯ 允许一次" in permission_prompt, f"default permission selection was not visible:\n{permission_prompt}")
        assert_overlay_above_prompt_with_gap(permission_prompt, "↑↓ 选择")
        assert_no_truncated_footer_status(permission_prompt)

        tmux.send_key("Down")
        tmux.send_key("Down")
        time.sleep(0.2)
        project_selected = tmux.capture()
        assert_true(
            "❯ 始终允许 bash(cmd *) (保存到项目)" in project_selected,
            f"permission selection did not move to project allow:\n{project_selected}",
        )
        assert_true(
            count_occurrences(project_selected, "xiaok 想要执行以下操作") == 1,
            f"permission prompt duplicated during navigation:\n{project_selected}",
        )
        assert_overlay_above_prompt_with_gap(project_selected, "↑↓ 选择")
        assert_no_truncated_footer_status(project_selected)
        tmux.send_key("Enter")

        first_permission_result = tmux.wait_for(
            lambda text: permission_response_one in text and "xiaok 想要执行以下操作" not in text,
            timeout=20,
        )
        assert_contains(first_permission_result, permission_response_one, "permission flow response did not render")
        assert_true("xiaok 想要执行以下操作" not in first_permission_result, f"permission prompt text leaked after approval:\n{first_permission_result}")
        assert_single_footer_status(first_permission_result, "gpt-terminal-e2e")

        settings_path = project_fixture / ".xiaok" / "settings.json"
        assert_true(settings_path.exists(), f"project settings file was not written: {settings_path}")
        settings_raw = settings_path.read_text(encoding="utf-8")
        assert_true("bash(cmd *)" in settings_raw, f"project permission rule was not persisted:\n{settings_raw}")

        tmux.stop()
        tmux.start()
        welcome = tmux.wait_for(lambda text: "欢迎使用 xiaok code" in text and has_input_prompt(text), timeout=12)
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
        welcome = tmux.wait_for(lambda text: "欢迎使用 xiaok code" in text and has_input_prompt(text), timeout=12)
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
        assert_overlay_above_prompt_with_gap(sandbox_prompt, "↑↓ 选择")

        tmux.send_key("Down")
        tmux.send_key("Down")
        time.sleep(0.2)
        sandbox_project_selected = tmux.capture()
        assert_true(
            "保存到项目" in sandbox_project_selected and "❯ 始终允许 sandbox-expand:bash(" in sandbox_project_selected,
            f"sandbox prompt selection did not move to project allow:\n{sandbox_project_selected}",
        )
        assert_overlay_above_prompt_with_gap(sandbox_project_selected, "↑↓ 选择")
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
        welcome = tmux.wait_for(lambda text: "欢迎使用 xiaok code" in text and has_input_prompt(text), timeout=12)
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

        tmux.stop()
        tmux.start()
        welcome = tmux.wait_for(lambda text: "欢迎使用 xiaok code" in text and has_input_prompt(text), timeout=12)
        assert_contains(welcome, "欢迎使用 xiaok code", "welcome screen did not render before tool interruption flow")

        print("--- E2E 10: tool interruption keeps footer/activity visible and restarts assistant lead formatting ---")
        tmux.send_text("先读项目文件再继续")
        time.sleep(0.15)
        tmux.send_key("Enter")

        tool_pending = tmux.wait_for(
            lambda text: "Read notes.txt" in text and any(label in text for label in SPINNER_LABELS),
            timeout=12,
        )
        assert_contains(tool_pending, "Read notes.txt", "tool activity block did not render during interrupted turn")
        assert_activity_above_prompt_with_gap(tool_pending)
        assert_true(
            "gpt-terminal-e2e" in tool_pending and "project" in tool_pending,
            f"footer status was not visible during the tool interruption:\n{tool_pending}",
        )

        interrupted_final = tmux.wait_for(
            lambda text: "继续总结如下：" in text and has_input_prompt(text),
            timeout=20,
        )
        assert_true(
            count_bullet_lines(interrupted_final, "我先读取项目文件。") >= 1,
            f"first assistant segment did not keep its lead bullet across the tool interruption:\n{interrupted_final}",
        )
        assert_true(
            count_bullet_lines(interrupted_final, "继续总结如下：") >= 1,
            f"continued assistant segment did not restart with a lead bullet after the tool block:\n{interrupted_final}",
        )
        line_before_prompt_with_gap(interrupted_final, min_blank_rows=2)
        print("PASS: tool interruption keeps footer visible and restarts assistant lead formatting")

        tmux.stop()
        tmux.start()
        welcome = tmux.wait_for(lambda text: "欢迎使用 xiaok code" in text and has_input_prompt(text), timeout=12)
        assert_contains(welcome, "欢迎使用 xiaok code", "welcome screen did not render before intent summary flow")

        print("--- E2E 11: intent summary hint uses the indented bullet style during active planning ---")
        tmux.send_text(complex_report_prompt)
        time.sleep(0.15)
        tmux.send_key("Enter")

        intent_pending = tmux.wait_for(
            lambda text: "Intent:" in text and any(label in text for label in SPINNER_LABELS),
            timeout=12,
        )
        assert_intent_summary_hint(intent_pending, "Intent:")
        assert_true(
            any(label in intent_pending for label in SPINNER_LABELS),
            f"activity was not visible while the intent summary hint was active:\n{intent_pending}",
        )

        intent_final = tmux.wait_for(
            lambda text: "已理解，我会先合并三份材料为 Markdown，再生成报告。" in text and has_input_prompt(text),
            timeout=20,
        )
        assert_contains(intent_final, "已理解，我会先合并三份材料为 Markdown，再生成报告。", "intent flow response did not render")
        print("PASS: intent summary hint renders with an indented bullet during active planning")

        tmux.stop()
        tmux.start()
        welcome = tmux.wait_for(lambda text: "欢迎使用 xiaok code" in text and has_input_prompt(text), timeout=12)
        assert_contains(welcome, "欢迎使用 xiaok code", "welcome screen did not render before consecutive tool flow")

        print("--- E2E 12: consecutive tool blocks preserve footer/activity and the next turn still submits ---")
        tmux.send_text("连续工具块")
        time.sleep(0.15)
        tmux.send_key("Enter")

        multi_tool_pending = tmux.wait_for(
            lambda text: "Read notes.txt" in text and any(label in text for label in SPINNER_LABELS),
            timeout=12,
        )
        assert_contains(multi_tool_pending, "Read notes.txt", "read tool block did not render during consecutive tool flow")
        assert_activity_above_prompt_with_gap(multi_tool_pending)
        assert_true(
            sum(1 for line in visible_lines(multi_tool_pending) if "gpt-terminal-e2e" in line and "project" in line) == 1,
            f"footer status did not remain singular during the first tool block:\n{multi_tool_pending}",
        )
        assert_no_truncated_footer_status(multi_tool_pending)

        multi_tool_running = tmux.wait_for(
            lambda text: 'printf "E2E_MULTI_TOOL_OK"' in text and any(label in text for label in SPINNER_LABELS),
            timeout=12,
        )
        assert_contains(multi_tool_running, 'printf "E2E_MULTI_TOOL_OK"', "bash tool block did not render during consecutive tool flow")
        assert_activity_above_prompt_with_gap(multi_tool_running)
        assert_true(
            sum(1 for line in visible_lines(multi_tool_running) if "gpt-terminal-e2e" in line and "project" in line) == 1,
            f"footer status did not remain singular during the second tool block:\n{multi_tool_running}",
        )
        assert_no_truncated_footer_status(multi_tool_running)

        multi_tool_final = tmux.wait_for(
            lambda text: "连续多个工具块已完成。" in text and has_input_prompt(text),
            timeout=20,
        )
        line_before_prompt_with_gap(multi_tool_final, min_blank_rows=2)
        assert_true(
            "● Intent:" not in multi_tool_final,
            f"stale intent summary remained visible after the consecutive tool flow completed:\n{multi_tool_final}",
        )

        tmux.send_text("工具块完成后继续提问")
        time.sleep(0.15)
        tmux.send_key("Enter")

        followup = tmux.wait_for(
            lambda text: "echo:工具块完成后继续提问" in text and has_input_prompt(text),
            timeout=20,
        )
        assert_contains(followup, "echo:工具块完成后继续提问", "follow-up input did not submit after the consecutive tool flow")
        assert_true(
            "● Intent:" not in followup,
            f"stale intent summary leaked into the next ordinary turn:\n{followup}",
        )
        print("PASS: consecutive tool blocks keep footer/activity visible and the next turn still submits")

        tmux.auto_mode = False
        tmux.extra_args = ["chat", "--resume", feedback_resume_session_id]
        tmux.stop()
        tmux.start()
        tmux.tmux("resize-window", "-t", session, "-x", "60", "-y", "24")
        welcome = tmux.wait_for(lambda text: "欢迎使用 xiaok code" in text and has_input_prompt(text), timeout=12)
        assert_contains(welcome, "欢迎使用 xiaok code", "resume welcome screen did not render before feedback flow")

        print("--- E2E 13: completed intent does not open feedback prompt or collapse footer spacing ---")
        tmux.send_text("输出30行")
        time.sleep(0.15)
        tmux.send_key("Enter")

        no_feedback_prompt = tmux.wait_for(
            lambda text: "line 30" in text and "[xiaok]" not in text and has_ready_input_prompt(text),
            timeout=20,
        )
        assert_contains(no_feedback_prompt, "line 30", "long transcript did not finish before input returned")
        assert_true(
            "[xiaok]" not in no_feedback_prompt,
            f"completed-intent feedback prompt should be disabled:\n{no_feedback_prompt}",
        )
        assert_true(
            "gpt-terminal-e2e" in no_feedback_prompt and "project" in no_feedback_prompt,
            f"footer status disappeared after completed intent:\n{no_feedback_prompt}",
        )

        tmux.send_text("吃什么")
        time.sleep(0.15)
        tmux.send_key("Enter")

        feedback_followup = tmux.wait_for(
            lambda text: first_response_tail in text and has_ready_input_prompt(text),
            timeout=20,
        )
        assert_contains(feedback_followup, "适合中午的：", "first turn after feedback did not render")
        assert_true(
            line_before_prompt_with_gap(feedback_followup, min_blank_rows=2) == first_response_tail,
            f"first post-feedback response tail did not stay above the footer gap:\n{feedback_followup}",
        )

        tmux.send_text("辣的续问")
        time.sleep(0.15)
        tmux.send_key("Enter")

        feedback_second_followup = tmux.wait_for(
            lambda text: second_response_tail in text and has_ready_input_prompt(text),
            timeout=20,
        )
        assert_contains(feedback_second_followup, "辣的午餐：", "second turn after feedback did not render")
        assert_true(
            line_before_prompt_with_gap(feedback_second_followup, min_blank_rows=2) == second_response_tail,
            f"second post-feedback response tail did not stay above the footer gap:\n{feedback_second_followup}",
        )
        print("PASS: completed intent without feedback prompt preserves footer spacing across later turns")

        tmux.auto_mode = False
        tmux.extra_args = ["chat", "--resume", feedback_resume_tool_session_id]
        tmux.stop()
        tmux.start()
        tmux.tmux("resize-window", "-t", session, "-x", "60", "-y", "24")
        welcome = tmux.wait_for(lambda text: "欢迎使用 xiaok code" in text and has_input_prompt(text), timeout=12)
        assert_contains(welcome, "欢迎使用 xiaok code", "resume welcome screen did not render before feedback intent tool flow")

        print("--- E2E 14: completed intent can immediately enter a new complex intent without duplicating footer chrome ---")
        tmux.send_text("输出30行")
        time.sleep(0.15)
        tmux.send_key("Enter")

        no_feedback_prompt = tmux.wait_for(
            lambda text: "line 30" in text and "[xiaok]" not in text and has_ready_input_prompt(text),
            timeout=20,
        )
        assert_contains(no_feedback_prompt, "line 30", "second resumed long transcript did not finish before input returned")
        assert_true(
            "[xiaok]" not in no_feedback_prompt,
            f"completed-intent feedback prompt should be disabled:\n{no_feedback_prompt}",
        )
        assert_footer_chrome_is_singular(no_feedback_prompt)

        tmux.send_text(complex_report_prompt)
        time.sleep(0.15)
        tmux.send_key("Enter")

        intent_tool_pending = tmux.wait_for(
            lambda text: "Read 01-market-overview.md" in text and any(label in text for label in SPINNER_LABELS),
            timeout=12,
        )
        assert_intent_summary_hint(intent_tool_pending, "md -> 报告")
        assert_activity_above_prompt_with_gap(intent_tool_pending)
        assert_footer_chrome_is_singular(intent_tool_pending)

        intent_tool_second_read = tmux.wait_for(
            lambda text: "Read 02-customer-signals.txt" in text and any(label in text for label in SPINNER_LABELS),
            timeout=12,
        )
        assert_activity_above_prompt_with_gap(intent_tool_second_read)
        assert_footer_chrome_is_singular(intent_tool_second_read)

        intent_tool_third_read = tmux.wait_for(
            lambda text: "Read 03-execution-risks.txt" in text and any(label in text for label in SPINNER_LABELS),
            timeout=12,
        )
        assert_activity_above_prompt_with_gap(intent_tool_third_read)
        assert_footer_chrome_is_singular(intent_tool_third_read)

        intent_tool_merged_md = tmux.wait_for(
            lambda text: "E2E_FEEDBACK_INTENT_MERGED_MD" in text and any(label in text for label in SPINNER_LABELS),
            timeout=12,
        )
        assert_activity_above_prompt_with_gap(intent_tool_merged_md)
        assert_footer_chrome_is_singular(intent_tool_merged_md)

        intent_tool_running = tmux.wait_for(
            lambda text: "E2E_FEEDBACK_INTENT_WRAP_BLOCK" in text and any(label in text for label in SPINNER_LABELS),
            timeout=12,
        )
        assert_activity_above_prompt_with_gap(intent_tool_running)
        assert_footer_chrome_is_singular(intent_tool_running)

        intent_tool_stage_two = tmux.wait_for(
            lambda text: "E2E_FEEDBACK_INTENT_STAGE2_OK" in text and any(label in text for label in SPINNER_LABELS),
            timeout=12,
        )
        assert_activity_above_prompt_with_gap(intent_tool_stage_two)
        assert_footer_chrome_is_singular(intent_tool_stage_two)

        intent_tool_final = tmux.wait_for(
            lambda text: "三份文档已先合并为 Markdown，再生成报告。" in text and has_ready_input_prompt(text),
            timeout=20,
        )
        assert_contains(intent_tool_final, "三份文档已先合并为 Markdown，再生成报告。", "complex intent did not finish after the completed turn")
        assert_footer_chrome_is_singular(intent_tool_final, allow_completed_summary=True)
        assert_true(
            "● Intent: md -> 报告 · Stage 2/2 生成报告" in intent_tool_final and "Completed" in intent_tool_final,
            f"completed stage 2 intent summary was not visible after the complex intent finished:\n{intent_tool_final}",
        )

        tmux.send_text("报告后继续追问")
        time.sleep(0.15)
        tmux.send_key("Enter")

        intent_tool_followup = tmux.wait_for(
            lambda text: "echo:报告后继续追问" in text and has_ready_input_prompt(text),
            timeout=20,
        )
        assert_contains(intent_tool_followup, "echo:报告后继续追问", "follow-up input did not submit after the feedback-skipped complex intent")
        assert_footer_chrome_is_singular(intent_tool_followup)
        assert_true(
            "● Intent:" not in intent_tool_followup,
            f"stale intent summary leaked into the ordinary turn after the completed complex intent:\n{intent_tool_followup}",
        )
        print("PASS: completed intent can hand off directly into a complex intent without footer duplication")

        tmux.auto_mode = False
        tmux.extra_args = ["chat", "--resume", feedback_resume_confirm_session_id]
        tmux.stop()
        tmux.start()
        tmux.tmux("resize-window", "-t", session, "-x", "60", "-y", "24")
        welcome = tmux.wait_for(lambda text: "欢迎使用 xiaok code" in text and has_input_prompt(text), timeout=12)
        assert_contains(welcome, "欢迎使用 xiaok code", "resume welcome screen did not render before feedback confirmation flow")

        print("--- E2E 15: completed intent can immediately hand off into another complex intent ---")
        tmux.send_text("输出30行")
        time.sleep(0.15)
        tmux.send_key("Enter")

        no_feedback_prompt = tmux.wait_for(
            lambda text: "line 30" in text and "[xiaok]" not in text and has_ready_input_prompt(text),
            timeout=20,
        )
        assert_contains(no_feedback_prompt, "line 30", "third resumed long transcript did not finish before input returned")
        assert_true(
            "[xiaok]" not in no_feedback_prompt,
            f"completed-intent feedback prompt should be disabled:\n{no_feedback_prompt}",
        )
        assert_footer_chrome_is_singular(no_feedback_prompt)

        tmux.send_text(complex_report_prompt)
        time.sleep(0.15)
        tmux.send_key("Enter")

        confirm_tool_pending = tmux.wait_for(
            lambda text: "Read 01-market-overview.md" in text and any(label in text for label in SPINNER_LABELS),
            timeout=12,
        )
        assert_intent_summary_hint(confirm_tool_pending, "md -> 报告")
        assert_activity_above_prompt_with_gap(confirm_tool_pending)
        assert_footer_chrome_is_singular(confirm_tool_pending)

        confirm_tool_second_read = tmux.wait_for(
            lambda text: "Read 02-customer-signals.txt" in text and any(label in text for label in SPINNER_LABELS),
            timeout=12,
        )
        assert_activity_above_prompt_with_gap(confirm_tool_second_read)
        assert_footer_chrome_is_singular(confirm_tool_second_read)

        confirm_tool_third_read = tmux.wait_for(
            lambda text: "Read 03-execution-risks.txt" in text and any(label in text for label in SPINNER_LABELS),
            timeout=12,
        )
        assert_activity_above_prompt_with_gap(confirm_tool_third_read)
        assert_footer_chrome_is_singular(confirm_tool_third_read)

        confirm_tool_merged_md = tmux.wait_for(
            lambda text: "E2E_FEEDBACK_CONFIRM_MERGED_MD" in text and any(label in text for label in SPINNER_LABELS),
            timeout=12,
        )
        assert_activity_above_prompt_with_gap(confirm_tool_merged_md)
        assert_footer_chrome_is_singular(confirm_tool_merged_md)

        confirm_tool_running = tmux.wait_for(
            lambda text: "E2E_FEEDBACK_CONFIRM_WRAP_BLOCK" in text and any(label in text for label in SPINNER_LABELS),
            timeout=12,
        )
        assert_activity_above_prompt_with_gap(confirm_tool_running)
        assert_footer_chrome_is_singular(confirm_tool_running)

        confirm_tool_stage_two = tmux.wait_for(
            lambda text: "E2E_FEEDBACK_CONFIRM_STAGE2_OK" in text and any(label in text for label in SPINNER_LABELS),
            timeout=12,
        )
        assert_activity_above_prompt_with_gap(confirm_tool_stage_two)
        assert_footer_chrome_is_singular(confirm_tool_stage_two)

        confirm_tool_final = tmux.wait_for(
            lambda text: "确认反馈后，三份文档已先合并为 Markdown，再生成报告。" in text and has_ready_input_prompt(text),
            timeout=20,
        )
        assert_contains(confirm_tool_final, "确认反馈后，三份文档已先合并为 Markdown，再生成报告。", "complex intent did not finish after completed intent handoff")
        assert_footer_chrome_is_singular(confirm_tool_final, allow_completed_summary=True)
        assert_true(
            "● Intent: md -> 报告 · Stage 2/2 生成报告" in confirm_tool_final and "Completed" in confirm_tool_final,
            f"completed stage 2 intent summary was not visible after the confirmed-feedback complex intent finished:\n{confirm_tool_final}",
        )

        tmux.send_text("确认反馈后继续追问")
        time.sleep(0.15)
        tmux.send_key("Enter")

        confirm_tool_followup = tmux.wait_for(
            lambda text: "echo:确认反馈后继续追问" in text and has_ready_input_prompt(text),
            timeout=20,
        )
        assert_contains(confirm_tool_followup, "echo:确认反馈后继续追问", "follow-up input did not submit after the confirmed-feedback complex intent")
        assert_footer_chrome_is_singular(confirm_tool_followup)
        assert_true(
            "● Intent:" not in confirm_tool_followup,
            f"stale intent summary leaked into the ordinary turn after completed intent handoff:\n{confirm_tool_followup}",
        )
        print("PASS: completed intent can hand off directly into a complex intent without footer loss")

        tmux.auto_mode = True
        tmux.extra_args = []
        tmux.stop()
        tmux.start()
        tmux.tmux("resize-window", "-t", session, "-x", "60", "-y", "24")
        welcome = tmux.wait_for(lambda text: "欢迎使用 xiaok code" in text and has_input_prompt(text), timeout=12)
        assert_contains(welcome, "欢迎使用 xiaok code", "welcome screen did not render before the narrow wrapped report flow")

        print("--- E2E 16: narrow complex report flow keeps footer chrome visible while changed and long ran blocks are active ---")
        tmux.send_text(complex_report_prompt)
        time.sleep(0.15)
        tmux.send_key("Enter")

        narrow_report_write = tmux.wait_for_checked(
            lambda text: "Wrote report-analysis.report.md" in text and any(label in text for label in SPINNER_LABELS),
            assert_activity_frame_keeps_footer,
            timeout=12,
        )
        assert_intent_summary_hint(narrow_report_write, "md -> 报告")
        assert_footer_chrome_is_singular(narrow_report_write)

        narrow_report_running = tmux.wait_for_checked(
            lambda text: "E2E_NARROW_WRAPPED_ANALYSIS" in text and any(label in text for label in SPINNER_LABELS),
            assert_activity_frame_keeps_footer,
            timeout=12,
        )
        assert_contains(narrow_report_running, "Wrote report-analysis.report.md", "changed block did not remain visible before the long ran block")
        assert_intent_summary_hint(narrow_report_running, "md -> 报告")
        assert_activity_above_prompt_with_gap(narrow_report_running)
        assert_footer_chrome_is_singular(narrow_report_running)

        narrow_report_final = tmux.wait_for_checked(
            lambda text: "窄终端复杂报告链路已完成。" in text and has_ready_input_prompt(text),
            assert_activity_frame_keeps_footer,
            timeout=20,
        )
        assert_contains(narrow_report_final, "窄终端复杂报告链路已完成。", "narrow wrapped report intent did not finish")
        assert_footer_chrome_is_singular(narrow_report_final, allow_completed_summary=True)

        tmux.send_text(long_report_followup_prompt)
        time.sleep(0.15)
        tmux.send_key("Enter")

        narrow_report_followup_pending = tmux.wait_for_checked(
            lambda text: (
                "复杂报告完成后请继续" in text
                and any(label in text for label in SPINNER_LABELS)
                and f"echo:{long_report_followup_prompt}" not in text
            ),
            assert_activity_frame_keeps_footer,
            timeout=8,
        )
        assert_activity_above_prompt_with_gap(narrow_report_followup_pending)
        assert_footer_chrome_is_singular(narrow_report_followup_pending)
        assert_true(
            "● Intent:" not in narrow_report_followup_pending,
            f"stale completed intent summary remained visible while the post-intent follow-up was pending:\n{narrow_report_followup_pending}",
        )

        narrow_report_followup = tmux.wait_for(
            lambda text: f"echo:{long_report_followup_prompt}" in text and has_ready_input_prompt(text),
            timeout=20,
        )
        assert_true(
            "echo:复杂报告完成后请继续" in narrow_report_followup
            and "风险、建议和下一步行动" in narrow_report_followup,
            f"follow-up input did not submit after the narrow wrapped report flow:\n{narrow_report_followup}",
        )
        assert_footer_chrome_is_singular(narrow_report_followup)
        print("PASS: narrow wrapped report flow keeps footer chrome visible during changed and ran blocks")

        tmux.auto_mode = False
        tmux.extra_args = ["chat", "--resume", feedback_resume_stress_session_id]
        tmux.stop()
        tmux.start()
        tmux.tmux("resize-window", "-t", session, "-x", "60", "-y", "24")
        welcome = tmux.wait_for(lambda text: "欢迎使用 xiaok code" in text and has_input_prompt(text), timeout=12)
        assert_contains(welcome, "欢迎使用 xiaok code", "resume welcome screen did not render before the stress footer flow")

        print("--- E2E 17: completed intent plus repeated long ran blocks keeps footer visible through the next Thinking turn ---")
        tmux.send_text("输出30行")
        time.sleep(0.15)
        tmux.send_key("Enter")

        stress_no_feedback_prompt = tmux.wait_for(
            lambda text: "line 30" in text and "[xiaok]" not in text and has_ready_input_prompt(text),
            timeout=12,
        )
        assert_footer_chrome_is_singular(stress_no_feedback_prompt)

        tmux.send_text(complex_report_prompt)
        time.sleep(0.15)
        tmux.send_key("Enter")

        stress_report_write = tmux.wait_for_checked(
            lambda text: "Wrote combined-source.report.md" in text and any(label in text for label in SPINNER_LABELS),
            assert_activity_frame_keeps_footer,
            timeout=12,
        )
        assert_contains(stress_report_write, "Wrote combined-source.report.md", "stress report write block did not render before the long ran blocks")
        assert_intent_summary_hint(stress_report_write, "md -> 报告")
        assert_activity_above_prompt_with_gap(stress_report_write)
        assert_footer_chrome_is_singular(stress_report_write)

        stress_report_running_one = tmux.wait_for_checked(
            lambda text: "  │ cd " in text and any(label in text for label in SPINNER_LABELS),
            assert_activity_frame_keeps_footer,
            timeout=16,
        )
        assert_intent_summary_hint(stress_report_running_one, "md -> 报告")
        assert_activity_above_prompt_with_gap(stress_report_running_one)
        assert_footer_chrome_is_singular(stress_report_running_one)

        stress_report_running_two = tmux.wait_for_checked(
            lambda text: (
                text.count("  │ cd ") >= 3
                and has_input_prompt(text)
                and (any(label in text for label in SPINNER_LABELS) or "高压复杂报告链路已完成。" in text)
            ),
            assert_activity_frame_keeps_footer,
            timeout=16,
        )
        assert_true(
            stress_report_running_two.count("  │ cd ") >= 3,
            f"expected at least three long ran lines to stay visible in the stress flow:\n{stress_report_running_two}",
        )
        assert_footer_chrome_is_singular(
            stress_report_running_two,
            allow_completed_summary="高压复杂报告链路已完成。" in stress_report_running_two,
        )

        stress_report_final = tmux.wait_for_checked(
            lambda text: "高压复杂报告链路已完成。" in text and has_ready_input_prompt(text),
            assert_activity_frame_keeps_footer,
            timeout=24,
        )
        assert_contains(stress_report_final, "高压复杂报告链路已完成。", "stress report flow did not finish")
        assert_footer_chrome_is_singular(stress_report_final, allow_completed_summary=True)

        tmux.send_text("高压复杂报告后继续追问")
        time.sleep(0.15)
        tmux.send_key("Enter")

        stress_followup_thinking = tmux.wait_for_checked(
            lambda text: "高压复杂报告后继续追问" in text and any(label in text for label in SPINNER_LABELS),
            assert_activity_frame_keeps_footer,
            timeout=12,
        )
        assert_activity_above_prompt_with_gap(stress_followup_thinking)
        assert_footer_chrome_is_singular(stress_followup_thinking)

        stress_followup_final = tmux.wait_for(
            lambda text: "echo:高压复杂报告后继续追问" in text and has_ready_input_prompt(text),
            timeout=20,
        )
        assert_contains(stress_followup_final, "echo:高压复杂报告后继续追问", "follow-up input did not submit after the stress report flow")
        assert_footer_chrome_is_singular(stress_followup_final)
        print("PASS: stress report flow keeps footer chrome visible during repeated ran blocks and the next Thinking turn")

        tmux.auto_mode = True
        tmux.extra_args = []
        tmux.stop()
        tmux.start()
        tmux.tmux("resize-window", "-t", session, "-x", "60", "-y", "24")
        welcome = tmux.wait_for(lambda text: "欢迎使用 xiaok code" in text and has_input_prompt(text), timeout=12)
        assert_contains(welcome, "欢迎使用 xiaok code", "welcome screen did not render before the changed-answering footer flow")

        print("--- E2E 18: long Changed block must not evict the footer during the Answering handoff ---")
        tmux.send_text(complex_report_prompt)
        time.sleep(0.15)
        tmux.send_key("Enter")

        changed_answering_handoff = tmux.wait_for_checked(
            lambda text: (
                "tesla-salesforce-enterprise-ai-sales-report.report" in text
                and (
                    "Answering" in text
                    or "我先起草报告结构，再继续补充分析。" in text
                    or "E2E_ANSWERING_AFTER_CHANGED_STAGE" in text
                    or "Running command" in text
                )
            ),
            assert_activity_frame_keeps_footer,
            timeout=16,
        )
        assert_contains(
            changed_answering_handoff,
            "tesla-salesforce-enterprise-ai-sales-report.report",
            "long changed block did not render before the Answering handoff",
        )
        assert_intent_summary_hint(changed_answering_handoff, "md -> 报告")
        assert_footer_chrome_is_singular(changed_answering_handoff)

        changed_answering_final = tmux.wait_for_checked(
            lambda text: "Changed 后进入 Answering 的复杂报告链路已完成。" in text and has_ready_input_prompt(text),
            assert_activity_frame_keeps_footer,
            timeout=20,
        )
        assert_contains(
            changed_answering_final,
            "Changed 后进入 Answering 的复杂报告链路已完成。",
            "changed-answering report flow did not finish",
        )
        assert_footer_chrome_is_singular(changed_answering_final, allow_completed_summary=True)
        tmux.send_text("Changed 后继续追问")
        time.sleep(0.15)
        tmux.send_key("Enter")

        changed_answering_followup = tmux.wait_for(
            lambda text: "echo:Changed 后继续追问" in text and has_ready_input_prompt(text),
            timeout=20,
        )
        assert_contains(
            changed_answering_followup,
            "echo:Changed 后继续追问",
            "follow-up input did not submit after the changed-answering handoff flow",
        )
        assert_footer_chrome_is_singular(changed_answering_followup)
        print("PASS: long Changed blocks preserve the footer through the Answering handoff")

        tmux.auto_mode = False
        tmux.extra_args = ["chat", "--resume", feedback_resume_freeform_session_id]
        tmux.stop()
        tmux.start()
        tmux.tmux("resize-window", "-t", session, "-x", "60", "-y", "24")
        welcome = tmux.wait_for(lambda text: "欢迎使用 xiaok code" in text and has_input_prompt(text), timeout=12)
        assert_contains(welcome, "欢迎使用 xiaok code", "resume welcome screen did not render before the feedback free-form handoff flow")

        print("--- E2E 19: free-form input after completed intent starts the next turn directly ---")
        tmux.send_text("输出30行")
        time.sleep(0.15)
        tmux.send_key("Enter")

        no_feedback_prompt = tmux.wait_for(
            lambda text: "line 30" in text and "[xiaok]" not in text and has_ready_input_prompt(text),
            timeout=20,
        )
        assert_footer_chrome_is_singular(no_feedback_prompt)

        tmux.send_text("吃什么")
        time.sleep(0.15)
        tmux.send_key("Enter")

        feedback_freeform_followup = tmux.wait_for(
            lambda text: "echo:吃什么" in text and has_ready_input_prompt(text),
            timeout=20,
        )
        assert_contains(feedback_freeform_followup, "echo:吃什么", "free-form input after completed intent was swallowed instead of becoming the next turn")
        assert_true(
            "[xiaok]" not in feedback_freeform_followup,
            f"feedback overlay remained visible after a free-form follow-up:\n{feedback_freeform_followup}",
        )
        assert_footer_chrome_is_singular(feedback_freeform_followup)
        print("PASS: free-form input after completed intent is handed off into the next turn")

        tmux.auto_mode = False
        tmux.extra_args = ["chat", "--resume", feedback_resume_ctrlc_session_id]
        tmux.stop()
        tmux.start()
        tmux.tmux("resize-window", "-t", session, "-x", "60", "-y", "24")
        welcome = tmux.wait_for(lambda text: "欢迎使用 xiaok code" in text and has_input_prompt(text), timeout=12)
        assert_contains(welcome, "欢迎使用 xiaok code", "resume welcome screen did not render before the feedback ctrl+c exit flow")

        print("--- E2E 20: ctrl+c exits after completed intent with feedback disabled ---")
        tmux.send_text("输出30行")
        time.sleep(0.15)
        tmux.send_key("Enter")

        no_feedback_prompt = tmux.wait_for(
            lambda text: "line 30" in text and "[xiaok]" not in text and has_ready_input_prompt(text),
            timeout=20,
        )
        assert_footer_chrome_is_singular(no_feedback_prompt)

        tmux.send_key("C-c")
        after_ctrlc = tmux.wait_for(
            lambda text: "已退出。" in text,
            timeout=12,
        )
        assert_true(
            "已退出。" in after_ctrlc or "再见！" in after_ctrlc,
            f"ctrl+c did not exit after completed intent:\n{after_ctrlc}",
        )
        print("PASS: ctrl+c exits cleanly after completed intent")

        tmux.auto_mode = True
        tmux.extra_args = []
        write_config(config_dir, server.base_url, model_name=narrow_footer_model)
        tmux.stop()
        tmux.start()
        tmux.tmux("resize-window", "-t", session, "-x", "40", "-y", "24")
        welcome = tmux.wait_for(lambda text: "欢迎使用 xiaok code" in text and has_input_prompt(text), timeout=12)
        assert_contains(welcome, "欢迎使用 xiaok code", "welcome screen did not render before the narrow footer regression flow")

        print("--- E2E 21: narrow footer status stays on one row and the next Enter keeps the prompt visible ---")
        tmux.send_text("长段落收尾测试")
        time.sleep(0.15)
        tmux.send_key("Enter")

        wrapped_footer_final = tmux.wait_for_checked(
            lambda text: "Swiss Modern" in text and has_ready_input_prompt(text),
            lambda text: assert_activity_frame_keeps_footer(text, narrow_footer_model),
            timeout=20,
        )
        wrapped_footer_lines = visible_lines(wrapped_footer_final)
        assert_true(
            is_input_prompt_line(wrapped_footer_lines[-2]),
            f"ready prompt was not pinned to the penultimate row in the narrow footer flow:\n{wrapped_footer_final}",
        )
        assert_true(
            narrow_footer_model in wrapped_footer_lines[-1],
            f"narrow footer status line was not pinned to the last row:\n{wrapped_footer_final}",
        )
        assert_true(
            sum(1 for line in wrapped_footer_lines if narrow_footer_model in line) == 1,
            f"narrow footer status line duplicated or wrapped in the ready state:\n{wrapped_footer_final}",
        )
        final_tail = line_before_prompt_with_gap(wrapped_footer_final, min_blank_rows=2)
        assert_true(
            "幻灯片按 F5" in final_tail or "进入演讲模式" in final_tail,
            f"final plain Chinese paragraph tail did not keep the safety gap above the input footer:\n{wrapped_footer_final}",
        )
        assert_true(
            count_occurrences(wrapped_footer_final, "两个文件均为零依赖") == 1,
            f"soft-wrapped final paragraph was duplicated near the footer:\n{wrapped_footer_final}",
        )

        tmux.send_text(wrapped_footer_followup_prompt)
        time.sleep(0.15)
        tmux.send_key("Enter")

        wrapped_footer_pending = tmux.wait_for_checked(
            lambda text: (
                wrapped_footer_followup_prompt in text
                and any(label in text for label in SPINNER_LABELS)
                and has_input_prompt(text)
            ),
            lambda text: assert_activity_frame_keeps_footer(text, narrow_footer_model),
            timeout=12,
        )
        pending_lines = visible_lines(wrapped_footer_pending)
        assert_true(
            is_input_prompt_line(pending_lines[-2]),
            f"pending prompt disappeared from the penultimate row in the narrow footer flow:\n{wrapped_footer_pending}",
        )
        assert_true(
            "Finishing response..." in pending_lines[-2],
            f"pending prompt row did not keep the busy footer text in the narrow footer flow:\n{wrapped_footer_pending}",
        )
        assert_true(
            narrow_footer_model in pending_lines[-1],
            f"pending status line was not pinned to the last row in the narrow footer flow:\n{wrapped_footer_pending}",
        )
        assert_true(
            sum(1 for line in pending_lines if narrow_footer_model in line) == 1,
            f"pending status line duplicated or wrapped in the narrow footer flow:\n{wrapped_footer_pending}",
        )

        wrapped_footer_followup = tmux.wait_for(
            lambda text: f"echo:{wrapped_footer_followup_prompt}" in text and has_ready_input_prompt(text),
            timeout=20,
        )
        followup_lines = visible_lines(wrapped_footer_followup)
        assert_contains(
            wrapped_footer_followup,
            f"echo:{wrapped_footer_followup_prompt}",
            "follow-up input did not submit after the narrow footer regression flow",
        )
        assert_true(
            is_input_prompt_line(followup_lines[-2]),
            f"ready prompt disappeared after the narrow footer follow-up turn:\n{wrapped_footer_followup}",
        )
        assert_true(
            narrow_footer_model in followup_lines[-1],
            f"ready status line was not pinned to the last row after the narrow footer follow-up turn:\n{wrapped_footer_followup}",
        )
        assert_true(
            sum(1 for line in followup_lines if narrow_footer_model in line) == 1,
            f"ready status line duplicated or wrapped after the narrow footer follow-up turn:\n{wrapped_footer_followup}",
        )
        print("PASS: narrow footer status stays singular and the next Enter keeps the prompt visible")

        write_config(config_dir, server.base_url)
        tmux.stop()
        tmux.start()
        tmux.tmux("resize-window", "-t", session, "-x", "60", "-y", "24")
        welcome = tmux.wait_for(lambda text: "欢迎使用 xiaok code" in text and has_input_prompt(text), timeout=12)
        assert_contains(welcome, "欢迎使用 xiaok code", "welcome screen did not render before the AskUserQuestion reassurance flow")

        print("--- E2E 22: AskUserQuestion waiting state must not emit reassurance progress notes ---")
        tmux.send_text(ask_user_question_prompt)
        time.sleep(0.15)
        tmux.send_key("Enter")

        ask_user_prompt = tmux.wait_for(
            lambda text: "你希望：" in text and "A) 重新生成报告" in text and has_input_prompt(text),
            timeout=20,
        )
        assert_contains(ask_user_prompt, "AskUserQuestion", "AskUserQuestion tool header did not render before the waiting-state check")
        assert_true(
            "Still working:" not in ask_user_prompt,
            f"reassurance note appeared before the AskUserQuestion prompt stabilized:\n{ask_user_prompt}",
        )

        time.sleep(22.5)
        ask_user_waiting = tmux.capture()
        assert_contains(ask_user_waiting, "你希望：", "AskUserQuestion prompt disappeared while waiting for user input")
        assert_contains(ask_user_waiting, "A) 重新生成报告", "AskUserQuestion options were not visible while waiting")
        assert_true(
            "Still working:" not in ask_user_waiting,
            f"reassurance notes kept printing while AskUserQuestion was waiting for the user:\n{ask_user_waiting}",
        )

        tmux.send_key("Enter")
        ask_user_result = tmux.wait_for(
            lambda text: "已记录你的处理偏好。" in text and has_ready_input_prompt(text),
            timeout=20,
        )
        assert_contains(ask_user_result, "已记录你的处理偏好。", "AskUserQuestion follow-up response did not render")
        print("PASS: AskUserQuestion waiting state stays quiet without reassurance spam")

        tmux.tmux("resize-window", "-t", session, "-x", "120", "-y", "24")
        print("--- E2E 23: report-to-slides intent shows stage 2 before stage 3 and filters unrelated skills ---")
        tmux.send_text(report_slide_prompt)
        time.sleep(0.15)
        tmux.send_key("Enter")

        report_slide_stage_three = tmux.wait_for_checked(
            lambda text: (
                "Wrote salesforce-ai-evolution-slides.html" in text
                and "● Intent: md -> 报告 -> 幻灯片 · Stage 3/3 生成幻灯片" in latest_intent_summary_line(text)
                and "Skill: kai-slide-creator" in latest_intent_summary_line(text)
                and has_input_prompt(text)
            ),
            assert_activity_frame_keeps_footer,
            timeout=24,
        )
        assert_true(
            "skill-creator" not in latest_intent_summary_line(report_slide_stage_three),
            f"unrelated skill-creator leaked into the slide stage summary:\n{report_slide_stage_three}",
        )
        assert_footer_chrome_is_singular(report_slide_stage_three)

        report_slide_final = tmux.wait_for_checked(
            lambda text: (
                "三阶段报告幻灯片链路已完成。" in text
                and "╭─ Stages" in text
                and "Stage 2/3 生成报告 · Skill: kai-report-creator · Completed" in text
                and "Stage 3/3 生成幻灯片 · Skill: kai-slide-creator · Completed" in text
                and has_ready_input_prompt(text)
            ),
            assert_activity_frame_keeps_footer,
            timeout=24,
        )
        assert_true(
            "Stage 2/3 生成报告 · Skill: kai-report-creator · Completed" in report_slide_final,
            f"final report-to-slides screen did not keep the report stage visible:\n{report_slide_final}",
        )
        assert_true(
            "● Intent: md -> 报告 -> 幻灯片 · Stage 3/3 生成幻灯片" in latest_intent_summary_line(report_slide_final)
            and "Skill: kai-slide-creator" in latest_intent_summary_line(report_slide_final)
            and "Completed" in latest_intent_summary_line(report_slide_final),
            f"completed report-to-slides summary did not show the final slide stage:\n{report_slide_final}",
        )
        assert_true(
            "skill-creator" not in latest_intent_summary_line(report_slide_final),
            f"unrelated skill-creator leaked into the final report-to-slides summary:\n{report_slide_final}",
        )
        assert_true(
            "Stage 3/3 生成幻灯片" in line_before_prompt_with_gap(report_slide_final, min_blank_rows=2),
            f"completed stage summary did not keep the safety gap above the input footer:\n{report_slide_final}",
        )
        assert_contains(report_slide_final, "Swiss Modern", "final wrapped report/slide tail was not visible")
        assert_footer_chrome_is_singular(report_slide_final, allow_completed_summary=True)
        print("PASS: report-to-slides intent shows stage 2, then stage 3, without unrelated skill names")

        print("--- E2E 24: path-first local source still shows an intent summary ---")
        tmux.send_text(path_first_report_slide_prompt)
        time.sleep(0.15)
        tmux.send_key("Enter")

        path_first_final = tmux.wait_for_checked(
            lambda text: (
                "路径开头报告幻灯片任务已完成。" in text
                and "● Intent: 报告 -> 幻灯片 · Stage 2/2 生成幻灯片" in latest_intent_summary_line(text)
                and "Completed" in latest_intent_summary_line(text)
                and has_ready_input_prompt(text)
            ),
            assert_activity_frame_keeps_footer,
            timeout=20,
        )
        assert_true(
            "找不到 skill" not in path_first_final,
            f"path-first local source was treated as a slash skill:\n{path_first_final}",
        )
        assert_true(
            "Stage 2/2 生成幻灯片" in line_before_prompt_with_gap(path_first_final, min_blank_rows=2),
            f"path-first completed intent summary did not keep the safety gap above the input footer:\n{path_first_final}",
        )
        assert_footer_chrome_is_singular(path_first_final, allow_completed_summary=True)
        print("PASS: path-first local source still shows an intent summary")

        print("--- E2E 25: file-url report-creator follow-up keeps busy footer during intent-created Thinking frame ---")
        tmux.send_text(file_url_report_creator_prompt)
        time.sleep(0.15)
        tmux.send_key("Enter")

        file_url_thinking = tmux.wait_for_checked(
            lambda text: (
                "🤝 已理解" in text
                and "report-creator" in text
                and "Thinking" in text
                and has_input_prompt(text)
                and "这是 report-creator 生成物检查结果。" not in text
            ),
            assert_activity_frame_keeps_footer,
            timeout=12,
        )
        file_url_lines = visible_lines(file_url_thinking)
        assert_true(
            is_input_prompt_line(file_url_lines[-2]),
            f"file-url intent Thinking frame did not keep the prompt pinned to the penultimate row:\n{file_url_thinking}",
        )
        assert_true(
            "gpt-terminal-e2e" in file_url_lines[-1],
            f"file-url intent Thinking frame did not keep the status pinned to the final row:\n{file_url_thinking}",
        )
        assert_footer_chrome_is_singular(file_url_thinking)

        file_url_final = tmux.wait_for_checked(
            lambda text: (
                "这是 report-creator 生成物检查结果。" in text
                and has_ready_input_prompt(text)
            ),
            assert_activity_frame_keeps_footer,
            timeout=20,
        )
        assert_footer_chrome_is_singular(file_url_final, allow_completed_summary=True)
        print("PASS: file-url report-creator follow-up keeps busy footer during intent-created Thinking frame")

        write_config(config_dir, server.base_url)
        tmux.stop()
        tmux = TmuxHarness(
            session,
            project_fixture,
            config_dir,
            home_dir,
            cli_entry,
            tmux_bin,
            env_overrides={
                "XIAOK_E2E_ACTIVITY_LABEL_FACTOR": "120",
            },
        )
        tmux.start(cols=80, rows=18)
        welcome = tmux.wait_for(lambda text: "欢迎使用 xiaok code" in text and has_input_prompt(text), timeout=12)
        assert_contains(welcome, "欢迎使用 xiaok code", "welcome screen did not render before the long markdown flow")

        print("--- E2E 26: long markdown report-to-slides chain keeps footer during explored/finalizing pressure ---")
        tmux.send_text(long_markdown_report_slide_prompt)
        time.sleep(0.15)
        tmux.send_key("Enter")

        long_markdown_explored = tmux.wait_for_checked(
            lambda text: (
                "Read js-engine.md" in text
                and "Explored" in text
                and has_input_prompt(text)
            ),
            assert_activity_frame_keeps_footer,
            timeout=45,
        )
        assert_footer_chrome_is_singular(long_markdown_explored)
        assert_true(
            "Read brief-template.json" in long_markdown_explored
            or "Read style-index.md" in long_markdown_explored
            or "Read enterprise-dark.md" in long_markdown_explored
            or "Read html-template.md" in long_markdown_explored
            or "Read base-css.md" in long_markdown_explored
            or "Read js-engine.md" in long_markdown_explored,
            f"long markdown slide skill exploration did not render template reads:\n{long_markdown_explored}",
        )

        long_markdown_finalizing = tmux.wait_for_checked(
            lambda text: (
                "Finalizing response" in text
                and has_input_prompt(text)
            ),
            assert_activity_frame_keeps_footer,
            timeout=20,
        )
        assert_footer_chrome_is_singular(long_markdown_finalizing)

        long_markdown_final = tmux.wait_for_checked(
            lambda text: (
                "长 Markdown 报告和幻灯片链路已完成。" in text
                and "● Intent: 报告 -> 幻灯片 · Stage 2/2 生成幻灯片" in latest_intent_summary_line(text)
                and "Completed" in latest_intent_summary_line(text)
                and has_ready_input_prompt(text)
            ),
            assert_activity_frame_keeps_footer,
            timeout=45,
        )
        assert_true(
            line_before_prompt_with_gap(long_markdown_final, min_blank_rows=2).strip(),
            f"long markdown completed summary did not keep the safety gap above the input footer:\n{long_markdown_final}",
        )
        assert_true(
            "Stage 2/2 生成幻灯片" in latest_intent_summary_line(long_markdown_final),
            f"long markdown completed summary did not show the final slide stage:\n{long_markdown_final}",
        )
        assert_footer_chrome_is_singular(long_markdown_final, allow_completed_summary=True)
        print("PASS: long markdown report-to-slides chain keeps footer during explored/finalizing pressure")

        print("--- E2E Summary ---")
        print(f"Requests observed by fake OpenAI server: {len(server.requests)}")
        assert_true(len(server.requests) >= 89, "expected at least eighty-nine model requests")
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
