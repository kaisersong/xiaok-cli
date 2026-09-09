#!/usr/bin/env python3
"""Real CLI: stalled shell cancellation waits for process exit, then accepts next turn."""
import json, os, runpy, tempfile, threading, time
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
common=runpy.run_path(str(Path(__file__).with_name('tmux-e2e.py')))
root=Path(tempfile.mkdtemp(prefix='xiaok-tool-health-e2e-'))
home,config,work=(root/n for n in ('home','config','work'))
for p in (home,config,work):p.mkdir()
requests=[]
class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        requests.append(json.loads(self.rfile.read(int(self.headers['content-length']))))
        events=common['tool_call_response_events']('bash',{'command':'printf "%s" "$$" > owner.pid; sleep 60','timeout_ms':65000},'held') if len(requests)==1 else common['text_response_events']('NEXT_TURN_OK')
        self.send_response(200);self.send_header('content-type','text/event-stream');self.end_headers()
        try:
            for event in events:self.wfile.write(('data: '+json.dumps(event)+'\n\n').encode())
            self.wfile.write(b'data: [DONE]\n\n');self.wfile.flush()
        except (BrokenPipeError,ConnectionResetError):pass
    def log_message(self,*args):pass
server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
threading.Thread(target=server.serve_forever,daemon=True).start()
common['write_config'](config,f'http://127.0.0.1:{server.server_address[1]}/v1')
tty=common['TmuxHarness'](f'xiaok-tool-health-{os.getpid()}',work,config,home,Path.cwd()/'dist'/'index.js',common['resolve_tmux_binary'](),env_overrides={'XIAOK_TOOL_IDLE_TIMEOUT_MS':'1000'})
try:
    tty.start(cols=110,rows=24)
    assert common['has_welcome_screen'](tty.wait_for(common['has_welcome_screen'],timeout=15))
    tty.send_text('run stalled tool fixture');tty.send_key('Enter')
    screen=tty.wait_for(lambda t:'TOOL_IDLE_TIMEOUT' in t,timeout=15)
    assert 'TOOL_IDLE_TIMEOUT' in screen,screen
    pid=int((work/'owner.pid').read_text())
    try:os.kill(pid,0)
    except ProcessLookupError:pass
    else:raise AssertionError('tool reported terminal error while owned shell still alive')
    assert len(requests)==1,'tool failure unexpectedly retried model/action'
    tty.send_text('next');tty.send_key('Enter')
    screen=tty.wait_for(lambda t:'NEXT_TURN_OK' in t,timeout=15)
    assert 'NEXT_TURN_OK' in screen,screen
    (root/'screen.txt').write_text(screen)
    assert len(requests)==2
    print(f'PASS: real tool idle cancellation, owned shell exited, no automatic replay, next turn usable; evidence={root}')
finally:tty.stop();server.shutdown();server.server_close()
