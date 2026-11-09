#!/usr/bin/env python3
"""Real CLI/SDK/TTY: GLM and Kimi quota stops, rate reason waits then resumes."""
import argparse
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import tempfile
import time

parser=argparse.ArgumentParser()
parser.add_argument('--cli-entry',type=Path,required=True)
args=parser.parse_args()
root=Path(tempfile.mkdtemp(prefix='xiaok-provider-errors-tty-'))
socket=root.name
node=shutil.which('node')
tmux_bin=shutil.which('tmux')
assert node and tmux_bin
fixture=Path(__file__).with_name('provider-errors-fixture.mjs').resolve()
def tmux(*commands,check=True):
    return subprocess.run([tmux_bin,'-L',socket,*commands],capture_output=True,text=True,check=check,timeout=10)
results=[]
for provider in ['glm','kimi']:
    case=root/provider
    config=case/'config'
    project=case/'project'
    config.mkdir(parents=True)
    project.mkdir()
    model='GLM-5.3' if provider=='glm' else 'k3'
    base='https://open.bigmodel.cn/api/coding/paas/v4' if provider=='glm' else 'https://api.kimi.com/coding/v1'
    (config/'config.json').write_text(json.dumps({'schemaVersion':2,'defaultProvider':provider,'defaultModelId':'fixture',
        'providers':{provider:{'type':'first_party','protocol':'openai_legacy','baseUrl':base,'apiKey':'fictional'}},
        'models':{'fixture':{'provider':provider,'model':model,'capabilities':['tools','thinking']}},
        'defaultMode':'auto','channels':{},'automations':{'enabled':False},'memory':{'enabled':False},'intentBoundary':{'enabled':False}}))
    env={'XIAOK_CONFIG_DIR':str(config),'XIAOK_PROVIDER_ERROR_PROBE_DIR':str(case),'XIAOK_DISABLE_GLOBAL_PLUGINS':'1',
         'XIAOK_TURN_TIMEOUT_MS':'10000','XIAOK_MODEL_RECOVERY_WINDOW_MS':'10000'}
    command=' '.join([*(k+'='+shlex.quote(v) for k,v in env.items()),shlex.quote(node),'--import',shlex.quote(str(fixture)),shlex.quote(str(args.cli_entry.resolve())),'chat','--auto','2>'+shlex.quote(str(case/'stderr.log'))])
    def capture(): return tmux('capture-pane','-p','-S','-1000','-t',provider).stdout
    def until(predicate,timeout=30):
        end=time.monotonic()+timeout
        while time.monotonic()<end:
            pane=capture()
            if predicate(pane): return pane
            time.sleep(.1)
        raise AssertionError(capture())
    def send(text):
        tmux('send-keys','-l','-t',provider,text)
        tmux('send-keys','-t',provider,'Enter')
    try:
        tmux('new-session','-d','-s',provider,'-x','190','-y','45','-c',str(project),command)
        tmux('set-option','-t',provider,'remain-on-exit','on')
        until(lambda p:'❯' in p)
        send('PROVIDER_QUOTA_CASE: report the provider error')
        quota=until(lambda p:'套餐额度已用尽' in p and '已停止自动重试' in p)
        assert 'HTTP 429' in quota,quota
        assert ('1310' in quota and '2026-12-10 09:30:00' in quota) if provider=='glm' else 'Kimi' in quota
        assert '自动续接（' not in quota,quota
        send('PROVIDER_RATE_CASE: report a short rate limit and resume')
        rate=until(lambda p:'请求频率受限' in p and '3 秒后自动续接' in p)
        assert 'HTTP 429' in rate,rate
        assert ('1302' in rate) if provider=='glm' else 'Kimi' in rate
        done=until(lambda p:'PROVIDER_RATE_RECOVERED' in p)
        requests=[json.loads(line) for line in (case/'requests.jsonl').read_text().splitlines()]
        assert len([r for r in requests if r['kind']=='quota'])==1,requests
        rates=[r for r in requests if r['kind']=='rate']
        assert len(rates)==2 and rates[1]['time']-rates[0]['time']>=2900,requests
        log=(config/'logs'/'xiaok.log').read_text()
        for sink in [done,log,(case/'stderr.log').read_text()]:
            assert 'PRIVATE_CANARY' not in sink and 'sk-fictional' not in sink,sink
        for name,pane in [('quota',quota),('rate',rate),('done',done)]: (case/(name+'-pane.txt')).write_text(pane)
        results.append({'provider':provider,'quotaRequests':1,'rateRequests':2,'waitMs':rates[1]['time']-rates[0]['time']})
    finally:
        tmux('send-keys','-t',provider,'C-c',check=False)
        tmux('send-keys','-t',provider,'C-c',check=False)
        tmux('kill-session','-t',provider,check=False)
        if (case/'cli.pid').exists():
            pid=int((case/'cli.pid').read_text())
            for _ in range(30):
                try: os.kill(pid,0)
                except ProcessLookupError: break
                time.sleep(.1)
            else:
                os.kill(pid,15)
                for _ in range(30):
                    try: os.kill(pid,0)
                    except ProcessLookupError: break
                    time.sleep(.1)
                else: raise AssertionError('owned CLI process still running')
(root/'result.json').write_text(json.dumps({'passed':True,'cases':results,'cliProcessesRemaining':0},indent=2))
print('PASS',root,json.dumps(results), 'owned CLI processes remaining=0')
