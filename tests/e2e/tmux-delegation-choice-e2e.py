#!/usr/bin/env python3
"""Real CLI/TTY choice transport; scripted SSE, not a model-judgment benchmark."""
from __future__ import annotations

import argparse
import json
import os
import runpy
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

common = runpy.run_path(str(Path(__file__).with_name('tmux-e2e.py')))


def run(project: Path, choice: str) -> None:
    root = Path(tempfile.mkdtemp(prefix=f'xiaok-delegation-{choice}-'))
    home, config, work = (root / name for name in ('home', 'config', 'project'))
    for directory in (home, config, work):
        directory.mkdir()
    state = {'requests': 0, 'children': 0, 'answer': None}
    errors: list[str] = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:
            try:
                request = json.loads(self.rfile.read(int(self.headers['content-length'])))
                messages = request.get('messages', [])
                system = next((str(m.get('content', '')) for m in messages if m['role'] == 'system'), '')
                assert '# CLI autonomous delegation' in system
                assert 'Interactive user input is available.' in system
                if 'You are subagent /root/review ' in system:
                    state['children'] += 1
                    events = common['text_response_events']('CHILD_REVIEW_COMPLETE')
                else:
                    step = state['requests']
                    state['requests'] += 1
                    if step == 0:
                        events = common['tool_call_response_events']('AskUserQuestion', {'questions': [{
                            'header': 'execution', 'question': '选择执行方式', 'options': [
                                {'label': '并行执行', 'description': '分别审查实现和测试，会增加模型调用'},
                                {'label': '主 Agent 单独完成', 'description': '减少额外调用'},
                            ],
                        }]}, 'ask_delegation')
                    elif step == 1:
                        result = json.loads(messages[-1]['content'])
                        state['answer'] = result['answers']['选择执行方式']
                        if choice == 'parallel':
                            assert state['answer'] == '并行执行', state
                            events = common['tool_call_response_events']('spawn_agent', {
                                'task_name': 'review', 'message': '只读检查测试覆盖', 'tools': ['read'],
                            }, 'spawn_review')
                        else:
                            expected = '主 Agent 单独完成' if choice == 'solo' else ''
                            assert state['answer'] == expected, state
                            events = common['text_response_events'](f'CHOICE_{choice.upper()}_PASS')
                    elif step == 2:
                        events = common['tool_call_response_events']('wait_agent', {
                            'targets': ['/root/review'], 'timeout_ms': 10000,
                        }, 'wait_review')
                    elif step == 3:
                        events = common['tool_call_response_events']('close_agent', {'target': '/root/review'}, 'close_review')
                    else:
                        events = common['text_response_events']('CHOICE_PARALLEL_PASS')
            except Exception as error:
                errors.append(repr(error))
                events = common['text_response_events']('CHOICE_FAILED')
            self.send_response(200)
            self.send_header('content-type', 'text/event-stream')
            self.send_header('connection', 'close')
            self.end_headers()
            for event in events:
                self.wfile.write(('data: ' + json.dumps(event) + '\n\n').encode())
            self.wfile.write(b'data: [DONE]\n\n')
            self.wfile.flush()

        def log_message(self, *_args: object) -> None:
            pass

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    common['write_config'](config, f'http://127.0.0.1:{server.server_address[1]}/v1')
    tty = common['TmuxHarness'](f'xiaok-choice-{choice}-{os.getpid()}', work, config, home,
                                project / 'dist' / 'index.js', common['resolve_tmux_binary']())
    try:
        tty.start(cols=120, rows=28)
        welcome = tty.wait_for(common['has_welcome_screen'], timeout=20)
        assert common['has_welcome_screen'](welcome), welcome
        tty.send_text('检查实现和测试覆盖；如果明显增加调用成本，先让我选择执行方式。')
        tty.send_key('Enter')
        menu = tty.wait_for(lambda text: '选择执行方式' in text and '主 Agent 单独完成' in text, timeout=20)
        (root / 'question.txt').write_text(menu)
        assert '选择执行方式' in menu and '主 Agent 单独完成' in menu, menu
        assert state['requests'] == 1 and state['children'] == 0 and state['answer'] is None, state
        if choice == 'solo':
            tty.send_key('Down')
        tty.send_key('Escape' if choice == 'cancel' else 'Enter')
        marker = f'CHOICE_{choice.upper()}_PASS'
        final = tty.wait_for(lambda text: marker in text and common['has_ready_input_prompt'](text), timeout=25)
        (root / 'final.txt').write_text(final)
        assert not errors, errors
        assert marker in final, final
        assert (state['children'] > 0) == (choice == 'parallel'), state
        events = [json.loads(line) for path in (config / 'transcripts').glob('*.jsonl') for line in path.read_text().splitlines()]
        children = [event['event']['agent'] for event in events if event['type'] == 'multi_agent' and event['event']['agent'].get('parentId')]
        if choice == 'parallel':
            assert any(agent.get('resourcesReleased') is True for agent in children), children
        else:
            assert not children, children
        print(f'PASS: choice={choice}, answer={state["answer"]!r}, child_requests={state["children"]}, evidence={root}', flush=True)
    finally:
        tty.stop()
        server.shutdown()
        server.server_close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--project-dir', default=os.getcwd())
    args = parser.parse_args()
    for selected in ('parallel', 'solo', 'cancel'):
        run(Path(args.project_dir).resolve(), selected)
