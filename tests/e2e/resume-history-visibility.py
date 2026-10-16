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


def run(entry: Path):
    spec = importlib.util.spec_from_file_location('helpers', Path(__file__).with_name('tmux-e2e.py'))
    helpers = importlib.util.module_from_spec(spec); spec.loader.exec_module(helpers)
    root = Path(tempfile.mkdtemp(prefix='xiaok-resume-visibility-'))
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
        tty.send_text('/exit'); tty.send_key('Enter'); time.sleep(1)
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
        (root / 'result.json').write_text(json.dumps({'passed': True, 'entry': str(entry),
            'defaultReplayClean': True, 'detailsAvailableInPager': True, 'modelContextPreserved': True,
            'genuineHeadingVisible': True, 'retainedImagesVisible': True, 'repeatedResumePassed': True,
            'storedHistoryUnchanged': True}, indent=2))
        print('PASS: clean replay; Ctrl+O details; model context; genuine text/images; repeated resume; history unchanged')
    finally:
        tty.stop(); server.close(); remaining = list(owned)
        deadline = time.monotonic() + 5
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
    run((args.cli_entry or args.project_dir / 'dist/index.js').resolve())
