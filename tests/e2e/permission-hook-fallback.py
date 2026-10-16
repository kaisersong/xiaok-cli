#!/usr/bin/env python3
"""Real CLI/TTY: timed-out approval bridge still requires a local decision."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import shlex
import shutil
import time
import tempfile


def run(project: Path, entry: Path) -> None:
    spec = importlib.util.spec_from_file_location('tty_helpers', Path(__file__).with_name('tmux-e2e.py'))
    helpers = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helpers)
    root = Path(tempfile.mkdtemp(prefix='xiaok-permission-fallback-'))
    work, config, home = root / 'project', root / 'config', root / 'home'
    work.mkdir(); home.mkdir()
    denied, approved = work / 'denied.txt', work / 'approved.txt'
    socket = f'xiaok-permission-{os.getpid()}-{int(time.time())}'

    class IsolatedTmux(helpers.TmuxHarness):
        def tmux(self, *args, **kwargs):
            return super().tmux('-L', socket, *args, **kwargs)

    hook_script = root / 'approval-hook.cjs'
    hook_pids = root / 'hook-pids.txt'
    hook_script.write_text("const fs=require('node:fs');\n"
        f"fs.appendFileSync({json.dumps(str(hook_pids))},String(process.pid)+'\\n');\n"
        "process.stdin.resume(); setInterval(()=>{},1000);\n")
    plugin = work / '.xiaok/plugins/approval-probe'
    plugin.mkdir(parents=True)
    (plugin / 'plugin.json').write_text(json.dumps({'name': 'approval-probe', 'version': '1.0.0',
        'hooks': [{'command': shlex.join([shutil.which('node'), str(hook_script)]),
                   'events': ['PermissionRequest'], 'timeoutMs': 500}]}))
    server = helpers.FakeOpenAIServer([
        helpers.tool_call_response_events('write', {'file_path': str(denied), 'content': 'DENIED_WRITE'}, 'deny_probe'),
        'DENIED_ACK',
        helpers.tool_call_response_events('write', {'file_path': str(approved), 'content': 'APPROVED_WRITE'}, 'allow_probe'),
        'APPROVED_ACK', 'FOLLOWUP_OK',
    ], first_token_delay=0.05)
    tty = IsolatedTmux('permission-probe', work, config, home, entry,
        helpers.resolve_tmux_binary(), auto_mode=False,
        env_overrides={'XIAOK_DISABLE_GLOBAL_PLUGINS': '1'})
    owned = []

    def wait_for(predicate, name, timeout=20):
        screen = tty.wait_for(predicate, timeout=timeout)
        (root / f'{name}.txt').write_text(screen)
        assert predicate(screen), f'{name}: {screen}'
        return screen

    try:
        server.start(); helpers.write_config(config, server.base_url, 'gpt-4o')
        settings = json.loads((config / 'config.json').read_text())
        settings.update({'automations': {'enabled': False}, 'memory': {'enabled': False},
                         'intentBoundary': {'enabled': False}})
        (config / 'config.json').write_text(json.dumps(settings))
        tty.start(cols=120, rows=32)
        owned.append(int(tty.tmux('display-message', '-p', '-t', tty.session, '#{pane_pid}').stdout.strip()))
        wait_for(helpers.has_ready_input_prompt, 'ready')
        tty.send_text('Test the denied write'); tty.send_key('Enter')
        wait_for(lambda s: '允许一次' in s and '拒绝' in s, 'deny-prompt')
        assert not denied.exists(), 'tool ran before local confirmation'
        tty.send_key('5')
        wait_for(lambda s: 'DENIED_ACK' in s and helpers.has_ready_input_prompt(s), 'denied')
        assert not denied.exists(), 'locally denied tool executed'
        tty.send_text('Test the approved write'); tty.send_key('Enter')
        wait_for(lambda s: '允许一次' in s and '拒绝' in s, 'allow-prompt')
        assert not approved.exists(), 'tool ran before local confirmation'
        tty.send_key('1')
        wait_for(lambda s: 'APPROVED_ACK' in s and helpers.has_ready_input_prompt(s), 'approved')
        assert approved.read_text() == 'APPROVED_WRITE'
        tty.send_text('Verify the next turn'); tty.send_key('Enter')
        wait_for(lambda s: 'FOLLOWUP_OK' in s and helpers.has_ready_input_prompt(s), 'followup')
        messages = server.requests[-1]['messages']
        replies = {m.get('tool_call_id'): m.get('content', '') for m in messages if m.get('role') == 'tool'}
        assert '已取消' in replies['deny_probe'], replies
        assert 'Error:' not in replies['allow_probe'], replies
        (root / 'requests.json').write_text(json.dumps(server.requests, ensure_ascii=False, indent=2))
        tty.send_text('/exit'); tty.send_key('Enter')
        time.sleep(1)
        sessions = list((config / 'sessions').glob('sess_*.json'))
        assert len(sessions) == 1
        state = json.loads(sessions[0].read_text())
        assert state['intentDelegation']['ownership']['state'] == 'released'
        (root / 'result.json').write_text(json.dumps({'passed': True, 'entry': str(entry),
            'deniedNotExecuted': not denied.exists(), 'approvedContent': approved.read_text(),
            'modelRequests': len(server.requests), 'ownershipReleased': True}, indent=2))
        print('PASS: timeout -> real local prompt; rejection performs no write; approval writes; next turn and exit work')
    finally:
        tty.stop(); server.close()
        if hook_pids.exists(): owned += [int(p) for p in hook_pids.read_text().splitlines()]
        remaining = []
        for pid in owned:
            try: os.kill(pid, 0); remaining.append(pid)
            except ProcessLookupError: pass
        (root / 'owned-pids.json').write_text(json.dumps({'pids': owned, 'remaining': remaining}))
        print(f'CLEANUP: owned CLI and hook processes remaining={len(remaining)}; local SSE server closed')
        print('EVIDENCE', root)
        assert not remaining, f'owned processes survived: {remaining}'


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--project-dir', type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument('--cli-entry', type=Path)
    args = parser.parse_args()
    run(args.project_dir.resolve(), (args.cli_entry or args.project_dir / 'dist/index.js').resolve())
