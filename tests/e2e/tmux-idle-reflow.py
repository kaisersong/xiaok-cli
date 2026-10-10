#!/usr/bin/env python3
"""Focused real CLI TTY regression for submitted-input background reflow."""
from __future__ import annotations
import argparse
import importlib.util
import os
from pathlib import Path
import re
import tempfile
import time

spec = importlib.util.spec_from_file_location('terminal_e2e', Path(__file__).with_name('tmux-e2e.py'))
e2e = importlib.util.module_from_spec(spec)
spec.loader.exec_module(e2e)


def submitted_background_rows(pane: str) -> int:
    bg = None
    count = 0
    for line in pane.splitlines():
        painted = False
        for part in re.split(r'(\x1b\[[0-9;]*m)', line):
            if part.startswith('\x1b['):
                codes = [int(value or '0') for value in part[2:-1].split(';')]
                index = 0
                while index < len(codes):
                    code = codes[index]
                    if code in (0, 49):
                        bg = None
                    elif code in (38, 48) and index + 1 < len(codes):
                        length = 3 if codes[index + 1] == 5 else 5
                        if code == 48:
                            bg = codes[index + 2] if length == 3 else None
                            painted |= bg == 235
                        index += length
                        continue
                    index += 1
            elif part and bg == 235:
                painted = True
        count += int(painted)
    return count


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--project-dir', default=Path(__file__).resolve().parents[2])
    args = parser.parse_args()
    repo = Path(args.project_dir).resolve()
    root = Path(tempfile.mkdtemp(prefix='xiaok-idle-reflow-')).resolve()
    project, home, config = root / 'project', root / 'home', root / 'config'
    project.mkdir()
    home.mkdir()
    # The shared CLI harness loads this account-isolation preloader from cwd.
    (project / 'tests').symlink_to(repo / 'tests', target_is_directory=True)
    server = e2e.FakeOpenAIServer(['ANSWER_IDLE_MARKER', 'AFTER_IDLE_MARKER'], first_token_delay=0.1)
    server.start()
    e2e.write_config(config, server.base_url)
    terminal = e2e.TmuxHarness(
        f'xiaok-idle-reflow-{os.getpid()}', project, config, home,
        repo / 'dist' / 'index.js', e2e.resolve_tmux_binary(),
        env_overrides={'XIAOK_DISABLE_GLOBAL_PLUGINS': '1', 'NO_COLOR': ''},
    )
    print(f'Artifacts: {root}', flush=True)
    try:
        terminal.start(cols=120, rows=30)
        terminal.wait_for(e2e.has_ready_input_prompt, timeout=30)
        terminal.send_text('simple question')
        terminal.send_key('Enter')
        terminal.wait_for(lambda pane: 'ANSWER_IDLE_MARKER' in pane and e2e.has_ready_input_prompt(pane), timeout=30)
        terminal.send_text('KEEP_DRAFT')
        terminal.wait_for(lambda pane: 'KEEP_DRAFT' in pane)
        time.sleep(2)
        for index, (width, height) in enumerate([(80, 30), (120, 30), (60, 24), (120, 30), (80, 24), (120, 30)]):
            terminal.tmux('resize-window', '-t', terminal.session, '-x', str(width), '-y', str(height))
            time.sleep(0.3)
            pane = terminal.capture(ansi=True)
            (root / f'{index}-{width}-{height}.ansi').write_text(pane)
            rows = submitted_background_rows(pane)
            assert rows <= 3, f'Background reflow added rows: {rows} at {width}x{height}'
            assert 'KEEP_DRAFT' in pane, f'Draft hidden at {width}x{height}'
            terminal.send_text('x')
            terminal.wait_for(lambda text: 'KEEP_DRAFTx' in text)
            terminal.send_key('BSpace')
            terminal.wait_for(lambda text: 'KEEP_DRAFTx' not in text and 'KEEP_DRAFT' in text)
        terminal.send_key('Enter')
        final = terminal.wait_for(lambda text: 'AFTER_IDLE_MARKER' in text and e2e.has_ready_input_prompt(text), timeout=30)
        (root / 'final.txt').write_text(final)
        assert len(server.requests) == 2, 'Expected both submissions to reach the real CLI model adapter'
        print('PASS: idle, six resizes, background row count, draft editing and subsequent submission')
    finally:
        terminal.stop()
        server.close()


if __name__ == '__main__':
    main()
