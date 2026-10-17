#!/usr/bin/env python3
"""Installed CLI TTY: remember all four modes across exit, new chat and resume."""
import argparse
import importlib.util
import json
import os
import subprocess
from pathlib import Path
import tempfile
import time


def run(entry):
    spec = importlib.util.spec_from_file_location('helpers', Path(__file__).with_name('tmux-e2e.py'))
    h = importlib.util.module_from_spec(spec); spec.loader.exec_module(h)
    root = Path(tempfile.mkdtemp(prefix='xiaok-mode-persistence-'))
    work, config, home = [root / name for name in ['project', 'config', 'home']]
    work.mkdir(); home.mkdir()
    target = work / 'synthetic-output.txt'
    server = h.FakeOpenAIServer([
        h.tool_call_response_events('write', {'file_path': str(target), 'content': 'RESTORED_YOLO'}, 'restored'),
        'RESTORED_MODE_AUTHORITY_OK',
        h.tool_call_response_events('bash', {'command': 'echo mkfs'}, 'non_tty'),
        'NON_TTY_MODE_CHECK_OK',
    ], first_token_delay=.05)
    socket = f'xiaok-mode-persistence-{os.getpid()}'
    class IsolatedTmux(h.TmuxHarness):
        def tmux(self, *args, **kwargs): return super().tmux('-L', socket, *args, **kwargs)
    tty = IsolatedTmux('mode', work, config, home, entry, h.resolve_tmux_binary(), auto_mode=False,
        env_overrides={'XIAOK_DISABLE_GLOBAL_PLUGINS': '1', 'NO_COLOR': ''})
    owned = []; older = None
    def wait_for(predicate):
        screen = tty.wait_for(predicate, timeout=20)
        (root / 'last-screen.txt').write_text(screen)
        assert predicate(screen), f'Inspect {root}'
        return screen
    def send(text): tty.send_text(text); tty.send_key('Enter')
    def start(args=None):
        tty.extra_args = args or []; tty.start(cols=115, rows=30)
        owned.append(int(tty.tmux('display-message', '-p', '-t', tty.session, '#{pane_pid}').stdout))
        wait_for(h.has_ready_input_prompt)
    def inspect(mode):
        send('/mode'); wait_for(lambda s: f'选择权限模式（当前：{mode}）' in s)
        tty.send_key('Escape'); wait_for(h.has_ready_input_prompt)
    def choose(mode):
        send('/mode'); wait_for(lambda s: '选择权限模式' in s)
        tty.send_text(str(['default', 'auto', 'plan', 'yolo'].index(mode) + 1))
        wait_for(lambda s: f'权限模式已切换为 {mode}' in s and h.has_ready_input_prompt(s))
    def stop():
        send('/exit'); time.sleep(.5); tty.stop()
    try:
        server.start(); h.write_config(config, server.base_url, 'gpt-4o')
        original_config = (config / 'config.json').read_bytes()
        for mode in ['default', 'auto', 'plan', 'yolo']:
            start(); choose(mode); stop()
            start(); inspect(mode); stop()
        start(); inspect('yolo'); send('Write the synthetic fixture using restored authority')
        wait_for(lambda s: 'RESTORED_MODE_AUTHORITY_OK' in s and h.has_ready_input_prompt(s))
        assert target.read_text() == 'RESTORED_YOLO'
        session = max((config / 'sessions').glob('sess_*.json'), key=lambda p: p.stat().st_mtime)
        session_id = json.loads(session.read_text())['sessionId']; stop()
        start(['--resume', session_id]); inspect('yolo'); stop()
        start(['--auto']); inspect('auto'); stop()
        start(); inspect('auto')
        tty.send_text('DRAFT_中文'); tty.send_key('BTab')
        wait_for(lambda s: 'DRAFT_中文' in s and 'plan' in s)
        assert json.loads((config / 'cli-permission-mode.json').read_text())['mode'] == 'plan'
        tty.send_key('C-u'); wait_for(h.has_ready_input_prompt); stop()
        start(); inspect('plan'); stop()
        # An old window must not write its stale mode over the latest choice.
        start(); inspect('plan')
        older = IsolatedTmux('older', work, config, home, entry, h.resolve_tmux_binary(), auto_mode=False,
            env_overrides={'XIAOK_DISABLE_GLOBAL_PLUGINS': '1', 'NO_COLOR': ''})
        older.start(cols=115, rows=30)
        owned.append(int(older.tmux('display-message', '-p', '-t', older.session, '#{pane_pid}').stdout))
        assert h.has_ready_input_prompt(older.wait_for(h.has_ready_input_prompt, timeout=20))
        choose('auto'); stop()
        older.send_text('/exit'); older.send_key('Enter'); time.sleep(.5); older.stop()
        start(); inspect('auto'); stop()
        start(['--yolo']); inspect('yolo'); stop()

        assert (config / 'config.json').read_bytes() == original_config
        assert json.loads((config / 'cli-permission-mode.json').read_text())['mode'] == 'yolo'
        before = (config / 'cli-permission-mode.json').read_bytes()
        non_tty = subprocess.run(['node', str(entry), '--print', 'Run the inert permission fixture'], cwd=work,
            env={**os.environ, 'HOME': str(home), 'XIAOK_CONFIG_DIR': str(config), 'XIAOK_DISABLE_GLOBAL_PLUGINS': '1'},
            capture_output=True, text=True, timeout=30)
        assert non_tty.returncode == 0 and 'NON_TTY_MODE_CHECK_OK' in non_tty.stdout, non_tty.stderr
        replies = [m.get('content', '') for m in server.requests[-1]['messages'] if m.get('role') == 'tool']
        assert replies and any('权限不足' in reply or '拦截' in reply for reply in replies), replies
        assert (config / 'cli-permission-mode.json').read_bytes() == before

        (root / 'result.json').write_text(json.dumps({'passed': True, 'allFourModes': True,
            'newChat': True, 'resume': True, 'explicitFlags': True, 'keyboardCycle': True,
            'nonTtyDoesNotInheritOrOverwrite': True, 'staleWindowExitPreservedLatest': True, 'configPreserved': True, 'restoredYoloWriteExecuted': True, 'entry': str(entry)}, indent=2))
        print('PASS: four modes persist; new chat/resume; flags; keyboard; restored YOLO actually writes')
    finally:
        tty.stop();
        if older: older.stop()
        server.close(); remaining = list(owned); deadline = time.monotonic() + 5
        while remaining and time.monotonic() < deadline:
            alive = []
            for pid in remaining:
                try: os.kill(pid, 0); alive.append(pid)
                except ProcessLookupError: pass
            remaining = alive
            if remaining: time.sleep(.05)
        (root / 'owned-pids.json').write_text(json.dumps({'pids': owned, 'remaining': remaining}))
        print(f'CLEANUP: owned CLI processes remaining={len(remaining)}; local SSE closed')
        print('EVIDENCE', root); assert not remaining


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--cli-entry', type=Path)
    args = parser.parse_args()
    run((args.cli_entry or Path(__file__).resolve().parents[2] / 'dist/index.js').resolve())
