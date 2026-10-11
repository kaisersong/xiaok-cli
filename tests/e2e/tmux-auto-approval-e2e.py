#!/usr/bin/env python3
"""Real CLI + local SSE: auto approvals keep data-loss checks and numbered choices."""
import argparse
import importlib.util
import shutil
import tempfile
import time
from pathlib import Path


def run(project: Path, cli_entry: Path | None = None) -> None:
    spec = importlib.util.spec_from_file_location("approval_tmux_helpers", Path(__file__).with_name("tmux-e2e.py"))
    helpers = importlib.util.module_from_spec(spec); spec.loader.exec_module(helpers)
    root = Path(tempfile.mkdtemp(prefix="xiaok-auto-approval-e2e-"))
    work, config, home = root / "project", root / "config", root / "home"
    work.mkdir(); home.mkdir()
    allowed, denied = work / "allowed-build", work / "denied-build"
    allowed.mkdir(); denied.mkdir()
    (allowed / "sentinel").write_text("allowed", encoding="utf-8")
    (denied / "sentinel").write_text("keep", encoding="utf-8")
    ordinary = f'S="{work}"; cd "$S"; export APPROVAL_E2E=test; printf AUTO_SAFE_OK'
    server = helpers.FakeOpenAIServer([
        helpers.tool_call_response_events("bash", {"command": ordinary}, "safe_cmd"), "SAFE_DONE",
        helpers.tool_call_response_events("bash", {"command": "rm -rf ./allowed-build"}, "delete_cmd"), "DELETE_DONE",
        helpers.tool_call_response_events("bash", {"command": "rm -rf ./denied-build"}, "deny_cmd"), "DENY_DONE",
    ], first_token_delay=0.05)
    tmux = helpers.TmuxHarness(f"xiaok-auto-approval-{int(time.time()*1000)}", work, config, home,
                              cli_entry or project / "dist/index.js", helpers.resolve_tmux_binary(),
                              env_overrides={"XIAOK_DISABLE_GLOBAL_PLUGINS": "1"})
    try:
        server.start(); helpers.write_config(config, server.base_url)
        tmux.start(); tmux.wait_for(helpers.has_input_prompt, timeout=15)
        tmux.send_text("ordinary auto command"); tmux.send_key("Enter")
        output = tmux.wait_for(lambda text: "SAFE_DONE" in text and helpers.has_ready_input_prompt(text), timeout=20)
        assert "xiaok 想要执行以下操作" not in output, output
        result = next(m for m in server.requests[1]["messages"] if m.get("tool_call_id") == "safe_cmd")
        assert "AUTO_SAFE_OK" in result["content"], result
        print("PASS: auto environment setup and normal shell command run without approval")

        for request_text, reply, digit, target, should_delete in [
            ("delete the isolated allowed fixture", "DELETE_DONE", "1", allowed, True),
            ("reject deleting the isolated denied fixture", "DENY_DONE", "5", denied, False),
        ]:
            tmux.send_text(request_text); tmux.send_key("Enter")
            output = tmux.wait_for(lambda text: "确认原因: auto 模式仍需确认：递归强制删除" in text, timeout=15)
            for number in range(1, 6): assert f"{number}. " in output, output
            assert "数字直选" in output, output
            assert (target / "sentinel").exists(), "deleted before approval"
            tmux.send_text(digit)  # No Enter: one digit is the decision.
            output = tmux.wait_for(lambda text: reply in text and helpers.has_ready_input_prompt(text), timeout=20)
            assert "xiaok 想要执行以下操作" not in output, output
            assert target.exists() != should_delete, f"wrong decision for {digit}"
            print(f"PASS: auto destructive confirmation explains its reason; digit {digit} acts immediately")
        tmux.send_text("KEEP_DRAFT")
        output = tmux.wait_for(lambda text: "KEEP_DRAFT" in text, timeout=5)
        assert "KEEP_DRAFT" in output, output
        print("PASS: input stays editable after approval and denial")
    finally:
        tmux.stop(); server.close(); shutil.rmtree(root)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--project-dir", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--cli-entry", type=Path)
    options = parser.parse_args(); run(options.project_dir.resolve(), options.cli_entry)
