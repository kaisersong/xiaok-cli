#!/usr/bin/env python3
"""Real CLI/TTY and reminder client; only daemon delivery and model SSE are fixtures."""
import hashlib, json, os, pwd, runpy, socket, tempfile, threading, time, sys
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

common = runpy.run_path(str(Path(__file__).with_name('tmux-e2e.py')))
root = Path(tempfile.mkdtemp(prefix='xiaok-reminder-e2e-'))
home, config, work = (root / name for name in ('home', 'config', 'work'))
for folder in (home, config, work): folder.mkdir()
sock_path = Path(tempfile.gettempdir()) / ('xiaok-daemon-' + hashlib.sha256(f'{pwd.getpwuid(os.getuid()).pw_name}:{home}'.encode()).hexdigest()[:16] + '.sock')
daemon = socket.socket(socket.AF_UNIX); daemon.bind(str(sock_path)); daemon.listen()
connected = threading.Event(); peer = {}; release = threading.Event()
def serve_daemon():
    connection, _ = daemon.accept(); peer['socket'] = connection
    for raw in connection.makefile('r'):
        message = json.loads(raw)
        if message['type'] == 'hello':
            peer['session'] = message['sessionId']
            connection.sendall((json.dumps({'type':'hello_ack','daemonVersion':'test','protocolVersion':1,'sentAt':int(time.time()*1000)})+'\n').encode())
            connected.set()
        elif message['type'] == 'rpc':
            connection.sendall((json.dumps({'type':'rpc_result','id':message['id'],'result':[]})+'\n').encode())
threading.Thread(target=serve_daemon, daemon=True).start()
class Model(BaseHTTPRequestHandler):
    def do_POST(self):
        self.rfile.read(int(self.headers['content-length']))
        self.send_response(200); self.send_header('content-type','text/event-stream'); self.end_headers()
        try:
            for event in common['text_response_events']('STREAMING_STARTED\n\n'):
                self.wfile.write(('data: '+json.dumps(event)+'\n\n').encode())
                self.wfile.flush()
                if (event.get('choices') or [{}])[0].get('delta',{}).get('content'): release.wait(20)
            self.wfile.write(b'data: [DONE]\n\n'); self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError): pass
    def log_message(self,*args): pass
server=ThreadingHTTPServer(('127.0.0.1',0),Model)
threading.Thread(target=server.serve_forever,daemon=True).start()
common['write_config'](config,f'http://127.0.0.1:{server.server_address[1]}/v1')
tty=common['TmuxHarness'](f'xiaok-reminder-{os.getpid()}',work,config,home,Path.cwd()/'dist/index.js',common['resolve_tmux_binary']())
def deliver(marker):
    peer['socket'].sendall((json.dumps({'type':'service_event','service':'reminder','name':'delivery','payload':{'sessionId':peer['session'],'reminderId':marker,'message':marker+' 跟踪下载进度，完成后验证','content':marker,'createdAt':int(time.time()*1000),'taskType':'reminder'}})+'\n').encode())
def check(marker, draft):
    text=tty.wait_for(lambda t:marker in t and draft in t,timeout=8)
    cursor=int(tty.tmux('display-message','-p','-t',tty.session,'#{cursor_y}').stdout.strip())
    lines=text.splitlines(); inputs=[i for i,line in enumerate(lines) if '❯' in line and draft in line]
    (root/(marker+'.txt')).write_text(text+f'\ncursor_y={cursor}\n')
    assert marker in text, text
    assert inputs and cursor in inputs, f'cursor {cursor} is not in draft rows {inputs}\n{text}'
    assert next(i for i,line in enumerate(lines) if marker in line)<inputs[-1], text
try:
    tty.start(cols=110,rows=24)
    tty.wait_for(common['has_welcome_screen'],timeout=20); assert connected.wait(10)
    tty.send_text('draft-kept'); time.sleep(.3)
    deliver('IDLE_REMINDER'); check('IDLE_REMINDER','draft-kept')
    tty.tmux('resize-window','-t',tty.session,'-x','65','-y','18'); time.sleep(.3)
    deliver('NARROW_REMINDER'); check('NARROW_REMINDER','draft-kept')
    tty.send_key('C-u'); tty.send_text('/models'); time.sleep(.3)
    deliver('POPUP_REMINDER'); time.sleep(.3)
    assert 'POPUP_REMINDER' not in tty.capture(), 'notification overwrote slash popup'
    tty.send_key('Escape'); tty.send_key('C-u'); tty.send_text('hello'); tty.send_key('Enter')
    stream = tty.wait_for(lambda t:'STREAMING_STARTED' in t,timeout=8)
    assert 'STREAMING_STARTED' in stream, stream
    deliver('BUSY_REMINDER'); time.sleep(.3)
    assert 'BUSY_REMINDER' not in tty.capture(), 'notification interrupted model stream'
    release.set(); tty.wait_for(lambda t:'BUSY_REMINDER' in t,timeout=20)
    tty.wait_for(lambda t: 'Finishing response' not in t and common['has_input_prompt'](t),timeout=10)
    tty.send_text('after-stream'); check('BUSY_REMINDER','after-stream')
    print('PASS idle draft, narrow resize, popup, streamed response; evidence='+str(root)+'; session='+tty.session,flush=True)
    if '--keep-open' in sys.argv:
        while True: time.sleep(1)
finally:
    release.set(); tty.stop(); server.shutdown(); server.server_close(); daemon.close(); sock_path.unlink(missing_ok=True)
