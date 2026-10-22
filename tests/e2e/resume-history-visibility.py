#!/usr/bin/env python3
"""Real CLI: compacted context stays model-only; tool details stay in Ctrl+O."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import shlex
import tempfile
import time


class TtyCleanupError(RuntimeError):
    """Preserve the original body and every cleanup exception object."""
    def __init__(self, errors):
        self.errors = tuple(errors)
        super().__init__('TTY body and cleanup failures: ' +
                         ', '.join(type(error).__name__ for error in errors))


def run(entry: Path):
    spec = importlib.util.spec_from_file_location('helpers', Path(__file__).with_name('tmux-e2e.py'))
    helpers = importlib.util.module_from_spec(spec); spec.loader.exec_module(helpers)
    root = Path(tempfile.mkdtemp(prefix='xiaok-resume-visibility-')).resolve()
    work, config, home = root / 'project', root / 'config', root / 'home'
    work.mkdir(); home.mkdir(); (config / 'sessions').mkdir(parents=True)
    summary = '# Context Summary: INTERNAL_COMPACTION_CANARY'
    genuine = '# Context Summary: USER_AUTHORED_HEADING'
    raw = 'RAW_TOOL_RESULT_CANARY'
    messages = [
        {'role': 'user', 'content': [{'type': 'text', 'text': summary}]},
        {'role': 'user', 'content': [{'type': 'text', 'text': genuine}]},
        {'role': 'assistant', 'content': [{'type': 'tool_use', 'id': 'history_tool', 'name': 'bash',
            'input': {'command': 'echo TOOL_COMMAND_CANARY'}}]},
        {'role': 'user', 'content': [{'type': 'tool_result', 'tool_use_id': 'history_tool', 'content': raw}]},
        {'role': 'assistant', 'content': [{'type': 'text', 'text': 'VISIBLE_RETAINED_ANSWER'}]},
        {'role': 'user', 'content': [{'type': 'image', 'source': {'type': 'base64',
            'media_type': 'image/png', 'data': 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a+S8AAAAASUVORK5CYII='}}]},
    ]
    now = int(time.time() * 1000)
    compactions = [{'id': 'cmp_synthetic', 'createdAt': now, 'summary': summary, 'replacedMessages': 40}]
    sid = 'sess_synthetic_resume_visibility'
    target = config / 'sessions' / f'{sid}.json'
    target.write_text(json.dumps({'schemaVersion': 1, 'sessionId': sid, 'cwd': str(work),
        'createdAt': now, 'updatedAt': now, 'lineage': [], 'model': 'gpt-4o',
        'messages': messages, 'usage': {'inputTokens': 0, 'outputTokens': 0},
        'compactions': compactions, 'memoryRefs': [], 'approvalRefs': [], 'backgroundJobRefs': []}))
    # Capture exactly what Ctrl+O hands to a real pager, outside the default view.
    pager_output = root / 'pager.txt'
    pager = root / 'pager.sh'
    pager.write_text('#!/bin/sh\ncp "$1" ' + shlex.quote(str(pager_output)) + '\n')
    pager.chmod(0o700)
    socket = f'xiaok-resume-visibility-{os.getpid()}'

    class IsolatedTmux(helpers.TmuxHarness):
        def tmux(self, *args, **kwargs): return super().tmux('-L', socket, *args, **kwargs)

    server = helpers.FakeOpenAIServer(['RESUMED_CONTEXT_OK'], first_token_delay=0.05)
    tty = IsolatedTmux('visibility', work, config, home, entry, helpers.resolve_tmux_binary(),
        auto_mode=False, extra_args=['--resume', sid],
        env_overrides={'XIAOK_DISABLE_GLOBAL_PLUGINS': '1', 'PAGER': str(pager)})
    owned = []
    primary_error = None
    exit_receipts = []

    def observe_exit():
        receipt = tty.wait_for_exit(timeout=10)
        exit_receipts.append(receipt)
        (root / 'exit-receipts.json').write_text(json.dumps(exit_receipts, indent=2))

    def full_history():
        return tty.tmux('capture-pane', '-p', '-S', '-', '-t', tty.session).stdout

    def wait_for(predicate, name):
        screen = tty.wait_for(predicate, timeout=30)
        (root / f'{name}.txt').write_text(screen)
        assert predicate(screen), f'{name} failed; inspect {root}'

    def start(index):
        tty.start(cols=120, rows=32)
        owned.append(int(tty.tmux('display-message', '-p', '-t', tty.session, '#{pane_pid}').stdout))
        wait_for(helpers.has_ready_input_prompt, f'ready-{index}')
        history = full_history(); (root / f'history-{index}.txt').write_text(history)
        assert 'INTERNAL_COMPACTION_CANARY' not in history
        assert raw not in history and 'TOOL_COMMAND_CANARY' not in history
        assert 'Tool result:' not in history
        assert 'USER_AUTHORED_HEADING' in history and 'VISIBLE_RETAINED_ANSWER' in history
        assert '[Image]' in history

    def exit_session():
        tty.send_text('/exit'); tty.send_key('Enter'); observe_exit()
        saved = json.loads(target.read_text())
        assert saved['messages'][:len(messages)] == messages
        assert saved['compactions'] == compactions
        assert saved['intentDelegation']['ownership']['state'] == 'released'
        tty.stop()

    try:
        server.start(); helpers.write_config(config, server.base_url, 'gpt-4o')
        settings = json.loads((config / 'config.json').read_text())
        settings.update({'memory': {'enabled': False}, 'automations': {'enabled': False}, 'intentBoundary': {'enabled': False}})
        (config / 'config.json').write_text(json.dumps(settings))
        start(1)
        tty.send_key('C-o')
        deadline = time.monotonic() + 10
        while not pager_output.exists() and time.monotonic() < deadline: time.sleep(0.05)
        details = pager_output.read_text()
        assert raw in details and 'TOOL_COMMAND_CANARY' in details
        assert 'INTERNAL_COMPACTION_CANARY' not in details and 'USER_AUTHORED_HEADING' in details
        wait_for(helpers.has_ready_input_prompt, 'pager-restored')
        tty.send_text('Continue the retained task.'); tty.send_key('Enter')
        wait_for(lambda s: 'RESUMED_CONTEXT_OK' in s and helpers.has_ready_input_prompt(s), 'continued')
        assert len(server.requests) == 1
        request = json.dumps(server.requests[0])
        assert summary in request and raw in request and 'TOOL_COMMAND_CANARY' in request
        exit_session(); start(2); exit_session()
        (root / 'result.json').write_text(json.dumps({'passed': True, 'exitReceipts': exit_receipts, 'entry': str(entry),
            'defaultReplayClean': True, 'detailsAvailableInPager': True, 'modelContextPreserved': True,
            'genuineHeadingVisible': True, 'retainedImagesVisible': True, 'repeatedResumePassed': True,
            'storedHistoryUnchanged': True}, indent=2))
        print('PASS: clean replay; Ctrl+O details; model context; genuine text/images; repeated resume; history unchanged')
    except BaseException as error:
        primary_error = error
        raise
    finally:
        cleanup_errors = []
        for close in (tty.stop, server.close):
            try: close()
            except BaseException as error: cleanup_errors.append(error)
        remaining = list(owned)
        deadline = time.monotonic() + 5
        while remaining and time.monotonic() < deadline:
            alive = []
            probe_failed = False
            for pid in remaining:
                try: os.kill(pid, 0); alive.append(pid)
                except ProcessLookupError: pass
                except BaseException as error:
                    cleanup_errors.append(error)
                    alive.append(pid)
                    probe_failed = True
            remaining = alive
            if probe_failed: break  # Unknown is failure; do not repeat/erase its original exception.
            if remaining: time.sleep(0.05)
        try:
            (root / 'owned-pids.json').write_text(json.dumps({'pids': owned, 'remaining': remaining,
                'cleanupErrors': [type(error).__name__ for error in cleanup_errors]}))
        except BaseException as error: cleanup_errors.append(error)
        for values in ((f'CLEANUP: owned CLI processes remaining={len(remaining)}; cleanup errors={len(cleanup_errors)}',),
                       ('EVIDENCE', root)):
            try: print(*values)
            except BaseException as error: cleanup_errors.append(error)
        if remaining: cleanup_errors.append(AssertionError(f'owned processes survived or unknown: {remaining}'))
        if cleanup_errors:
            errors = ([primary_error] if primary_error is not None else []) + cleanup_errors
            if len(errors) == 1: raise errors[0]
            raise TtyCleanupError(errors) from errors[0]


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--project-dir', type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument('--cli-entry', type=Path)
    args = parser.parse_args()
    run((args.cli_entry or args.project_dir / 'dist/index.js').resolve())
