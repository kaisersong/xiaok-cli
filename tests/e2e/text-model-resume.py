#!/usr/bin/env python3
"""Resume retained images against a text-only local API using the real CLI.

Optional --session-file checks a private session COPY locally. Never publishes
its data or sends it to an external provider; output stays in a private temp dir.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import time


def run(project: Path, entry: Path, session_file: Path | None):
    spec = importlib.util.spec_from_file_location('helpers', Path(__file__).with_name('tmux-e2e.py'))
    helpers = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helpers)
    root = Path(tempfile.mkdtemp(prefix='xiaok-text-resume-'))
    work, config, home = root / 'project', root / 'config', root / 'home'
    work.mkdir(); home.mkdir(); (config / 'sessions').mkdir(parents=True)
    now = int(time.time() * 1000)
    if session_file:
        source_bytes = session_file.read_bytes()
        snapshot = json.loads(source_bytes)
        # Only the isolated copy is released; the user's source is read-only.
        if snapshot.get('intentDelegation'):
            snapshot['intentDelegation']['ownership']['state'] = 'released'
            snapshot['intentDelegation']['ownership'].pop('ownerInstanceId', None)
    else:
        snapshot = {'schemaVersion': 1, 'sessionId': 'sess_synthetic_image_resume', 'cwd': str(work),
            'createdAt': now, 'updatedAt': now, 'lineage': [], 'model': 'GLM-5.3',
            'messages': [{'role': 'user', 'content': [{'type': 'text', 'text': 'Retained question.'},
                {'type': 'image', 'source': {'type': 'base64', 'media_type': 'image/png', 'data': 'YWJj'}}]},
                {'role': 'assistant', 'content': [{'type': 'text', 'text': 'Retained answer.'}]}],
            'usage': {'inputTokens': 0, 'outputTokens': 0}, 'compactions': [],
            'memoryRefs': [], 'approvalRefs': [], 'backgroundJobRefs': []}
    original_messages = snapshot['messages']
    original_compactions = snapshot['compactions']
    sid = snapshot['sessionId']
    target = config / 'sessions' / f'{sid}.json'
    target.write_text(json.dumps(snapshot, ensure_ascii=False))
    socket = f'xiaok-text-resume-{os.getpid()}'

    class TextOnlyServer(helpers.FakeOpenAIServer):
        def _handler_class(self):
            from http.server import BaseHTTPRequestHandler
            outer = self

            class Handler(BaseHTTPRequestHandler):
                def do_POST(self):
                    body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                    outer.requests.append(body)
                    invalid = any(isinstance(m.get('content'), list) and any(p.get('type') != 'text' for p in m['content'])
                                  for m in body['messages'])
                    if invalid:
                        self.send_response(400); self.end_headers()
                        self.wfile.write(b'{"error":{"code":"1210","message":"messages.content.type only supports text"}}')
                        return
                    self.send_response(200); self.send_header('Content-Type', 'text/event-stream'); self.end_headers()
                    compact = body['messages'][0].get('content', '').startswith('CRITICAL: Respond with TEXT ONLY.')
                    if compact:
                        outer.compactions += 1
                    answer = 'Synthetic compact context preserving the retained task.' if compact else outer._next_response()
                    for event in helpers.text_response_events(answer):
                        self.wfile.write(('data: ' + json.dumps(event) + '\n\n').encode())
                    self.wfile.write(b'data: [DONE]\n\n')

                def log_message(self, *_): pass

            return Handler

    class IsolatedTmux(helpers.TmuxHarness):
        def tmux(self, *args, **kwargs):
            return super().tmux('-L', socket, *args, **kwargs)

    server = TextOnlyServer(['HISTORY_RESUMED_OK', 'NEXT_TURN_OK'])
    server.compactions = 0
    tty = IsolatedTmux('text-resume', work, config, home, entry, helpers.resolve_tmux_binary(),
        auto_mode=False, extra_args=['--resume', sid], env_overrides={'XIAOK_DISABLE_GLOBAL_PLUGINS': '1'})
    owned = []

    def wait_for(predicate, name):
        screen = tty.wait_for(predicate, timeout=40)
        (root / f'{name}.txt').write_text(screen)
        assert predicate(screen), f'{name} failed; inspect {root}'

    try:
        server.start()
        settings = {'schemaVersion': 2, 'defaultProvider': 'text-probe', 'defaultModelId': 'text-probe',
            'providers': {'text-probe': {'type': 'custom', 'protocol': 'openai_legacy',
                'baseUrl': server.base_url, 'apiKey': 'synthetic-test-key'}},
            'models': {'text-probe': {'provider': 'text-probe', 'model': 'GLM-5.3',
                'runtimeOptions': {'contextLimit': 1048576}}}, 'defaultMode': 'interactive', 'channels': {}}
        settings.update({'memory': {'enabled': False}, 'automations': {'enabled': False}, 'intentBoundary': {'enabled': False}})
        (config / 'config.json').write_text(json.dumps(settings))
        tty.start(cols=120, rows=32)
        owned.append(int(tty.tmux('display-message', '-p', '-t', tty.session, '#{pane_pid}').stdout))
        wait_for(helpers.has_ready_input_prompt, 'ready')
        tty.send_text('Continue from the retained history.'); tty.send_key('Enter')
        wait_for(lambda s: 'HISTORY_RESUMED_OK' in s and helpers.has_ready_input_prompt(s), 'resumed')
        tty.send_text('Confirm the next turn works.'); tty.send_key('Enter')
        wait_for(lambda s: 'NEXT_TURN_OK' in s and helpers.has_ready_input_prompt(s), 'next-turn')
        assert len(server.requests) == 2 + server.compactions, 'unexpected retries'
        for request in server.requests:
            assert all(not isinstance(m.get('content'), list) or all(p['type'] == 'text' for p in m['content'])
                       for m in request['messages'])
        assert any(isinstance(m.get('content'), str) and 'Original image retained' in m['content']
                   for request in server.requests for m in request['messages'])
        tty.send_text('/exit'); tty.send_key('Enter'); time.sleep(1)
        final = json.loads(target.read_text())
        if not server.compactions:
            assert final['messages'][:len(original_messages)] == original_messages, 'persisted history changed'
            assert final['compactions'] == original_compactions
        else:
            # A large real copy may cross the existing model budget. Exercise
            # the compaction request too; never raise the budget to hide it.
            assert session_file, 'synthetic fixture unexpectedly compacted'
            assert final['compactions'][:len(original_compactions)] == original_compactions
            assert len(final['compactions']) == len(original_compactions) + server.compactions
            assert final['compactions'][-1]['replacedMessages'] > 0
        if session_file:
            assert session_file.read_bytes() == source_bytes, 'original private session changed during test'
        assert final['intentDelegation']['ownership']['state'] == 'released'
        (root / 'result.json').write_text(json.dumps({'passed': True, 'entry': str(entry),
            'retainedMessages': len(original_messages), 'retainedCompactions': len(original_compactions),
            'retainedImages': sum(b['type'] == 'image' for m in original_messages for b in m['content']),
            'textOnlyRequests': len(server.requests), 'compactionRequests': server.compactions,
            'originalSourceUnchanged': True, 'sourceDigest': hashlib.sha256(source_bytes).hexdigest() if session_file else None,
            'historyPrefixUnchanged': not server.compactions}, indent=2))
        print(f'PASS: retained images -> text-only resume -> next turn; source unchanged; compactions exercised={server.compactions}')
    finally:
        tty.stop(); server.close()
        remaining = []
        for pid in owned:
            try: os.kill(pid, 0); remaining.append(pid)
            except ProcessLookupError: pass
        (root / 'owned-pids.json').write_text(json.dumps({'pids': owned, 'remaining': remaining}))
        print(f'CLEANUP: owned CLI processes remaining={len(remaining)}; local SSE closed')
        print('EVIDENCE', root)
        assert not remaining


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--project-dir', type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument('--cli-entry', type=Path)
    parser.add_argument('--session-file', type=Path)
    args = parser.parse_args()
    run(args.project_dir.resolve(), (args.cli_entry or args.project_dir / 'dist/index.js').resolve(), args.session_file)
