#!/usr/bin/env python3
"""Real CLI TTY: compound project/global approvals persist across resume."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import time


def run(project: Path, entry: Path, scope: str):
    spec = importlib.util.spec_from_file_location('helpers', Path(__file__).with_name('tmux-e2e.py'))
    helpers = importlib.util.module_from_spec(spec); spec.loader.exec_module(helpers)
    root = Path(tempfile.mkdtemp(prefix=f'xiaok-remember-{scope}-'))
    work, config, home = root / 'project', root / 'config', root / 'home'
    work.mkdir(); home.mkdir(); (work / 'probe.txt').write_text('SCOPE_PROBE_OK\n')
    commands = ['sleep 0; tail -n1 probe.txt | grep SCOPE_PROBE | head -n1',
                'sleep 0; tail -n2 probe.txt | grep SCOPE_PROBE | head -n1',
                'sleep 0; tail -n3 probe.txt | grep SCOPE_PROBE | head -n1']
    responses = []
    for index, command in enumerate(commands):
        responses += [helpers.tool_call_response_events('bash', {'command': command}, f'probe_{index}'), f'CONFIRMED_SCOPE_{index}']
    responses += [helpers.tool_call_response_events('bash', {'command': commands[0] + '; wc -l probe.txt'}, 'unknown_suffix'), 'SUFFIX_DENIED']
    server = helpers.FakeOpenAIServer(responses, first_token_delay=0.05)
    socket = f'xiaok-remember-{scope}-{os.getpid()}'

    class IsolatedTmux(helpers.TmuxHarness):
        def tmux(self, *args, **kwargs): return super().tmux('-L', socket, *args, **kwargs)

    tty = IsolatedTmux('remember', work, config, home, entry, helpers.resolve_tmux_binary(),
        auto_mode=False, env_overrides={'XIAOK_DISABLE_GLOBAL_PLUGINS': '1'})
    owned = []

    def wait_for(predicate, name):
        screen = tty.wait_for(predicate, timeout=20); (root / f'{name}.txt').write_text(screen)
        assert predicate(screen), f'{name} failed; inspect {root}'
        return screen

    def prompt_count():
        files = list((config / 'transcripts').glob('sess_*.jsonl'))
        return sum(json.loads(line).get('type') == 'permission_prompt_open' for f in files for line in f.read_text().splitlines())

    def start():
        tty.start(cols=140, rows=40)
        owned.append(int(tty.tmux('display-message', '-p', '-t', tty.session, '#{pane_pid}').stdout))
        wait_for(helpers.has_ready_input_prompt, f'ready-{len(owned)}')

    def turn(index):
        tty.send_text(f'Run compound scope probe {index}'); tty.send_key('Enter')

    try:
        server.start(); helpers.write_config(config, server.base_url, 'gpt-4o')
        settings = json.loads((config / 'config.json').read_text())
        settings.update({'memory': {'enabled': False}, 'automations': {'enabled': False}, 'intentBoundary': {'enabled': False}})
        (config / 'config.json').write_text(json.dumps(settings))
        start(); turn(0)
        screen = wait_for(lambda s: '保存到全局' in s and '保存到项目' in s, 'first-prompt')
        for program in ['sleep', 'tail', 'grep', 'head']: assert f'bash({program} *)' in screen, screen
        for _ in range(2 if scope == 'project' else 3): tty.send_key('Down')
        tty.send_key('Enter')
        wait_for(lambda s: 'CONFIRMED_SCOPE_0' in s and helpers.has_ready_input_prompt(s), 'saved')
        turn(1)
        wait_for(lambda s: 'CONFIRMED_SCOPE_1' in s and helpers.has_ready_input_prompt(s), 'same-process')
        assert prompt_count() == 1, 'remembered scope prompted again in same process'
        tty.send_text('/exit'); tty.send_key('Enter'); time.sleep(1); tty.stop()
        session = next((config / 'sessions').glob('sess_*.json'))
        snapshot = json.loads(session.read_text()); assert snapshot['intentDelegation']['ownership']['state'] == 'released'
        tty.extra_args = ['--resume', snapshot['sessionId']]
        start(); turn(2)
        wait_for(lambda s: 'CONFIRMED_SCOPE_2' in s and helpers.has_ready_input_prompt(s), 'reloaded')
        assert prompt_count() == 1, 'saved scope prompted again after resume'
        turn(3)
        wait_for(lambda s: 'bash(wc *)' in s and '拒绝' in s, 'unknown-suffix-prompt')
        for _ in range(4): tty.send_key('Down')
        tty.send_key('Enter')
        wait_for(lambda s: 'SUFFIX_DENIED' in s and helpers.has_ready_input_prompt(s), 'suffix-denied')
        assert prompt_count() == 2
        replies = {m.get('tool_call_id'): m.get('content', '') for m in server.requests[-1]['messages'] if m.get('role') == 'tool'}
        for index in range(3): assert 'SCOPE_PROBE_OK' in replies[f'probe_{index}'], replies
        assert '已取消' in replies['unknown_suffix'], replies
        tty.send_text('/exit'); tty.send_key('Enter'); time.sleep(1)
        assert json.loads(session.read_text())['intentDelegation']['ownership']['state'] == 'released'
        expected = ['bash(sleep *)', 'bash(tail *)', 'bash(grep *)', 'bash(head *)']
        if scope == 'global': stored = json.loads((config / 'settings.json').read_text())['permissions']['allow']
        else:
            local = json.loads((config / 'project-rule-adoptions.json').read_text())['localRules']
            stored = local[str(work.resolve())]
        assert stored == expected, stored
        (root / 'result.json').write_text(json.dumps({'passed': True, 'scope': scope, 'entry': str(entry),
            'prompts': 2, 'allowedInvocations': 3, 'storedRules': stored, 'resumePassed': True,
            'unapprovedSuffixDenied': True}, indent=2))
        print(f'PASS: {scope} compound approval -> same process -> resume; all scopes saved; new suffix still prompts')
    finally:
        tty.stop(); server.close(); remaining = list(owned)
        end = time.monotonic() + 5
        while remaining and time.monotonic() < end:
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
    for scope in ['project', 'global']:
        run(args.project_dir.resolve(), (args.cli_entry or args.project_dir / 'dist/index.js').resolve(), scope)
