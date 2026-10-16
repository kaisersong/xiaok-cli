#!/usr/bin/env python3
"""Real CLI: code aligns with prose in streaming and resume; shell copy works."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time


def run(entry: Path):
    spec = importlib.util.spec_from_file_location('helpers', Path(__file__).with_name('tmux-e2e.py'))
    helpers = importlib.util.module_from_spec(spec); spec.loader.exec_module(helpers)
    root = Path(tempfile.mkdtemp(prefix='xiaok-code-indent-'))
    work, config, home = root / 'project', root / 'config', root / 'home'
    work.mkdir(); home.mkdir()
    command = "printf '%s' 'code_copy_ok' | tr 'a-z' 'A-Z' > copied.txt"
    answer = ('Intro\nContinuation\n```rust\nplatform.on_change(|| {\n    callback();\n\n});\n```\n'
        '```bash\n' + command + '\n```\nTAIL_MARKER')
    events = [{'choices': [{'index': 0, 'delta': {'content': char}, 'finish_reason': None}]} for char in answer]
    events.append({'choices': [{'index': 0, 'delta': {}, 'finish_reason': 'stop'}]})
    server = helpers.FakeOpenAIServer([events, 'NEXT_TURN_OK'], first_token_delay=0.05)
    socket = f'xiaok-code-indent-{os.getpid()}'

    class IsolatedTmux(helpers.TmuxHarness):
        def tmux(self, *args, **kwargs): return super().tmux('-L', socket, *args, **kwargs)

    tty = IsolatedTmux('code-indent', work, config, home, entry, helpers.resolve_tmux_binary(),
        auto_mode=False, env_overrides={'XIAOK_DISABLE_GLOBAL_PLUGINS': '1'})
    owned = []

    def wait_for(predicate, name):
        screen = tty.wait_for(predicate, timeout=20); (root / f'{name}.txt').write_text(screen)
        assert predicate(screen), f'{name} failed; inspect {root}'

    def start():
        tty.start(cols=120, rows=40)
        owned.append(int(tty.tmux('display-message', '-p', '-t', tty.session, '#{pane_pid}').stdout))
        wait_for(helpers.has_ready_input_prompt, f'ready-{len(owned)}')

    def check_layout(name):
        history = tty.tmux('capture-pane', '-p', '-J', '-S', '-', '-t', tty.session).stdout
        (root / f'{name}.txt').write_text(history)
        lines = history.splitlines()
        assert '  Continuation' in lines
        assert '  platform.on_change(|| {' in lines
        assert '      callback();' in lines
        assert '  });' in lines
        copied = next(line for line in lines if command in line)
        assert copied == '  ' + command
        subprocess.run(['sh', '-c', copied], cwd=work, check=True)
        assert (work / 'copied.txt').read_text() == 'CODE_COPY_OK'

    def exit_session():
        tty.send_key('C-u'); tty.send_text('/exit'); tty.send_key('Enter'); time.sleep(1)
        session = next((config / 'sessions').glob('sess_*.json'))
        saved = json.loads(session.read_text())
        assert saved['intentDelegation']['ownership']['state'] == 'released'
        assert any(m['role'] == 'assistant' and any(b.get('text') == answer for b in m['content']) for m in saved['messages'])
        tty.stop(); return saved

    try:
        server.start(); helpers.write_config(config, server.base_url, 'gpt-4o')
        settings = json.loads((config / 'config.json').read_text())
        settings.update({'memory': {'enabled': False}, 'automations': {'enabled': False}, 'intentBoundary': {'enabled': False}})
        (config / 'config.json').write_text(json.dumps(settings))
        start(); tty.send_text('Show the synthetic code sample'); tty.send_key('Enter')
        wait_for(lambda s: 'TAIL_MARKER' in s and helpers.has_ready_input_prompt(s), 'streamed')
        check_layout('streamed-layout')
        tty.send_text('DRAFT_KEEP')
        wait_for(lambda s: '❯ DRAFT_KEEP' in s, 'draft-preserved')
        saved = exit_session()
        tty.extra_args = ['--resume', saved['sessionId']]
        start(); check_layout('resumed-layout')
        tty.send_text('Continue'); tty.send_key('Enter')
        wait_for(lambda s: 'NEXT_TURN_OK' in s and helpers.has_ready_input_prompt(s), 'next-turn')
        assert any(m.get('role') == 'assistant' and m.get('content') == answer for m in server.requests[-1]['messages'])
        exit_session()
        (root / 'result.json').write_text(json.dumps({'passed': True, 'entry': str(entry),
            'streamAndResumeAligned': True, 'sourceIndentPreserved': True, 'copiedCommandExecuted': True,
            'draftPreserved': True, 'modelAndStoredSourceUnchanged': True}, indent=2))
        print('PASS: code/prose alignment in streaming and resume; copied shell command; draft and raw source preserved')
    finally:
        tty.stop(); server.close(); remaining = list(owned); deadline = time.monotonic() + 5
        while remaining and time.monotonic() < deadline:
            alive = []
            for pid in remaining:
                try: os.kill(pid, 0); alive.append(pid)
                except ProcessLookupError: pass
            remaining = alive
            if remaining: time.sleep(0.05)
        (root / 'owned-pids.json').write_text(json.dumps({'pids': owned, 'remaining': remaining}))
        print(f'CLEANUP: owned CLI processes remaining={len(remaining)}; local SSE closed')
        print('EVIDENCE', root); assert not remaining


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--project-dir', type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument('--cli-entry', type=Path)
    args = parser.parse_args()
    run((args.cli_entry or args.project_dir / 'dist/index.js').resolve())
