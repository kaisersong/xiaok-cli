#!/usr/bin/env python3
"""Real CLI TTY: remember exact project/log writes and quoted Python scripts."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import shlex
import tempfile
import time


def run(entry: Path, scope: str, kind: str):
    spec = importlib.util.spec_from_file_location('helpers', Path(__file__).with_name('tmux-e2e.py'))
    helpers = importlib.util.module_from_spec(spec); spec.loader.exec_module(helpers)
    root = Path(tempfile.mkdtemp(prefix=f'xiaok-exact-{scope}-{kind}-'))
    work, config, home = root / 'project', root / 'config', root / 'home'
    work.mkdir(); home.mkdir()
    log = work / 'build.log' if kind == 'redirect' else root / 'temporary-build.log'
    command = "printf '%s\\n' BUILD_OK >> build.log" if kind == 'redirect' else (
        'cd ' + shlex.quote(str(work)) + " && python3 - <<'PY' >> " + shlex.quote(str(log))
        + " 2>&1\nprint('BUILD_OK')\nPY")
    changed = command.replace('BUILD_OK', 'CHANGED')
    responses = []
    for index in range(3):
        responses += [helpers.tool_call_response_events('bash', {'command': command}, f'exact_{index}'), f'EXACT_RUN_{index}_OK']
    responses += [helpers.tool_call_response_events('bash', {'command': changed}, 'changed'), 'CHANGED_DENIED']
    server = helpers.FakeOpenAIServer(responses, first_token_delay=0.05)
    socket = f'xiaok-exact-{scope}-{kind}-{os.getpid()}'

    class IsolatedTmux(helpers.TmuxHarness):
        def tmux(self, *args, **kwargs): return super().tmux('-L', socket, *args, **kwargs)

    tty = IsolatedTmux('exact', work, config, home, entry, helpers.resolve_tmux_binary(),
        auto_mode=False, env_overrides={'XIAOK_DISABLE_GLOBAL_PLUGINS': '1'})
    owned = []

    def wait_for(predicate, name):
        screen = tty.wait_for(predicate, timeout=20); (root / f'{name}.txt').write_text(screen)
        assert predicate(screen), f'{name} failed; inspect {root}'
        return screen

    def prompt_count():
        return sum(json.loads(line).get('type') == 'permission_prompt_open'
            for f in (config / 'transcripts').glob('sess_*.jsonl') for line in f.read_text().splitlines())

    def start():
        tty.start(cols=140, rows=40)
        owned.append(int(tty.tmux('display-message', '-p', '-t', tty.session, '#{pane_pid}').stdout))
        wait_for(helpers.has_ready_input_prompt, f'ready-{len(owned)}')

    def turn(index):
        tty.send_text(f'Run exact approval probe {index}'); tty.send_key('Enter')

    def exit_session():
        tty.send_text('/exit'); tty.send_key('Enter'); time.sleep(1)
        session = next((config / 'sessions').glob('sess_*.json'))
        saved = json.loads(session.read_text())
        assert saved['intentDelegation']['ownership']['state'] == 'released'
        tty.stop(); return saved

    try:
        server.start(); helpers.write_config(config, server.base_url, 'gpt-4o')
        settings = json.loads((config / 'config.json').read_text())
        settings.update({'memory': {'enabled': False}, 'automations': {'enabled': False}, 'intentBoundary': {'enabled': False}})
        (config / 'config.json').write_text(json.dumps(settings))
        start(); turn(0)
        screen = wait_for(lambda s: '保存到全局' in s and '完整命令' in s, 'save-prompt')
        assert '@exact:' not in screen and '每次都会询问' not in screen
        assert not log.exists(), 'command executed before approval'
        tty.tmux('send-keys', '-t', tty.session, *(['Down'] * (2 if scope == 'project' else 3)), 'Enter')
        wait_for(lambda s: 'EXACT_RUN_0_OK' in s and helpers.has_ready_input_prompt(s), 'saved')
        assert log.read_text() == 'BUILD_OK\n'
        turn(1)
        wait_for(lambda s: 'EXACT_RUN_1_OK' in s and helpers.has_ready_input_prompt(s), 'same-process')
        assert prompt_count() == 1, 'exact command prompted again'
        saved = exit_session(); tty.extra_args = ['--resume', saved['sessionId']]
        start(); turn(2)
        wait_for(lambda s: 'EXACT_RUN_2_OK' in s and helpers.has_ready_input_prompt(s), 'resumed')
        assert prompt_count() == 1, 'saved exact command prompted after resume'
        turn(3)
        wait_for(lambda s: '保存到全局' in s and '完整命令' in s, 'changed-prompt')
        tty.tmux('send-keys', '-t', tty.session, *(['Down'] * 4), 'Enter')
        wait_for(lambda s: 'CHANGED_DENIED' in s and helpers.has_ready_input_prompt(s), 'changed-denied')
        assert prompt_count() == 2
        assert log.read_text() == 'BUILD_OK\n' * 3, 'changed script executed or approved script replayed'
        replies = {m.get('tool_call_id'): m.get('content', '') for m in server.requests[-1]['messages'] if m.get('role') == 'tool'}
        for index in range(3): assert 'Error:' not in replies[f'exact_{index}']
        assert '已取消' in replies['changed']
        if scope == 'global': rules = json.loads((config / 'settings.json').read_text())['permissions']['allow']
        else:
            local = json.loads((config / 'project-rule-adoptions.json').read_text())['localRules']
            rules = local[str(work.resolve())]
        assert len(rules) == 1 and rules[0].startswith('bash(@exact:')
        assert command not in json.dumps(rules), 'raw script persisted in approval settings'
        exit_session()
        (root / 'result.json').write_text(json.dumps({'passed': True, 'entry': str(entry), 'scope': scope, 'kind': kind,
            'sameProcessAndResumeReused': True, 'changedPayloadDenied': True, 'prompts': 2,
            'executions': 3, 'scriptNotStoredInSettings': True}, indent=2))
        print(f'PASS: {scope}/{kind}; one approval -> same process -> resume; changed payload still prompts')
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
    for scope in ['project', 'global']:
        for kind in ['redirect', 'python']:
            run((args.cli_entry or args.project_dir / 'dist/index.js').resolve(), scope, kind)
