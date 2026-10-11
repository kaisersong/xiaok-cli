import importlib.util,json,os,subprocess,tempfile,time,sys
from pathlib import Path
repo=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('tty',repo/'tests/e2e/tmux-e2e.py');tty=importlib.util.module_from_spec(spec);sys.modules['tty']=tty;spec.loader.exec_module(tty)
root=Path(tempfile.mkdtemp(prefix='xiaok-activity-tty-')).resolve();project=root/'workspace';project.mkdir();home=root/'home';home.mkdir();config=root/'config'
server=tty.FakeOpenAIServer([tty.text_response_events('TTY_HELLO')]);server.start();tty.write_config(config,server.base_url)
h=tty.TmuxHarness(f'xiaok-activity-{os.getpid()}',project,config,home,repo/'dist/index.js',tty.resolve_tmux_binary(),env_overrides={'XIAOK_DISABLE_GLOBAL_PLUGINS':'1','NO_COLOR':''})
ownerpid=None
try:
 h.start(rows=32,cols=100);text=h.wait_for(lambda t:'❯'in t,timeout=20);assert '❯' in text,text
 h.send_text('你好');h.send_key('Enter');text=h.wait_for(lambda t:'TTY_HELLO'in t,timeout=20);assert 'TTY_HELLO'in text,text
 h.send_text('中文尚未发送');h.send_key('C-j');h.send_text('第二行草稿')
 before=h.capture();(root/'before.txt').write_text(before);cursor_before=h.tmux('display-message','-p','-t',h.session,'#{cursor_x}:#{cursor_y}').stdout.strip()
 result=subprocess.run(['node',str(repo/'tests/support/conversation-activity-tty-source.mjs'),str(repo),str(config),str(project)],capture_output=True,text=True,timeout=15);assert result.returncode==0,result.stderr
 source=json.loads(result.stdout);ownerpid=source['owner']['pid'];(root/'source.json').write_text(json.dumps(source))
 text=h.wait_for(lambda t:'TTY_BG_DONE'in t and'已完成'in t,timeout=10);(root/'delivered.txt').write_text(text)
 assert '中文尚未发送'in text and'第二行草稿'in text,text
 cursor_after=h.tmux('display-message','-p','-t',h.session,'#{cursor_x}:#{cursor_y}').stdout.strip();assert cursor_after==cursor_before,(cursor_before,cursor_after,text);(root/'cursor.json').write_text(json.dumps({'before':cursor_before,'after':cursor_after}))
 prompt=next(i for i,l in reversed(list(enumerate(text.splitlines())))if'❯'in l);done=next(i for i,l in enumerate(text.splitlines())if'异步任务'in l and'已完成'in l)
 assert done<prompt,text
 h.send_key('C-u');h.send_key('C-a');h.send_key('C-u');h.send_key('C-c');time.sleep(.2);h.send_text('/exit');h.send_key('Enter');time.sleep(1)
 h.stop();h.extra_args=['--resume',source['sessionId']];h.start(rows=32,cols=100)
 text=h.wait_for(lambda t:'❯'in t,timeout=20);(root/'resumed.txt').write_text(text);assert'❯'in text,text
 assert'异步任务'not in text or'TTY_BG_DONE'not in text,text
 assert len(server.requests)==1,server.requests
 print(json.dumps({'status':'passed','root':str(root),'modelCalls':len(server.requests),'ownerPid':ownerpid,'sessionId':source['sessionId']}))
finally:
 h.stop();server.close()
 if ownerpid:
  try:os.kill(ownerpid,15)
  except ProcessLookupError:pass
 print('TTY evidence:',root)
