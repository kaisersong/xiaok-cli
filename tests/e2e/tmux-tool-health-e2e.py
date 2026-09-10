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
protocol_errors=[]
class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        requests.append(json.loads(self.rfile.read(int(self.headers['content-length']))))
        pending=set()
        for message in requests[-1]['messages']:
            if message['role']=='tool':
                reply_id=message.get('tool_call_id')
                if reply_id not in pending:protocol_errors.append('orphan or duplicate tool reply')
                pending.discard(reply_id)
            else:
                if pending:protocol_errors.append('missing tool replies before next message')
                pending={call['id'] for call in message.get('tool_calls',[])}
        if pending:protocol_errors.append('missing tool replies at request end')
        if protocol_errors:
            self.send_response(400);self.end_headers();self.wfile.write(b'{"error":{"message":"insufficient tool messages following tool_calls message"}}');return
        events=common['tool_call_response_events']('bash',{'command':'printf "%s" "$$" > owner.pid; sleep 60','timeout_ms':65000},'held') if len(requests)==1 else common['text_response_events']('NEXT_TURN_OK')
        if len(requests)==1:
            tool_calls=events[0]['choices'][0]['delta']['tool_calls']
            tool_calls[0]['index']=1
            events[1]['choices'][0]['delta']['tool_calls'][0]['index']=1
            tool_calls.insert(0,{'index':0,'id':'completed','type':'function','function':{'name':'bash','arguments':json.dumps({'command':'echo completed-side-effect'})}})
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
    assert not protocol_errors,protocol_errors
    replies=[m for m in requests[-1]['messages'] if m['role']=='tool']
    assert [m['tool_call_id'] for m in replies]==['completed','held'],replies
    assert 'completed-side-effect' in replies[0]['content']
    (root/'requests.json').write_text(json.dumps(requests,ensure_ascii=False,indent=2))
    print(f'PASS: real tool idle cancellation, owned shell exited, no automatic replay, next turn usable; evidence={root}')
finally:tty.stop();server.shutdown();server.server_close()
