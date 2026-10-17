#!/usr/bin/env python3
"""macOS native acceptance in an owned Ghostty window (Python >= 3.10).

Usage: python3 tests/e2e/ghostty-footer-return.py [absolute-cli-entry]
Requires an unlocked desktop, Automation/Screen Recording permissions and the
standard xterm gray 238 footer. Screenshots stay private in a temp directory.
"""
import importlib.util
import json
import os
from pathlib import Path
import plistlib
import shlex
import shutil
import signal
import subprocess
import sys
import tempfile
import time


def osa(code, *args):
    result = subprocess.run(['osascript', '-e', code, *map(str, args)], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    return result.stdout.strip()


def run(entry):
    assert sys.platform == 'darwin', 'Ghostty acceptance requires macOS'
    registry = plistlib.loads(subprocess.check_output(['ioreg', '-n', 'Root', '-d1', '-a']))
    if isinstance(registry, list): registry = registry[0]
    assert not any(user.get('CGSSessionScreenIsLocked') for user in registry.get('IOConsoleUsers', [])), 'Unlock the Mac before native acceptance'
    repo = Path(__file__).resolve().parents[2]
    node = shutil.which('node'); assert node, 'node is required'
    spec = importlib.util.spec_from_file_location('helpers', repo / 'tests/e2e/tmux-e2e.py')
    h = importlib.util.module_from_spec(spec); spec.loader.exec_module(h)
    root = Path(tempfile.mkdtemp(prefix='xiaok-native-footer-'))
    work, home, config = root / 'project', root / 'home', root / 'config'
    work.mkdir(); home.mkdir()
    checker = root / 'footer-bands'
    subprocess.run(['swiftc', str(repo / 'tests/support/footer-bands.swift'), '-o', str(checker)], check=True)
    answer = '\n'.join(f'NATIVE_LINE_{i:03d}' for i in range(75)) + '\nNATIVE_ANSWER_READY'
    server = h.FakeOpenAIServer([answer, 'NATIVE_SECOND_READY'], first_token_delay=.1)
    measurements, win, term = [], None, None
    original = osa('tell application "System Events" to get bundle identifier of first application process whose frontmost is true')

    def text(value):
        osa('on run a\ntell application "Ghostty" to input text (item 1 of a) to terminal id (item 2 of a)\nend run', value, term)

    def key(value):
        osa('on run a\ntell application "Ghostty" to send key (item 1 of a) to terminal id (item 2 of a)\nend run', value, term)

    def capture(name):
        osa('on run a\ntell application "Ghostty" to focus terminal id (item 1 of a)\nend run', term)
        time.sleep(.2)
        rect = osa('tell application "System Events" to tell process "Ghostty"\nset p to position of front window\nset s to size of front window\nreturn (item 1 of p as text) & "," & (item 2 of p) & "," & (item 1 of s) & "," & (item 2 of s)\nend tell')
        screenshot = root / (name + '.png')
        subprocess.run(['screencapture', '-x', '-R', rect, str(screenshot)], check=True)
        if name != 'submitted':
            measurement = json.loads(subprocess.check_output([str(checker), str(screenshot)], text=True))
            measurements.append(measurement)
            (root / 'bands.json').write_text(json.dumps(measurements, indent=2))
            assert len(measurement['bands']) == 1, f'stale native footer bands: {measurement}'

    try:
        server.start(); h.write_config(config, server.base_url, 'gpt-4o')
        settings = json.loads((config / 'config.json').read_text())
        settings.update({'memory': {'enabled': False}, 'automations': {'enabled': False}, 'intentBoundary': {'enabled': False}})
        (config / 'config.json').write_text(json.dumps(settings))
        launch = root / 'launch.sh'
        command = ['env', 'XIAOK_CONFIG_DIR=' + str(config), 'HOME=' + str(home), 'XIAOK_DISABLE_GLOBAL_PLUGINS=1', 'NO_COLOR=', node, str(entry), '--yolo']
        launch.write_text('#!/bin/sh\necho $$ > ' + shlex.quote(str(root / 'pid')) + '\ncd ' + shlex.quote(str(work)) + '\nexec ' + shlex.join(command) + ' 2> ' + shlex.quote(str(root / 'stderr.log')) + '\n')
        ids = osa('on run argv\ntell application "Ghostty"\nactivate\nset c to new surface configuration\nset command of c to item 1 of argv\nset wait after command of c to true\nset w to new window with configuration c\ndelay 1\nset t to focused terminal of selected tab of w\nfocus t\nreturn (id of w) & "," & (id of t)\nend tell\nend run', shlex.join(['/bin/sh', str(launch)]))
        win, term = ids.split(',')
        (root / 'ids.json').write_text(json.dumps({'window': win, 'terminal': term}))
        print('EVIDENCE', root, flush=True)
        time.sleep(2)
        text('Native terminal return probe'); key('enter'); time.sleep(2)
        text('KEEP_NATIVE_DRAFT'); capture('before')
        osa('tell application "Finder" to activate'); time.sleep(.8); capture('focus-return')
        for index, (width, height) in enumerate([(1100, 850), (650, 430), (1100, 850), (650, 550), (1100, 650)]):
            osa('on run a\ntell application "Ghostty" to focus terminal id (item 1 of a)\ntell application "System Events" to tell process "Ghostty" to set size of front window to {item 2 of a as integer,item 3 of a as integer}\nend run', term, width, height)
            time.sleep(.5); capture(f'resize-{index}')
        text('X'); key('backspace'); capture('editable')
        key('enter'); time.sleep(1); capture('submitted')
        assert len(server.requests) == 2, f'expected two submissions, got {len(server.requests)}'
        content = [m['content'] for m in server.requests[-1]['messages'] if m['role'] == 'user'][-1]
        session = json.loads(next((config / 'sessions').glob('*.json')).read_text())
        saved = [m['content'] for m in session['messages'] if m['role'] == 'user'][-1]
        assert saved[-1]['text'] == 'KEEP_NATIVE_DRAFT', repr(saved[-1])
        expected = ''.join(block['text'] for block in saved) if isinstance(content, str) else saved
        assert content == expected, 'provider draft changed'
        (root / 'result.json').write_text(json.dumps({'passed': True, 'entry': str(entry), 'nativeScreens': len(measurements), 'exactNextInput': True}, indent=2))
        print('PASS: Ghostty focus return and five resizes; one gray footer; next input exact', flush=True)
    finally:
        if term:
            try: text('/exit'); key('enter'); time.sleep(.5)
            except Exception: pass
        if win:
            try: osa('on run a\ntell application "Ghostty" to close window id (item 1 of a)\nend run', win)
            except Exception: pass
        server.close()
        remaining = []
        if (root / 'pid').exists():
            pid = int((root / 'pid').read_text())
            try: os.kill(pid, signal.SIGTERM)
            except ProcessLookupError: pass
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                try: os.kill(pid, 0)
                except ProcessLookupError: break
                time.sleep(.05)
            else: remaining.append(pid)
        (root / 'owned-pids.json').write_text(json.dumps({'remaining': remaining}))
        print(f'CLEANUP: owned CLI processes remaining={len(remaining)}; local SSE closed', flush=True)
        try: osa('on run a\ntell application id (item 1 of a) to activate\nend run', original)
        except Exception: pass
        assert not remaining


if __name__ == '__main__':
    run(Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path(__file__).resolve().parents[2] / 'dist/index.js')
