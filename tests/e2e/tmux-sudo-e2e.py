#!/usr/bin/env python3
"""Real CLI + native PTY, fake sudo password, no privileged actions."""
import json
import os
from pathlib import Path
import runpy
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

common = runpy.run_path(str(Path(__file__).with_name('tmux-e2e.py')))
project = Path.cwd()
root = Path(tempfile.mkdtemp(prefix='xiaok-sudo-e2e-'))
home, config, work, binaries = (root / name for name in ('home', 'config', 'work', 'bin'))
for folder in (home, config, work, binaries): folder.mkdir()
secret = 'TEST_ONLY_SECRET_6429'
(binaries / 'sudo').write_text('''#!/bin/sh
if [ "$1" = "--wait" ]; then
  echo WAIT_READY
  sleep 60
  exit 0
fi
printf 'SUDO_PASSWORD:'
read -r secret
[ "$secret" = "TEST_ONLY_SECRET_6429" ] || exit 2
printf '\\nSUDO_FIXTURE_OK\\n'
''')
(binaries / 'sudo').chmod(0o755)
requests = []
release = threading.Event()
class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['content-length'])))
        requests.append(body)
        users = [m.get('content', '') for m in body['messages'] if m['role'] == 'user']
        latest = str(users[-1]) if users else ''
        if 'CANCEL_CASE' in latest:
            events = common['tool_call_response_events']('bash', {'command': 'sudo --wait'}, 'cancel_sudo')
        elif 'NEXT_CASE' in latest:
            events = common['text_response_events']('NEXT_TURN_OK')
        elif len(requests) == 1:
            release.wait(15)
            events = common['tool_call_response_events']('bash', {'command': 'sudo id -u'}, 'sudo_auth')
        else:
            events = common['text_response_events']('SUDO_TURN_OK')
        self.send_response(200); self.send_header('content-type','text/event-stream'); self.end_headers()
        try:
            for event in events: self.wfile.write(('data: '+json.dumps(event)+'\n\n').encode())
            self.wfile.write(b'data: [DONE]\n\n'); self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError): pass
    def log_message(self,*args): pass
server = ThreadingHTTPServer(('127.0.0.1',0),Handler)
threading.Thread(target=server.serve_forever,daemon=True).start()
common['write_config'](config,f'http://127.0.0.1:{server.server_address[1]}/v1')
tty = common['TmuxHarness'](f'xiaok-sudo-{os.getpid()}',work,config,home,project/'dist'/'index.js',common['resolve_tmux_binary'](),env_overrides={'PATH':str(binaries)+os.pathsep+os.environ['PATH']})
def wait(predicate, name, timeout=20):
    text = tty.wait_for(predicate,timeout=timeout)
    (root/(name+'.txt')).write_text(text)
    assert predicate(text), f'{name}: {text}'
    return text
try:
    tty.start(cols=110,rows=24)
    wait(common['has_welcome_screen'],'welcome')
    tty.send_text('SUDO_CASE');tty.send_key('Enter')
    wait(lambda t:'Thinking' in t,'thinking')
    tty.send_text('KEEP_DRAFT')
    wait(lambda t:'KEEP_DRAFT' in t,'draft')
    release.set()
    wait(lambda t:'SUDO_PASSWORD:' in t,'password')
    tty.send_text(secret);tty.send_key('Enter')
    final=wait(lambda t:'SUDO_TURN_OK' in t and 'KEEP_DRAFT' in t,'finished')
    assert secret not in final
    history=tty.tmux('capture-pane','-p','-S','-','-t',tty.session).stdout
    assert secret not in history
    transcripts='\n'.join(p.read_text() for p in (config/'transcripts').glob('*.jsonl'))
    assert secret not in transcripts, 'password leaked into transcript'
    assert secret not in json.dumps(requests), 'password leaked into provider request'
    assert 'SUDO_FIXTURE_OK' in json.dumps(requests), 'command output did not reach model'
    tty.send_key('C-u');tty.send_text('CANCEL_CASE');tty.send_key('Enter')
    wait(lambda t:'WAIT_READY' in t,'cancel-ready')
    tty.send_key('Escape')
    wait(lambda t:'中断' in t or 'Interrupted' in t or 'Request cancelled' in t,'cancelled')
    tty.send_text('NEXT_CASE');tty.send_key('Enter')
    wait(lambda t:'NEXT_TURN_OK' in t,'next-turn')
    print(f'PASS: real CLI sudo PTY, hidden password, no transcript/provider leak, draft, cancellation and next turn; evidence={root}',flush=True)
finally:
    release.set();tty.stop();server.shutdown();server.server_close()
