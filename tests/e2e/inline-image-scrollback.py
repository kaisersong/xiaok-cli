#!/usr/bin/env python3
"""Real TTY regression: production image cells survive in text scrollback.

This checks protocol bytes and retained UTF-8 cells, not GPU image rendering.
For GPU validation run inline-image-display.mjs in Kitty/Ghostty without --wire.
"""
import importlib.util
import re
import shutil
import tempfile
import time
from pathlib import Path


def run(project: Path) -> None:
    spec = importlib.util.spec_from_file_location('inline_image_helpers', Path(__file__).with_name('tmux-e2e.py'))
    helpers = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helpers)
    root = Path(tempfile.mkdtemp(prefix='xiaok-inline-image-scrollback-'))
    (root / 'config').mkdir()
    (root / 'home').mkdir()
    socket = f'xiaok-image-scrollback-{int(time.time() * 1000)}'

    class IsolatedTmux(helpers.TmuxHarness):
        def tmux(self, *args, **kwargs):
            return super().tmux('-L', socket, *args, **kwargs)

    tty = IsolatedTmux('image-scrollback', root, root / 'config', root / 'home',
                       project / 'tests/e2e/inline-image-display.mjs', helpers.resolve_tmux_binary(),
                       auto_mode=False, extra_args=['--wire'])
    try:
        tty.start(cols=80, rows=24)
        ready = tty.wait_for(lambda text: 'KEEP_DRAFT' in text, timeout=10)
        assert 'KEEP_DRAFT' in ready, ready
        tty.send_key('s')
        ready = tty.wait_for(lambda text: 'LONG_OUTPUT_80' in text, timeout=10)
        assert 'KEEP_DRAFT' in ready and 'LONG_OUTPUT_80' in ready, ready
        history = tty.tmux('capture-pane', '-ep', '-S', '-', '-t', tty.session).stdout
        cells = '\U0010eeee'
        rows = [line for line in history.splitlines() if cells in line]
        assert len(rows) == 12, (len(rows), history)
        assert all(line.count(cells) == 40 for line in rows), rows
        assert all(line.startswith('  ') for line in rows), rows
        assert cells + '\u0305\u0305' in rows[0], rows[0]
        assert cells + '\u034c\u0305' in rows[-1], rows[-1]
        lines = history.splitlines()
        first = next(index for index, line in enumerate(lines) if cells in line)
        last = max(index for index, line in enumerate(lines) if cells in line)
        for line in [lines[first - 1], lines[last + 1]]:
            assert not re.sub(r'\x1b\[[0-9;]*m', '', line).strip(), line
        print('PASS: all 12x40 image cells remain in real TTY scrollback after 80 output lines')
        tty.send_key('i')
        # Wait for the new image to reach the pane, not just an unchanged draft.
        tty.wait_for(lambda text: cells in text, timeout=10)
        tty.send_key('s')
        ready = tty.wait_for(lambda text: 'LONG_OUTPUT_160' in text, timeout=10)
        history = tty.tmux('capture-pane', '-ep', '-S', '-', '-t', tty.session).stdout
        assert sum(line.count(cells) for line in history.splitlines()) == 960, history
        assert 'KEEP_DRAFT' in ready, ready
        print('PASS: two images keep distinct history cells; fixed draft survives both long outputs')
    finally:
        tty.stop()
        # This socket belongs exclusively to this test.
        tty.tmux('kill-server', check=False)
        shutil.rmtree(root)
        print('CLEANUP: closed 1 owned TTY child and its isolated tmux server')


if __name__ == '__main__':
    run(Path(__file__).resolve().parents[2])
