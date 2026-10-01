"""Isolated typed-decision service. Never imported by product startup/tool_search.

Call prepare explicitly, then evaluate; close with a context manager. Model judgments
are uncalibrated. This harness does not grant tool execution or product data authority.
"""
from __future__ import annotations
from dataclasses import dataclass
import hashlib
import importlib.metadata
import json
import math
import multiprocessing
import os
from pathlib import Path
import re
import shutil
import signal
import stat
import tempfile
import threading
import time
import urllib.error
import urllib.request
import uuid

MAX_FRAME = 1024 * 1024
LAYA_REVISION = 'e4e9ddf21a7b1903b7acffd8814ad4307bf63a67'
REQUIRED_ASSETS = ('model.safetensors', 'rl_agent_config.json', 'encoder/config.json',
                   'tokenizer/tokenizer.json', 'tokenizer/tokenizer_config.json')
CODES = {'invalid_input','unsupported','invalid_response','unavailable','closed','busy',
         'timeout','cancelled','remote_not_authorized','remote_error','missing_key',
         'asset_mismatch','runtime_mismatch','input_truncated','device_fallback','worker_error','cleanup_failed'}

class DecisionError(Exception):
    def __init__(self, code):
        self.code = code if code in CODES else 'worker_error'
        super().__init__(self.code)

@dataclass(frozen=True)
class Option:
    id: str
    description: str

@dataclass(frozen=True)
class Question:
    id: str
    type: str
    instructions: str
    options: tuple[Option, ...] = ()
    direction: str | None = None

def require(condition, code='invalid_response'):
    if not condition: raise DecisionError(code)

def dumps(value):
    try:return json.dumps(value,ensure_ascii=False,allow_nan=False,separators=(',',':')).encode('utf-8')
    except (ValueError,TypeError,UnicodeError):raise DecisionError('invalid_input') from None

def parse_json(data):
    def pairs(items):
        d={}
        for k,v in items:
            if k in d:raise ValueError('duplicate')
            d[k]=v
        return d
    try:
        require(len(data)<=MAX_FRAME)
        d=json.loads(data.decode('utf-8'),object_pairs_hook=pairs,
                     parse_constant=lambda _: (_ for _ in ()).throw(ValueError('constant')))
        require(type(d) is dict)
        return d
    except (ValueError,TypeError,UnicodeError,RecursionError):raise DecisionError('invalid_response') from None

def text(value):return type(value) is str and bool(value.strip())

def clone_plain(value, depth=0):
    require(depth<=16,'invalid_input')
    if value is None or type(value) in (str,bool,int):return value
    if type(value) is float:
        require(math.isfinite(value),'invalid_input');return value
    if type(value) in (tuple,list):return [clone_plain(v,depth+1) for v in value]
    if type(value) is dict:
        require(all(type(k) is str for k in value),'invalid_input')
        return {k:clone_plain(v,depth+1) for k,v in value.items()}
    raise DecisionError('invalid_input')

def validate_request(state, questions, deadline=None):
    def check_time():
        if deadline is not None:require(time.monotonic()<deadline,'timeout')
    def field(value,limit):
        require(type(value) is str and 0<len(value)<=limit,'invalid_input')
        require(bool(value.strip()) and len(value.encode('utf-8'))<=limit,'invalid_input')
        return value
    try:
        check_time()
        require(type(state) is str and len(state)<=16000,'invalid_input')
        require(type(questions) is tuple and 1<=len(questions)<=32,'invalid_input')
        qs=[];ids=set();budget=len(state.encode('utf-8'))
        for q in questions:
            check_time()
            require(type(q) is Question,'invalid_input')
            raw_id,qtype,raw_instructions,options,direction=q.id,q.type,q.instructions,q.options,q.direction
            require(type(options) is tuple,'invalid_input')
            qid=field(raw_id,128);instructions=field(raw_instructions,4096)
            require(qid not in ids,'invalid_input');ids.add(qid)
            require(type(qtype) is str and qtype in ('noul','choice','score'),'unsupported')
            if qtype=='noul':require(len(options)==0 and direction is None,'invalid_input')
            else:
                require(2<=len(options)<=(10 if qtype=='score' else 32),'invalid_input')
                require((type(direction) is str and direction=='ascending') if qtype=='score' else direction is None,'invalid_input')
            opts=[];option_ids=set()
            for o in options:
                check_time();require(type(o) is Option,'invalid_input')
                oid=field(o.id,128);description=field(o.description,1024)
                require(oid not in option_ids,'invalid_input');option_ids.add(oid)
                opts.append({'id':oid,'description':description})
            item={'id':qid,'type':qtype,'instructions':instructions,'options':opts,'direction':direction}
            budget+=len(dumps(item));require(budget<=65536,'invalid_input');qs.append(item)
        result={'state':state,'questions':qs}
        require(len(dumps(result))<=65536,'invalid_input');check_time()
        return result
    except (KeyError,TypeError,ValueError,AttributeError,UnicodeError):raise DecisionError('invalid_input') from None

