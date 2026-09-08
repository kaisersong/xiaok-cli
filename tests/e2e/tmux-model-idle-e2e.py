#!/usr/bin/env python3
"""Real CLI with a connected SSE server that never produces a response."""
import json, os, runpy, sys, tempfile, threading, time
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
common = runpy.run_path(str(Path(__file__).with_name('tmux-e2e.py')))
root = Path(tempfile.mkdtemp(prefix='xiaok-model-idle-e2e-'))
home, config, work = (root / name for name in ('home', 'config', 'work'))
for folder in (home, config, work): folder.mkdir()
release = threading.Event()
requests = []
class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['content-length'])))
        requests.append(body)
        self.send_response(200); self.send_header('content-type', 'text/event-stream'); self.end_headers()
        self.wfile.flush()
        if len(requests) == 1:
            release.wait(20)
            return
        try:
            for event in common['text_response_events']('RESUMED_NEW_REPLY' if len(requests) >= 3 else 'RECOVERED_NEXT_TURN'):
                self.wfile.write(('data: '+json.dumps(event)+'\n\n').encode())
            self.wfile.write(b'data: [DONE]\n\n'); self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError): pass
    def log_message(self,*args): pass
server = ThreadingHTTPServer(('127.0.0.1',0), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
common['write_config'](config, f'http://127.0.0.1:{server.server_address[1]}/v1')
tty = common['TmuxHarness'](f'xiaok-idle-{os.getpid()}',work,config,home,Path.cwd()/'dist'/'index.js',common['resolve_tmux_binary'](),env_overrides={'XIAOK_TURN_TIMEOUT_MS':'1000','XIAOK_MODEL_RECOVERY_WINDOW_MS':'15000'})
try:
    tty.start(cols=110, rows=24)
    assert common['has_welcome_screen'](tty.wait_for(common['has_welcome_screen'],timeout=15))
    tty.send_text('hello'); tty.send_key('Enter')
    if '--cancel' in sys.argv:
        notice = tty.wait_for(lambda t:'自动续接' in t,timeout=10)
        assert '自动续接' in notice, notice
        tty.send_key('Escape')
        time.sleep(3)
        assert len(requests) == 1, 'user cancellation incorrectly retried'
        tty.send_text('next question'); tty.send_key('Enter')
    recovered = tty.wait_for(lambda t:'RECOVERED_NEXT_TURN' in t,timeout=15)
    (root/'recovered.txt').write_text(recovered)
    assert 'RECOVERED_NEXT_TURN' in recovered, recovered
    assert len(requests) == 2, len(requests)
    tty.send_text('/exit'); tty.send_key('Enter')
    tty.wait_for(lambda t: 'Pane is dead' in t,timeout=15)
    tty.stop()
    tty.extra_args = ['-c']
    tty.start(cols=110, rows=24)
    welcome = tty.wait_for(common['has_welcome_screen'],timeout=15)
    (root/'resume-welcome.txt').write_text(welcome)
    assert common['has_welcome_screen'](welcome), welcome
    tty.send_text('resumed question'); tty.send_key('Enter')
    resumed = tty.wait_for(lambda t:'RESUMED_NEW_REPLY' in t,timeout=15)
    (root/'resumed.txt').write_text(resumed)
    assert 'RESUMED_NEW_REPLY' in resumed, resumed
    assert len(requests) == 3, len(requests)
    print(f'PASS: mode={"cancel" if "--cancel" in sys.argv else "automatic"}; stalled SSE automatically retried without user continuation, --auto -c usable; evidence={root}')
finally:
    release.set(); tty.stop(); server.shutdown(); server.server_close()
