#!/usr/bin/env python3
"""Actual CLI TTY: one /mode entry selects modes and changes live tool authority."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import re
import tempfile
import time


def run(entry):
    spec = importlib.util.spec_from_file_location('helpers', Path(__file__).with_name('tmux-e2e.py'))
    h = importlib.util.module_from_spec(spec); spec.loader.exec_module(h)
    root = Path(tempfile.mkdtemp(prefix='xiaok-mode-selector-'))
    work, config, home = root / 'project', root / 'config', root / 'home'
    work.mkdir(); home.mkdir()
    written, denied = work / 'selected-yolo.txt', work / 'selected-plan.txt'
    server = h.FakeOpenAIServer([
        h.tool_call_response_events('write', {'file_path': str(written), 'content': 'MODE_SELECTION_VERIFIED'}, 'selected_yolo'),
        'YOLO_SELECTION_DONE',
        h.tool_call_response_events('write', {'file_path': str(denied), 'content': 'MUST_NOT_WRITE'}, 'selected_plan'),
        'PLAN_SELECTION_DONE',
    ], first_token_delay=.05)
    socket = f'xiaok-mode-selector-{os.getpid()}'
    class IsolatedTmux(h.TmuxHarness):
        def tmux(self, *args, **kwargs): return super().tmux('-L', socket, *args, **kwargs)
    tty = IsolatedTmux('mode', work, config, home, entry, h.resolve_tmux_binary(),
        env_overrides={'XIAOK_DISABLE_GLOBAL_PLUGINS': '1', 'NO_COLOR': ''})
    owned = []
    def wait_for(predicate):
        screen = tty.wait_for(predicate, timeout=20)
        assert predicate(screen), f'Inspect {root}'
        return screen
    def open_mode(current):
        tty.send_text('/mode'); tty.send_key('Enter')
        return wait_for(lambda s: f'选择权限模式（当前：{current}）' in s)
    def changed(mode):
        return wait_for(lambda s: f'权限模式已切换为 {mode}' in s and h.has_ready_input_prompt(s))
    try:
        server.start(); h.write_config(config, server.base_url, 'gpt-4o')
        tty.start(cols=110, rows=30)
        owned.append(int(tty.tmux('display-message', '-p', '-t', tty.session, '#{pane_pid}').stdout))
        wait_for(h.has_ready_input_prompt)
        tty.send_text('/mod')
        screen = wait_for(lambda s: '/models' in s and '/mode' in s)
        assert len([line for line in screen.splitlines() if re.search(r'/mode(?:\s|$)', line)]) == 1
        assert not any('/mode ' + mode in screen for mode in ['default', 'auto', 'plan', 'yolo'])
        tty.send_key('C-u'); wait_for(h.has_ready_input_prompt)
        open_mode('auto')
        tty.tmux('resize-window', '-t', tty.session, '-x', '40', '-y', '12')
        wait_for(lambda s: '❯ 2. auto' in s)
        tty.send_key('Down'); tty.send_key('Down')
        wait_for(lambda s: '❯ 4. yolo' in s)
        tty.tmux('resize-window', '-t', tty.session, '-x', '110', '-y', '30')
        wait_for(lambda s: '选择权限模式' in s and '❯ 4. yolo' in s)
        tty.send_key('Enter'); changed('yolo')
        open_mode('yolo'); tty.send_key('Escape')
        wait_for(lambda s: '已取消模式切换' in s and h.has_ready_input_prompt(s))
        tty.send_text('Write the synthetic allowed fixture'); tty.send_key('Enter')
        wait_for(lambda s: 'YOLO_SELECTION_DONE' in s and h.has_ready_input_prompt(s))
        assert written.read_text() == 'MODE_SELECTION_VERIFIED'
        open_mode('yolo'); tty.send_text('3'); changed('plan')
        tty.send_text('Try the synthetic restricted fixture'); tty.send_key('Enter')
        wait_for(lambda s: 'PLAN_SELECTION_DONE' in s and h.has_ready_input_prompt(s))
        assert not denied.exists(), 'plan selection did not change live tool authority'
        open_mode('plan'); tty.send_text('1'); changed('default')
        open_mode('default'); tty.send_text('2'); changed('auto')
        (root / 'final.txt').write_text(tty.capture())
        tty.send_text('/exit'); tty.send_key('Enter'); time.sleep(.5)
        (root / 'result.json').write_text(json.dumps({'passed': True, 'singleSlashEntry': True,
            'arrowSelection': True, 'numericSelection': True, 'cancelPreservedMode': True, 'tinyResize': True,
            'yoloWriteExecuted': True, 'planWriteDenied': True, 'entry': str(entry)}, indent=2))
        print('PASS: one /mode entry; selector/cancel; all four modes; live yolo write and plan denial')
    finally:
        tty.stop(); server.close(); remaining = list(owned); deadline = time.monotonic() + 5
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
