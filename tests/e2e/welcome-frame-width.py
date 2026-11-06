#!/usr/bin/env python3
"""Exercise the production welcome renderer in isolated tmux PTYs."""
import argparse
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import tempfile
import time
import unicodedata

parser = argparse.ArgumentParser()
repo = Path(__file__).resolve().parents[2]
parser.add_argument('--module', type=Path, default=repo / 'dist/ui/render.js')
parser.add_argument('--output-dir', type=Path)
parser.add_argument('--expect-overflow', action='store_true')
args = parser.parse_args()
node, tmux_bin = shutil.which('node'), shutil.which('tmux')
if not node or not tmux_bin:
    raise SystemExit('node and tmux are required')
socket = f'xiaok-welcome-frame-{os.getpid()}'


def tmux(*arguments):
    return subprocess.check_output([tmux_bin, '-u', '-L', socket, *arguments], text=True)


def width(text):
    return sum(0 if unicodedata.combining(char) else
               2 if unicodedata.east_asian_width(char) in ('W', 'F') else 1
               for char in text)


results, owned_pids = [], []
with tempfile.TemporaryDirectory(prefix='xiaok-welcome-frame-') as temporary:
    root = args.output_dir or Path(temporary)
    root.mkdir(parents=True, exist_ok=True)
    fixture = root / 'render-fixture.mjs'
    fixture.write_text("""
if(process.argv[3]==='unicode'){delete process.env.TMUX;delete process.env.TERM_PROGRAM;}
delete process.env.NO_COLOR;
const {renderWelcomeScreen}=await import(process.argv[2]);
const rows=renderWelcomeScreen({model:'kimi',cwd:'/workspace',
 sessionId:'sess_00000000-1111-4222-8333-444444444444',mode:'auto',version:'1.6.1'});
console.log('__WELCOME_DONE__:'+rows);
setTimeout(()=>{},30000);
""")
    cases = [(64, 'unicode')] if args.expect_overflow else [
        (columns, frame) for columns in [50, 64, 80, 120] for frame in ['unicode', 'ascii']]
    for index, (columns, frame) in enumerate(cases):
        name = f'case{index}'
        command = shlex.join([node, str(fixture.resolve()), args.module.resolve().as_uri(), frame])
        tmux('new-session', '-d', '-s', name, '-x', str(columns), '-y', '40', command)
        try:
            pid = int(tmux('display-message', '-p', '-t', name, '#{pane_pid}').strip())
            owned_pids.append(pid)
            (root / 'owned-pids.json').write_text(json.dumps(owned_pids))
            deadline = time.monotonic() + 5
            while True:
                output = tmux('capture-pane', '-p', '-t', name)
                if '__WELCOME_DONE__:' in output:
                    break
                if time.monotonic() > deadline:
                    raise RuntimeError('welcome render timeout')
                time.sleep(.05)
            (root / f'{columns}-{frame}.txt').write_text(output)
            lines = [line for line in output.splitlines()
                     if line.strip() and not line.startswith('__WELCOME_DONE__:')]
            border = width(lines[0])
            results.append(dict(columns=columns, frame=frame, borderWidth=border,
                                maxRowWidth=max(map(width, lines)),
                                aligned=all(width(line) == border for line in lines)))
        finally:
            # Only our named session on our private socket; the final session's
            # server exits automatically. Never stop a shared tmux server.
            tmux('kill-session', '-t', name)
    (root / 'results.json').write_text(json.dumps(results, indent=2))
    print(json.dumps(results))
    if args.expect_overflow:
        assert not results[0]['aligned'], 'original overflow was not reproduced'
    else:
        assert all(row['aligned'] for row in results), 'welcome cells escaped the frame'