def encode_questions(questions):
    result={}
    for i,q in enumerate(questions):
        item={'type':q['type'],'instructions':q['instructions']}
        if q['type']=='choice':item['criteria']={f'o{j}':o['description'] for j,o in enumerate(q['options'])}
        elif q['type']=='score':item['criteria']=[o['description'] for o in q['options']]
        result[f'q{i}']=item
    return result

def number(value):return type(value) in (int,float) and math.isfinite(value)

def decode_answers(body, questions, provider, revision):
    try:
        require(type(body) is dict and body.get('model')==('laya-rl-agent' if provider=='laya' else revision))
        raw=body.get('answers');require(type(raw) is dict and set(raw)=={f'q{i}' for i in range(len(questions))})
        answers=[]
        for i,q in enumerate(questions):
            a=raw[f'q{i}'];require(type(a) is dict and a.get('type')==q['type'])
            answer={'id':q['id'],'type':q['type']}
            if q['type']=='noul':
                p=a.get('noul');require(number(p) and 0<=p<=1);answer['probabilityYes']=p
            else:
                keys=[f'o{j}' if q['type']=='choice' else str(j) for j in range(len(q['options']))]
                probs=a.get('probabilities');require(type(probs) is dict and set(probs)==set(keys))
                vals=[probs[k] for k in keys]
                require(all(number(v) and 0<=v<=1 for v in vals))
                tol=len(vals)*.00005+1e-6 if provider=='laya' else 1e-5
                require(abs(sum(vals)-1)<=tol)
                answer['probabilities']=[{'id':o['id'],'p':v} for o,v in zip(q['options'],vals)]
                if q['type']=='choice':
                    require(a.get('choice') in keys)
                    require(max(vals)-probs[a['choice']]<=tol)
                else:
                    require(a.get('legend')=={str(j):o['description'] for j,o in enumerate(q['options'])})
                    weighted=sum(j*v for j,v in enumerate(vals))
                    require(number(a.get('score')) and abs(a['score']-weighted)<=tol*len(vals)+.00005)
                    answer['score']=weighted/(len(vals)-1)
            answers.append(answer)
        usage=body.get('usage',{})
        require(type(usage) is dict)
        for v in usage.values():require(v is None or (type(v) is int and v>=0))
        return {'answers':answers,'calibrationId':None,
                'usage':{'inputTokens':usage.get('input_tokens'),'outputTokens':usage.get('output_tokens')}}
    except (KeyError,TypeError,ValueError,AttributeError):raise DecisionError('invalid_response') from None

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,newurl):return None

def fetch_jev(request, model, key, timeout):
    require(text(key),'missing_key')
    req=urllib.request.Request('https://api.typesafe.ai/v1/systemone',
        data=dumps({'model':model,**request}),method='POST',
        headers={'Authorization':'Bearer '+key,'Content-Type':'application/json'})
    try:
        with urllib.request.build_opener(NoRedirect()).open(req,timeout=timeout) as response:
            return parse_json(response.read(MAX_FRAME+1))
    except urllib.error.HTTPError as exc:
        exc.close();raise DecisionError('remote_error') from None
    except (OSError,ValueError):raise DecisionError('remote_error') from None

