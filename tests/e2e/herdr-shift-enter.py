#!/usr/bin/env python3
"""Real installed Herdr encoding -> built CLI -> local model request regression.

Requires herdr in PATH. Uses an owned headless named session, never the user's
server. Evidence stays in the printed temp directory, including raw key bytes.
"""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import tempfile
import time


def run(project: Path) -> None:
    spec = importlib.util.spec_from_file_location('tty_helpers', Path(__file__).with_name('tmux-e2e.py'))
    helpers = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helpers)
    root = Path(tempfile.mkdtemp(prefix='xiaok-herdr-newline-'))
    work, config = root / 'project', root / 'config'
    work.mkdir()
    env = {k: v for k, v in os.environ.items() if not k.startswith('HERDR_')}
    (root / 'herdr.toml').write_text('')
    env['HERDR_CONFIG_PATH'] = str(root / 'herdr.toml')
    session = f'xiaok-newline-{os.getpid()}'
    command = [shutil.which('herdr'), '--session', session]
    assert command[0], 'herdr must be installed'
    model = helpers.FakeOpenAIServer(['FIRST_NEWLINE_OK', 'FOLLOWUP_NEWLINE_OK'], first_token_delay=0.5)
    log = (root / 'herdr.log').open('w')
    server = subprocess.Popen([*command, 'server'], env=env, stdout=log, stderr=log)
    (root / 'owned-pids.json').write_text(json.dumps({'herdr': server.pid}))
    pane = None

    def cli(*args, check=True):
        result = subprocess.run([*command, *args], env=env, capture_output=True, text=True, timeout=15)
        if check and result.returncode:
            raise RuntimeError(result.stderr)
        return result.stdout

    def capture():
        return cli('pane', 'read', pane, '--source', 'visible')

    def wait_for(predicate, timeout=25):
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            screen = capture()
            (root / 'last-screen.txt').write_text(screen)
            if predicate(screen):
                return screen
            time.sleep(0.1)
        raise AssertionError((root / 'last-screen.txt').read_text())

    def key(*keys):
        cli('pane', 'send-keys', pane, *keys)

    def text(value):
        cli('pane', 'send-text', pane, value)

    try:
        end = time.monotonic() + 10
        while time.monotonic() < end:
            if cli('pane', 'list', check=False).strip():
                break
            time.sleep(0.1)
        result = json.loads(cli('workspace', 'create', '--cwd', str(work), '--no-focus'))
        pane = result['result']['root_pane']['pane_id']
        model.start()
        helpers.write_config(config, model.base_url, 'gpt-4o')
        settings = json.loads((config / 'config.json').read_text())
        settings.update({'automations': {'enabled': False}, 'memory': {'enabled': False},
                         'intentBoundary': {'enabled': False}})
        (config / 'config.json').write_text(json.dumps(settings))
        recorder = root / 'recorder.mjs'
        recorder.write_text("import {appendFileSync,writeFileSync} from 'node:fs';\n"
                            f"const root={json.dumps(str(root))};\n"
                            "writeFileSync(root+'/cli.pid',String(process.pid));\n"
                            "process.stdin.on('data',d=>appendFileSync(root+'/keys.jsonl',JSON.stringify({hex:Buffer.from(d).toString('hex')})+'\\n'));\n")
        launch = ['env', f'XIAOK_CONFIG_DIR={config}', 'XIAOK_DISABLE_GLOBAL_PLUGINS=1',
                  shutil.which('node'), '--import', str(recorder), str(project / 'dist/index.js'), '--auto']
        cli('pane', 'run', pane, shlex.join(launch) + ' 2>' + shlex.quote(str(root / 'stderr.log')))
        wait_for(lambda screen: '❯' in screen)
        text('first line')
        key('shift+enter')
        time.sleep(0.4)
        assert not model.requests, 'Shift+Enter submitted prematurely; inspect keys.jsonl'
        text('second line')
        key('enter')
        wait_for(lambda screen: 'FIRST_NEWLINE_OK' in screen and '❯' in screen)
        assert helpers.request_contains_user_text(model.requests[0], 'first line\nsecond line'), model.requests
        # A second read must reacquire the mode after the model turn/reader handoff.
        text('followup')
        key('ctrl+j')
        text('fallback')
        key('shift+enter')
        text('last line')
        key('enter')
        wait_for(lambda screen: 'FOLLOWUP_NEWLINE_OK' in screen and '❯' in screen)
        assert helpers.request_contains_user_text(model.requests[-1], 'followup\nfallback\nlast line'), model.requests
        (root / 'requests.json').write_text(json.dumps(model.requests, ensure_ascii=False, indent=2))
        (root / 'result.json').write_text(json.dumps({'passed': True, 'cliEntry': str(project / 'dist/index.js'),
            'herdrVersion': subprocess.check_output(['herdr', '--version'], text=True).strip(),
            'requests': len(model.requests)}, indent=2))
        print('PASS: real Herdr Shift+Enter keeps draft; Enter submits full multiline text to model')
        print('PASS: subsequent turn retains Shift+Enter and Ctrl+J newline behavior')
    finally:
        cli('server', 'stop', check=False)
        server.wait(timeout=15)
        model.close()
        log.close()
        print('CLEANUP: stopped 1 owned Herdr server (including its CLI pane) and 1 local SSE server')
        print('EVIDENCE', root)
        if (root / 'cli.pid').exists():
            pid = int((root / 'cli.pid').read_text())
            try:
                os.kill(pid, 0)
            except ProcessLookupError:
                print('CLEANUP: owned CLI processes remaining=0')
            else:
                os.kill(pid, 15)
                raise AssertionError(f'owned CLI {pid} survived Herdr shutdown; terminated')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--project-dir', type=Path, default=Path(__file__).resolve().parents[2])
    run(parser.parse_args().project_dir.resolve())
