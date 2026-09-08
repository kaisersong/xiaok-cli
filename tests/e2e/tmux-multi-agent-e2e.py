#!/usr/bin/env python3
"""Real dist CLI/TTY progress and in-flight message acceptance; local SSE only."""
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


def run(project: Path) -> None:
    root = Path(tempfile.mkdtemp(prefix='xiaok-subagent-tty-'))
    home = root / 'home'
    config = root / 'config'
    work = root / 'project'
    for directory in (home, config, work):
        directory.mkdir()
    release = threading.Event()
    child_started = threading.Event()
    state = {'main': 0, 'runtime': 0, 'live_received': False}
    requests: list[dict] = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:
            request = json.loads(self.rfile.read(int(self.headers['content-length'])))
            requests.append(request)
            messages = request.get('messages', [])
            system = next((str(m.get('content', '')) for m in messages if m['role'] == 'system'), '')
            if 'You are subagent /root/review_runtime ' in system:
                state['runtime'] += 1
                if state['runtime'] == 1:
                    child_started.set()
                    release.wait(20)
                    events = common['tool_call_response_events']('bash', {
                        'command': 'node -e "setTimeout(() => process.stdout.write(\'READ_ONLY_PROBE\'), 2500)"',
                    }, 'runtime_probe')
                else:
                    state['live_received'] = 'MAIN_LIVE_TTY_MESSAGE' in str(messages[-1].get('content', ''))
                    events = common['text_response_events']('RUNTIME_ACK')
            elif 'You are subagent /root/review_tests ' in system:
                events = common['text_response_events']('TESTS_DONE')
            else:
                step = state['main']
                state['main'] += 1
                if step == 0:
                    events = common['tool_call_response_events']('spawn_agent', {'task_name': 'review_runtime', 'message': 'read only runtime review', 'tools': ['bash']}, 'spawn_runtime')
                elif step == 1:
                    events = common['tool_call_response_events']('spawn_agent', {'task_name': 'review_tests', 'message': 'read only test review'}, 'spawn_tests')
                elif step == 2:
                    child_started.wait(10)
                    events = common['tool_call_response_events']('send_message', {'target': '/root/review_runtime', 'message': 'MAIN_LIVE_TTY_MESSAGE'}, 'send_runtime')
                elif step == 3:
                    events = common['tool_call_response_events']('wait_agent', {'targets': ['/root/review_runtime'], 'timeout_ms': 10000}, 'wait_runtime')
                elif step == 4:
                    events = common['tool_call_response_events']('close_agent', {'target': '/root/review_runtime'}, 'close_runtime')
                elif step == 5:
                    events = common['tool_call_response_events']('close_agent', {'target': '/root/review_tests'}, 'close_tests')
                else:
                    events = common['text_response_events']('TTY_MULTI_AGENT_PASS')
            self.send_response(200)
            self.send_header('content-type', 'text/event-stream')
            self.send_header('connection', 'close')
            self.end_headers()
            try:
                for event in events:
                    self.wfile.write(('data: ' + json.dumps(event) + '\n\n').encode())
                self.wfile.write(b'data: [DONE]\n\n')
                self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                pass

        def log_message(self, *_args: object) -> None:
            pass

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    common['write_config'](config, f'http://127.0.0.1:{server.server_address[1]}/v1')
    tty = common['TmuxHarness'](f'xiaok-subagent-tty-{os.getpid()}', work, config, home, project / 'dist' / 'index.js', common['resolve_tmux_binary']())
    try:
        tty.start(cols=120, rows=24)
        welcome = tty.wait_for(common['has_welcome_screen'], timeout=20)
        (root / 'welcome.txt').write_text(welcome)
        tty.send_text('TTY read-only multi-agent review')
        tty.send_key('Enter')
        pane = tty.wait_for(lambda text: 'SubAgent' in text and '双鱼座' in text and '天秤座' in text and '完成' in text, timeout=20)
        (root / 'waiting.txt').write_text(pane)
        lines = pane.splitlines()
        activity = next(i for i, line in enumerate(lines) if 'SubAgent ' in line and '模型请求' in line)
        prompt = max(i for i, line in enumerate(lines) if common['is_input_prompt_line'](line))
        assert activity < prompt and any(not line.strip() for line in lines[activity + 1:prompt]), pane
        assert '模型请求' in lines[activity], pane
        release.set()
        tool_pane = tty.wait_for(lambda text: any('SubAgent' in line and 'bash' in line for line in text.splitlines()), timeout=10)
        (root / 'tool.txt').write_text(tool_pane)
        final = tty.wait_for(lambda text: 'TTY_MULTI_AGENT_PASS' in text and common['has_ready_input_prompt'](text), timeout=20)
        (root / 'final.txt').write_text(final)
        assert state['live_received'], 'running child did not consume the message after its tool batch'
        transcripts = list((config / 'transcripts').glob('*.jsonl'))
        events = [json.loads(line) for path in transcripts for line in path.read_text().splitlines()]
        progress = [event['event'] for event in events if event['type'] == 'multi_agent']
        assert any(e['agent'].get('currentTool') == 'bash' for e in progress)
        assert any(e['kind'] == 'message_consumed' and e.get('message', {}).get('text') == 'MAIN_LIVE_TTY_MESSAGE' for e in progress)
        assert len({e['agent']['id'] for e in progress if e['agent'].get('parentId')}) == 2
        print(f'PASS: visible two-child progress, model/tool phases, footer gap, in-flight message, final input; evidence={root}', flush=True)
    finally:
        release.set()
        tty.stop()
        server.shutdown()
        server.server_close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--project-dir', default=os.getcwd())
    run(Path(parser.parse_args().project_dir).resolve())
