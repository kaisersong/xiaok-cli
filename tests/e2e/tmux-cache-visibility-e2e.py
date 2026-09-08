#!/usr/bin/env python3
"""Real TUI output boundary through the cache observer; synthetic SSE, never ROI."""
import argparse
import json
import os
from pathlib import Path
import runpy
import shutil
import subprocess
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

common = runpy.run_path(str(Path(__file__).with_name('tmux-e2e.py')))


def run(project: Path, evidence: Path) -> None:
    root = Path(tempfile.mkdtemp(prefix='xiaok-cache-tui-'))
    work, config, home = (root / p for p in ('work', 'config', 'home'))
    for p in (work, config, home):
        p.mkdir()
    (work / 'cache-visible.txt').write_text('CACHE_READ_OK\n')
    hidden, partial, called = (threading.Event() for _ in range(3))
    allow_partial, allow_complete, allow_final = (threading.Event() for _ in range(3))
    observations = {}
    errors = []

    def event(delta, reason=None):
        return ('data: ' + json.dumps({'choices': [{'index': 0, 'delta': delta, 'finish_reason': reason}]}) + '\n\n').encode()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_POST(self):
            request = json.loads(self.rfile.read(int(self.headers['content-length'])))
            self.send_response(200)
            self.send_header('content-type', 'text/event-stream')
            self.send_header('connection', 'close')
            self.end_headers()
            try:
                if not hidden.is_set():
                    observations['request_start'] = time.monotonic()
                    self.wfile.write(event({'reasoning_content': 'HIDDEN_CACHE_REASONING'})); self.wfile.flush(); hidden.set()
                    if not allow_partial.wait(20):
                        raise RuntimeError('partial gate timeout')
                    self.wfile.write(event({'tool_calls': [{'index': 0, 'id': 'cache_read', 'type': 'function', 'function': {'name': 'read', 'arguments': '{"file_path":'}}]})); self.wfile.flush(); partial.set()
                    if not allow_complete.wait(20):
                        raise RuntimeError('complete gate timeout')
                    observations['complete_tool_sent'] = time.monotonic()
                    self.wfile.write(event({'tool_calls': [{'index': 0, 'function': {'arguments': json.dumps(str(work / 'cache-visible.txt')) + '}'}}]}))
                    self.wfile.write(event({}, 'tool_calls') + b'data: [DONE]\n\n'); self.wfile.flush()
                else:
                    if not any(m.get('role') == 'tool' and 'CACHE_READ_OK' in str(m.get('content')) for m in request['messages']):
                        raise RuntimeError('real read result missing')
                    called.set()
                    if not allow_final.wait(20):
                        raise RuntimeError('final gate timeout')
                    observations['content_sent'] = time.monotonic()
                    self.wfile.write(event({'content': 'CACHE_TUI_FINISHED\n'}, 'stop') + b'data: [DONE]\n\n'); self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                pass
            except Exception as error:
                errors.append(str(error))

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    observer = subprocess.Popen([shutil.which('node'), str(project / 'scripts/evals/local-model-cache/run.mjs'), 'observe', '--upstream', f'http://127.0.0.1:{server.server_address[1]}', '--scope', 'fixture-main', '--out', str(root / 'wire.jsonl')], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    tty = None
    try:
        endpoint = json.loads(observer.stdout.readline())['listen']
        common['write_config'](config, endpoint + '/v1')
        tty = common['TmuxHarness'](f'xiaok-cache-{os.getpid()}', work, config, home, project / 'dist/index.js', common['resolve_tmux_binary']())
        tty.start(cols=110, rows=28)
        assert common['has_welcome_screen'](tty.wait_for(common['has_welcome_screen'], timeout=20))
        tty.send_text('只读检查当前目录文件'); tty.send_key('Enter')
        assert hidden.wait(20)
        pane = tty.capture()
        assert 'HIDDEN_CACHE_REASONING' not in pane and 'cache-visible.txt' not in pane
        allow_partial.set(); assert partial.wait(20)
        pane = tty.capture()
        assert 'cache-visible.txt' not in pane and not called.is_set()
        allow_complete.set(); assert called.wait(20)
        pane = tty.wait_for(lambda text: 'cache-visible.txt' in text, timeout=20)
        observations['tool_visible_capture'] = time.monotonic()
        assert 'cache-visible.txt' in pane and 'CACHE_TUI_FINISHED' not in pane
        allow_final.set()
        pane = tty.wait_for(lambda text: 'CACHE_TUI_FINISHED' in text, timeout=20)
        observations['content_visible_capture'] = time.monotonic()
        assert 'CACHE_TUI_FINISHED' in pane and not errors, (pane, errors)
        assert observations['complete_tool_sent'] <= observations['tool_visible_capture'] < observations['content_sent'] <= observations['content_visible_capture']
        evidence.write_text(json.dumps({'status': 'pass', 'mode': 'interactive-tmux-fixture', 'roi': False, 'seconds_from_request': {k: round(v - observations['request_start'], 6) for k, v in observations.items()}, 'checks': ['thinking-hidden', 'fragmented-tool-not-executed', 'complete-tool-visible-before-content', 'real-read-result']}, indent=2))
    finally:
        for e in (allow_partial, allow_complete, allow_final):
            e.set()
        if tty:
            tty.stop()
        observer.terminate()
        try:
            observer.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            observer.kill(); observer.communicate()
        server.shutdown(); server.server_close()
        shutil.rmtree(root, ignore_errors=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--project-dir', type=Path, default=Path.cwd())
    parser.add_argument('--evidence', type=Path, required=True)
    args = parser.parse_args()
    run(args.project_dir.resolve(), args.evidence.resolve())
    print('PASS: real TUI visibility through streaming observer')
