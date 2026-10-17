#!/usr/bin/env python3
"""Exercise the built CLI/Kimi adapter/recovery owner in an isolated real tmux TTY."""
import argparse
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import tempfile
import time

parser = argparse.ArgumentParser()
parser.add_argument('--cli-entry', type=Path, required=True)
args = parser.parse_args()
root = Path(tempfile.mkdtemp(prefix='xiaok-kimi-recovery-tty-'))
config = root / 'config'
project = root / 'project'
config.mkdir()
project.mkdir()
socket = 'xiaok-kimi-recovery-' + root.name
tmux_binary = shutil.which('tmux')
node_binary = shutil.which('node')
assert tmux_binary and node_binary
fixture = Path(__file__).with_name('kimi-error-recovery-fixture.mjs').resolve()
(config / 'config.json').write_text(json.dumps({
    'schemaVersion': 2, 'defaultProvider': 'kimi', 'defaultModelId': 'kimi-k3',
    'providers': {'kimi': {'type': 'first_party', 'protocol': 'openai_legacy',
                           'baseUrl': 'https://api.kimi.com/coding/v1', 'apiKey': 'fixture-key'}},
    'models': {'kimi-k3': {'provider': 'kimi', 'model': 'k3', 'capabilities': ['tools', 'thinking']}},
    'defaultMode': 'auto', 'channels': {}, 'automations': {'enabled': False},
    'memory': {'enabled': False}, 'intentBoundary': {'enabled': False},
}))

def tmux(*commands, check=True):
    return subprocess.run([tmux_binary, '-L', socket, *commands], capture_output=True, text=True, check=check, timeout=10)

def capture():
    return tmux('capture-pane', '-p', '-S', '-1000', '-t', 'probe').stdout

def until(predicate, timeout=45):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        pane = capture()
        if predicate(pane):
            return pane
        time.sleep(0.1)
    raise AssertionError(capture())

def send(text):
    tmux('send-keys', '-l', '-t', 'probe', text)
    tmux('send-keys', '-t', 'probe', 'Enter')

env = {'XIAOK_CONFIG_DIR': str(config), 'XIAOK_ERROR_RECOVERY_PROBE_DIR': str(root),
       'XIAOK_DISABLE_GLOBAL_PLUGINS': '1', 'XIAOK_TURN_TIMEOUT_MS': '5000'}
command = ' '.join([*(k + '=' + shlex.quote(v) for k, v in env.items()),
                    shlex.quote(node_binary), '--import', shlex.quote(str(fixture)),
                    shlex.quote(str(args.cli_entry.resolve())), '--auto']) + ' 2>' + shlex.quote(str(root / 'stderr.log'))
try:
    tmux('new-session', '-d', '-s', 'probe', '-x', '150', '-y', '45', '-c', str(project), command)
    tmux('set-option', '-t', 'probe', 'remain-on-exit', 'on')
    until(lambda p: '❯' in p)
    send('RECOVERY_TTY_CASE: execute the fixture command once and report completion')
    pane = until(lambda p: 'RECOVERY_TTY_COMPLETE' in p)
    assert 'tool_failed' not in pane, pane
    assert (project / 'tool-count.txt').read_text().splitlines() == ['once']
    (root / 'recovered-pane.txt').write_text(pane)
    send('PERMANENT_TTY_CASE: report the provider error')
    pane = until(lambda p: 'model_failed' in p and 'http_status=401' in p)
    time.sleep(0.2)
    requests = [json.loads(line) for line in (root / 'requests.jsonl').read_text().splitlines()]
    assert len(requests) == 4, requests
    assert len([r for r in requests if r['permanent']]) == 1, requests
    log = (config / 'logs' / 'xiaok.log').read_text()
    assert '"transportCode":"ECONNRESET"' in log
    assert '"status":401' in log
    for text in [pane, log, (root / 'stderr.log').read_text()]:
        assert 'PRIVATE_REASONING_CANARY' not in text
        assert 'sk-fixture-private' not in text
    (root / 'permanent-pane.txt').write_text(pane)
    (root / 'result.json').write_text(json.dumps({'passed': True, 'requests': len(requests),
        'completedToolExecutions': 1, 'permanentRequests': 1, 'cliEntry': str(args.cli_entry.resolve())}, indent=2))
    print('PASS', root)
finally:
    tmux('send-keys', '-t', 'probe', 'C-c', check=False)
    tmux('send-keys', '-t', 'probe', 'C-c', check=False)
    tmux('kill-session', '-t', 'probe', check=False)
    cli_pid = int((root / 'cli.pid').read_text()) if (root / 'cli.pid').exists() else None
    if cli_pid:
        try:
            os.kill(cli_pid, 0)
        except ProcessLookupError:
            print('CLEANUP cli processes remaining=0')
        else:
            os.kill(cli_pid, 15)
            print('CLEANUP terminated owned CLI pid', cli_pid)
    print('EVIDENCE', root)
