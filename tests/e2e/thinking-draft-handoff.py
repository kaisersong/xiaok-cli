#!/usr/bin/env python3
"""Real stdin/TTY: drafts remain editable before and after permission prompts."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler


def run(entry: Path, decision: str):
    spec = importlib.util.spec_from_file_location('helpers', Path(__file__).with_name('tmux-e2e.py'))
    helpers = importlib.util.module_from_spec(spec); spec.loader.exec_module(helpers)
    root = Path(tempfile.mkdtemp(prefix=f'xiaok-thinking-draft-{decision}-'))
    work, config, home = root / 'project', root / 'config', root / 'home'
    work.mkdir(); home.mkdir()
    target = work / 'synthetic.txt'
    before_tool, release_tool = threading.Event(), threading.Event()
    after_prompt, release_answer = threading.Event(), threading.Event()

    class GatedServer(helpers.FakeOpenAIServer):
        def _handler_class(self):
            outer = self

            class Handler(BaseHTTPRequestHandler):
                def do_POST(self):
                    body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                    index = len(outer.requests); outer.requests.append(body)
                    self.send_response(200); self.send_header('Content-Type', 'text/event-stream'); self.end_headers()

                    def emit(events):
                        for event in events:
                            self.wfile.write(('data: ' + json.dumps(event) + '\n\n').encode())
                            self.wfile.flush()

                    if index == 0:
                        before_tool.set(); assert release_tool.wait(30)
                        events = helpers.tool_call_response_events('write', {'file_path': str(target),
                            'content': 'SYNTHETIC_WRITE'}, 'draft_permission')
                    elif index == 1:
                        emit([{'choices': [{'index': 0, 'delta': {'reasoning_content': 'Synthetic ongoing reasoning.'},
                            'finish_reason': None}]}])
                        after_prompt.set(); assert release_answer.wait(30)
                        events = helpers.text_response_events('FIRST_TURN_DONE')
                    else:
                        events = helpers.text_response_events('QUEUED_TURN_DONE')
                    emit(events); self.wfile.write(b'data: [DONE]\n\n'); self.wfile.flush()

                def log_message(self, *_): pass

            return Handler

    socket = f'xiaok-thinking-draft-{decision}-{os.getpid()}'

    class IsolatedTmux(helpers.TmuxHarness):
        def tmux(self, *args, **kwargs): return super().tmux('-L', socket, *args, **kwargs)

    server = GatedServer([])
    tty = IsolatedTmux('draft', work, config, home, entry, helpers.resolve_tmux_binary(),
        auto_mode=False, env_overrides={'XIAOK_DISABLE_GLOBAL_PLUGINS': '1'})
    owned = []

    def wait_for(predicate, name, timeout=12):
        screen = tty.wait_for(predicate, timeout=timeout)
        (root / f'{name}.txt').write_text(screen)
        assert predicate(screen), f'{name} failed; inspect {root}'
        return screen

    def draft_visible(screen, text):
        return any('❯' in line and text in line for line in screen.splitlines())

    try:
        server.start(); helpers.write_config(config, server.base_url, 'gpt-4o')
        settings = json.loads((config / 'config.json').read_text())
        settings.update({'memory': {'enabled': False}, 'automations': {'enabled': False}, 'intentBoundary': {'enabled': False}})
        (config / 'config.json').write_text(json.dumps(settings))
        tty.start(cols=120, rows=32)
        owned.append(int(tty.tmux('display-message', '-p', '-t', tty.session, '#{pane_pid}').stdout))
        wait_for(helpers.has_ready_input_prompt, 'ready')
        tty.send_text('Check draft input across a permission prompt'); tty.send_key('Enter')
        assert before_tool.wait(10)
        tty.send_text('DRAFT_中文')
        wait_for(lambda s: draft_visible(s, 'DRAFT_中文') and 'Thinking' in s, 'before-permission')
        release_tool.set()
        wait_for(lambda s: '允许一次' in s and '拒绝' in s, 'permission')
        assert not target.exists(), 'tool executed without approval'
        tty.send_key('1' if decision == 'allow' else '5')
        assert after_prompt.wait(10)
        tty.send_text(' EDIT_ME'); tty.send_key('BSpace'); tty.send_text('D')
        expected = 'DRAFT_中文 EDIT_MD'
        wait_for(lambda s: draft_visible(s, expected) and 'Thinking' in s, 'thinking-edit')
        assert not release_answer.is_set(), 'test let the response finish before checking typing'
        # Several real activity ticks and both resize directions must preserve it.
        time.sleep(0.5)
        tty.tmux('resize-window', '-t', tty.session, '-x', '60', '-y', '18')
        wait_for(lambda s: draft_visible(s, expected), 'narrow-draft')
        tty.tmux('resize-window', '-t', tty.session, '-x', '120', '-y', '32')
        wait_for(lambda s: draft_visible(s, expected), 'wide-draft')
        tty.send_key('C-j'); tty.send_text('第二行')
        wait_for(lambda s: expected in s and '第二行' in s and 'Thinking' in s, 'multiline-draft')
        tty.send_key('Enter')
        wait_for(lambda s: 'Queued (press ↑ to edit):' in s and '第二行' in s, 'queued')
        release_answer.set()
        wait_for(lambda s: 'QUEUED_TURN_DONE' in s and helpers.has_ready_input_prompt(s), 'next-turn', 20)
        assert len(server.requests) == 3
        queued = [m['content'] for m in server.requests[2]['messages'] if m.get('role') == 'user'][-1]
        # The runtime may prepend its generated skill reminder at this boundary.
        if queued.startswith('<system-reminder>'):
            queued = queued.split('</system-reminder>', 1)[1]
        assert queued == expected + '\n第二行', 'model received a modified queued draft'
        events = [json.loads(line) for f in (config / 'transcripts').glob('sess_*.jsonl')
            for line in f.read_text().splitlines()]
        assert [e['value'] for e in events if e.get('type') == 'input_queue_submit'] == [expected + '\n第二行']
        assert target.exists() == (decision == 'allow')
        if target.exists(): assert target.read_text() == 'SYNTHETIC_WRITE'
        tty.send_text('/exit'); tty.send_key('Enter'); time.sleep(1)
        saved = json.loads(next((config / 'sessions').glob('sess_*.json')).read_text())
        assert saved['intentDelegation']['ownership']['state'] == 'released'
        (root / 'result.json').write_text(json.dumps({'passed': True, 'decision': decision, 'entry': str(entry),
            'thinkingDraftVisible': True, 'resizePassed': True, 'multilineQueueExact': True,
            'approvalKeysExcluded': True, 'ownershipReleased': True}, indent=2))
        print(f'PASS: {decision}; Thinking draft before/after prompt; edits, resize, multiline queue; exact next input')
    finally:
        release_tool.set(); release_answer.set(); tty.stop(); server.close()
        remaining = list(owned); deadline = time.monotonic() + 5
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
    parser.add_argument('--decision', choices=['allow', 'deny'])
    args = parser.parse_args()
    for choice in [args.decision] if args.decision else ['allow', 'deny']:
        run((args.cli_entry or args.project_dir / 'dist/index.js').resolve(), choice)
