#!/usr/bin/env python3
"""Real CLI: forced HTTP truncation after a completed tool, automatic continuation."""
import json, os, runpy, socket, tempfile, threading
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
common=runpy.run_path(str(Path(__file__).with_name('tmux-e2e.py')))
root=Path(tempfile.mkdtemp(prefix='xiaok-model-recovery-e2e-'))
home,config,work=(root/n for n in ('home','config','work'))
for p in (home,config,work):p.mkdir()
requests=[]
class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        body=json.loads(self.rfile.read(int(self.headers['content-length'])));requests.append(body)
        if len(requests)==2:
            self.send_response(200);self.send_header('content-type','text/event-stream');self.send_header('content-length','999999');self.end_headers()
            event={'id':'cut','object':'chat.completion.chunk','choices':[{'index':0,'delta':{'content':'PARTIAL_BEFORE_DROP'},'finish_reason':None}]}
            self.wfile.write(('data: '+json.dumps(event)+'\n\n').encode());self.wfile.flush()
            self.connection.shutdown(socket.SHUT_RDWR);self.connection.close();return
        events=common['tool_call_response_events']('bash',{'command':'printf "effect\\n" >> effect.txt; printf "TOOL_DONE"'},'effect') if len(requests)==1 else common['text_response_events']('AUTO_RECOVERY_COMPLETE')
        self.send_response(200);self.send_header('content-type','text/event-stream');self.end_headers()
        try:
            for event in events:self.wfile.write(('data: '+json.dumps(event)+'\n\n').encode())
            self.wfile.write(b'data: [DONE]\n\n');self.wfile.flush()
        except (BrokenPipeError,ConnectionResetError):pass
    def log_message(self,*args):pass
server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
threading.Thread(target=server.serve_forever,daemon=True).start()
common['write_config'](config,f'http://127.0.0.1:{server.server_address[1]}/v1')
tty=common['TmuxHarness'](f'xiaok-recovery-{os.getpid()}',work,config,home,Path.cwd()/'dist'/'index.js',common['resolve_tmux_binary'](),env_overrides={'XIAOK_MODEL_RECOVERY_WINDOW_MS':'15000'})
try:
    tty.start(cols=110,rows=24)
    assert common['has_welcome_screen'](tty.wait_for(common['has_welcome_screen'],timeout=15))
    tty.send_text('run recovery fixture');tty.send_key('Enter')
    screen=tty.wait_for(lambda t:'AUTO_RECOVERY_COMPLETE' in t,timeout=25)
    (root/'complete.txt').write_text(screen)
    assert 'AUTO_RECOVERY_COMPLETE' in screen,screen
    assert len(requests)==3,len(requests)
    assert (work/'effect.txt').read_text()=='effect\n','tool side effect repeated'
    assert 'TOOL_DONE' in json.dumps(requests[2]),'completed tool context lost'
    assert 'PARTIAL_BEFORE_DROP' in json.dumps(requests[2]),'partial visible context lost'
    history=tty.tmux('capture-pane','-p','-S','-','-t',tty.session).stdout
    (root/'history.txt').write_text(history)
    assert '自动续接' in history,'recovery status missing'
    assert 'Error: model_failed' not in history,'recoverable error terminated user turn'
    print(f'PASS: actual HTTP truncation recovered automatically, completed tool executed once; evidence={root}')
finally:
    tty.stop();server.shutdown();server.server_close()
