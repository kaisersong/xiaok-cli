#!/usr/bin/env python3
"""Explicit YOLO through actual CLI: real local force push, resume and revoke."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time


def run(entry, activation):
    spec = importlib.util.spec_from_file_location('helpers', Path(__file__).with_name('tmux-e2e.py'))
    helpers = importlib.util.module_from_spec(spec); spec.loader.exec_module(helpers)
    root = Path(tempfile.mkdtemp(prefix=f'xiaok-yolo-{activation}-'))
    work, config, home, remote = [root / n for n in ['project', 'config', 'home', 'remote.git']]
    work.mkdir(); home.mkdir()

    git_env = {'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': os.devnull, 'GIT_TERMINAL_PROMPT': '0'}

    def git(*args, cwd=work):
        return subprocess.check_output(['git', *args], cwd=cwd, env={**os.environ, **git_env}, stderr=subprocess.STDOUT, text=True).strip()

    git('init', '--bare', str(remote)); git('init')
    git('config', 'user.name', 'Synthetic Test'); git('config', 'user.email', 'test@example.invalid')
    (work / 'fixture').write_text('first'); git('add', 'fixture'); git('commit', '-m', 'fixture one')
    git('tag', 'v1.2.3'); git('remote', 'add', 'origin', str(remote)); git('push', 'origin', 'refs/tags/v1.2.3')
    original = git('rev-parse', 'refs/tags/v1.2.3', cwd=remote)
    (work / 'fixture').write_text('second'); git('commit', '-am', 'fixture two')
    head = git('rev-parse', 'HEAD'); assert head != original
    force = 'git tag -f v1.2.3 HEAD && git push -f origin refs/tags/v1.2.3 && echo YOLO_FORCE_EXECUTED'
    responses = []
    for call_id, command, text in [
        ('force', force, 'YOLO_FORCE_DONE'), ('block', 'echo mkfs', 'YOLO_BLOCK_PATTERN_DONE'),
        ('resume', force, 'YOLO_RESUME_DONE'), ('revoked', force, 'YOLO_REVOKED_DENIED'),
    ]:
        responses += [helpers.tool_call_response_events('bash', {'command': command}, call_id), text]
    server = helpers.FakeOpenAIServer(responses, first_token_delay=0.05)
    socket = f'xiaok-yolo-{activation}-{os.getpid()}'

    class IsolatedTmux(helpers.TmuxHarness):
        def tmux(self, *args, **kwargs): return super().tmux('-L', socket, *args, **kwargs)

    tty = IsolatedTmux('yolo', work, config, home, entry, helpers.resolve_tmux_binary(),
        auto_mode=False, extra_args=['--yolo'] if activation == 'flag' else [],
        env_overrides={'XIAOK_DISABLE_GLOBAL_PLUGINS': '1', **git_env})
    owned = []

    def wait_for(predicate, name):
        screen = tty.wait_for(predicate, timeout=20); (root / f'{name}.txt').write_text(screen)
        assert predicate(screen), f'{name} failed; inspect {root}'
        return screen

    def start():
        tty.start(cols=140, rows=40)
        owned.append(int(tty.tmux('display-message', '-p', '-t', tty.session, '#{pane_pid}').stdout))
        wait_for(helpers.has_ready_input_prompt, f'ready-{len(owned)}')

    def send(text): tty.send_text(text); tty.send_key('Enter')

    def prompts():
        return sum(json.loads(line).get('type') == 'permission_prompt_open'
            for f in (config / 'transcripts').glob('sess_*.jsonl') for line in f.read_text().splitlines())

    def exit_session():
        send('/exit'); time.sleep(1)
        saved = json.loads(next((config / 'sessions').glob('sess_*.json')).read_text())
        assert saved['intentDelegation']['ownership']['state'] == 'released'
        tty.stop(); return saved['sessionId']

    try:
        server.start(); helpers.write_config(config, server.base_url, 'gpt-4o')
        settings = json.loads((config / 'config.json').read_text())
        settings.update({'memory': {'enabled': False}, 'automations': {'enabled': False}, 'intentBoundary': {'enabled': False}})
        (config / 'config.json').write_text(json.dumps(settings))
        start()
        if activation == 'slash':
            send('/mode yolo'); wait_for(lambda s: '权限模式已切换为 yolo' in s and helpers.has_ready_input_prompt(s), 'slash-enabled')
        send('/mode'); wait_for(lambda s: '当前权限模式：yolo' in s, 'mode-status')
        send('Run the synthetic local tag probe')
        wait_for(lambda s: 'YOLO_FORCE_DONE' in s and helpers.has_ready_input_prompt(s), 'force-executed')
        assert git('rev-parse', 'refs/tags/v1.2.3', cwd=remote) == head
        send('Run the inert blocked-pattern probe')
        wait_for(lambda s: 'YOLO_BLOCK_PATTERN_DONE' in s and helpers.has_ready_input_prompt(s), 'executor-bypass')
        assert prompts() == 0
        session_id = exit_session(); tty.extra_args = ['--yolo', '--resume', session_id]
        start(); send('Repeat the local tag probe after resume')
        wait_for(lambda s: 'YOLO_RESUME_DONE' in s and helpers.has_ready_input_prompt(s), 'resume-yolo')
        assert prompts() == 0
        session_id = exit_session(); tty.extra_args = ['--resume', session_id]
        start(); send('/mode')
        wait_for(lambda s: '当前权限模式：default' in s, 'resume-default')
        send('/mode auto'); wait_for(lambda s: '权限模式已切换为 auto' in s, 'mode-auto')
        send('Run the tag probe with YOLO disabled')
        wait_for(lambda s: '允许一次' in s and '每次都会询问' in s, 'restored-risk-prompt')
        tty.tmux('send-keys', '-t', tty.session, 'Down', 'Enter')
        wait_for(lambda s: 'YOLO_REVOKED_DENIED' in s and helpers.has_ready_input_prompt(s), 'revoked-denied')
        assert prompts() == 1
        replies = {m.get('tool_call_id'): m.get('content', '') for m in server.requests[-1]['messages'] if m.get('role') == 'tool'}
        for name in ['force', 'resume']: assert 'YOLO_FORCE_EXECUTED' in replies[name], replies
        assert replies['block'].strip() == 'mkfs'; assert '已取消' in replies['revoked']
        exit_session()
        (root / 'result.json').write_text(json.dumps({'passed': True, 'activation': activation, 'entry': str(entry),
            'realLocalRemoteTagUpdated': True, 'noPromptsInYolo': True, 'executorBypass': True,
            'explicitResume': True, 'implicitResumeDefault': True, 'autoStillConfirms': True}, indent=2))
        print(f'PASS: {activation}; force push actually executed; no approval; resume and revocation verified')
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
    parser = argparse.ArgumentParser(); parser.add_argument('--cli-entry', type=Path)
    args = parser.parse_args()
    entry = (args.cli_entry or Path(__file__).resolve().parents[2] / 'dist/index.js').resolve()
    for activation in ['flag', 'slash']: run(entry, activation)
