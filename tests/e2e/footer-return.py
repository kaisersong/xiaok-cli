#!/usr/bin/env python3
"""Real CLI TTY: idle resize retains history and one editable footer."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import re
import tempfile
import time


def gray_rows(screen):
    bg = None; painted = []
    for index, line in enumerate(screen.splitlines()):
        has_bg = False
        for part in re.split(r'(\x1b\[[0-9;]*m)', line):
            if part.startswith('\x1b['):
                values = [int(n or '0') for n in part[2:-1].split(';')]; i = 0
                while i < len(values):
                    code = values[i]
                    if code in (0, 49): bg = None
                    elif code in (38, 48) and i + 1 < len(values):
                        count = 3 if values[i + 1] == 5 else 5
                        if code == 48: bg = values[i + 2] if count == 3 else None
                        i += count; continue
                    i += 1
            elif part and bg == 238: has_bg = True
        if has_bg: painted.append(index)
    return painted


def run(entry):
    spec = importlib.util.spec_from_file_location('helpers', Path(__file__).with_name('tmux-e2e.py'))
    h = importlib.util.module_from_spec(spec); spec.loader.exec_module(h)
    root = Path(tempfile.mkdtemp(prefix='xiaok-footer-return-'))
    work, config, home = root / 'project', root / 'config', root / 'home'
    work.mkdir(); home.mkdir()
    answer = '\n'.join(f'PRESERVED_LINE_{i:03d}' for i in range(75)) + '\nFINAL_RESPONSE_MARKER'
    server = h.FakeOpenAIServer([answer, 'NEXT_TURN_CONFIRMED'], first_token_delay=0.05)
    socket = f'xiaok-footer-return-{os.getpid()}'

    class IsolatedTmux(h.TmuxHarness):
        def tmux(self, *args, **kwargs): return super().tmux('-L', socket, *args, **kwargs)

    tty = IsolatedTmux('footer', work, config, home, entry, h.resolve_tmux_binary(),
        env_overrides={'XIAOK_DISABLE_GLOBAL_PLUGINS': '1', 'NO_COLOR': ''})
    owned = []

    def wait_for(predicate):
        screen = tty.wait_for(predicate, timeout=20); assert predicate(screen), f'Inspect {root}'
        return screen

    try:
        server.start(); h.write_config(config, server.base_url, 'gpt-4o')
        settings = json.loads((config / 'config.json').read_text())
        settings.update({'memory': {'enabled': False}, 'automations': {'enabled': False}, 'intentBoundary': {'enabled': False}})
        (config / 'config.json').write_text(json.dumps(settings))
        tty.start(cols=110, rows=60)
        owned.append(int(tty.tmux('display-message', '-p', '-t', tty.session, '#{pane_pid}').stdout))
        wait_for(h.has_ready_input_prompt)
        tty.send_text('Fill the synthetic transcript'); tty.send_key('Enter')
        wait_for(lambda s: 'FINAL_RESPONSE_MARKER' in s and h.has_ready_input_prompt(s))
        tty.send_text('DRAFT_中文'); wait_for(lambda s: 'DRAFT_中文' in s)
        (root / 'before-history.txt').write_text(tty.tmux('capture-pane', '-p', '-t', tty.session, '-S', '-2000').stdout)
        for index, (cols, rows) in enumerate([(65, 24), (110, 60), (40, 20), (100, 34), (55, 24), (110, 40)]):
            tty.tmux('resize-window', '-t', tty.session, '-x', str(cols), '-y', str(rows)); time.sleep(0.25)
            screen = tty.capture(ansi=True); (root / f'{index}-{cols}-{rows}.ansi').write_text(screen)
            assert screen.count('DRAFT_中文') == 1, f'duplicate/missing draft at {cols}x{rows}'
            painted = gray_rows(screen)
            assert len(painted) <= 3 and (not painted or painted == list(range(min(painted), max(painted) + 1))), f'stale footer bands: {painted}'
            history = tty.tmux('capture-pane', '-p', '-t', tty.session, '-S', '-2000').stdout
            (root / f'{index}-history.txt').write_text(history)
            assert 'PRESERVED_LINE_000' in history and 'FINAL_RESPONSE_MARKER' in history, 'history erased on resize'
            tty.send_text('X'); wait_for(lambda s: 'DRAFT_中文X' in s)
            tty.send_key('BSpace'); wait_for(lambda s: 'DRAFT_中文X' not in s and 'DRAFT_中文' in s)
        tty.send_key('Enter'); wait_for(lambda s: 'NEXT_TURN_CONFIRMED' in s and h.has_ready_input_prompt(s))
        texts = [m['content'] for m in server.requests[-1]['messages'] if m['role'] == 'user']
        content = texts[-1]
        session = json.loads(next((config / 'sessions').glob('*.json')).read_text())
        saved = [m['content'] for m in session['messages'] if m['role'] == 'user'][-1]
        assert saved[-1]['text'] == 'DRAFT_中文', repr(saved[-1])
        # The adapter can flatten the separate reminder and input text blocks.
        expected = ''.join(block['text'] for block in saved) if isinstance(content, str) else saved
        assert content == expected, 'provider received a different input than the persisted draft'
        tty.send_text('/exit'); tty.send_key('Enter'); time.sleep(.5)
        (root / 'result.json').write_text(json.dumps({'passed': True, 'entry': str(entry), 'resizeCases': 6,
            'oneFooter': True, 'historyRetained': True, 'draftEditable': True, 'exactNextInput': True}, indent=2))
        print('PASS: six geometry changes; one editable footer; full history retained; next input exact')
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
    p = argparse.ArgumentParser(); p.add_argument('--cli-entry', type=Path)
    args = p.parse_args()
    run((args.cli_entry or Path(__file__).resolve().parents[2] / 'dist/index.js').resolve())
