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
import traceback


class TtyCleanupError(RuntimeError):
    """Keep the original exception objects on Python versions before 3.11 too."""
    def __init__(self, errors):
        self.errors = tuple(errors)
        super().__init__('permission TTY failure and cleanup errors: ' +
                         ', '.join(type(error).__name__ for error in errors))


def record_failure(root: Path, config: Path, tty, state, error: BaseException) -> None:
    # Only this script's synthetic local-SSE fixture is inspected. Never dump
    # config, environment, session messages, credentials, or the complete state.
    ledger = state.get('intentDelegation') if isinstance(state, dict) else None
    ownership = ledger.get('ownership') if isinstance(ledger, dict) else None
    snapshot = {'primaryErrorType': type(error).__name__, 'primaryError': str(error)[:2048],
                'pythonTraceback': traceback.format_exc(limit=8)[-8192:],
                'ownershipState': ownership.get('state') if isinstance(ownership, dict) else None,
                'actualExitKnown': False, 'diagnosticErrors': []}
    if not isinstance(snapshot['ownershipState'], (str, type(None))):
        snapshot['ownershipState'] = 'unavailable'
    try:
        pane = tty.tmux('display-message', '-p', '-t', tty.session,
                        '#{pane_dead}\t#{pane_dead_status}\t#{pane_dead_signal}', check=False)
        snapshot['paneQueryExit'] = pane.returncode
        fields = pane.stdout.strip('\n').split('\t')
        if pane.returncode == 0 and len(fields) == 3:
            snapshot.update({'paneDead': fields[0], 'paneDeadStatus': fields[1], 'paneDeadSignal': fields[2],
                             'actualExitKnown': fields[0] == '1' and bool(fields[1] or fields[2])})
            if fields[0] == '1':
                snapshot['actualExitCode'] = int(fields[1]) if fields[1].isdigit() else None
                snapshot['actualExitSignal'] = fields[2] or None
    except Exception as diagnostic_error:
        snapshot['diagnosticErrors'].append(type(diagnostic_error).__name__)
    try:
        pane = tty.tmux('capture-pane', '-p', '-t', tty.session, check=False)
        (root / 'failure-pane.txt').write_text(pane.stdout[-65536:])
        snapshot['captureQueryExit'] = pane.returncode
    except Exception as diagnostic_error:
        snapshot['diagnosticErrors'].append(type(diagnostic_error).__name__)
    try:
        # This stderr is redirected by TmuxHarness into this owned config only.
        with (config / 'cli-stderr.log').open('rb') as stream:
            size = stream.seek(0, 2); stream.seek(max(0, size - 65536))
            stderr = stream.read(65536).decode('utf-8', errors='replace')
        (root / 'failure-stderr.txt').write_text(stderr)
        snapshot['stderrBytesTotal'] = size
        print('FIXTURE_CLI_STDERR_TAIL\n' + stderr, flush=True)
    except Exception as diagnostic_error:
        snapshot['diagnosticErrors'].append(type(diagnostic_error).__name__)
    (root / 'failure-snapshot.json').write_text(json.dumps(snapshot, ensure_ascii=False, indent=2))
    print('FAILURE_SNAPSHOT ' + json.dumps(snapshot, ensure_ascii=False), flush=True)


def run(project: Path, entry: Path) -> None:
    spec = importlib.util.spec_from_file_location('tty_helpers', Path(__file__).with_name('tmux-e2e.py'))
    helpers = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helpers)
    root = Path(tempfile.mkdtemp(prefix='xiaok-permission-fallback-')).resolve()
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
    state = None
    primary_error = None
    diagnostic_errors = []

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
        # A UI acknowledgement precedes the real owner drain and durable release.
        # Use the existing TTY exit-observation budget, not a one-second sample.
        exit_receipt = tty.wait_for_exit(timeout=10)
        sessions = list((config / 'sessions').glob('sess_*.json'))
        assert len(sessions) == 1
        state = json.loads(sessions[0].read_text())
        assert state['intentDelegation']['ownership']['state'] == 'released'
        (root / 'result.json').write_text(json.dumps({'passed': True, 'entry': str(entry),
            'deniedNotExecuted': not denied.exists(), 'approvedContent': approved.read_text(),
            'modelRequests': len(server.requests), 'ownershipReleased': True,
            'exitReceipt': exit_receipt}, indent=2))
        print('PASS: timeout -> real local prompt; rejection performs no write; approval writes; next turn and exit work')
    except BaseException as error:
        primary_error = error
        try: record_failure(root, config, tty, state, error)
        except BaseException as diagnostic_error:
            diagnostic_errors.append(diagnostic_error)
            try: print('FAILURE_DIAGNOSTIC_UNAVAILABLE ' + type(diagnostic_error).__name__, flush=True)
            except BaseException as output_error: diagnostic_errors.append(output_error)
        raise
    finally:
        cleanup_errors = list(diagnostic_errors)
        for close in (tty.stop, server.close):
            try: close()
            except BaseException as error: cleanup_errors.append(error)
        try:
            if hook_pids.exists(): owned += [int(p) for p in hook_pids.read_text().splitlines()]
        except BaseException as error:
            cleanup_errors.append(error)
        remaining = []
        for pid in owned:
            try: os.kill(pid, 0); remaining.append(pid)
            except ProcessLookupError: pass
            except BaseException as error: cleanup_errors.append(error)
        try:
            (root / 'owned-pids.json').write_text(json.dumps({'pids': owned, 'remaining': remaining,
                'cleanupErrors': [type(error).__name__ for error in cleanup_errors]}))
        except BaseException as error:
            cleanup_errors.append(error)
        for values in ((f'CLEANUP: owned CLI and hook processes remaining={len(remaining)}; cleanup errors={len(cleanup_errors)}',),
                       ('EVIDENCE', root)):
            try: print(*values)
            except BaseException as output_error: cleanup_errors.append(output_error)
        if remaining: cleanup_errors.append(AssertionError(f'owned processes survived: {remaining}'))
        if cleanup_errors:
            errors = ([primary_error] if primary_error is not None else []) + cleanup_errors
            if len(errors) == 1: raise errors[0]
            raise TtyCleanupError(errors) from errors[0]


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--project-dir', type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument('--cli-entry', type=Path)
    args = parser.parse_args()
    run(args.project_dir.resolve(), (args.cli_entry or args.project_dir / 'dist/index.js').resolve())
