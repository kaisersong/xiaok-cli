#!/usr/bin/env python3
"""Real CLI/PTY + local SSE server: submitted images and read images reach the wire.

tmux deliberately exercises the safe text fallback, not GPU graphics rendering.
Use inline-image-display.mjs separately in Ghostty for visual placement checks.
"""
import importlib.util
import shutil
import tempfile
import time
from pathlib import Path


def run(project: Path) -> None:
    spec = importlib.util.spec_from_file_location("image_tmux_helpers", Path(__file__).with_name("tmux-e2e.py"))
    helpers = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helpers)
    root = Path(tempfile.mkdtemp(prefix="xiaok-image-wire-e2e-"))
    work, config, home = root / "project", root / "config", root / "home"
    work.mkdir(); home.mkdir()
    image = work / "screen.png"
    shutil.copy2(project / "tests/fixtures/images/read-image.png", image)
    server = helpers.FakeOpenAIServer([
        "IMAGE_SUBMITTED\n" + "\n".join(f"IMAGE_REPLY_{i}" for i in range(25)),
        helpers.tool_call_response_events("read", {"file_path": str(image)}, "read_screen"),
        "READ_IMAGE_RECEIVED",
    ], first_token_delay=0.05)
    tmux = helpers.TmuxHarness(f"xiaok-image-wire-{int(time.time()*1000)}", work, config, home, project / "dist/index.js", helpers.resolve_tmux_binary(), env_overrides={"XIAOK_DISABLE_GLOBAL_PLUGINS": "1"})
    try:
        server.start(); helpers.write_config(config, server.base_url, "gpt-4o")
        tmux.start()
        welcome = tmux.wait_for(helpers.has_input_prompt, timeout=15)
        assert helpers.has_input_prompt(welcome), welcome
        tmux.send_text(str(image)); tmux.send_key("Enter")
        output = tmux.wait_for(lambda text: "IMAGE_REPLY_24" in text and helpers.has_ready_input_prompt(text), timeout=20)
        assert "IMAGE_REPLY_24" in output and helpers.has_ready_input_prompt(output), output
        first = server.requests[0]
        assert any(part.get("type") == "image_url" for message in first["messages"] if isinstance(message.get("content"), list) for part in message["content"]), first
        print("PASS: submitted image reaches real OpenAI-compatible request and long reply keeps the footer")
        tmux.send_text(f"read screen from {image}"); tmux.send_key("Enter")
        output = tmux.wait_for(lambda text: "READ_IMAGE_RECEIVED" in text and helpers.has_ready_input_prompt(text), timeout=20)
        assert "READ_IMAGE_RECEIVED" in output and helpers.has_ready_input_prompt(output), output
        messages = server.requests[-1]["messages"]
        index = next(i for i, m in enumerate(messages) if m.get("role") == "tool" and m.get("tool_call_id") == "read_screen")
        assert not messages[index]["content"].startswith("Error:"), messages[index]
        assert messages[index + 1]["role"] == "user", messages[index + 1]
        parts = messages[index + 1]["content"]
        assert any(part.get("type") == "image_url" and part["image_url"]["url"].startswith("data:image/png;base64,") for part in parts), parts
        print("PASS: real read result is followed by a visual image in the next model request")
        tmux.send_text("KEEP_DRAFT")
        output = tmux.wait_for(lambda text: "KEEP_DRAFT" in text, timeout=5)
        assert "KEEP_DRAFT" in output and "gpt-4o" in output, output
        print("PASS: input remains editable after the image tool turn")
    finally:
        tmux.stop(); server.close(); shutil.rmtree(root)


if __name__ == "__main__":
    run(Path(__file__).resolve().parents[2])
