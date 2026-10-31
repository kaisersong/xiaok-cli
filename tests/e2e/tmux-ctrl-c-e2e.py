#!/usr/bin/env python3
"""Real TTY: Ctrl+C confirmation, retained draft, busy abort, SIGINT and hangup."""
import json, os, runpy, signal, sys, tempfile, time
from pathlib import Path
common=runpy.run_path(str(Path(__file__).with_name('tmux-e2e.py')))
root=Path(tempfile.mkdtemp(prefix='xiaok-ctrl-c-e2e-')).resolve()
server=common['FakeOpenAIServer'](['LATE_RESPONSE'],first_token_delay=4)
server.start()
def dead(tty):return tty.tmux('display-message','-p','-t',tty.session,'#{pane_dead}').stdout.strip()=='1'
def node_pid(config):
    for f in (config/'transcripts').glob('*.claims/*.claim'):
        return json.loads(f.read_text())['pid']
    raise AssertionError('missing production transcript owner')
try:
 for name in ('draft','expiry','busy','sigint','hangup'):
    home,config,work=(root/name/n for n in ('home','config','work'))
    for p in (home,config,work):p.mkdir(parents=True)
    common['write_config'](config,server.base_url)
    tty=common['TmuxHarness'](f'xiaok-ctrlc-{os.getpid()}-{name}',work,config,home,Path.cwd()/'dist'/'index.js',common['resolve_tmux_binary']())
    try:
        tty.start();screen=tty.wait_for(common['has_welcome_screen'],timeout=20)
        assert common['has_welcome_screen'](screen),screen
        if name=='hangup':
            os.kill(node_pid(config),signal.SIGHUP)
        else:
            if name=='busy':
                tty.send_text('slow request');tty.send_key('Enter')
                tty.wait_for(lambda t:'Thinking' in t,timeout=10)
            tty.send_text('KEEP_DRAFT');screen=tty.wait_for(lambda t:'KEEP_DRAFT' in t)
            assert 'KEEP_DRAFT' in screen,screen
            press=(lambda:os.kill(node_pid(config),signal.SIGINT)) if name=='sigint' else (lambda:tty.send_key('C-c'))
            press();screen=tty.wait_for(lambda t:'Ctrl+C' in t,timeout=5)
            assert 'Ctrl+C' in screen,screen
            assert not dead(tty),screen
            assert 'KEEP_DRAFT' in screen,screen
            if name=='draft':
                tty.send_text('X');press();assert not dead(tty)
            if name=='expiry':
                time.sleep(2.2);press();assert not dead(tty)
            press()
        deadline=time.monotonic()+15
        while not dead(tty) and time.monotonic()<deadline:time.sleep(.1)
        assert dead(tty),tty.capture()
        screen=tty.capture();assert 'KEEP_DRAFT' not in screen,screen
        (root/(name+'.txt')).write_text(screen)
        print('PASS '+name,flush=True)
    except Exception:
        stderr_path=config/'cli-stderr.log'
        print(f'FAIL {name}; stderr={stderr_path}',file=sys.stderr,flush=True)
        try:
            stderr_text=stderr_path.read_text(encoding='utf-8',errors='replace')
        except OSError as stderr_error:
            stderr_text=f'<stderr read failed: {stderr_error}>'
        print(stderr_text,file=sys.stderr,flush=True)
        raise
    finally:tty.stop()
 print('PASS Ctrl+C/SIGINT/hangup real terminal; evidence='+str(root))
finally:server.close()