def file_hash(path):
    h=hashlib.sha256()
    with open(path,'rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''):h.update(chunk)
    return h.hexdigest()

def asset_manifest():
    return parse_json(Path(__file__).with_name('laya-manifest.json').read_bytes())

def verify_assets(config):
    root=Path(config.get('model_dir',''))
    require(root.is_absolute() and root.is_dir() and not root.is_symlink(),'asset_mismatch')
    root=root.resolve()
    manifest=asset_manifest()
    expected=manifest['assets']
    require(config.get('model')==manifest['modelRevision'],'asset_mismatch')
    seen=set();folded=set()
    allowed_dirs={str(Path(n).parent) for n in expected if str(Path(n).parent)!='.'}
    for target in root.rglob('*'):
        rel=str(target.relative_to(root)).replace(os.sep,'/')
        mode=target.lstat().st_mode
        require(not stat.S_ISLNK(mode),'asset_mismatch')
        if stat.S_ISDIR(mode):require(rel in allowed_dirs,'asset_mismatch');continue
        require(stat.S_ISREG(mode) and rel in expected and rel.casefold() not in folded,'asset_mismatch')
        folded.add(rel.casefold());seen.add(rel)
        require(target.stat().st_size==expected[rel]['bytes'] and file_hash(target)==expected[rel]['sha256'],'asset_mismatch')
    require(seen==set(expected),'asset_mismatch')
    return manifest

def stage_assets(config):
    manifest=verify_assets(config)
    source=Path(config['model_dir']).resolve();dest=Path(config['_staging'])
    for name,entry in manifest['assets'].items():
        target=dest/Path(name);target.parent.mkdir(parents=True,exist_ok=True)
        # Private host-owned copy prevents later replacement of the original path during loading.
        fd=os.open(source/Path(name),os.O_RDONLY|getattr(os,'O_NOFOLLOW',0))
        with os.fdopen(fd,'rb') as src,open(target,'xb') as out:
            require(stat.S_ISREG(os.fstat(src.fileno()).st_mode),'asset_mismatch')
            shutil.copyfileobj(src,out,1024*1024)
        require(target.stat().st_size==entry['bytes'] and file_hash(target)==entry['sha256'],'asset_mismatch')
        target.chmod(0o400)
    staged={**config,'model_dir':str(dest)}
    verify_assets(staged)
    return staged,manifest

class LayaBackend:
    def __init__(self,config):
        os.environ['HF_HUB_OFFLINE']='1';os.environ['TRANSFORMERS_OFFLINE']='1';os.environ['TOKENIZERS_PARALLELISM']='false'
        require(importlib.metadata.version('laya')=='0.3.20','runtime_mismatch')
        config,manifest=stage_assets(config)
        expected=manifest['runtimes'].get(config.get('device','cpu'))
        require(type(expected) is dict,'runtime_mismatch')
        require(all(importlib.metadata.version(n)==v for n,v in expected.items()),'runtime_mismatch')
        import torch
        from laya import Agent
        torch.set_num_threads(4)
        self.device=config.get('device','cpu')
        require(self.device in ('cpu','mps','cuda'),'invalid_input')
        if self.device=='cuda':torch.cuda.set_per_process_memory_fraction(.015)
        # Force explicit local-only, no-remote-code loading for the pinned library's factory calls.
        from unittest.mock import patch
        from transformers import AutoConfig,AutoTokenizer,AutoModel
        patches=[]
        for factory in (AutoConfig,AutoTokenizer,AutoModel):
            original=factory.from_pretrained
            def local_loader(*args,_original=original,**kwargs):
                kwargs.update(local_files_only=True,trust_remote_code=False)
                return _original(*args,**kwargs)
            patches.append(patch.object(factory,'from_pretrained',side_effect=local_loader))
        from contextlib import ExitStack
        with ExitStack() as stack:
            for guard in patches:stack.enter_context(guard)
            self.agent=Agent(config['model_dir'],device=self.device,compile=False,fast=False)
        require(self.agent.device.type==self.device,'device_fallback')
        verify_assets(config)  # Any automatic tokenizer rewrite must have been normalized and pinned before prepare.
        self.seen=[]
        self.hook=self.agent.model.register_forward_pre_hook(lambda m,_:self.seen.append(str(next(m.parameters()).device)))
        self.runtime={n:importlib.metadata.version(n) for n in ('laya','torch','transformers','safetensors','huggingface_hub')}
        self.precision_contract={**manifest['precision'][self.device],'device':self.device,'parameterDevice':self.device}
        self._assert_precision()
        self.runtime.update(self._precision())
    def _precision(self):
        parameter=next(self.agent.model.parameters())
        result={'device':self.agent.device.type,'parameterDevice':parameter.device.type,
                'parameterDtype':str(parameter.dtype),'configuredDtype':str(self.agent.dtype),'ampEnabled':self.agent.amp_enabled}
        if self.device=='mps':result['mpsAmpMinRows']=self.agent.mps_amp_min_rows
        return result
    def _assert_precision(self):
        require(self._precision()==self.precision_contract,'runtime_mismatch')
    def evaluate(self,state,questions):
        from laya.common import render_options
        self._assert_precision()
        ids=list(questions);internal={k:self.agent._to_internal(v) for k,v in questions.items()}
        tok=self.agent.tok
        require(tok.mask_token not in state,'input_truncated')
        for q in internal.values():
            require(tok.mask_token not in str(q),'input_truncated')
            for option in render_options(q):
                require(len(tok(' '+option,add_special_tokens=False)['input_ids'])<=48,'input_truncated')
        actual=self.agent._encode_state(state,ids,internal,max_len=1024,head_max_len=256)
        full=self.agent._encode_state(state,ids,internal,max_len=100000,head_max_len=100000)
        require(actual==full,'input_truncated')
        self.seen.clear()
        result=self.agent.predict(state,questions,max_len=1024,head_max_len=256)
        require(self.agent.device.type==self.device and self.seen and all(d.split(':')[0]==self.device for d in self.seen),'device_fallback')
        self._assert_precision()
        return result

def send(conn,value):
    try:data=dumps(value)
    except DecisionError:raise DecisionError('invalid_response') from None
    require(len(data)<=MAX_FRAME,'invalid_response');conn.send_bytes(data)

def worker(conn,config,backend_factory=None):
    try:
        provider=config['provider'];model=config['model']
        if backend_factory is not None:backend=backend_factory(config);runtime=backend.runtime
        elif provider=='laya':backend=LayaBackend(config);runtime=backend.runtime
        else:
            require(text(os.environ.get('TYPESAFE_API_KEY')),'missing_key');backend=None;runtime={'transport':'urllib-https-v1'}
        send(conn,{'type':'ready','provider':provider,'modelRevision':model,'runtime':runtime,'processGroup':os.getpgrp(),'capabilities':['noul','choice','score'] if backend else ['noul']})
        while True:
            req=parse_json(conn.recv_bytes(MAX_FRAME));questions=encode_questions(req['questions'])
            try:
                body=backend.evaluate(req['state'],questions) if backend else fetch_jev(
                    {'state':req['state'],'questions':questions},model,os.environ.get('TYPESAFE_API_KEY'),req['timeout'])
                send(conn,{'type':'result','id':req['id'],'body':body})
            except DecisionError as exc:send(conn,{'type':'error','id':req['id'],'code':exc.code})
            except Exception:send(conn,{'type':'error','id':req['id'],'code':'worker_error'})
    except DecisionError as exc:
        try:send(conn,{'type':'error','code':exc.code})
        except (OSError,EOFError):pass
    except (OSError,EOFError):pass
    except Exception:
        try:send(conn,{'type':'error','code':'worker_error'})
        except (OSError,EOFError):pass
    finally:conn.close()

def launch_worker(conn,config,target):
    # Establish the owned group before backend/model code or a test peer can spawn children.
    os.setsid()
    target(conn,config)

class DecisionService:
    def __init__(self,config,*,_worker_target=worker):
        require(os.name=='posix','unsupported')  # Windows process-tree cancellation not verified.
        require(type(config) is dict and len(config)<=4,'invalid_input')
        absent=object();snapshot={}
        for name in ('provider','model','model_dir','device'):
            value=config.get(name,absent)
            if value is not absent:snapshot[name]=value
        require(len(snapshot)==len(config) and all(type(v) is str and len(v)<=4096 for v in snapshot.values()),'invalid_input')
        self.config=snapshot
        require(self.config.get('provider') in ('laya','jev'),'unsupported')
        if self.config['provider']=='jev':require(self.config.get('model')=='jev-1.13.0','invalid_input')
        self._target=_worker_target;self._process=None;self._conn=None;self._ready=None
        self._lock=threading.Lock();self._closed=threading.Event();self._io=None;self._staging=None;self._state='new';self._poisoned=False;self._pgid=None;self._worker_dead=True
    @property
    def pid(self):return self._process.pid if self._process else None
    @property
    def busy(self):return self._lock.locked()
    def __enter__(self):return self
    def __exit__(self,*_):self.close()
    @property
    def state(self):return self._state
    def _stop(self):
        self._ready=None;cleanup_deadline=time.monotonic()+2;failed=False
        process=self._process;owned_group=self._pgid
        # Group ownership is single-use. A later unrelated cleanup failure must never
        # cause another signal to an old, potentially reused PGID.
        self._pgid=None
        def attempt(action):
            nonlocal failed
            try:return action()
            except Exception:failed=True;return None
        def group_signal(sig):
            try:os.killpg(owned_group,sig)
            except ProcessLookupError:pass
        def observe_liveness():
            running=attempt(process.is_alive)
            if running is False:self._worker_dead=True
            return running
        if owned_group:attempt(lambda:group_signal(signal.SIGTERM))
        if process:
            pid=attempt(lambda:process.pid)
            started=bool(pid) or not self._worker_dead
            if started:
                observe_liveness()
                if not self._worker_dead:attempt(process.terminate)
                attempt(lambda:process.join(.1))
            # If pid lookup failed, never turn an unknown live process into a dead fact.
        if owned_group:attempt(lambda:group_signal(signal.SIGKILL))
        if process:
            if started:
                observe_liveness()
                if not self._worker_dead:attempt(process.kill)
                attempt(lambda:process.join(max(0,cleanup_deadline-time.monotonic())))
                observe_liveness()
                if not self._worker_dead:failed=True
            if self._worker_dead:
                # Close failure does not erase the independently established dead fact.
                try:process.close();self._process=None
                except Exception:failed=True
        else:self._worker_dead=True
        if self._conn:
            try:self._conn.close();self._conn=None
            except Exception:failed=True
        if self._io:
            try:
                if self._io.ident is not None:self._io.join(max(0,cleanup_deadline-time.monotonic()))
                require(not self._io.is_alive(),'cleanup_failed');self._io=None
            except Exception:failed=True
        if self._staging and self._worker_dead:
            try:shutil.rmtree(self._staging);self._staging=None
            except Exception:failed=True
        # If the OS refuses to stop a live worker, retain its private files for explicit
        # operator cleanup, report failure and permanently prohibit automatic reuse.
        self._poisoned=self._poisoned or failed
        self._state='closed' if self._closed.is_set() else ('failed' if self._poisoned else 'unavailable')
        require(not failed,'cleanup_failed')
    def _acquire(self):
        require(not self._closed.is_set(),'closed');require(not self._poisoned,'cleanup_failed')
        if not self._lock.acquire(False):
            require(not self._closed.is_set(),'closed')
            raise DecisionError('busy')
    def _check(self,deadline,cancel=None):
        require(not self._closed.is_set(),'closed')
        require(not (cancel and cancel.is_set()),'cancelled')
        require(time.monotonic()<deadline,'timeout')
    def _exchange(self,deadline,cancel=None,request=None):
        done=threading.Event();box={};conn=self._conn
        wire=dumps(request) if request is not None else None
        if wire is not None:require(len(wire)<=MAX_FRAME,'invalid_input')
        def io():
            try:
                if wire is not None:conn.send_bytes(wire)
                box['data']=conn.recv_bytes(MAX_FRAME)
            except (OSError,EOFError):box['error']='invalid_response'
            finally:done.set()
        self._io=threading.Thread(target=io,name='decision-provider-io',daemon=True)
        self._io.start()
        while not done.wait(.01):
            self._check(deadline,cancel)
            require(self._process.is_alive(),'unavailable')
        self._io.join();self._io=None
        self._check(deadline,cancel)
        require('error' not in box)
        return parse_json(box['data'])
    def prepare(self,timeout=60,cancel=None):
        require(cancel is None or type(cancel) is threading.Event,'invalid_input')
        require(number(timeout) and 0<timeout<=300,'invalid_input')
        deadline=time.monotonic()+timeout
        self._acquire()
        try:
            self._check(deadline,cancel)
            if self._ready and self._process.is_alive():return clone_plain(self._ready)
            self._stop();self._check(deadline,cancel);self._state='preparing'
            self._staging=tempfile.mkdtemp(prefix='xiaok-decision-model-') if self.config['provider']=='laya' else None
            context=multiprocessing.get_context('spawn');self._conn,child=context.Pipe(duplex=True)
            self._process=context.Process(target=launch_worker,args=(child,{**self.config,**({'_staging':self._staging} if self._staging else {})},self._target),daemon=True)
            try:
                self._process.start();self._pgid=self._process.pid;self._worker_dead=False
            finally:child.close()
            reply=self._exchange(deadline,cancel)
            if reply.get('type')=='error':raise DecisionError(reply.get('code'))
            require(reply.get('type')=='ready' and reply.get('provider')==self.config['provider'] and reply.get('modelRevision')==self.config['model'] and type(reply.get('runtime')) is dict)
            if reply.get('processGroup') is not None:require(reply['processGroup']==self._pgid)
            caps=reply.get('capabilities')
            require(type(caps) is list and all(type(c) is str and c in ('noul','choice','score') for c in caps) and len(caps)==len(set(caps)))
            if self._target is worker:require(set(caps)==({'noul','choice','score'} if self.config['provider']=='laya' else {'noul'}))
            self._ready=reply;self._state='ready';return clone_plain(reply)
        except DecisionError:self._stop();raise
        except Exception:self._stop();raise DecisionError('worker_error') from None
        finally:self._lock.release()
    def evaluate(self,state,questions,*,timeout=5,cancel=None,allow_remote=False):
        require(cancel is None or type(cancel) is threading.Event,'invalid_input')
        require(number(timeout) and 0<timeout<=300,'invalid_input');deadline=time.monotonic()+timeout
        self._acquire()
        try:
            self._check(deadline,cancel)
            require(self._ready is not None and self._process.is_alive(),'unavailable')
            require(self.config['provider']!='jev' or allow_remote is True,'remote_not_authorized')
            request=validate_request(state,questions,deadline)
            require(all(q['type'] in self._ready.get('capabilities',[]) for q in request['questions']),'unsupported')
            self._check(deadline,cancel)
            request.update(id=uuid.uuid4().hex,timeout=max(.001,deadline-time.monotonic()))
            self._state='busy'
            reply=self._exchange(deadline,cancel,request)
            require(reply.get('id')==request['id'])
            if reply.get('type')=='error':raise DecisionError(reply.get('code'))
            require(reply.get('type')=='result')
            result=decode_answers(reply.get('body'),request['questions'],self.config['provider'],self.config['model'])
            result['provenance']={**clone_plain(self._ready),'protocolVersion':'typed-decision-spike-v1'}
            result['provenance'].pop('type',None)
            self._check(deadline,cancel)
            self._state='ready'
            return result
        except DecisionError as exc:
            if exc.code not in ('invalid_input','unsupported','remote_not_authorized'):self._stop()
            raise
        except Exception:self._stop();raise DecisionError('worker_error') from None
        finally:self._lock.release()
    def close(self):
        self._closed.set()
        with self._lock:self._stop()
